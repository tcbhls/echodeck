import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  CheckCircle2,
  Download,
  Ear,
  Eye,
  EyeOff,
  Film,
  Flame,
  Languages,
  List,
  MessageSquare,
  Plus,
  Repeat,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { echoAgentBridge, getStudyLangMeta } from "../lib/appAgentBridge";
import { annotateJyutpingOffline } from "../lib/cantoneseLocal";
import { getDailyHabitStats, recordDailyActivity, undoDailyReviewActivity, updateDailyGoals } from "../lib/lexiconStore";
import { speakOffline, triggerHaptic } from "../lib/nativeBridge";
import {
  createCardLocal,
  deleteCardLocal,
  explainCardDirect,
  exportAnkiTsvBlob,
  importBackupOrCsvFile,
  listCardsLocal,
  resolveMediaSrc,
  restoreCardSnapshotLocal,
  reviewCardStandalone,
  updateCardLocal,
} from "../lib/standaloneStore";
import type { CardItem, DailyHabitStats, VodCardRef } from "../types";
import { SectionCoachBanner } from "./SectionCoachBanner";
import { ShadowRecorder } from "./ShadowRecorder";
import { ClickableWordsText, WordQuickLookupModal } from "./WordQuickLookupModal";

interface ReviewViewProps {
  showCoachTips: boolean;
  onDismissCoachTips: () => void;
  onStartPageTour: () => void;
  onOpenCoachWithChunks: (chunks: string[], language: string) => void;
  onJumpToVodRef?: (ref: VodCardRef) => void;
  onCardsChanged?: () => void;
}

