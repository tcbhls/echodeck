import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  CheckCircle2,
  Download,
  GraduationCap,
  Languages,
  MessageSquare,
  Mic,
  Save,
  Search,
  Send,
  Settings,
  Smartphone,
  Upload,
  Volume2,
  Wand2,
  Zap,
} from "lucide-react";
import {
  runEchoAgentTurn,
  type AgentActionReceipt,
  type AgentCorrection,
  type AgentTurnMessage,
  type AgentVodHitCard,
} from "../lib/aiAgentEngine";
import {
  echoAgentBridge,
  getStudyLangMeta,
  STUDY_LANGUAGE_CATALOG,
} from "../lib/appAgentBridge";
import { annotateJyutpingOffline, searchGlossaryOffline } from "../lib/cantoneseLocal";
import { recordDailyActivity } from "../lib/lexiconStore";
import {
  BUILTIN_ZHIPU_KEY,
  isNativeAndroid,
  speakOffline,
} from "../lib/nativeBridge";
import {
  cancelNativeModelDownload,
  clearOnDeviceAiCache,
  deleteNativeModel,
  ensureOnDeviceAiLoaded,
  getNativeLocalLlmStatus,
  getOnDeviceModelSpec,
  getSelectedOnDeviceModelKey,
  isNativeLlamaSupported,
  isOnDeviceAiCached,
  ONDEVICE_MODELS,
  requestSharedModelDirPermission,
  setSelectedOnDeviceModelKey,
  unloadNativeModel,
  type NativeLocalLlmStatus,
  type OnDeviceModelKey,
  type OnDeviceProgress,
} from "../lib/localOnDeviceAi";
import {
  createCardLocal,
  exportAnkiTsvBlob,
  exportFullBackupZip,
  getAppStats,
  getSettingsLocal,
  importBackupOrCsvFile,
  saveSettingsLocal,
  testAiConnectivityDirect,
  type AppSettings,
} from "../lib/standaloneStore";
import type { CantoneseToken, GlossaryItem } from "../types";
import { AiAssistantBubble } from "./AiAssistantBubble";
import { SectionCoachBanner } from "./SectionCoachBanner";
import { VoiceStudioPanel } from "./VoiceStudioPanel";

interface SyncLabViewProps {
  initialSubTab?: "cantonese" | "coach" | "settings";
  coachPresetChunks?: string[];
  coachPresetLang?: string;
  showCoachTips: boolean;
  onDismissCoachTips: () => void;
  onStartPageTour: () => void;
  onStartFullTour: () => void;
  onDataChanged?: () => void;
}

interface ChatTurn {
  id?: string;
  role: "user" | "assistant";
  content: string;
  replyZh?: string;
  userQuestionRecast?: string;
  targetLang?: string;
  speakText?: string;
  speakLang?: string;
  coachNote?: string;
  receipts?: AgentActionReceipt[];
  correction?: AgentCorrection | null;
  vodCards?: AgentVodHitCard[];
}

