/**
 * EchoDeck v9.5 多对话页全权限 AI 智能体工作台（GlobalAiCopilot）：
 * 1. 多对话页（默认保留 3 个专属对话页：🎬 追剧搜片 / 🗣️ 口语实战 / 📚 词卡私教，并支持 + 新建最多 10 个独立对话页，互不串上下文）
 * 2. 多步 ReAct 自主智能体（最多 3 轮工具链 + 实时步骤进度流 + 智能上下文快捷跟进胶囊）
 * 3. 长期学习记忆档案（🧠 记忆面板：查看/增删 AI 记住的你的水平、偏好、兴趣与易错点，跨会话长期生效）
 * 4. 🔊 自动朗读开关 + 顶栏 16 款真人音色快捷切换 + 8 语种实时切换 + 点击气泡 0ms 看中文翻译
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brain,
  Check,
  Mic,
  MicOff,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { runEchoAgentTurn, type AgentTurnMessage } from "../lib/aiAgentEngine";
import {
  buildWelcomeMessageForSession,
  createNewCopilotSession,
  deriveAutoSessionTitle,
  getAutoSpeakPref,
  getSessionModePromptHint,
  loadCopilotSessions,
  saveCopilotSessions,
  setAutoSpeakPref,
  type CopilotSession,
} from "../lib/aiSessionStore";
import {
  echoAgentBridge,
  getStudyLangMeta,
  STUDY_LANGUAGE_CATALOG,
} from "../lib/appAgentBridge";
import {
  addLearnerMemory,
  getMemoryCategoryMeta,
  listLearnerMemories,
  removeLearnerMemory,
  type LearnerMemoryItem,
} from "../lib/learnerMemory";
import { isSupertonicCached } from "../lib/localSupertonicTts";
import { speakOffline, stopAllSpeech } from "../lib/nativeBridge";
import {
  ALL_VOICE_PRESETS,
  getSelectedVoiceId,
  getVoicePresetById,
  setSelectedVoiceId,
  subscribeSelectedVoice,
} from "../lib/voiceCatalog";
import type { TabKey } from "../types";
import { AiAssistantBubble } from "./AiAssistantBubble";

interface GlobalAiCopilotProps {
  open: boolean;
  activeTab: TabKey;
  presetPrompt?: string;
  onConsumePreset?: () => void;
  onClose: () => void;
}

export function GlobalAiCopilot({
  open,
  activeTab,
  presetPrompt,
  onConsumePreset,
  onClose,
}: GlobalAiCopilotProps) {
  const initialData = useMemo(() => loadCopilotSessions(echoAgentBridge.getActiveStudyLang()), []);

  const [sessions, setSessions] = useState<CopilotSession[]>(initialData.sessions);
  const [activeSessionId, setActiveSessionId] = useState<string>(initialData.activeId);
  const [studyLang, setStudyLang] = useState<string>(() => echoAgentBridge.getActiveStudyLang());
  const [voiceId, setVoiceId] = useState<string>(() => getSelectedVoiceId());
  const [autoSpeak, setAutoSpeak] = useState<boolean>(() => getAutoSpeakPref());

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyStatus, setBusyStatus] = useState("");
  const [listening, setListening] = useState(false);
  const [toast, setToast] = useState("");

  // 长期记忆面板与重命名状态
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const [memories, setMemories] = useState<LearnerMemoryItem[]>(() => listLearnerMemories());
  const [newMemText, setNewMemText] = useState("");
  const [newMemCat, setNewMemCat] = useState<LearnerMemoryItem["category"]>("preference");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const recogRef = useRef<any>(null);
  const reqSeqRef = useRef<number>(0);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || sessions[0],
    [sessions, activeSessionId]
  );
  const messages = activeSession?.messages || [];
  const langMeta = useMemo(() => getStudyLangMeta(studyLang), [studyLang]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((c) => (c === msg ? "" : c)), 2600);
  };

  // 持久保存全部对话页与当前选中页
  useEffect(() => {
    saveCopilotSessions(sessions, activeSession?.id || activeSessionId);
  }, [sessions, activeSession?.id, activeSessionId]);

  // 订阅全应用学习语种切换
  useEffect(() => {
    return echoAgentBridge.subscribeActiveStudyLang((nextLang) => {
      setStudyLang(nextLang);
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId && s.messages.length === 1 && s.messages[0].id === "ag_welcome"
            ? { ...s, studyLang: nextLang, messages: [buildWelcomeMessageForSession(nextLang, s.mode)] }
            : s
        )
      );
    });
  }, [activeSessionId]);

  // 订阅全局音色切换
  useEffect(() => {
    return subscribeSelectedVoice((nextVoiceId) => {
      setVoiceId(nextVoiceId);
    });
  }, []);

  useEffect(() => {
    if (open) {
      setMemories(listLearnerMemories());
      setTimeout(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      }, 80);
    } else if (listening) {
      try {
        recogRef.current?.stop();
      } catch {
        // ignore
      }
      setListening(false);
    }
  }, [open, activeSessionId, messages.length, busyStatus, listening]);

  const updateSessionById = (id: string, updater: (s: CopilotSession) => CopilotSession) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
  };

  const handleSelectSession = (sess: CopilotSession) => {
    if (busy) return;
    setActiveSessionId(sess.id);
    setRenamingId(null);
    if (sess.studyLang && sess.studyLang !== studyLang) {
      setStudyLang(sess.studyLang);
      echoAgentBridge.setActiveStudyLang(sess.studyLang);
    }
  };

  const handleCreateSession = () => {
    if (busy) return;
    if (sessions.length >= 10) {
      showToast("最多同时保留 10 个对话页，可先关闭不常用的分页");
      return;
    }
    const created = createNewCopilotSession(studyLang, sessions.length + 1);
    setSessions((prev) => [...prev, created]);
    setActiveSessionId(created.id);
    setShowMemoryPanel(false);
    showToast(`已新建「${created.title}」独立对话页`);
  };

  const handleDeleteSession = (id: string) => {
    if (busy) return;
    if (sessions.length <= 1) {
      showToast("至少保留 1 个对话页");
      return;
    }
    const next = sessions.filter((s) => s.id !== id);
    setSessions(next);
    if (activeSessionId === id) {
      setActiveSessionId(next[0].id);
    }
    showToast("已关闭该对话页");
  };

  const handleClearCurrentSession = () => {
    if (busy || !activeSession) return;
    updateSessionById(activeSession.id, (s) => ({
      ...s,
      messages: [buildWelcomeMessageForSession(studyLang, s.mode)],
      updatedAt: Date.now(),
    }));
    showToast(`已清空「${activeSession.title}」，其他对话页已完整保留`);
  };

  const handleCommitRename = () => {
    if (!renamingId) return;
    const clean = renameDraft.trim().slice(0, 14);
    if (clean) {
      updateSessionById(renamingId, (s) => ({ ...s, title: clean, autoTitlePending: false }));
    }
    setRenamingId(null);
    setRenameDraft("");
  };

  const handleChangeLang = (nextCode: string) => {
    setStudyLang(nextCode);
    echoAgentBridge.setActiveStudyLang(nextCode);
    const nextMeta = getStudyLangMeta(nextCode);
    if (activeSession) {
      updateSessionById(activeSession.id, (s) => ({
        ...s,
        studyLang: nextCode,
        messages:
          s.messages.length === 1 && s.messages[0].id === "ag_welcome"
            ? [buildWelcomeMessageForSession(nextCode, s.mode)]
            : s.messages,
      }));
    }
    showToast(`当前对话页已切为「${nextMeta.flag} ${nextMeta.label}」沉浸回复`);
  };

  const toggleAutoSpeak = () => {
    const next = !autoSpeak;
    setAutoSpeak(next);
    setAutoSpeakPref(next);
    if (!next) stopAllSpeech();
    showToast(next ? "🔊 已开启自动朗读：AI 每次回复将自动用真人音色读出" : "已关闭自动朗读（仍可点气泡朗读按钮）");
  };

  const handleCancelBusy = () => {
    if (!busy) return;
    reqSeqRef.current += 1;
    setBusy(false);
    setBusyStatus("");
    showToast("已中止当前等待，可立即继续提问");
  };

  const sendMessage = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || busy || !activeSession) return;

    const mySeq = ++reqSeqRef.current;
    const targetSessId = activeSession.id;
    const targetMode = activeSession.mode;
    const userMsg: AgentTurnMessage = {
      id: `u_${Date.now().toString(36)}`,
      role: "user",
      content: text,
      targetLang: studyLang,
      createdAt: Date.now(),
    };
    const nextHistory = [...activeSession.messages, userMsg];

    updateSessionById(targetSessId, (s) => ({
      ...s,
      title: s.autoTitlePending ? deriveAutoSessionTitle(text) : s.title,
      autoTitlePending: false,
      studyLang,
      messages: nextHistory,
      updatedAt: Date.now(),
    }));

    if (!textOverride) setInput("");
    setBusy(true);
    setBusyStatus(`🧠 正在结合你的长期记忆与进度分析...`);

    try {
      const replyMsg = await runEchoAgentTurn({
        userInput: text,
        history: nextHistory.filter((m) => m.id !== "ag_welcome"),
        targetLang: studyLang,
        extraContext: getSessionModePromptHint(targetMode),
        onProgress: (stepText) => {
          if (reqSeqRef.current === mySeq) setBusyStatus(stepText);
        },
      });
      if (reqSeqRef.current !== mySeq) return;

      updateSessionById(targetSessId, (s) => ({
        ...s,
        messages: [...s.messages, replyMsg],
        updatedAt: Date.now(),
      }));

      // 同步刷新长期记忆列表（若本轮 AI 调用了 save_learner_memory）
      setMemories(listLearnerMemories());

      // 若开启自动朗读模式，收到回复立即用选定真人音色朗读核心外语
      if (autoSpeak && (replyMsg.speakText || replyMsg.content)) {
        speakOffline(replyMsg.speakText || replyMsg.content, replyMsg.speakLang || studyLang, 0.96).catch(
          () => undefined
        );
      }
    } catch (e: any) {
      if (reqSeqRef.current !== mySeq) return;
      updateSessionById(targetSessId, (s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            id: `err_${Date.now().toString(36)}`,
            role: "assistant",
            targetLang: studyLang,
            content:
              studyLang === "yue"
                ? `暫時連唔到 AI 通道（${e?.message || "網絡波動"}），麻煩再試一次或者去設置檢查下～`
                : `Connection hiccup (${e?.message || "network timeout"}). Please try again or check AI settings.`,
            replyZh: `执行受阻：${e?.message || "网络波动，请重试或去「工具 → 备份与设置」检查 AI 通道"}`,
            createdAt: Date.now(),
          },
        ],
        updatedAt: Date.now(),
      }));
    } finally {
      if (reqSeqRef.current === mySeq) {
        setBusy(false);
        setBusyStatus("");
      }
    }
  };

  // 支持从影厅/复习页带着预设指令一键唤起并自动执行
  useEffect(() => {
    if (open && presetPrompt?.trim()) {
      const cmd = presetPrompt.trim();
      onConsumePreset?.();
      sendMessage(cmd);
    }
  }, [open, presetPrompt]);

  // 语音听写快捷输入（自动匹配当前语种）
  const toggleVoiceInput = () => {
    if (listening) {
      try {
        recogRef.current?.stop();
      } catch {
        // ignore
      }
      setListening(false);
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      showToast("当前系统输入法可直接点键盘麦克风语音输入");
      return;
    }
    try {
      const rec = new SR();
      rec.lang = langMeta.speechRecLang || "en-US";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (ev: any) => {
        const transcript = ev.results?.[0]?.[0]?.transcript || "";
        if (transcript) {
          setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => setListening(false);
      recogRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
      showToast("语音启动失败，可直接使用手机键盘语音听写");
    }
  };

  const cinemaSnap = echoAgentBridge.getCinema()?.getSnapshot();
  const reviewSnap = echoAgentBridge.getReview()?.getSnapshot();

  const contextLabel = cinemaSnap?.isPlayerOpen
    ? `🎬 《${cinemaSnap.showTitle}》${cinemaSnap.episodeName} · ${Math.floor(cinemaSnap.currentTimeSec / 60)}:${String(Math.floor(cinemaSnap.currentTimeSec % 60)).padStart(2, "0")}`
    : activeTab === "review" && reviewSnap?.currentCard
      ? `📖 正在复习：${reviewSnap.currentCard.front_text.slice(0, 24)}${reviewSnap.currentCard.front_text.length > 24 ? "..." : ""}`
      : `🧠 ${memories.length} 条长期记忆 · ${sessions.length} 个独立对话页 · 22 项权限`;

  const quickChips: Array<{ label: string; prompt: string }> = cinemaSnap?.isPlayerOpen
    ? [
        { label: "🇺🇸 只要英文字幕(遮中文)", prompt: "帮我自动挂载纯英文字幕并把画面底部的烧录中文字幕盖住" },
        { label: "📸 收藏当前画面这句", prompt: "帮我截屏识别并收藏当前画面正在说的这句台词进今日复习" },
        { label: "⏪ 倒退5秒+0.8x循环", prompt: "把播放倍速调成 0.8x，并帮我循环复读刚才这 5 秒" },
        { label: "🎓 生成本剧词包", prompt: "帮我为当前正在看的这部剧生成课前高频词包" },
      ]
    : activeSession?.mode === "oral"
      ? [
          { label: "☕ 咖啡店点单演练", prompt: "模拟我在国外咖啡店点单，你当咖啡师先用自然口语问我" },
          { label: "🎬 聊最近看的剧", prompt: "结合我最近在追的剧，用自然口语和我聊两句并帮我纠错" },
          { label: "🗣️ 中式表达大改造", prompt: "我今天累瘫了不想出门，教我 3 种母语者最地道说法并选最好的一句存进复习卡" },
        ]
      : activeSession?.mode === "study"
        ? [
            { label: "🎯 抽我待复习卡出题", prompt: "查一下我今天待复习的卡片和最近收藏的词，挑 2 个重点出互动小测验考考我" },
            { label: "📦 批量存 4 张口语卡", prompt: "教我 4 个最高频的美剧日常口语词块，并一次性批量存进今日复习卡" },
            { label: "📊 定制今日学习计划", prompt: "结合我的学习统计、待复习卡片和长期记忆，给我定制今天 10 分钟高效计划" },
          ]
        : [
            { label: "🎬 搜《新闻女王 粤语》", prompt: "帮我去在线影厅搜一下《新闻女王 粤语》" },
            { label: "🧟 搜《生化危机 爆发夜》", prompt: "帮我找找生化危机 爆发夜" },
            { label: "🧠 记住我的学习目标", prompt: "记住我平时喜欢看美剧和港剧练地道口语，希望解释简洁实用、少废话" },
          ];

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/50 backdrop-blur-xs sm:items-center sm:p-3">
          <motion.div
            initial={{ opacity: 0, y: 36 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 36 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="flex h-[92dvh] max-h-[95dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-2xl sm:h-[85dvh] sm:rounded-[28px]"
          >
            {/* 顶栏（语种 + 16 音色快切 + 长期记忆 + 自动朗读 + 关闭） */}
            <div className="flex shrink-0 items-center justify-between gap-1.5 border-b border-[var(--border-hairline)] px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)]">
                    <Sparkles className="h-3.5 w-3.5" />
                  </span>
                  <span className="shrink-0 text-sm font-bold text-[var(--text-primary)]">AI 助教</span>
                  <select
                    aria-label="选择 AI 回复语种"
                    value={studyLang}
                    onChange={(e) => handleChangeLang(e.target.value)}
                    className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--accent-text)] outline-none"
                  >
                    {STUDY_LANGUAGE_CATALOG.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.flag} {item.shortLabel}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="快速切换 AI 朗读音色"
                    value={voiceId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setSelectedVoiceId(nextId);
                      setVoiceId(nextId);
                      const vp = getVoicePresetById(nextId);
                      if (vp.engine === "supertonic" && !isSupertonicCached()) {
                        showToast(`已选 ${vp.shortName}（去「工具→设置」装入 44.1kHz 引擎后生效）`);
                      } else {
                        showToast(`已切音色：${vp.flag} ${vp.shortName}`);
                        speakOffline(vp.sampleText, vp.sampleLang, 0.98, vp.id).catch(() => undefined);
                      }
                    }}
                    className="max-w-[104px] shrink-0 truncate rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)] outline-none"
                  >
                    {ALL_VOICE_PRESETS.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.flag} {v.shortName}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="mt-0.5 truncate text-[10.5px] text-[var(--text-muted)]">{contextLabel}</p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={toggleAutoSpeak}
                  title={autoSpeak ? "自动朗读已开启" : "开启回复自动朗读"}
                  className={`rounded-full p-1.5 transition ${
                    autoSpeak
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]"
                  }`}
                >
                  {autoSpeak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMemories(listLearnerMemories());
                    setShowMemoryPanel((v) => !v);
                  }}
                  title="查看/管理 AI 长期记忆"
                  className={`relative rounded-full p-1.5 transition ${
                    showMemoryPanel
                      ? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]"
                  }`}
                >
                  <Brain className="h-4 w-4" />
                  {memories.length > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[8.5px] font-bold text-[var(--accent-fg)]">
                      {memories.length}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  title="关闭助教"
                  className="rounded-full p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>
            </div>

            {/* 多对话页切换标签栏（默认保留 3 个专属对话页 + 一键新建最多 10 页） */}
            <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)]/60 px-3 py-1.5">
              <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                {sessions.map((sess) => {
                  const isActive = sess.id === activeSession?.id;
                  const userTurns = sess.messages.filter((m) => m.role === "user").length;
                  return (
                    <div
                      key={sess.id}
                      className={`group flex shrink-0 items-center gap-0.5 rounded-full border px-2 py-1 text-[10.5px] font-semibold transition ${
                        isActive
                          ? "border-[var(--accent)] bg-[var(--bg-surface)] text-[var(--accent-text)] shadow-2xs"
                          : "border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/70"
                      }`}
                    >
                      {renamingId === sess.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleCommitRename();
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            className="w-20 rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)] outline-none"
                          />
                          <button
                            type="button"
                            onClick={handleCommitRename}
                            className="text-emerald-600"
                            title="确认重命名"
                          >
                            <Check className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleSelectSession(sess)}
                            className="flex items-center gap-1 whitespace-nowrap"
                          >
                            <span>{sess.icon}</span>
                            <span>{sess.title}</span>
                            {userTurns > 0 && (
                              <span className="rounded-full bg-[var(--accent-soft)] px-1.5 text-[9.5px] font-bold text-[var(--accent-text)]">
                                {userTurns}
                              </span>
                            )}
                          </button>
                          {isActive && (
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingId(sess.id);
                                setRenameDraft(sess.title);
                              }}
                              title="重命名当前对话页"
                              className="ml-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                            >
                              <Pencil className="h-2.5 w-2.5" />
                            </button>
                          )}
                          {!sess.pinned && sessions.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleDeleteSession(sess.id)}
                              title="关闭此对话页"
                              className="ml-0.5 text-[var(--text-muted)] hover:text-rose-500"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={handleCreateSession}
                title="新建独立对话页"
                className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--accent)] px-2.5 py-1 text-[10.5px] font-bold text-[var(--accent-fg)] shadow-2xs active:scale-95"
              >
                <Plus className="h-3 w-3" />
                新建
              </button>
              <button
                type="button"
                onClick={handleClearCurrentSession}
                title="清空当前对话页（保留其他页）"
                className="shrink-0 rounded-full p-1 text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-rose-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* 🧠 长期学习记忆管理面板（可展开查看/手动添加/删除） */}
            {showMemoryPanel && (
              <div className="shrink-0 space-y-2 border-b border-[var(--border-hairline)] bg-sky-500/8 px-3.5 py-2.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sky-700 dark:text-sky-300">
                    🧠 AI 长期学习记忆档案（全对话页共享）
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowMemoryPanel(false)}
                    className="text-[10.5px] font-semibold text-[var(--text-muted)]"
                  >
                    收起
                  </button>
                </div>
                {memories.length === 0 ? (
                  <p className="text-[10.5px] text-[var(--text-secondary)]">
                    还没有长期记忆。你可以在下面写下你的水平/兴趣/偏好，或直接在聊天里对 AI 说「记住我喜欢看悬疑美剧」。
                  </p>
                ) : (
                  <div className="max-h-28 space-y-1 overflow-y-auto">
                    {memories.map((m) => {
                      const cm = getMemoryCategoryMeta(m.category);
                      return (
                        <div
                          key={m.id}
                          className="flex items-center justify-between gap-2 rounded-xl bg-[var(--bg-surface)] px-2.5 py-1.5"
                        >
                          <span className="min-w-0 flex-1 text-[11px] text-[var(--text-primary)]">
                            <span className="mr-1 font-semibold text-sky-700 dark:text-sky-300">
                              {cm.icon} {cm.label}:
                            </span>
                            {m.text}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              removeLearnerMemory(m.id);
                              setMemories(listLearnerMemories());
                            }}
                            className="shrink-0 text-[var(--text-muted)] hover:text-rose-500"
                            title="删除记忆"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <select
                    value={newMemCat}
                    onChange={(e) => setNewMemCat(e.target.value as LearnerMemoryItem["category"])}
                    className="shrink-0 rounded-lg bg-[var(--bg-surface)] px-1.5 py-1 text-[10.5px] font-semibold text-[var(--text-secondary)] outline-none"
                  >
                    <option value="preference">⚙️ 偏好</option>
                    <option value="level">📈 水平</option>
                    <option value="goal">🎯 目标</option>
                    <option value="interest">🎬 兴趣</option>
                    <option value="weakness">⚠️ 盲区</option>
                  </select>
                  <input
                    value={newMemText}
                    onChange={(e) => setNewMemText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newMemText.trim()) {
                        addLearnerMemory(newMemText, newMemCat);
                        setMemories(listLearnerMemories());
                        setNewMemText("");
                        showToast("已写入 AI 长期学习记忆");
                      }
                    }}
                    placeholder="添加一条记忆（如：四级水平，常漏过去时）"
                    className="min-w-0 flex-1 rounded-lg bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] text-[var(--text-primary)] outline-none"
                  />
                  <button
                    type="button"
                    disabled={!newMemText.trim()}
                    onClick={() => {
                      if (!newMemText.trim()) return;
                      addLearnerMemory(newMemText, newMemCat);
                      setMemories(listLearnerMemories());
                      setNewMemText("");
                      showToast("已写入 AI 长期学习记忆");
                    }}
                    className="shrink-0 rounded-lg bg-sky-600 px-2.5 py-1 text-[10.5px] font-bold text-white disabled:opacity-40"
                  >
                    记住
                  </button>
                </div>
              </div>
            )}

            {toast && (
              <div className="mx-3.5 mt-2 rounded-xl bg-emerald-500/15 px-3 py-1.5 text-center text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                {toast}
              </div>
            )}

            {/* 动态场景快捷指令胶囊（随当前对话页与页面上下文自动变化） */}
            <div className="no-scrollbar flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)]/35 px-3.5 py-1.5">
              {quickChips.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  disabled={busy}
                  onClick={() => sendMessage(chip.prompt)}
                  className="shrink-0 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-primary)] shadow-2xs transition active:scale-95 disabled:opacity-40"
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* 当前对话页消息流 */}
            <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3 text-xs">
              {messages.map((m, idx) => (
                <div key={m.id} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                  {m.role === "user" ? (
                    <div className="max-w-[90%] rounded-2xl bg-[var(--accent)] px-3.5 py-2.5 text-xs font-medium leading-relaxed text-[var(--accent-fg)]">
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    </div>
                  ) : (
                    <AiAssistantBubble
                      message={m}
                      prevUserText={idx > 0 && messages[idx - 1]?.role === "user" ? messages[idx - 1].content : ""}
                      compact
                      onSavedCard={showToast}
                      onMarkRecastSaved={() => {
                        if (!activeSession) return;
                        updateSessionById(activeSession.id, (s) => ({
                          ...s,
                          messages: s.messages.map((it) => (it.id === m.id ? { ...it, savedRecast: true } : it)),
                        }));
                      }}
                      onMarkCorrectionSaved={() => {
                        if (!activeSession) return;
                        updateSessionById(activeSession.id, (s) => ({
                          ...s,
                          messages: s.messages.map((it) => (it.id === m.id ? { ...it, savedCorrection: true } : it)),
                        }));
                      }}
                      onPlayVodCard={(vc) => {
                        echoAgentBridge.getApp()?.jumpToVodRef({
                          sourceKey: vc.sourceKey,
                          sourceApi: vc.sourceApi,
                          vodId: vc.vodId,
                          title: vc.title,
                          routeName: "",
                          episodeName: "",
                          timeSec: 0,
                        });
                        onClose();
                      }}
                      onPickSuggestion={
                        idx === messages.length - 1 && !busy
                          ? (prompt) => sendMessage(prompt)
                          : undefined
                      }
                    />
                  )}
                </div>
              ))}

              {busy && (
                <div className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-3.5 py-2 text-xs font-medium text-[var(--text-secondary)]">
                  <Sparkles className="h-3.5 w-3.5 shrink-0 animate-pulse text-[var(--accent-text)]" />
                  <span>{busyStatus || `AI 正在用${langMeta.shortLabel}多步思考并执行...`}</span>
                  <button
                    type="button"
                    onClick={handleCancelBusy}
                    className="ml-1 rounded-full bg-[var(--bg-surface)] px-2 py-0.5 text-[10px] font-bold text-rose-500 shadow-2xs active:scale-95"
                  >
                    停止
                  </button>
                </div>
              )}
            </div>

            {/* 底部输入栏 */}
            <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2.5 pb-[max(0.65rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={toggleVoiceInput}
                title="语音输入"
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${
                  listening
                    ? "animate-pulse bg-rose-500 text-white"
                    : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                }`}
              >
                {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder={`在「${activeSession?.title || "对话"}」中用中文或${langMeta.shortLabel}提问...`}
                className="min-w-0 flex-1 rounded-full bg-[var(--bg-subtle)] px-3.5 py-2 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
              <button
                type="button"
                disabled={busy || !input.trim()}
                onClick={() => sendMessage()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm transition active:scale-95 disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