export function ReviewView({
  showCoachTips,
  onDismissCoachTips,
  onStartPageTour,
  onOpenCoachWithChunks,
  onJumpToVodRef,
  onCardsChanged,
}: ReviewViewProps) {
  const [mode, setMode] = useState<"study" | "browse">("study");
  const [allCards, setAllCards] = useState<CardItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [langFilter, setLangFilter] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [searchText, setSearchText] = useState("");
  const [blindMode, setBlindMode] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const [slowMode, setSlowMode] = useState(false);
  const [loopAudio, setLoopAudio] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [resolvedImgUrl, setResolvedImgUrl] = useState("");
  const [resolvedAudioUrl, setResolvedAudioUrl] = useState("");

  const [aiExplainText, setAiExplainText] = useState("");
  const [aiExplainBusy, setAiExplainBusy] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [newFront, setNewFront] = useState("");
  const [newTrans, setNewTrans] = useState("");
  const [newChunk, setNewChunk] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newLang, setNewLang] = useState("en");
  const [newTags, setNewTags] = useState("美剧电影");
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState("");
  // 每日打卡目标 & 复习卡片点词查词
  const [habit, setHabit] = useState<DailyHabitStats>(() => getDailyHabitStats());
  const [showGoalEdit, setShowGoalEdit] = useState(false);
  const [goalWordsDraft, setGoalWordsDraft] = useState(() => String(getDailyHabitStats().dailyWordGoal));
  const [goalReviewsDraft, setGoalReviewsDraft] = useState(() => String(getDailyHabitStats().dailyReviewGoal));
  const [lookupWord, setLookupWord] = useState<string | null>(null);
  const [lastRatedUndo, setLastRatedUndo] = useState<CardItem | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const cardStartTimeRef = useRef<number>(Date.now());
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? "" : cur)), 2800);
  };

  const loadCards = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listCardsLocal();
      setAllCards(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  // 在复习页筛选语种时自动同步全局学习语种，让 AI 助教无缝切换对应语言回答
  useEffect(() => {
    if (langFilter) {
      echoAgentBridge.setActiveStudyLang(langFilter);
    }
  }, [langFilter]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    allCards.forEach((c) => (c.tags || []).forEach((t) => set.add(t)));
    return Array.from(set);
  }, [allCards]);

  // 动态汇总用户卡片库中存在的所有语种（除英/粤外，用 AI 建的日/韩/法/西/德/意卡片也能一键筛选！）
  const availableLangFilters = useMemo(() => {
    const codes = new Set<string>(["en", "yue"]);
    allCards.forEach((c) => {
      if (c.language) codes.add(c.language.toLowerCase());
    });
    return [
      { id: "", label: "全部语言" },
      ...Array.from(codes).map((code) => {
        const meta = getStudyLangMeta(code);
        return { id: code, label: `${meta.flag} ${meta.shortLabel}` };
      }),
    ];
  }, [allCards]);

  const filteredCards = useMemo(() => {
    return allCards.filter((c) => {
      if (langFilter && c.language !== langFilter) return false;
      if (tagFilter && !(c.tags || []).includes(tagFilter)) return false;
      if (searchText.trim()) {
        const q = searchText.trim().toLowerCase();
        const hit =
          c.front_text.toLowerCase().includes(q) ||
          c.translation.toLowerCase().includes(q) ||
          c.focus_chunk.toLowerCase().includes(q) ||
          c.note.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [allCards, langFilter, tagFilter, searchText]);

  const dueCards = useMemo(() => {
    const nowIso = new Date().toISOString();
    return filteredCards.filter((c) => c.due_at <= nowIso);
  }, [filteredCards]);

  const currentCard = dueCards[0] || null;

  useEffect(() => {
    setRevealed(false);
    setAiExplainText("");
    setEditingNote(false);
    setNoteDraft(currentCard?.note || "");
    cardStartTimeRef.current = Date.now();
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlayingAudio(false);
    }
    let alive = true;
    if (currentCard) {
      Promise.all([
        resolveMediaSrc(currentCard.image_path),
        resolveMediaSrc(currentCard.audio_clip_path),
      ]).then(([img, aud]) => {
        if (!alive) return;
        setResolvedImgUrl(img);
        setResolvedAudioUrl(aud);
      });
    } else {
      setResolvedImgUrl("");
      setResolvedAudioUrl("");
    }
    return () => {
      alive = false;
    };
  }, [currentCard?.id]);

  const playVoiceOrClip = useCallback(
    async (rateOverride?: number): Promise<void> => {
      if (!currentCard) return;
      const rate = rateOverride ?? (slowMode ? 0.8 : 1.0);
      if (resolvedAudioUrl) {
        if (!audioRef.current) audioRef.current = new Audio();
        const audio = audioRef.current;
        audio.pause();
        audio.src = resolvedAudioUrl;
        audio.currentTime = 0;
        audio.playbackRate = rate;
        audio.loop = loopAudio;
        const played = await new Promise<boolean>((resolve) => {
          audio.onended = () => {
            setIsPlayingAudio(false);
            resolve(true);
          };
          audio.onerror = () => {
            setIsPlayingAudio(false);
            resolve(false);
          };
          setIsPlayingAudio(true);
          audio.play().catch(() => {
            setIsPlayingAudio(false);
            resolve(false);
          });
        });
        if (played) return;
      }
      setIsPlayingAudio(true);
      const ok = await speakOffline(currentCard.front_text, currentCard.language, rate);
      setTimeout(() => setIsPlayingAudio(false), 1200);
      if (!ok) {
        showToast("手机未开启离线语音引擎且当前无网络：请联网发音或到手机「设置 → 文字转语音」开启引擎");
      }
    },
    [currentCard, resolvedAudioUrl, slowMode, loopAudio]
  );

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.loop = loopAudio;
      audioRef.current.playbackRate = slowMode ? 0.8 : 1.0;
    }
  }, [loopAudio, slowMode]);

  const handleRate = useCallback(
    async (rating: 1 | 2 | 3 | 4) => {
      if (!currentCard) return;
      triggerHaptic(rating >= 3 ? 12 : 8);
      const snapshot = { ...currentCard };
      const elapsed = Date.now() - cardStartTimeRef.current;
      const updated = await reviewCardStandalone(currentCard, rating, elapsed);
      setHabit(recordDailyActivity("review"));
      setAllCards((prev) =>
        prev
          .map((c) => (c.id === updated.id ? updated : c))
          .sort((a, b) => a.due_at.localeCompare(b.due_at))
      );
      setLastRatedUndo(snapshot);
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = window.setTimeout(() => setLastRatedUndo(null), 8000);
      onCardsChanged?.();
    },
    [currentCard, onCardsChanged]
  );

  const handleUndoLastRate = useCallback(async () => {
    if (!lastRatedUndo) return;
    triggerHaptic(10);
    const restored = await restoreCardSnapshotLocal(lastRatedUndo);
    setLastRatedUndo(null);
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setHabit(undoDailyReviewActivity());
    setAllCards((prev) => [restored, ...prev.filter((c) => c.id !== restored.id)]);
    onCardsChanged?.();
    showToast("已撤回上一张卡片评分");
  }, [lastRatedUndo, onCardsChanged]);

  // Android 返回手势分层关闭复习舱弹窗与浏览列表
  useEffect(() => {
    const onCloseOverlay = (ev: Event) => {
      if (lookupWord) {
        ev.preventDefault();
        setLookupWord(null);
        return;
      }
      if (showCreate) {
        ev.preventDefault();
        setShowCreate(false);
        return;
      }
      if (showGoalEdit) {
        ev.preventDefault();
        setShowGoalEdit(false);
        return;
      }
      if (mode === "browse") {
        ev.preventDefault();
        setMode("study");
      }
    };
    window.addEventListener("echodeck:close-overlay", onCloseOverlay);
    return () => window.removeEventListener("echodeck:close-overlay", onCloseOverlay);
  }, [lookupWord, showCreate, showGoalEdit, mode]);

  // 向全局全权限 AI 总线注册复习舱控制器，并订阅 AI 修改词卡/目标后的热刷新
  useEffect(() => {
    echoAgentBridge.registerReview({
      getSnapshot: () => ({
        currentCard,
        dueCount: dueCards.length,
        totalCount: allCards.length,
        blindMode,
        revealed,
      }),
      rateCurrent: async (rating) => {
        if (!currentCard) return "当前没有待复习卡片";
        const labels: Record<number, string> = { 1: "没听懂", 2: "有点卡", 3: "懂且会读", 4: "脱口而出" };
        await handleRate(rating);
        return `已为当前卡打分「${labels[rating]}」并切下一张`;
      },
      toggleBlindMode: (enabled) => {
        setBlindMode((prev) => (typeof enabled === "boolean" ? enabled : !prev));
      },
      revealCurrent: () => setRevealed(true),
      refresh: async () => {
        await loadCards();
        setHabit(getDailyHabitStats());
      },
    });
    return () => echoAgentBridge.registerReview(null);
  }, [currentCard, dueCards.length, allCards.length, blindMode, revealed, handleRate, loadCards]);

  useEffect(() => {
    return echoAgentBridge.subscribeDataChange(() => {
      loadCards();
      setHabit(getDailyHabitStats());
    });
  }, [loadCards]);

  const handleExplain = async () => {
    if (!currentCard || aiExplainBusy) return;
    setAiExplainBusy(true);
    try {
      const text = await explainCardDirect(currentCard.front_text, currentCard.language, currentCard.focus_chunk);
      setAiExplainText(text);
    } catch (e: any) {
      setAiExplainText(e.message || "AI 精解失败");
    } finally {
      setAiExplainBusy(false);
    }
  };

  const handleSaveNote = async () => {
    if (!currentCard) return;
    const updated = await updateCardLocal(currentCard.id, { note: noteDraft });
    setAllCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setEditingNote(false);
    showToast("笔记已保存");
  };

  const handleCreateCard = async () => {
    if (!newFront.trim() || creating) return;
    setCreating(true);
    try {
      const tags = newTags
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const card = await createCardLocal({
        front_text: newFront.trim(),
        translation: newTrans.trim(),
        jyutping: newLang === "yue" ? annotateJyutpingOffline(newFront.trim()).jyutping : "",
        focus_chunk: newChunk.trim(),
        note: newNote.trim(),
        language: newLang,
        tags,
      });
      setAllCards((prev) => [card, ...prev]);
      setNewFront("");
      setNewTrans("");
      setNewChunk("");
      setNewNote("");
      setShowCreate(false);
      showToast("新词块卡已加入今日复习");
      onCardsChanged?.();
    } finally {
      setCreating(false);
    }
  };

  const handleExportTsv = async () => {
    const blob = await exportAnkiTsvBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `EchoDeck_Anki_${new Date().toISOString().slice(0, 10)}.tsv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("已导出 Anki 词表");
  };

  const handleImportFile = async (file: File) => {
    try {
      const count = await importBackupOrCsvFile(file);
      showToast(`已成功导入 ${count} 张卡片`);
      await loadCards();
      onCardsChanged?.();
    } catch (e: any) {
      showToast(`导入失败：${e.message}`);
    }
  };

  const doneCount = Math.max(0, filteredCards.length - dueCards.length);
  const progressPct = filteredCards.length > 0 ? Math.round((doneCount / filteredCards.length) * 100) : 100;
  const recentChunks = useMemo(
    () => allCards.slice(0, 5).map((c) => c.focus_chunk || c.front_text.slice(0, 42)),
    [allCards]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {toast && (
        <div className="fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-full bg-[var(--text-primary)] px-4 py-2 text-xs font-medium text-[var(--bg-surface)] shadow-xl">
          {toast}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-28 pt-3 sm:px-6">
        <div className="mx-auto max-w-xl">
          {/* 教学模式常驻轻提示 */}
          <SectionCoachBanner
            visible={showCoachTips}
            title="今日复习 · 每天 5 分钟抗遗忘刷卡"
            stepsText="① 点橙色按钮听原声（听不清切 0.8x） → ② 点「录音跟读」张嘴复述一遍 → ③ 点「显示答案」核对词块与粤拼后按掌握程度打分。"
            onStartPageTour={onStartPageTour}
            onDismiss={onDismissCoachTips}
          />

          {/* 顶部每日打卡目标 + 进度胶囊 + 单行不折行筛选滚条 */}
          <div data-tour="review-progress" className="mb-4 space-y-2.5">
            {/* 轻量每日连胜与目标胶囊条 */}
            <div className="flex items-center justify-between gap-2 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-2 text-[11px]">
              <div className="flex min-w-0 items-center gap-2.5 overflow-x-auto no-scrollbar whitespace-nowrap">
                <span className="inline-flex shrink-0 items-center gap-1 font-bold text-[var(--accent-text)]">
                  <Flame className="h-3.5 w-3.5" />
                  连胜 {habit.streakDays} 天
                </span>
                <span className="text-[var(--text-secondary)]">
                  复习 <strong className="text-[var(--text-primary)]">{habit.todayReviewedCards}</strong>/{habit.dailyReviewGoal}
                </span>
                <span className="text-[var(--text-secondary)]">
                  过词 <strong className="text-[var(--text-primary)]">{habit.todayPassedWords}</strong>/{habit.dailyWordGoal}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowGoalEdit((v) => !v)}
                className="shrink-0 rounded-full bg-[var(--bg-subtle)] px-2.5 py-1 text-[10px] font-semibold text-[var(--text-secondary)]"
              >
                {showGoalEdit ? "收起" : "定目标"}
              </button>
            </div>

            {showGoalEdit && (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/70 p-2.5 text-xs">
                <label className="inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                  每日复习
                  <input
                    type="number"
                    min={3}
                    max={100}
                    value={goalReviewsDraft}
                    onChange={(e) => setGoalReviewsDraft(e.target.value)}
                    className="w-12 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-1.5 py-1 text-center font-mono-code text-xs text-[var(--text-primary)]"
                  />
                  句
                </label>
                <label className="inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                  每日过词
                  <input
                    type="number"
                    min={5}
                    max={200}
                    value={goalWordsDraft}
                    onChange={(e) => setGoalWordsDraft(e.target.value)}
                    className="w-14 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-1.5 py-1 text-center font-mono-code text-xs text-[var(--text-primary)]"
                  />
                  词
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const updated = updateDailyGoals(Number(goalWordsDraft) || 20, Number(goalReviewsDraft) || 10);
                    setHabit(updated);
                    setShowGoalEdit(false);
                    showToast(`每日目标已更新：复习 ${updated.dailyReviewGoal} 句 + 过词 ${updated.dailyWordGoal} 词`);
                  }}
                  className="ml-auto rounded-full bg-[var(--accent)] px-3 py-1 text-[11px] font-semibold text-[var(--accent-fg)]"
                >
                  保存
                </button>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-[var(--text-muted)]">
                  今日进度 · 剩余 {dueCards.length} 张
                </div>
                <div className="mt-1.5 h-1.5 w-full max-w-[160px] overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] transition-all duration-500"
                    style={{ width: `${Math.max(dueCards.length === 0 ? 100 : 12, progressPct)}%` }}
                  />
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {lastRatedUndo && (
                  <button
                    type="button"
                    onClick={handleUndoLastRate}
                    className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 transition active:scale-95 dark:text-amber-300"
                    title="撤回刚误点的上一张卡片评分"
                  >
                    <RotateCcw className="h-3 w-3" />
                    撤回
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMode(mode === "study" ? "browse" : "study")}
                  className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] shadow-xs"
                >
                  {mode === "study" ? <List className="h-3.5 w-3.5" /> : <BookOpen className="h-3.5 w-3.5" />}
                  {mode === "study" ? `全部 (${allCards.length})` : "回刷卡"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-xs font-semibold text-[var(--accent-fg)] shadow-xs transition active:scale-95"
                >
                  <Plus className="h-3.5 w-3.5" />
                  记一句
                </button>
              </div>
            </div>

            {/* 单行优雅横滑筛选条（自动覆盖用户所有语种卡片） */}
            <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {availableLangFilters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setLangFilter(item.id)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                    langFilter === item.id
                      ? "bg-[var(--text-primary)] text-[var(--bg-surface)]"
                      : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-hairline)]"
                  }`}
                >
                  {item.label}
                </button>
              ))}

              <button
                type="button"
                onClick={() => setBlindMode((v) => !v)}
                className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  blindMode
                    ? "bg-[var(--accent-soft)] text-[var(--accent-text)] border border-[var(--accent-ring)]"
                    : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-hairline)]"
                }`}
              >
                {blindMode ? <EyeOff className="h-3.5 w-3.5" /> : <Ear className="h-3.5 w-3.5" />}
                {blindMode ? "盲听已开" : "盲听模式"}
              </button>

              {allTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTagFilter(tagFilter === t ? "" : t)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs transition ${
                    tagFilter === t
                      ? "bg-[var(--accent)] font-semibold text-[var(--accent-fg)]"
                      : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                  }`}
                >
                  #{t}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="surface-card space-y-4 rounded-[28px] p-6">
              <div className="flex items-center justify-between">
                <div className="skeleton-shimmer h-5 w-24 rounded-full" />
                <div className="skeleton-shimmer h-4 w-16 rounded-full" />
              </div>
              <div className="skeleton-shimmer h-12 w-full rounded-2xl" />
              <div className="space-y-2.5 pt-2">
                <div className="skeleton-shimmer h-7 w-11/12 rounded-xl" />
                <div className="skeleton-shimmer h-7 w-3/4 rounded-xl" />
              </div>
              <div className="skeleton-shimmer mt-4 h-12 w-full rounded-2xl" />
            </div>
          ) : mode === "study" ? (
            !currentCard ? (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="surface-card rounded-[28px] px-6 py-14 text-center"
              >
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">今日复习全部通关</h2>
                <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-[var(--text-secondary)]">
                  趁热打铁：用刚刷完的表达找 AI 语伴聊 2 分钟刚看的电影、追的剧或任何感兴趣的话题，或者去「影听」板块再挖几句新台词！
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => onOpenCoachWithChunks(recentChunks, langFilter || "en")}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-5 py-2.5 text-xs font-semibold text-[var(--accent-fg)] shadow-sm"
                  >
                    <MessageSquare className="h-4 w-4" />
                    用这些词块和 AI 聊两句
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("browse")}
                    className="rounded-full bg-[var(--bg-subtle)] px-4 py-2.5 text-xs font-medium text-[var(--text-primary)]"
                  >
                    浏览全部词卡
                  </button>
                </div>
              </motion.div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentCard.id}
                  initial={{ opacity: 0, y: 16, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -12, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 320, damping: 28 }}
                  className="surface-card overflow-hidden rounded-[28px]"
                >
                  {/* 视频截图（如有） */}
                  {resolvedImgUrl && (
                    <div className="relative aspect-video w-full overflow-hidden bg-black">
                      <img src={resolvedImgUrl} alt="场景帧" className="h-full w-full object-cover" />
                      <div className="absolute bottom-3 left-3 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md">
                        {currentCard.language === "yue" ? "粤语" : "英语"} · 已复习 {currentCard.reps} 次
                      </div>
                    </div>
                  )}

                  <div className="p-5 sm:p-7">
                    {/* 顶部标签 */}
                    <div className="mb-4 flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-[var(--bg-subtle)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)]">
                          {currentCard.language === "yue" ? "香港粤语" : currentCard.language === "en" ? "英语原声" : "中文"}
                        </span>
                        {(currentCard.tags || []).map((t) => (
                          <span key={t} className="rounded-full bg-[var(--bg-subtle)] px-2.5 py-0.5 text-[11px] text-[var(--text-muted)]">
                            #{t}
                          </span>
                        ))}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            triggerHaptic(8);
                            echoAgentBridge.getApp()?.openCopilot(
                              `帮我结合这张正在复习的句子「${currentCard.front_text}」给我举 2 个真实生活场景例句，顺便出个小问题让我用它造句`
                            );
                          }}
                          className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[10.5px] font-bold text-[var(--accent-text)] transition active:scale-95"
                        >
                          <Sparkles className="h-3 w-3" />
                          问 AI 助教
                        </button>
                        <span className="text-[11px] text-[var(--text-muted)]">
                          {currentCard.reps === 0 ? "首次学习" : `第 ${currentCard.reps + 1} 轮`}
                        </span>
                      </div>
                    </div>

                    {/* 主听读区：原声播放 + 0.8x + 跟读对比 */}
                    <div
                      data-tour="review-audio-bar"
                      className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl bg-[var(--bg-subtle)]/75 p-3"
                    >
                      <button
                        type="button"
                        onClick={() => playVoiceOrClip()}
                        className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-fg)] shadow-sm transition active:scale-95"
                      >
                        <Volume2 className={`h-4 w-4 ${isPlayingAudio ? "animate-pulse" : ""}`} />
                        {resolvedAudioUrl ? "听原声" : "朗读句子"}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const next = !slowMode;
                          setSlowMode(next);
                          playVoiceOrClip(next ? 0.8 : 1.0);
                        }}
                        className={`rounded-full px-3 py-2 font-mono-code text-xs font-semibold transition ${
                          slowMode
                            ? "bg-[var(--accent-soft)] text-[var(--accent-text)] border border-[var(--accent-ring)]"
                            : "bg-[var(--bg-surface)] text-[var(--text-secondary)]"
                        }`}
                      >
                        0.8x 慢听
                      </button>

                      {resolvedAudioUrl && (
                        <button
                          type="button"
                          onClick={() => setLoopAudio((v) => !v)}
                          className={`inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium transition ${
                            loopAudio
                              ? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
                              : "bg-[var(--bg-surface)] text-[var(--text-secondary)]"
                          }`}
                        >
                          <Repeat className="h-3.5 w-3.5" />
                          循环
                        </button>
                      )}

                      <div className="w-full pt-1 sm:ml-auto sm:w-auto sm:pt-0">
                        <ShadowRecorder compact onPlayOriginal={() => playVoiceOrClip()} />
                      </div>
                    </div>

                    {/* 核心句子区 */}
                    {blindMode && !revealed ? (
                      <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-subtle)]/50 px-5 py-9 text-center">
                        <Ear className="mx-auto mb-2.5 h-7 w-7 text-[var(--accent-text)]" />
                        <p className="text-sm font-semibold text-[var(--text-primary)]">盲听训练中</p>
                        <p className="mt-1 text-xs text-[var(--text-secondary)]">先点上方橙色按钮听 2 遍并跟读，再翻面验证</p>
                      </div>
                    ) : (
                      <div className="py-1">
                        {currentCard.focus_chunk && (
                          <div className="mb-3 inline-flex items-center rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent-text)]">
                            重点词块 · {currentCard.focus_chunk}
                          </div>
                        )}
                        <p className="text-[22px] font-bold leading-[1.48] tracking-tight text-[var(--text-primary)] sm:text-2xl">
                          <ClickableWordsText
                            text={currentCard.front_text}
                            lang={currentCard.language || "en"}
                            onWordClick={(w) => setLookupWord(w)}
                          />
                        </p>
                        <p className="mt-1 text-[10px] text-[var(--text-muted)]">点句子中任意生词可离线速查释义与例句</p>
                        {currentCard.context_prev && (
                          <p className="mt-3 text-xs text-[var(--text-muted)]">上一句：{currentCard.context_prev}</p>
                        )}
                      </div>
                    )}

                    {/* 翻面与打分区 */}
                    <div data-tour="review-action-area" className="mt-6">
                      {!revealed ? (
                        <button
                          type="button"
                          onClick={() => {
                            triggerHaptic(10);
                            setRevealed(true);
                          }}
                          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--text-primary)] py-4 text-sm font-semibold text-[var(--bg-surface)] shadow-sm transition active:scale-[0.99]"
                        >
                          <Eye className="h-4 w-4" />
                          显示答案 · 看中文释义与笔记
                        </button>
                      ) : (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="space-y-4 border-t border-[var(--border-hairline)] pt-5"
                        >
                          {currentCard.jyutping && (
                            <div className="rounded-2xl bg-[var(--accent-soft)] px-4 py-3 font-mono-code text-sm font-medium leading-relaxed text-[var(--accent-text)]">
                              {currentCard.jyutping}
                            </div>
                          )}

                          {currentCard.translation && (
                            <p className="text-base font-medium leading-relaxed text-[var(--text-primary)]">
                              {currentCard.translation}
                            </p>
                          )}

                          {currentCard.context_next && (
                            <p className="text-xs text-[var(--text-muted)]">下一句：{currentCard.context_next}</p>
                          )}

                          {/* 笔记区 */}
                          <div className="rounded-2xl bg-[var(--bg-subtle)] p-4">
                            <div className="mb-1 flex items-center justify-between text-xs text-[var(--text-muted)]">
                              <span className="font-semibold">用法与场景笔记</span>
                              {!editingNote && (
                                <button type="button" onClick={() => setEditingNote(true)} className="font-medium text-[var(--accent-text)]">
                                  编辑
                                </button>
                              )}
                            </div>
                            {editingNote ? (
                              <div className="mt-2 space-y-2">
                                <textarea
                                  value={noteDraft}
                                  onChange={(e) => setNoteDraft(e.target.value)}
                                  rows={3}
                                  className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-2.5 text-xs text-[var(--text-primary)] outline-none"
                                />
                                <div className="flex justify-end gap-2">
                                  <button type="button" onClick={() => setEditingNote(false)} className="px-3 py-1 text-xs text-[var(--text-muted)]">
                                    取消
                                  </button>
                                  <button type="button" onClick={handleSaveNote} className="rounded-full bg-[var(--accent)] px-3.5 py-1 text-xs font-semibold text-[var(--accent-fg)]">
                                    保存
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--text-secondary)]">
                                {currentCard.note || "暂无笔记，可点右上角记录连读技巧或场景用法。"}
                              </p>
                            )}
                          </div>

                          {/* AI 辅助 */}
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={handleExplain}
                              disabled={aiExplainBusy}
                              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)]"
                            >
                              <Sparkles className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                              {aiExplainBusy ? "AI 拆解中..." : "AI 拆解地道用法"}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onOpenCoachWithChunks(
                                  [currentCard.focus_chunk || currentCard.front_text],
                                  currentCard.language === "yue" ? "yue" : "en"
                                )
                              }
                              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)]"
                            >
                              <MessageSquare className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                              拿这句练口语
                            </button>
                            {currentCard.vod_ref && onJumpToVodRef && (
                              <button
                                type="button"
                                onClick={() => onJumpToVodRef(currentCard.vod_ref!)}
                                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-3.5 py-2 text-xs font-semibold text-[var(--accent-text)]"
                              >
                                <Film className="h-3.5 w-3.5" />
                                回影厅看原片段 ({currentCard.vod_ref.episodeName}{" "}
                                {Math.floor(currentCard.vod_ref.timeSec / 60)}:
                                {String(currentCard.vod_ref.timeSec % 60).padStart(2, "0")})
                              </button>
                            )}
                          </div>

                          {aiExplainText && (
                            <div className="whitespace-pre-wrap rounded-2xl border border-[var(--accent-ring)] bg-[var(--accent-soft)] p-4 text-xs leading-relaxed text-[var(--text-primary)]">
                              {aiExplainText}
                            </div>
                          )}

                          {/* 大白话四档 FSRS 评分 */}
                          <div className="pt-1">
                            <div className="mb-2 text-center text-[11px] text-[var(--text-muted)]">
                              诚实选择你刚才的掌握程度，系统自动安排下次复习
                            </div>
                            <div className="grid grid-cols-4 gap-2">
                              {[
                                { rating: 1 as const, label: "没听懂", cls: "bg-rose-500/12 text-rose-600 dark:text-rose-400 border-rose-500/25" },
                                { rating: 2 as const, label: "有点卡", cls: "bg-amber-500/14 text-amber-700 dark:text-amber-300 border-amber-500/25" },
                                { rating: 3 as const, label: "懂且会读", cls: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/25" },
                                { rating: 4 as const, label: "脱口而出", cls: "bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/25" },
                              ].map((btn) => (
                                <button
                                  key={btn.rating}
                                  type="button"
                                  onClick={() => handleRate(btn.rating)}
                                  className={`flex flex-col items-center justify-center rounded-2xl border py-3 transition active:scale-95 ${btn.cls}`}
                                >
                                  <span className="text-xs font-bold sm:text-sm">{btn.label}</span>
                                  <span className="mt-0.5 font-mono-code text-[10px] opacity-80">
                                    {currentCard.intervals?.[btn.rating] || ""}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>
            )
          ) : (
            /* 全部词库浏览 */
            <div className="space-y-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder="搜索句子、词块或中文..."
                    className="w-full rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] py-2.5 pl-10 pr-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleExportTsv}
                  className="inline-flex items-center gap-1 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-hairline)] px-3 py-2.5 text-xs font-medium text-[var(--text-primary)]"
                >
                  <Download className="h-3.5 w-3.5" />
                  导出
                </button>
                <button
                  type="button"
                  onClick={() => importInputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-hairline)] px-3 py-2.5 text-xs font-medium text-[var(--text-primary)]"
                >
                  <Upload className="h-3.5 w-3.5" />
                  导入
                </button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".zip,.csv,.tsv,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleImportFile(f);
                    e.target.value = "";
                  }}
                />
              </div>

              <div className="space-y-2.5">
                {filteredCards.length === 0 ? (
                  <div className="surface-card rounded-2xl py-12 text-center text-xs text-[var(--text-muted)]">
                    暂无匹配词卡，点击右上角「+ 记一句」或去「影听」页一键挖卡
                  </div>
                ) : (
                  filteredCards.map((c) => (
                  <div key={c.id} className="surface-card flex items-start justify-between gap-3 rounded-2xl p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
                          {c.language === "yue" ? "粤语" : "英语"}
                        </span>
                        {c.focus_chunk && (
                          <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-text)]">
                            {c.focus_chunk}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={async () => {
                            if (c.audio_clip_path) {
                              const u = await resolveMediaSrc(c.audio_clip_path);
                              if (u) {
                                new Audio(u).play().catch(() => undefined);
                                return;
                              }
                            }
                            speakOffline(c.front_text, c.language, 1.0);
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent-text)]"
                        >
                          <Volume2 className="h-3 w-3" /> 听
                        </button>
                      </div>
                      <p className="mt-1.5 text-sm font-semibold text-[var(--text-primary)]">{c.front_text}</p>
                      {c.jyutping && <p className="mt-0.5 font-mono-code text-xs text-[var(--accent-text)]">{c.jyutping}</p>}
                      {c.translation && <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{c.translation}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteCardLocal(c.id);
                        setAllCards((prev) => prev.filter((x) => x.id !== c.id));
                        onCardsChanged?.();
                      }}
                      className="rounded-full p-2 text-[var(--text-muted)] hover:bg-rose-500/10 hover:text-rose-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 快速新建词卡底部抽屉 */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-3 backdrop-blur-xs sm:items-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-lg rounded-[28px] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-bold text-[var(--text-primary)]">
                <Languages className="h-4 w-4 text-[var(--accent-text)]" />
                随手记一句地道表达
              </h3>
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-full p-1 text-[var(--text-muted)]">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div className="flex gap-2">
                {[
                  { id: "en", label: "英语" },
                  { id: "yue", label: "粤语（自动标粤拼）" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setNewLang(opt.id)}
                    className={`rounded-full px-3.5 py-1.5 font-semibold ${
                      newLang === opt.id
                        ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                        : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <textarea
                value={newFront}
                onChange={(e) => setNewFront(e.target.value)}
                rows={3}
                placeholder="输入原句（如电影/美剧台词或日常表达）"
                className="w-full rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-subtle)]/50 p-3.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
              <input
                value={newChunk}
                onChange={(e) => setNewChunk(e.target.value)}
                placeholder="重点词块（可选，方便复习高亮）"
                className="w-full rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/50 px-3.5 py-2.5 text-[var(--text-primary)] outline-none"
              />
              <input
                value={newTrans}
                onChange={(e) => setNewTrans(e.target.value)}
                placeholder="中文意思"
                className="w-full rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/50 px-3.5 py-2.5 text-[var(--text-primary)] outline-none"
              />
              <input
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="笔记 / 发音提醒（可选）"
                className="w-full rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/50 px-3.5 py-2.5 text-[var(--text-primary)] outline-none"
              />
              <input
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                placeholder="标签（任意填写，如 美剧电影, 播客, 日常）"
                className="w-full rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/50 px-3.5 py-2.5 text-[var(--text-primary)] outline-none"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="rounded-full px-4 py-2.5 text-[var(--text-secondary)]">
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleCreateCard}
                  disabled={creating || !newFront.trim()}
                  className="rounded-full bg-[var(--accent)] px-5 py-2.5 font-semibold text-[var(--accent-fg)] disabled:opacity-50"
                >
                  加入复习
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
      {/* 复习卡片生词点词即查弹窗 */}
      <WordQuickLookupModal
        query={lookupWord}
        langHint={currentCard?.language || "en"}
        contextSentence={currentCard?.front_text || ""}
        contextTranslation={currentCard?.translation || ""}
        onClose={() => setLookupWord(null)}
        onCardCreated={(msg) => {
          showToast(msg);
          loadCards();
          onCardsChanged?.();
        }}
      />
    </div>
  );
}