export function SyncLabView({
  initialSubTab = "cantonese",
  coachPresetChunks = [],
  coachPresetLang = "",
  showCoachTips,
  onDismissCoachTips,
  onStartPageTour,
  onStartFullTour,
  onDataChanged,
}: SyncLabViewProps) {
  const [subTab, setSubTab] = useState<"cantonese" | "coach" | "settings">(initialSubTab);

  const [yueInput, setYueInput] = useState("今晚得唔得閒一齊去睇戲食飯？聽講呢套片真係冇得彈！");
  const [yueTokens, setYueTokens] = useState<CantoneseToken[]>([]);
  const [yueResultText, setYueResultText] = useState("");
  const [glossaryQ, setGlossaryQ] = useState("");
  const [glossaryList, setGlossaryList] = useState<GlossaryItem[]>([]);

  const [coachLang, setCoachLang] = useState(() => coachPresetLang || echoAgentBridge.getActiveStudyLang() || "en");
  const [coachTopic, setCoachTopic] = useState("刚看的一部好电影或剧集");
  const [coachChunksText, setCoachChunksText] = useState(coachPresetChunks.join(", "));
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [listeningVoice, setListeningVoice] = useState(false);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [storageMb, setStorageMb] = useState("0.0");
  const [cardCount, setCardCount] = useState(0);
  const [mediaCount, setMediaCount] = useState(0);
  const [exportingZip, setExportingZip] = useState(false);
  const [onDeviceModelKey, setOnDeviceModelKey] = useState<OnDeviceModelKey>(() => getSelectedOnDeviceModelKey());
  const [onDeviceCached, setOnDeviceCached] = useState(() => isOnDeviceAiCached());
  const [onDeviceProg, setOnDeviceProg] = useState<OnDeviceProgress>({ status: "idle", progress: 0, message: "" });
  const [nativeLlmStatus, setNativeLlmStatus] = useState<NativeLocalLlmStatus | null>(null);
  const [testingAi, setTestingAi] = useState(false);
  const [aiTestMsg, setAiTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [toast, setToast] = useState("");

  const refreshNativeLlmStatus = useCallback(async () => {
    try {
      const st = await getNativeLocalLlmStatus();
      setNativeLlmStatus(st);
      setOnDeviceCached(st.downloadedFiles.length > 0);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refreshNativeLlmStatus();
    const onFocusOrVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshNativeLlmStatus();
      }
    };
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);
    return () => {
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
    };
  }, [refreshNativeLlmStatus]);

  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const coachScrollRef = useRef<HTMLDivElement | null>(null);
  const coachRecogRef = useRef<any>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((c) => (c === msg ? "" : c)), 3000);
  };

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  useEffect(() => {
    if (coachPresetChunks.length > 0) {
      setCoachChunksText(coachPresetChunks.join(", "));
      const next = coachPresetLang || echoAgentBridge.getActiveStudyLang() || "en";
      setCoachLang(next);
      echoAgentBridge.setActiveStudyLang(next);
    }
  }, [coachPresetChunks, coachPresetLang]);

  useEffect(() => {
    return echoAgentBridge.subscribeActiveStudyLang((nextLang) => {
      setCoachLang(nextLang);
    });
  }, []);

  useEffect(() => {
    setTimeout(() => {
      coachScrollRef.current?.scrollTo({ top: coachScrollRef.current.scrollHeight, behavior: "smooth" });
    }, 60);
  }, [chatHistory.length, chatBusy]);

  useEffect(() => {
    return () => {
      try {
        coachRecogRef.current?.stop();
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    const ann = annotateJyutpingOffline(yueInput);
    setYueTokens(ann.tokens);
    setYueResultText(ann.jyutping);
  }, [yueInput]);

  useEffect(() => {
    setGlossaryList(searchGlossaryOffline(glossaryQ));
  }, [glossaryQ]);

  const refreshMeta = async () => {
    const [cfg, stats] = await Promise.all([getSettingsLocal(), getAppStats()]);
    setSettings(cfg);
    setStorageMb((stats.storageBytes / (1024 * 1024)).toFixed(1));
    setCardCount(stats.totalCards);
    setMediaCount(stats.mediaCount);
  };

  useEffect(() => {
    refreshMeta();
  }, [subTab]);

  useEffect(() => {
    return echoAgentBridge.subscribeDataChange(() => {
      refreshMeta();
    });
  }, []);

  const [savedCoachCorr, setSavedCoachCorr] = useState<Set<string>>(new Set());

  const handleSaveCoachCorrection = async (turnKey: string, corr: AgentCorrection) => {
    if (savedCoachCorr.has(turnKey)) return;
    await createCardLocal({
      front_text: corr.improved,
      translation: corr.original ? `升级自：${corr.original}` : corr.reason,
      jyutping: corr.lang === "yue" ? annotateJyutpingOffline(corr.improved).jyutping : "",
      focus_chunk: corr.focus_chunk || "",
      note: `AI 口语纠错：${corr.reason}`,
      language: corr.lang,
      tags: ["AI纠错升级", corr.lang === "yue" ? "港剧粤语" : "口语私教"],
    });
    recordDailyActivity("review");
    echoAgentBridge.notifyDataChanged();
    onDataChanged?.();
    setSavedCoachCorr((prev) => new Set(prev).add(turnKey));
    showToast("已将地道升级句存进「今日复习」");
  };

  const handleSendChat = async (customText?: string) => {
    const content = (customText ?? chatInput).trim();
    if (!content && chatHistory.length > 0) return;
    setChatBusy(true);

    const langMeta = getStudyLangMeta(coachLang);
    const promptText =
      content ||
      `请围绕话题「${coachTopic}」，用${langMeta.label}主动向我抛一个自然有趣的开场问题。`;
    const nextHistory: ChatTurn[] = [
      ...chatHistory,
      { id: `cu_${Date.now().toString(36)}`, role: "user", content: content || `（AI 先开聊 · ${coachTopic}）` },
    ];
    setChatHistory(nextHistory);
    setChatInput("");

    try {
      const targetChunks = coachChunksText
        .split(/[,，\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const agentHistory: AgentTurnMessage[] = nextHistory.slice(0, -1).map((m, i) => ({
        id: m.id || `h_${i}`,
        role: m.role,
        content: m.content,
        correction: m.correction,
        createdAt: Date.now(),
      }));

      const res = await runEchoAgentTurn({
        userInput: promptText,
        history: agentHistory,
        targetLang: coachLang,
        extraContext: `当前在「沉浸式 AI 口语私教」模式。练习语种=${langMeta.label}；当前话题="${coachTopic}"；目标练习词块="${targetChunks.join("、") || "自由发挥"}"。请严格只用 ${langMeta.label} 回 2 句自然对话 + 1 个引导提问，并同时写完整简体中文译文到 reply_zh；如果用户用中文问或答，先转换地道 ${langMeta.label} 写进 user_recast！`,
      });

      setChatHistory([
        ...nextHistory,
        {
          id: res.id,
          role: "assistant",
          content: res.content,
          replyZh: res.replyZh,
          userQuestionRecast: res.userQuestionRecast,
          targetLang: res.targetLang || coachLang,
          speakText: res.speakText,
          speakLang: res.speakLang || coachLang,
          receipts: res.receipts,
          correction: res.correction,
          vodCards: res.vodCards,
        },
      ]);
      if (res.speakText) speakOffline(res.speakText, res.speakLang || coachLang, 0.96);
    } catch (e: any) {
      showToast(e.message || "对话失败");
    } finally {
      setChatBusy(false);
    }
  };

  const startVoiceInput = () => {
    if (listeningVoice) {
      try {
        coachRecogRef.current?.stop();
      } catch {
        // ignore
      }
      setListeningVoice(false);
      return;
    }
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      showToast("可直接点击手机键盘的麦克风听写");
      return;
    }
    try {
      const rec = new SpeechRec();
      rec.lang = getStudyLangMeta(coachLang).speechRecLang || "en-US";
      rec.interimResults = false;
      rec.onstart = () => setListeningVoice(true);
      rec.onerror = () => setListeningVoice(false);
      rec.onend = () => setListeningVoice(false);
      rec.onresult = (event: any) => {
        const t = event.results?.[0]?.[0]?.transcript || "";
        if (t) setChatInput((prev) => (prev ? `${prev} ${t}` : t));
      };
      coachRecogRef.current = rec;
      rec.start();
    } catch {
      setListeningVoice(false);
      showToast("语音启动失败，可直接使用手机键盘麦克风");
    }
  };

  const handleExportZip = async () => {
    setExportingZip(true);
    try {
      const blob = await exportFullBackupZip();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `EchoDeck_Backup_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1200);
      showToast("已导出全量卡片+原声+截图备份包");
    } finally {
      setExportingZip(false);
    }
  };

  const handleExportTsv = async () => {
    const blob = await exportAnkiTsvBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `EchoDeck_Anki_${new Date().toISOString().slice(0, 10)}.tsv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    showToast("已导出 Anki 词表");
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {toast && (
        <div className="fixed left-1/2 top-16 z-50 max-w-sm -translate-x-1/2 rounded-2xl bg-[var(--text-primary)] px-4 py-2.5 text-xs font-medium text-[var(--bg-surface)] shadow-xl">
          {toast}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-28 pt-3 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-5">
          <SectionCoachBanner
            visible={showCoachTips}
            title="粤语正字 · 免费 AI 语伴 · 真人音色与备份"
            stepsText="①「粤拼正字」内置 21,574 字词典，断网也能查粤语声调纠懒音；②「AI 语伴」已内置免 Key 免费语言 AI，直接点「AI 先开聊」就能练口语和纠错；③「备份与设置」可切真人男女音色或换自己的付费 API。"
            onStartPageTour={onStartPageTour}
            onDismiss={onDismissCoachTips}
          />

          {/* 苹果风格分段胶囊切换 */}
          <div
            data-tour="tools-tabs"
            className="grid grid-cols-3 rounded-2xl bg-[var(--bg-subtle)] p-1 text-xs font-semibold"
          >
            {[
              { id: "cantonese" as const, label: "粤拼正字", icon: Languages },
              { id: "coach" as const, label: "AI 语伴", icon: MessageSquare },
              { id: "settings" as const, label: "备份与设置", icon: Settings },
            ].map((item) => {
              const Icon = item.icon;
              const active = subTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSubTab(item.id)}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-xl py-2.5 transition ${
                    active
                      ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs"
                      : "text-[var(--text-secondary)]"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* 1. 离线粤语正字粤拼 */}
          {subTab === "cantonese" && (
            <div className="space-y-4">
              <section className="surface-card rounded-[28px] p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-bold text-[var(--text-primary)]">逐字声调粤拼查词</h2>
                    <p className="text-xs text-[var(--text-muted)]">内置 21,574 汉字词库，飞行模式即时出音</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => speakOffline(yueInput, "yue", 0.92)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-fg)] shadow-xs active:scale-95"
                  >
                    <Volume2 className="h-3.5 w-3.5" />
                    听港粤发音
                  </button>
                </div>

                <textarea
                  value={yueInput}
                  onChange={(e) => setYueInput(e.target.value)}
                  rows={2}
                  placeholder="输入任意简体或繁体粤语句子..."
                  className="w-full resize-none rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-subtle)]/50 px-4 py-3 text-sm leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />

                {yueTokens.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2 rounded-2xl bg-[var(--bg-subtle)]/65 p-4">
                    {yueTokens.map((t, idx) => (
                      <div key={idx} className="flex flex-col items-center px-1">
                        <span className="font-mono-code text-[11px] font-semibold text-[var(--accent-text)]">
                          {t.jp || "\u00A0"}
                        </span>
                        <span className="text-lg font-bold text-[var(--text-primary)]">{t.char}</span>
                      </div>
                    ))}
                  </div>
                )}
                {yueResultText && <p className="mt-2.5 font-mono-code text-xs text-[var(--text-muted)]">{yueResultText}</p>}
              </section>

              <section className="surface-card rounded-[28px] p-5">
                <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-bold text-[var(--text-primary)]">港剧港片 & 日常粤语纠懒音词典</h2>
                  <div className="relative w-full sm:w-52">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input
                      value={glossaryQ}
                      onChange={(e) => setGlossaryQ(e.target.value)}
                      placeholder="搜词条/粤拼/含义..."
                      className="w-full rounded-full border border-[var(--border-hairline)] bg-[var(--bg-subtle)] py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {glossaryList.map((g) => (
                    <div
                      key={g.word}
                      onClick={() => speakOffline(g.word, "yue", 0.9)}
                      className="cursor-pointer rounded-2xl bg-[var(--bg-subtle)]/65 p-3.5 transition hover:bg-[var(--accent-soft)] active:scale-[0.99]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-[var(--text-primary)]">{g.word}</span>
                        <span className="font-mono-code text-xs font-semibold text-[var(--accent-text)]">{g.jyutping}</span>
                      </div>
                      <p className="mt-1 text-xs font-medium text-[var(--text-secondary)]">{g.meaning}</p>
                      <p className="mt-1 text-[11px] text-[var(--text-muted)]">{g.tip}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {/* 2. AI 语伴实战对话 */}
          {subTab === "coach" && (
            <section className="surface-card flex flex-col overflow-hidden rounded-[28px]">
              <div className="space-y-2.5 border-b border-[var(--border-hairline)] p-4 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={coachLang}
                    onChange={(e) => {
                      setCoachLang(e.target.value);
                      echoAgentBridge.setActiveStudyLang(e.target.value);
                    }}
                    className="rounded-full bg-[var(--bg-subtle)] px-3 py-2 font-semibold text-[var(--text-primary)] outline-none"
                  >
                    {STUDY_LANGUAGE_CATALOG.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.flag} {item.label}私教
                      </option>
                    ))}
                  </select>
                  <input
                    value={coachTopic}
                    onChange={(e) => setCoachTopic(e.target.value)}
                    placeholder="随便输入任何想聊的话题（电影 / 剧集 / 日常 / 旅行 / 兴趣）"
                    className="flex-1 min-w-[150px] rounded-full bg-[var(--bg-subtle)] px-3.5 py-2 text-[var(--text-primary)] outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setChatHistory([]);
                      handleSendChat("");
                    }}
                    className="rounded-full bg-[var(--accent)] px-4 py-2 font-semibold text-[var(--accent-fg)]"
                  >
                    AI 先开聊
                  </button>
                </div>
                <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
                  {[
                    "刚看的一部好电影或剧集",
                    "周末生活与日常随心聊",
                    "聊一期喜欢的播客或书",
                    "旅行美食与城市探索",
                    "科技数码或个人兴趣",
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setCoachTopic(preset)}
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                        coachTopic === preset
                          ? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
                          : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <input
                  value={coachChunksText}
                  onChange={(e) => setCoachChunksText(e.target.value)}
                  placeholder="想练的词块（自动在对话里引导你用出来）"
                  className="w-full rounded-full bg-[var(--bg-subtle)]/70 px-3.5 py-2 text-[var(--text-secondary)] outline-none"
                />
              </div>

              <div ref={coachScrollRef} className="h-[360px] space-y-3 overflow-y-auto p-4">
                {chatHistory.length === 0 ? (
                  <div className="py-12 text-center text-xs leading-relaxed text-[var(--text-muted)]">
                    <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-3 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                      ✅{" "}
                      {settings?.ai_provider_mode === "local_ondevice"
                        ? `App 本地开源 AI（${getOnDeviceModelSpec(onDeviceModelKey).name}）`
                        : settings?.ai_provider_mode === "custom" && settings.ai_api_key
                          ? `已连接自有模型 (${settings.ai_model})`
                          : settings?.ai_provider_mode === "zhipu_free" && (settings.zhipu_api_key || BUILTIN_ZHIPU_KEY)
                            ? `智谱 ${settings.zhipu_model || "glm-4.7-flash"}（国内永久免费）`
                            : "公共免 Key 免费语言 AI（双容灾通道）"}
                    </div>
                    <p className="mt-1">
                      直接点右上角「AI 先开聊」，AI 会全程用你当前选的 <strong className="text-[var(--text-primary)]">{getStudyLangMeta(coachLang).label}</strong> 和你对话！<br />
                      用中文问会先帮你转换成地道外语复述，点击 AI 气泡即可随时展开中文翻译。
                    </p>
                  </div>
                ) : (
                  chatHistory.map((turn, idx) => {
                    const turnKey = turn.id || `turn_${idx}`;
                    return (
                      <div key={turnKey} className={`flex flex-col ${turn.role === "user" ? "items-end" : "items-start"}`}>
                        {turn.role === "user" ? (
                          <div className="max-w-[88%] rounded-3xl bg-[var(--accent)] px-4 py-3 text-sm font-medium leading-relaxed text-[var(--accent-fg)]">
                            <p className="whitespace-pre-wrap">{turn.content}</p>
                          </div>
                        ) : (
                          <AiAssistantBubble
                            message={{
                              id: turnKey,
                              role: "assistant",
                              content: turn.content,
                              replyZh: turn.replyZh,
                              userQuestionRecast: turn.userQuestionRecast,
                              targetLang: turn.targetLang || coachLang,
                              speakText: turn.speakText,
                              speakLang: turn.speakLang || coachLang,
                              receipts: turn.receipts,
                              correction: turn.correction,
                              vodCards: turn.vodCards,
                              createdAt: Date.now(),
                            }}
                            prevUserText={idx > 0 && chatHistory[idx - 1]?.role === "user" ? chatHistory[idx - 1].content : ""}
                            onSavedCard={showToast}
                            correctionSaved={savedCoachCorr.has(turnKey)}
                            onSaveCorrection={(corr) => handleSaveCoachCorrection(turnKey, corr)}
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
                            }}
                          />
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="flex items-center gap-2 border-t border-[var(--border-hairline)] p-3">
                <button
                  type="button"
                  onClick={startVoiceInput}
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                    listeningVoice ? "bg-rose-500 text-white" : "bg-[var(--bg-subtle)] text-[var(--text-primary)]"
                  }`}
                >
                  <Mic className="h-4 w-4" />
                </button>
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendChat();
                    }
                  }}
                  placeholder={`用中文或${getStudyLangMeta(coachLang).shortLabel}聊（中文会先转地道外语复述）...`}
                  className="flex-1 rounded-full bg-[var(--bg-subtle)] px-4 py-2.5 text-sm text-[var(--text-primary)] outline-none"
                />
                <button
                  type="button"
                  disabled={chatBusy || !chatInput.trim()}
                  onClick={() => handleSendChat()}
                  className="inline-flex h-10 items-center gap-1 rounded-full bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--accent-fg)] disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </section>
          )}

          {/* 3. 备份与设置 */}
          {subTab === "settings" && settings && (
            <div className="space-y-4 text-xs">
              {/* 重新观看完整教学 */}
              <section className="surface-card flex flex-wrap items-center justify-between gap-3 rounded-[26px] p-5">
                <div>
                  <h2 className="text-sm font-bold text-[var(--text-primary)]">新手交互实战教程</h2>
                  <p className="mt-0.5 text-[var(--text-secondary)]">随时重看全应用 4 大板块的聚光灯手把手导览</p>
                </div>
                <button
                  type="button"
                  onClick={onStartFullTour}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 font-semibold text-[var(--accent-fg)]"
                >
                  <GraduationCap className="h-4 w-4" />
                  重新进入完整教学
                </button>
              </section>

              <section className="surface-card rounded-[26px] p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
                    <Smartphone className="h-4 w-4 text-[var(--accent-text)]" />
                    手机本地存储与备份
                  </h2>
                  <span className="rounded-full bg-emerald-500/12 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    {isNativeAndroid() ? "独立 Android App" : "独立离线版"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  {[
                    { label: "记忆卡片", val: `${cardCount} 张` },
                    { label: "精听素材", val: `${mediaCount} 条` },
                    { label: "本地占用", val: `${storageMb} MB` },
                  ].map((s) => (
                    <div key={s.label} className="rounded-2xl bg-[var(--bg-subtle)] p-3 text-center">
                      <div className="text-[11px] text-[var(--text-muted)]">{s.label}</div>
                      <div className="mt-1 text-base font-bold text-[var(--text-primary)]">{s.val}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={exportingZip}
                    onClick={handleExportZip}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[var(--text-primary)] px-4 py-2 font-semibold text-[var(--bg-surface)]"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    {exportingZip ? "打包中..." : "导出全量备份 (.zip)"}
                  </button>
                  <button
                    type="button"
                    onClick={handleExportTsv}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-subtle)] px-3.5 py-2 font-medium text-[var(--text-primary)]"
                  >
                    <Download className="h-3.5 w-3.5" />
                    导出 Anki 表
                  </button>
                  <button
                    type="button"
                    onClick={() => restoreInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-subtle)] px-3.5 py-2 font-medium text-[var(--text-primary)]"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    恢复备份 / 导入
                  </button>
                  <input
                    ref={restoreInputRef}
                    type="file"
                    accept=".zip,.csv,.tsv,.txt"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        try {
                          const n = await importBackupOrCsvFile(f);
                          showToast(`已导入 ${n} 张卡片`);
                          refreshMeta();
                          onDataChanged?.();
                        } catch (err: any) {
                          showToast(err.message);
                        }
                      }
                      e.target.value = "";
                    }}
                  />
                </div>
              </section>

              {/* 多引擎 AI 真人音色试听馆（保留原默认音色 + 新增 8 款自然口音 + GitHub 开源 44.1kHz 棚录离线声 + 可选云端） */}
              <VoiceStudioPanel onToast={showToast} />

              <section className="surface-card space-y-4 rounded-[26px] p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-bold text-[var(--text-primary)]">语言学习 AI 引擎（云端最强免费 + App 自带翻译/学习开源 AI）</h2>
                    <p className="mt-0.5 text-[var(--text-muted)]">默认已升级智谱 GLM-4.7-Flash 极速免费版；也可一键装入 GitHub 开源翻译/语言学习模型（Qwen3-0.6B / 腾讯混元 HY-MT1.5）到手机本地断网用</p>
                  </div>
                </div>

                {/* 四选一：智谱 GLM-4.7-Flash vs App 自带端侧开源离线 AI vs 免 Key 公共通道 vs 自有付费 API */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, ai_provider_mode: "zhipu_free" })}
                    className={`rounded-2xl border p-3 text-left transition ${
                      settings.ai_provider_mode === "zhipu_free"
                        ? "border-emerald-500 bg-emerald-500/10"
                        : "border-[var(--border-hairline)] bg-[var(--bg-subtle)]/60"
                    }`}
                  >
                    <div className="font-bold text-[var(--text-primary)]">🚀 智谱 GLM-4.7-Flash（默认推荐）</div>
                    <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                      国内永久免费主力 · 工具调用强 · {BUILTIN_ZHIPU_KEY || settings.zhipu_api_key ? "已配置 Key" : "选填免费 Key"}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, ai_provider_mode: "local_ondevice" })}
                    className={`rounded-2xl border p-3 text-left transition ${
                      settings.ai_provider_mode === "local_ondevice"
                        ? "border-sky-500 bg-sky-500/10"
                        : "border-[var(--border-hairline)] bg-[var(--bg-subtle)]/60"
                    }`}
                  >
                    <div className="font-bold text-[var(--text-primary)]">🧠 原生端侧离线 AI（llama.cpp）</div>
                    <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                      手机本地直跑 Qwen3-8B / 4B · {onDeviceCached ? "本地模型已就绪 ✓" : "100% 离线免费"}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, ai_provider_mode: "free" })}
                    className={`rounded-2xl border p-3 text-left transition ${
                      settings.ai_provider_mode === "free"
                        ? "border-emerald-500 bg-emerald-500/10"
                        : "border-[var(--border-hairline)] bg-[var(--bg-subtle)]/60"
                    }`}
                  >
                    <div className="font-bold text-[var(--text-primary)]">🎁 免 Key 公共免费 AI</div>
                    <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">ch.at + Pollinations 双容灾</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, ai_provider_mode: "custom" })}
                    className={`rounded-2xl border p-3 text-left transition ${
                      settings.ai_provider_mode === "custom"
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-[var(--border-hairline)] bg-[var(--bg-subtle)]/60"
                    }`}
                  >
                    <div className="font-bold text-[var(--text-primary)]">🔑 自有 / 付费 API</div>
                    <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">DeepSeek / 硅基 / OpenAI</div>
                  </button>
                </div>

                {settings.ai_provider_mode === "local_ondevice" && (() => {
                  const nativeAndroid = isNativeLlamaSupported();
                  const activeSpec = getOnDeviceModelSpec(onDeviceModelKey);
                  const downloadedFiles = nativeLlmStatus?.downloadedFiles || [];
                  const activeDownloaded = downloadedFiles.find((f) => f.fileName === activeSpec.fileName);
                  const activeCached = Boolean(activeDownloaded) || isOnDeviceAiCached(onDeviceModelKey);
                  const sharedGranted = Boolean(nativeLlmStatus?.sharedStorageGranted);
                  const catalogNames = new Set(ONDEVICE_MODELS.map((m) => m.fileName));
                  const extraFiles = downloadedFiles.filter((f) => !catalogNames.has(f.fileName));
                  return (
                    <div className="space-y-3 rounded-2xl border border-sky-500/25 bg-sky-500/8 p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <div className="font-bold text-sky-700 dark:text-sky-300">
                          原生 ARM64 llama.cpp 引擎 · 本地 GGUF 模型库
                        </div>
                        <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                          {nativeLlmStatus?.loaded
                            ? `已载入：${nativeLlmStatus.loadedFileName}`
                            : "手机原生直跑 · 断网可用"}
                        </span>
                      </div>

                      {/* 公共共享目录 Download/LocalAI 授权与状态条 */}
                      <div className="flex items-center justify-between gap-2 rounded-xl border border-sky-500/20 bg-[var(--bg-surface)]/80 px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold text-[var(--text-primary)]">
                            {nativeAndroid
                              ? sharedGranted
                                ? "✓ 已连通公共模型目录（Download/LocalAI）"
                                : "未开启公共模型目录权限（Download/LocalAI）"
                              : "网页预览模式 · 安装 Android APK 后启用原生 ARM64 引擎"}
                          </div>
                          <div className="mt-0.5 text-[10px] leading-relaxed text-[var(--text-secondary)]">
                            {sharedGranted
                              ? "下载或拷贝至 Download/LocalAI 的 GGUF 模型可零拷贝直读，也方便与其它本地 AI 应用共用。"
                              : "授权「所有文件访问」后可将大型 GGUF 权重存放在公共目录 Download/LocalAI，卸载重装不丢失。"}
                          </div>
                        </div>
                        {nativeAndroid && !sharedGranted && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await requestSharedModelDirPermission();
                                showToast("请在系统页打开「允许管理所有文件」，返回即自动生效");
                              } catch (e: any) {
                                showToast(e?.message || "打开权限页失败");
                              }
                            }}
                            className="shrink-0 rounded-full bg-sky-600 px-3 py-1.5 text-[11px] font-bold text-white"
                          >
                            去开启
                          </button>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        {ONDEVICE_MODELS.map((m) => {
                          const selected = m.key === onDeviceModelKey;
                          const hit = downloadedFiles.find((f) => f.fileName === m.fileName);
                          const installed = Boolean(hit);
                          const isLoaded = nativeLlmStatus?.loaded && nativeLlmStatus?.loadedFileName === m.fileName;
                          return (
                            <button
                              key={m.key}
                              type="button"
                              onClick={() => {
                                setOnDeviceModelKey(m.key);
                                setSelectedOnDeviceModelKey(m.key);
                                setOnDeviceCached(installed || downloadedFiles.length > 0);
                              }}
                              className={`w-full rounded-xl border p-2.5 text-left transition ${
                                selected
                                  ? "border-sky-500 bg-[var(--bg-surface)] shadow-xs"
                                  : "border-[var(--border-hairline)] bg-[var(--bg-surface)]/55"
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <span className="text-xs font-bold text-[var(--text-primary)]">{m.name}</span>
                                <div className="flex items-center gap-1">
                                  <span className="rounded-full bg-sky-500/12 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                                    {m.badge}
                                  </span>
                                  <span className="rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 font-mono-code text-[10px] text-[var(--text-secondary)]">
                                    {isLoaded
                                      ? "运行中 ✓"
                                      : installed
                                        ? hit?.shared
                                          ? "公共库已就绪 ✓"
                                          : "已下载 ✓"
                                        : m.sizeLabel}
                                  </span>
                                </div>
                              </div>
                              <div className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">{m.desc}</div>
                              <div className="mt-0.5 font-mono-code text-[10px] text-[var(--text-muted)]">
                                {m.ramHint} · 文件：{m.fileName}
                              </div>
                            </button>
                          );
                        })}

                        {extraFiles.map((ef) => {
                          const mb = Math.round(ef.sizeBytes / (1024 * 1024));
                          const isLoaded = nativeLlmStatus?.loaded && nativeLlmStatus?.loadedFileName === ef.fileName;
                          return (
                            <div
                              key={ef.fileName}
                              className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/70 p-2.5"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-xs font-bold text-[var(--text-primary)]">{ef.fileName}</div>
                                <div className="text-[10px] text-[var(--text-secondary)]">
                                  {mb} MB · {ef.shared ? "共享目录自定义 GGUF" : "本地自定义 GGUF"}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await ensureOnDeviceAiLoaded(setOnDeviceProg, ef.fileName);
                                    await saveSettingsLocal({ ...settings, ai_provider_mode: "local_ondevice" });
                                    await refreshNativeLlmStatus();
                                    showToast(`已载入自定义模型：${ef.fileName}`);
                                  } catch {
                                    // shown in progress
                                  }
                                }}
                                className="shrink-0 rounded-full bg-sky-600 px-3 py-1 text-[11px] font-bold text-white"
                              >
                                {isLoaded ? "运行中 ✓" : "直接载入"}
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      {onDeviceProg.status === "downloading" && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[11px] text-sky-700 dark:text-sky-300">
                            <span>{onDeviceProg.message}</span>
                            <span className="font-mono-code font-bold">{onDeviceProg.progress}%</span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-sky-500/20">
                            <div
                              className="h-full rounded-full bg-sky-600 transition-all"
                              style={{ width: `${onDeviceProg.progress}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {onDeviceProg.status === "error" && (
                        <div className="text-[11px] text-rose-600 dark:text-rose-400">{onDeviceProg.message}</div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={onDeviceProg.status === "downloading" || !nativeAndroid}
                          onClick={async () => {
                            try {
                              await ensureOnDeviceAiLoaded(setOnDeviceProg, activeSpec.key);
                              setOnDeviceCached(true);
                              await saveSettingsLocal({ ...settings, ai_provider_mode: "local_ondevice" });
                              await refreshNativeLlmStatus();
                              showToast(`${activeSpec.name} 已在原生引擎就绪，断网也能用！`);
                            } catch {
                              // error shown above
                            }
                          }}
                          className="inline-flex items-center gap-1.5 rounded-full bg-sky-600 px-4 py-2 text-xs font-bold text-white shadow-xs disabled:opacity-50"
                        >
                          {onDeviceProg.status === "downloading"
                            ? `下载/载入中 ${onDeviceProg.progress}%...`
                            : activeCached
                              ? `一键载入并启用 (${activeSpec.name}) ✓`
                              : `魔搭高速下载 (${activeSpec.sizeLabel} · 支持续传)`}
                        </button>
                        {onDeviceProg.status === "downloading" && (
                          <button
                            type="button"
                            onClick={async () => {
                              await cancelNativeModelDownload();
                              setOnDeviceProg({ status: "idle", progress: 0, message: "已暂停下载（保留断点进度）" });
                              showToast("已暂停下载，保留断点随时可续传");
                            }}
                            className="rounded-full bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400"
                          >
                            暂停下载
                          </button>
                        )}
                        {nativeLlmStatus?.loaded && (
                          <button
                            type="button"
                            onClick={async () => {
                              await unloadNativeModel();
                              await refreshNativeLlmStatus();
                              showToast("已释放本地模型内存");
                            }}
                            className="rounded-full bg-[var(--bg-surface)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)]"
                          >
                            释放内存
                          </button>
                        )}
                        {activeCached && onDeviceProg.status !== "downloading" && (
                          <button
                            type="button"
                            onClick={async () => {
                              await deleteNativeModel(activeSpec.fileName);
                              await clearOnDeviceAiCache();
                              await refreshNativeLlmStatus();
                              setOnDeviceProg({ status: "idle", progress: 0, message: "" });
                              showToast(`已删除 ${activeSpec.fileName} 并释放空间`);
                            }}
                            className="rounded-full bg-[var(--bg-surface)] px-3 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400"
                          >
                            删除权重
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {settings.ai_provider_mode === "zhipu_free" && (
                  <div className="space-y-2.5 rounded-2xl border border-emerald-500/25 bg-emerald-500/6 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-emerald-700 dark:text-emerald-300">
                        智谱永久免费模型选择（已升级极速非思考模式 + 自动容灾）
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { id: "glm-4.7-flash", label: "GLM-4.7-Flash 新一代主力（推荐 · 免费最强）" },
                        { id: "glm-4-flash-250414", label: "GLM-4-Flash 极速轻量" },
                        { id: "glm-4-flash", label: "GLM-4-Flash 经典免费" },
                      ].map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setSettings({ ...settings, zhipu_model: m.id })}
                          className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                            (settings.zhipu_model || "glm-4.7-flash") === m.id
                              ? "bg-emerald-600 text-white"
                              : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-hairline)]"
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    <label className="block space-y-1">
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {BUILTIN_ZHIPU_KEY
                          ? "已通过构建环境变量配置智谱免费 Key（可在此覆盖）"
                          : "智谱 API Key（前往 open.bigmodel.cn 免费注册即可领取永久免费 Flash 额度；留空自动回退免 Key 公共通道）"}
                      </span>
                      <input
                        type="password"
                        value={settings.zhipu_api_key}
                        onChange={(e) => setSettings({ ...settings, zhipu_api_key: e.target.value })}
                        placeholder={BUILTIN_ZHIPU_KEY ? "已配置构建期 Key · 无需填写" : "选填智谱 API Key（留空照常可用免费通道）"}
                        className="w-full rounded-xl bg-[var(--bg-surface)] px-3 py-2 font-mono-code text-[var(--text-primary)] outline-none"
                      />
                    </label>
                  </div>
                )}

                {settings.ai_provider_mode === "custom" && (
                  <div className="space-y-3 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/45 p-3.5">
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { label: "智谱 GLM-4-Flash (国内永久免费)", base: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
                        { label: "DeepSeek (高性价比最强)", base: "https://api.deepseek.com/v1", model: "deepseek-chat" },
                        { label: "硅基流动 Qwen (免费额度)", base: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-7B-Instruct" },
                        { label: "OpenAI", base: "https://api.openai.com/v1", model: "gpt-4o-mini" },
                      ].map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => setSettings({ ...settings, ai_base_url: p.base, ai_model: p.model })}
                          className="rounded-full bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)] border border-[var(--border-hairline)]"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <label className="space-y-1">
                        <span className="font-medium text-[var(--text-secondary)]">API Base URL</span>
                        <input
                          value={settings.ai_base_url}
                          onChange={(e) => setSettings({ ...settings, ai_base_url: e.target.value })}
                          placeholder="https://api.deepseek.com/v1"
                          className="w-full rounded-xl bg-[var(--bg-surface)] px-3 py-2 font-mono-code text-[var(--text-primary)] outline-none"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="font-medium text-[var(--text-secondary)]">模型名称</span>
                        <input
                          value={settings.ai_model}
                          onChange={(e) => setSettings({ ...settings, ai_model: e.target.value })}
                          placeholder="deepseek-chat / glm-4-flash"
                          className="w-full rounded-xl bg-[var(--bg-surface)] px-3 py-2 font-mono-code text-[var(--text-primary)] outline-none"
                        />
                      </label>
                      <label className="space-y-1 sm:col-span-2">
                        <span className="font-medium text-[var(--text-secondary)]">API Key（留空会自动回退内置免费 AI）</span>
                        <input
                          type="password"
                          value={settings.ai_api_key}
                          onChange={(e) => setSettings({ ...settings, ai_api_key: e.target.value })}
                          placeholder="粘贴你的 sk-... 或智谱 API Key"
                          className="w-full rounded-xl bg-[var(--bg-surface)] px-3 py-2 font-mono-code text-[var(--text-primary)] outline-none"
                        />
                      </label>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 border-t border-[var(--border-hairline)] pt-3 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="font-medium text-[var(--text-secondary)]">默认字幕识别方式</span>
                    <select
                      value={settings.whisper_mode}
                      onChange={(e) => setSettings({ ...settings, whisper_mode: e.target.value as "local" | "cloud" })}
                      className="w-full rounded-xl bg-[var(--bg-subtle)] px-3 py-2.5 text-[var(--text-primary)] outline-none"
                    >
                      <option value="local">📱 手机本地离线（免 Key）</option>
                      <option value="cloud">⚡ 云端极速高精度（推荐粤语）</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="font-medium text-[var(--text-secondary)]">离线模型下载源</span>
                    <select
                      value={settings.whisper_hf_mirror}
                      onChange={(e) => setSettings({ ...settings, whisper_hf_mirror: e.target.value })}
                      className="w-full rounded-xl bg-[var(--bg-subtle)] px-3 py-2.5 text-[var(--text-primary)] outline-none"
                    >
                      <option value="true">国内加速镜像（免翻墙）</option>
                      <option value="false">Hugging Face 官方源</option>
                    </select>
                  </label>
                  <label className="space-y-1 sm:col-span-2">
                    <span className="font-medium text-[var(--text-secondary)]">云端极速字幕 ASR Key（选填，如免费 Groq）</span>
                    <input
                      type="password"
                      value={settings.asr_api_key}
                      onChange={(e) => setSettings({ ...settings, asr_api_key: e.target.value })}
                      placeholder="选填 gsk_...（不填直接用手机本地离线 Whisper）"
                      className="w-full rounded-xl bg-[var(--bg-subtle)] px-3 py-2.5 font-mono-code text-[var(--text-primary)] outline-none"
                    />
                  </label>
                </div>
                {aiTestMsg && (
                  <div
                    className={`rounded-2xl px-3.5 py-2 text-xs font-medium ${
                      aiTestMsg.ok
                        ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                        : "bg-rose-500/12 text-rose-700 dark:text-rose-300"
                    }`}
                  >
                    {aiTestMsg.text}
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={testingAi}
                    onClick={async () => {
                      setTestingAi(true);
                      setAiTestMsg(null);
                      try {
                        await saveSettingsLocal(settings);
                        const res = await testAiConnectivityDirect(settings);
                        if (res.ok) {
                          setAiTestMsg({ ok: true, text: `✓ AI 连通正常 · 耗时 ${res.latencyMs}ms（回复：${res.preview}）` });
                        } else {
                          setAiTestMsg({ ok: false, text: `✗ 连通测试失败（${res.latencyMs}ms）：${res.error}` });
                        }
                      } finally {
                        setTestingAi(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-4 py-2.5 text-xs font-semibold text-[var(--text-primary)] transition active:scale-95 disabled:opacity-50"
                  >
                    <Zap className="h-3.5 w-3.5 text-[var(--accent)]" />
                    {testingAi ? "测试连通中..." : "测试 AI 连通性"}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await saveSettingsLocal(settings);
                      showToast("设置已保存");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-5 py-2.5 font-semibold text-[var(--accent-fg)] transition active:scale-95"
                  >
                    <Save className="h-3.5 w-3.5" />
                    保存设置
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
