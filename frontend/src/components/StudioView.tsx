import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  Film,
  Languages,
  Layers,
  Mic2,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { annotateJyutpingOffline } from "../lib/cantoneseLocal";
import {
  annotateMediaJyutpingLocal,
  deleteMediaStandalone,
  getBlob,
  getMediaDetailStandalone,
  getSettingsLocal,
  listMediaStandalone,
  mineCardInPhone,
  replaceSubtitlesLocal,
  resolveMediaSrc,
  translateSubtitlesDirect,
} from "../lib/standaloneStore";
import { exportSubtitlesToSrt, parseSubtitleText } from "../lib/subtitleLocal";
import { transcribeInPhone } from "../lib/whisperLocal";
import type { MediaItem, SubtitleItem, VodCardRef } from "../types";
import { OnlineCinemaView } from "./OnlineCinemaView";
import { SectionCoachBanner } from "./SectionCoachBanner";
import { ShadowRecorder } from "./ShadowRecorder";
import { ClickableWordsText, WordQuickLookupModal } from "./WordQuickLookupModal";

interface StudioViewProps {
  initialMediaId?: string;
  initialSeekMs?: number;
  initialVodRef?: VodCardRef | null;
  onConsumedSeek?: () => void;
  onConsumedVodRef?: () => void;
  onOpenCoachWithChunks?: (chunks: string[], language: string) => void;
  showCoachTips: boolean;
  onDismissCoachTips: () => void;
  onStartPageTour: () => void;
  onGoIngest: () => void;
  onCardsChanged?: () => void;
}

const SPEEDS = [0.6, 0.75, 0.8, 0.9, 1.0, 1.25, 1.5];

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function StudioView({
  initialMediaId = "",
  initialSeekMs,
  initialVodRef,
  onConsumedSeek,
  onConsumedVodRef,
  onOpenCoachWithChunks,
  showCoachTips,
  onDismissCoachTips,
  onStartPageTour,
  onGoIngest,
  onCardsChanged,
}: StudioViewProps) {
  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [posterUrls, setPosterUrls] = useState<Record<string, string>>({});
  const [loadingList, setLoadingList] = useState(true);

  const [studioMode, setStudioMode] = useState<"online" | "local">(initialMediaId ? "local" : "online");
  const [selectedId, setSelectedId] = useState<string>(initialMediaId);
  const [detail, setDetail] = useState<MediaItem | null>(null);
  const [mediaUrl, setMediaUrl] = useState("");
  const [posterUrl, setPosterUrl] = useState("");
  const [isAudioOnly, setIsAudioOnly] = useState(false);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1.0);
  const [loopSentence, setLoopSentence] = useState(false);
  const [manualA, setManualA] = useState<number | null>(null);
  const [manualB, setManualB] = useState<number | null>(null);
  const [shadowMode, setShadowMode] = useState(false);
  const [shadowCountdown, setShadowCountdown] = useState(0);
  const [hideSubtitleText, setHideSubtitleText] = useState(false);
  const [showMoreTools, setShowMoreTools] = useState(false);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedSubIds, setSelectedSubIds] = useState<Set<string>>(new Set());
  const [batchMining, setBatchMining] = useState(false);

  const [mineTarget, setMineTarget] = useState<SubtitleItem | null>(null);
  const [mineChunk, setMineChunk] = useState("");
  const [mineNote, setMineNote] = useState("");
  const [mineTrans, setMineTrans] = useState("");
  const [miningBusy, setMiningBusy] = useState(false);

  const [asrMode, setAsrMode] = useState<"local" | "cloud">("local");
  const [asrLang, setAsrLang] = useState("en");
  const [asrModel, setAsrModel] = useState("Xenova/whisper-tiny");
  const [asrProgress, setAsrProgress] = useState<{ pct: number; msg: string } | null>(null);
  const [translating, setTranslating] = useState(false);
  const [toast, setToast] = useState("");
  // 字幕点词即查
  const [tapLookupOn, setTapLookupOn] = useState(true);
  const [lookupCtx, setLookupCtx] = useState<{
    word: string;
    lang: string;
    sentence: string;
    translation: string;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const activeSubRowRef = useRef<HTMLDivElement | null>(null);
  const subUploadRef = useRef<HTMLInputElement | null>(null);
  const shadowTimerRef = useRef<number | null>(null);
  const lastShadowSubIdRef = useRef<string>("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? "" : cur)), 2800);
  };

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const items = await listMediaStandalone();
      setMediaList(items);
      const map: Record<string, string> = {};
      await Promise.all(
        items.map(async (m) => {
          if (m.poster_path) map[m.id] = await resolveMediaSrc(m.poster_path);
        })
      );
      setPosterUrls(map);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (initialMediaId) {
      setStudioMode("local");
      setSelectedId(initialMediaId);
    }
  }, [initialMediaId]);

  useEffect(() => {
    if (initialVodRef) {
      setSelectedId("");
      setStudioMode("online");
    }
  }, [initialVodRef]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) {
      setDetail(null);
      setMediaUrl("");
      setPosterUrl("");
      return;
    }
    const item = await getMediaDetailStandalone(id);
    if (!item) {
      setSelectedId("");
      return;
    }
    setDetail(item);
    setAsrLang(item.language || "en");
    const [mUrl, pUrl, rawBlob, cfg] = await Promise.all([
      resolveMediaSrc(item.file_path),
      resolveMediaSrc(item.poster_path),
      getBlob(item.file_path),
      getSettingsLocal(),
    ]);
    setMediaUrl(mUrl);
    setPosterUrl(pUrl);
    setIsAudioOnly(Boolean((rawBlob && rawBlob.type.startsWith("audio/")) || /\.mp3$/i.test(item.file_path)));
    setAsrMode(cfg.whisper_mode);
    setAsrModel(cfg.whisper_local_model || "Xenova/whisper-tiny");
  }, []);

  useEffect(() => {
    loadDetail(selectedId);
    setManualA(null);
    setManualB(null);
    setLoopSentence(false);
    setShadowMode(false);
    setSelectMode(false);
    setSelectedSubIds(new Set());
  }, [selectedId, loadDetail]);

  const subtitles = useMemo(() => detail?.subtitles || [], [detail]);
  const minedSubIds = useMemo(
    () => new Set((detail?.mined_cards || []).map((c) => c.subtitle_id).filter(Boolean)),
    [detail]
  );

  const currentSubIndex = useMemo(() => {
    const ms = currentTime * 1000;
    for (let i = 0; i < subtitles.length; i++) {
      if (ms >= subtitles[i].start_ms - 80 && ms <= subtitles[i].end_ms + 80) return i;
    }
    return subtitles.length > 0 ? 0 : -1;
  }, [subtitles, currentTime]);

  const currentSub = currentSubIndex >= 0 ? subtitles[currentSubIndex] : null;

  useEffect(() => {
    activeSubRowRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [currentSubIndex]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed, mediaUrl]);

  // 支持从「词库 → 影听素材原句」一键跳转到指定毫秒听原声
  useEffect(() => {
    if (initialSeekMs === undefined || !mediaUrl || !videoRef.current) return;
    const el = videoRef.current;
    const doSeek = () => {
      el.currentTime = Math.max(0, initialSeekMs / 1000);
      el.play().catch(() => undefined);
      onConsumedSeek?.();
    };
    if (el.readyState >= 1) {
      doSeek();
    } else {
      el.addEventListener("loadedmetadata", doSeek, { once: true });
      return () => el.removeEventListener("loadedmetadata", doSeek);
    }
  }, [initialSeekMs, mediaUrl, onConsumedSeek]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const onTime = () => {
      const t = el.currentTime;
      setCurrentTime(t);
      const ms = t * 1000;

      if (manualA !== null && manualB !== null && manualB > manualA + 0.2) {
        if (t >= manualB) {
          el.currentTime = manualA;
          if (el.paused) el.play().catch(() => undefined);
          return;
        }
      }

      if (loopSentence && currentSub) {
        if (ms >= currentSub.end_ms + 60) {
          el.currentTime = Math.max(0, (currentSub.start_ms - 50) / 1000);
          if (el.paused) el.play().catch(() => undefined);
          return;
        }
      }

      if (shadowMode && currentSub && !el.paused) {
        if (ms >= currentSub.end_ms - 40 && lastShadowSubIdRef.current !== currentSub.id) {
          lastShadowSubIdRef.current = currentSub.id;
          el.pause();
          const gapMs = Math.min(Math.max((currentSub.end_ms - currentSub.start_ms) * 1.15, 1800), 6500);
          const steps = Math.ceil(gapMs / 1000);
          setShadowCountdown(steps);
          if (shadowTimerRef.current) window.clearInterval(shadowTimerRef.current);
          let left = steps;
          shadowTimerRef.current = window.setInterval(() => {
            left -= 1;
            setShadowCountdown(Math.max(0, left));
            if (left <= 0) {
              if (shadowTimerRef.current) window.clearInterval(shadowTimerRef.current);
              shadowTimerRef.current = null;
              el.play().catch(() => undefined);
            }
          }, 1000);
        }
      }
    };

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onMeta = () => {
      setDuration(el.duration || 0);
      el.playbackRate = speed;
    };

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("loadedmetadata", onMeta);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("loadedmetadata", onMeta);
    };
  }, [loopSentence, manualA, manualB, shadowMode, currentSub, speed]);

  useEffect(() => {
    return () => {
      if (shadowTimerRef.current) window.clearInterval(shadowTimerRef.current);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (shadowTimerRef.current) {
      window.clearInterval(shadowTimerRef.current);
      shadowTimerRef.current = null;
      setShadowCountdown(0);
    }
    if (el.paused) el.play().catch(() => undefined);
    else el.pause();
  }, []);

  const jumpToSubtitle = useCallback((sub: SubtitleItem) => {
    const el = videoRef.current;
    if (!el) return;
    lastShadowSubIdRef.current = "";
    el.currentTime = Math.max(0, sub.start_ms / 1000);
    el.play().catch(() => undefined);
  }, []);

  const stepSubtitle = useCallback(
    (delta: number) => {
      if (subtitles.length === 0) return;
      const base = currentSubIndex >= 0 ? currentSubIndex : 0;
      const target = subtitles[Math.min(Math.max(base + delta, 0), subtitles.length - 1)];
      if (target) jumpToSubtitle(target);
    },
    [subtitles, currentSubIndex, jumpToSubtitle]
  );

  const executeMine = useCallback(
    async (sub: SubtitleItem, overrides?: { focus_chunk?: string; note?: string; translation?: string }) => {
      if (!detail || miningBusy) return;
      setMiningBusy(true);
      try {
        const idx = subtitles.findIndex((s) => s.id === sub.id);
        const card = await mineCardInPhone({
          media: detail,
          subtitle: sub,
          videoEl: videoRef.current,
          focusChunk: overrides?.focus_chunk,
          translation: overrides?.translation,
          note: overrides?.note,
          contextPrev: idx > 0 ? subtitles[idx - 1].text : "",
          contextNext: idx >= 0 && idx + 1 < subtitles.length ? subtitles[idx + 1].text : "",
        });
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                mined_cards: [
                  ...(prev.mined_cards || []),
                  { id: card.id, subtitle_id: sub.id, front_text: card.front_text, start_ms: sub.start_ms, end_ms: sub.end_ms },
                ],
              }
            : prev
        );
        setMineTarget(null);
        showToast("已切出原声与画面，加入「今日复习」");
        onCardsChanged?.();
      } catch (e: any) {
        showToast(`挖卡失败：${e.message}`);
      } finally {
        setMiningBusy(false);
      }
    },
    [detail, miningBusy, subtitles, onCardsChanged]
  );

  const openMineDrawer = (sub: SubtitleItem) => {
    videoRef.current?.pause();
    setMineTarget(sub);
    setMineChunk("");
    setMineNote("");
    setMineTrans(sub.translation || "");
  };

  const handleBatchMine = async () => {
    if (!detail || selectedSubIds.size === 0 || batchMining) return;
    setBatchMining(true);
    try {
      let ok = 0;
      for (const sid of Array.from(selectedSubIds)) {
        const idx = subtitles.findIndex((s) => s.id === sid);
        if (idx < 0) continue;
        await mineCardInPhone({
          media: detail,
          subtitle: subtitles[idx],
          videoEl: null,
          contextPrev: idx > 0 ? subtitles[idx - 1].text : "",
          contextNext: idx + 1 < subtitles.length ? subtitles[idx + 1].text : "",
        });
        ok += 1;
      }
      showToast(`已批量切出 ${ok} 张复习卡`);
      setSelectMode(false);
      setSelectedSubIds(new Set());
      await loadDetail(detail.id);
      onCardsChanged?.();
    } finally {
      setBatchMining(false);
    }
  };

  const handleGenerateSubtitles = async () => {
    if (!detail || asrProgress) return;
    const blob = await getBlob(detail.file_path);
    if (!blob) {
      showToast("未找到本地媒体文件");
      return;
    }
    const cfg = await getSettingsLocal();
    setAsrProgress({ pct: 4, msg: "正在提取音频轨道..." });
    try {
      const subs = await transcribeInPhone({
        mediaId: detail.id,
        blob,
        language: asrLang,
        mode: asrMode,
        localModel: asrModel,
        hfMirror: cfg.whisper_hf_mirror !== "false",
        cloudBaseUrl: cfg.asr_base_url,
        cloudApiKey: cfg.asr_api_key,
        cloudModel: cfg.asr_model,
        onProgress: (pct, msg) => setAsrProgress({ pct, msg }),
      });
      await replaceSubtitlesLocal(detail.id, subs, asrLang);
      await loadDetail(detail.id);
      await loadList();
      showToast(`已生成 ${subs.length} 句时间轴字幕`);
    } catch (e: any) {
      showToast(e.message || "字幕识别失败");
    } finally {
      setTimeout(() => setAsrProgress(null), 1200);
    }
  };

  const handleUploadSrt = async (file: File) => {
    if (!detail) return;
    const raw = await file.text();
    let subs = parseSubtitleText(raw, detail.id, file.name);
    if (subs.length === 0) {
      showToast("未识别到有效字幕行");
      return;
    }
    if (detail.language === "yue") {
      subs = subs.map((s) => ({ ...s, jyutping: annotateJyutpingOffline(s.text).jyutping }));
    }
    await replaceSubtitlesLocal(detail.id, subs);
    await loadDetail(detail.id);
    await loadList();
    showToast(`已导入 ${subs.length} 句字幕`);
  };

  // ==================== 列表模式：在线零下载片库 / 本地精听库 双模式 ====================
  if (!selectedId) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        {toast && (
          <div className="fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-full bg-[var(--text-primary)] px-4 py-2 text-xs font-medium text-[var(--bg-surface)] shadow-xl">
            {toast}
          </div>
        )}

        {/* 顶部双模式切换胶囊：在线零下载片库 vs 本地离线素材 */}
        <div className="shrink-0 px-4 pb-2 pt-3 sm:px-6">
          <div className="mx-auto max-w-4xl">
            <div className="grid grid-cols-2 rounded-2xl bg-[var(--bg-subtle)] p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setStudioMode("online")}
                className={`inline-flex items-center justify-center gap-1.5 rounded-xl py-2 transition ${
                  studioMode === "online"
                    ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs"
                    : "text-[var(--text-secondary)]"
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                在线精听影院
              </button>
              <button
                type="button"
                onClick={() => setStudioMode("local")}
                className={`inline-flex items-center justify-center gap-1.5 rounded-xl py-2 transition ${
                  studioMode === "local"
                    ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs"
                    : "text-[var(--text-secondary)]"
                }`}
              >
                <Film className="h-3.5 w-3.5" />
                本地精听库 ({mediaList.length})
              </button>
            </div>
          </div>
        </div>

        {studioMode === "online" ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <OnlineCinemaView
              initialVodRef={initialVodRef}
              onConsumedVodRef={onConsumedVodRef}
              onOpenCoachWithChunks={onOpenCoachWithChunks}
              onCardsChanged={onCardsChanged}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 pb-28 pt-1 sm:px-6">
            <div className="mx-auto max-w-4xl">
              <SectionCoachBanner
                visible={showCoachTips}
                title="影听跟读 · 在线零下载片库 + 本地精听挖卡"
                stepsText="上方切「在线片库（零下载）」直接搜美剧/港剧粤语/电影在线秒播精听不占空间；切「本地精听库」可用内置体验课或导入本地音视频切原声复习卡。"
                onStartPageTour={onStartPageTour}
                onDismiss={onDismissCoachTips}
              />

              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-[var(--text-primary)]">本地离线精听库</h2>
                  <p className="text-xs text-[var(--text-muted)]">共 {mediaList.length} 条本地离线素材（可完整切原声 WAV）</p>
                </div>
                <button
                  type="button"
                  onClick={onGoIngest}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-fg)] shadow-xs"
                >
                <Download className="h-3.5 w-3.5" />
                导入新视频/播客
              </button>
            </div>

            {loadingList ? (
              <div className="py-20 text-center text-xs text-[var(--text-muted)]">正在载入素材库...</div>
            ) : mediaList.length === 0 ? (
              <div className="surface-card rounded-[28px] px-6 py-16 text-center">
                <Film className="mx-auto mb-3 h-10 w-10 text-[var(--accent-text)]" />
                <h3 className="text-base font-bold text-[var(--text-primary)]">还没有精听视频或播客</h3>
                <p className="mt-1.5 text-xs text-[var(--text-secondary)]">去导入第一条喜欢的电影片段、剧集、播客或短视频吧</p>
                <button
                  type="button"
                  onClick={onGoIngest}
                  className="mt-5 rounded-full bg-[var(--accent)] px-5 py-2.5 text-xs font-semibold text-[var(--accent-fg)]"
                >
                  去导入素材
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {mediaList.map((m) => (
                  <motion.div
                    key={m.id}
                    whileTap={{ scale: 0.985 }}
                    onClick={() => setSelectedId(m.id)}
                    className="surface-card group cursor-pointer overflow-hidden rounded-[24px] transition"
                  >
                    <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
                      {posterUrls[m.id] ? (
                        <img
                          src={posterUrls[m.id]}
                          alt={m.title}
                          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-slate-500">
                          <Mic2 className="h-8 w-8" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent" />
                      <div className="absolute left-3 top-3 flex gap-1.5">
                        <span className="rounded-full bg-black/55 px-2.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-md">
                          {m.source_type}
                        </span>
                        <span className="rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-[10px] font-semibold text-white">
                          {m.language === "yue" ? "粤语" : "英语"}
                        </span>
                      </div>
                      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-white">
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-medium backdrop-blur-md">
                          <Play className="h-3 w-3 fill-current" /> 点击跟读
                        </span>
                        <span className="font-mono-code text-xs font-medium">{fmtTime(m.duration)}</span>
                      </div>
                    </div>

                    <div className="p-4">
                      <h3 className="line-clamp-2 text-sm font-bold leading-snug text-[var(--text-primary)]">
                        {m.title}
                      </h3>
                      <div className="mt-2.5 flex items-center justify-between text-xs text-[var(--text-muted)]">
                        <span>
                          {m.subtitle_count ?? 0} 句字幕 · 已挖 {m.card_count ?? 0} 张卡
                        </span>
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await deleteMediaStandalone(m.id);
                            setMediaList((prev) => prev.filter((x) => x.id !== m.id));
                            showToast("已删除该素材");
                          }}
                          className="rounded-full p-1.5 hover:bg-rose-500/10 hover:text-rose-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    );
  }

  // ==================== 复读台模式：Apple Music 歌词级清爽沉浸布局 ====================
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {toast && (
        <div className="fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-full bg-[var(--text-primary)] px-4 py-2 text-xs font-medium text-[var(--bg-surface)] shadow-xl">
          {toast}
        </div>
      )}

      {/* 顶栏返回 + 标题 + 盲听 */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 sm:px-6">
        <button
          type="button"
          onClick={() => setSelectedId("")}
          className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-surface)] border border-[var(--border-hairline)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回
        </button>
        <h2 className="min-w-0 flex-1 truncate text-center text-xs font-bold text-[var(--text-primary)] sm:text-sm">
          {detail?.title}
        </h2>
        <button
          type="button"
          onClick={() => setHideSubtitleText((v) => !v)}
          className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium ${
            hideSubtitleText
              ? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
              : "bg-[var(--bg-surface)] border border-[var(--border-hairline)] text-[var(--text-secondary)]"
          }`}
        >
          {hideSubtitleText ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          盲听
        </button>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden px-4 pb-24 sm:px-6 lg:flex-row lg:gap-5">
        {/* 左/上：精简高端播放器卡 */}
        <div className="flex shrink-0 flex-col lg:w-[50%]">
          <div className="surface-card overflow-hidden rounded-[26px]">
            <div className={`relative w-full bg-slate-950 ${isAudioOnly ? "h-36 sm:h-48" : "aspect-video max-h-[30vh] lg:max-h-[48vh]"}`}>
              <video
                ref={videoRef}
                src={mediaUrl}
                poster={posterUrl || undefined}
                playsInline
                controls={false}
                onClick={togglePlay}
                className={`h-full w-full ${isAudioOnly ? "opacity-35 object-cover" : "object-contain"}`}
              />

              {isAudioOnly && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
                  <div className="flex h-8 items-end gap-1.5">
                    {[0.1, 0.25, 0.4, 0.15, 0.35, 0.2, 0.3].map((d, i) => (
                      <span
                        key={i}
                        style={{ animationDelay: `${d}s` }}
                        className={`w-1.5 rounded-full bg-orange-400 ${playing ? "h-7 wave-bar" : "h-2 opacity-60"}`}
                      />
                    ))}
                  </div>
                  <span className="rounded-full bg-black/45 px-3 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur-md">
                    {playing ? "正在精听播放..." : "点播放或点下方任意字幕句开始"}
                  </span>
                </div>
              )}

              {shadowCountdown > 0 && (
                <div className="absolute right-3 top-3 rounded-full bg-orange-500 px-3 py-1 text-xs font-bold text-white shadow-lg">
                  开口跟读留白 {shadowCountdown}s
                </div>
              )}
            </div>

            {/* 极简音乐级主控区（只留最常用的 4 个大操作 + 折叠进阶抽屉） */}
            <div data-tour="studio-controls" className="p-4">
              {/* 进度条 */}
              <div className="mb-3 flex items-center gap-2.5 font-mono-code text-[11px] text-[var(--text-muted)]">
                <span>{fmtTime(currentTime)}</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(duration, 1)}
                  step={0.05}
                  value={currentTime}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (videoRef.current) videoRef.current.currentTime = v;
                    setCurrentTime(v);
                  }}
                  className="h-1.5 flex-1 cursor-pointer accent-[var(--accent)]"
                />
                <span>{fmtTime(duration)}</span>
              </div>

              {/* 播放三键居中 + 一键挖卡 */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => stepSubtitle(-1)}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--bg-subtle)] text-[var(--text-primary)] active:scale-95"
                    title="上一句"
                  >
                    <SkipBack className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)] shadow-md transition active:scale-95"
                  >
                    {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-0.5 fill-current" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => stepSubtitle(1)}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--bg-subtle)] text-[var(--text-primary)] active:scale-95"
                    title="下一句"
                  >
                    <SkipForward className="h-4 w-4" />
                  </button>
                </div>

                {/* 3 颗核心状态胶囊 */}
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setLoopSentence((v) => !v)}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-semibold transition ${
                      loopSentence
                        ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                        : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                    }`}
                  >
                    <Repeat className="h-3.5 w-3.5" />
                    单句循环
                  </button>

                  <button
                    type="button"
                    onClick={() => setSpeed((s) => (s === 0.8 ? 1.0 : 0.8))}
                    className={`rounded-full px-3 py-2 font-mono-code text-xs font-semibold transition ${
                      speed !== 1.0
                        ? "bg-[var(--accent-soft)] text-[var(--accent-text)] border border-[var(--accent-ring)]"
                        : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {speed}x
                  </button>

                  {currentSub && (
                    <button
                      data-tour="studio-mine-btn"
                      type="button"
                      onClick={() => openMineDrawer(currentSub)}
                      disabled={miningBusy}
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--text-primary)] px-3.5 py-2 text-xs font-semibold text-[var(--bg-surface)] shadow-xs transition active:scale-95"
                    >
                      <Zap className="h-3.5 w-3.5 text-amber-400" />
                      挖这句
                    </button>
                  )}
                </div>
              </div>

              {/* 进阶工具折叠按钮（收起不乱，展开全能） */}
              <button
                type="button"
                onClick={() => setShowMoreTools((v) => !v)}
                className="mt-3 flex w-full items-center justify-center gap-1 rounded-xl bg-[var(--bg-subtle)]/70 py-1.5 text-[11px] font-medium text-[var(--text-secondary)]"
              >
                <Sliders className="h-3 w-3" />
                {showMoreTools ? "收起进阶复读工具" : "更多工具：影子留白 · 录音对比 · 无级变速 · 手动 A-B"}
                {showMoreTools ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>

              <AnimatePresence>
                {showMoreTools && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 space-y-3 border-t border-[var(--border-hairline)] pt-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setShadowMode((v) => !v);
                            setShadowCountdown(0);
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
                            shadowMode
                              ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                              : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                          }`}
                        >
                          <Mic2 className="h-3.5 w-3.5" />
                          影子留白跟读 {shadowMode ? "已开" : ""}
                        </button>

                        <div className="flex items-center gap-1 font-mono-code text-[11px]">
                          <button
                            type="button"
                            onClick={() => setManualA(currentTime)}
                            className={`rounded-full px-2.5 py-1 ${manualA !== null ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"}`}
                          >
                            A {manualA !== null ? fmtTime(manualA) : "定点"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setManualB(currentTime)}
                            className={`rounded-full px-2.5 py-1 ${manualB !== null ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"}`}
                          >
                            B {manualB !== null ? fmtTime(manualB) : "定点"}
                          </button>
                          {(manualA !== null || manualB !== null) && (
                            <button type="button" onClick={() => { setManualA(null); setManualB(null); }} className="px-1.5 text-rose-500">
                              清
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {SPEEDS.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setSpeed(s)}
                            className={`rounded-full px-2.5 py-1 font-mono-code text-[11px] font-semibold ${
                              speed === s
                                ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                                : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                            }`}
                          >
                            {s}x
                          </button>
                        ))}
                      </div>

                      <ShadowRecorder
                        compact
                        onPlayOriginal={() => {
                          if (currentSub) jumpToSubtitle(currentSub);
                        }}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* 右/下：Apple Music 歌词级双语字幕轨 + AI 字幕工坊 */}
        <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[26px] surface-card lg:mt-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-hairline)] px-4 py-3 text-xs">
            <span className="font-bold text-[var(--text-primary)]">同步字幕 ({subtitles.length})</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {subtitles.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setTapLookupOn((v) => !v)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      tapLookupOn ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                    }`}
                    title="开启后，点字幕里任意单词/粤语词即刻离线查释义与例句"
                  >
                    点词查 {tapLookupOn ? "开" : "关"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectMode((v) => !v);
                      setSelectedSubIds(new Set());
                    }}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                      selectMode ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                    }`}
                  >
                    <CheckSquare className="h-3 w-3" />
                    批量挖卡
                  </button>
                  <button
                    type="button"
                    disabled={translating}
                    onClick={async () => {
                      if (!detail) return;
                      setTranslating(true);
                      try {
                        const n = await translateSubtitlesDirect(detail.id);
                        await loadDetail(detail.id);
                        showToast(`已翻译 ${n} 句字幕`);
                      } catch (e: any) {
                        showToast(e.message);
                      } finally {
                        setTranslating(false);
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-subtle)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]"
                  >
                    <Languages className="h-3 w-3" />
                    {translating ? "译中" : "AI译"}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!detail) return;
                      const n = await annotateMediaJyutpingLocal(detail.id);
                      await loadDetail(detail.id);
                      showToast(`已离线标出 ${n} 句粤拼`);
                    }}
                    className="rounded-full bg-[var(--bg-subtle)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]"
                  >
                    标粤拼
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => subUploadRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-subtle)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]"
              >
                <Upload className="h-3 w-3" />
                导字幕
              </button>
              {subtitles.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (!detail) return;
                    const url = URL.createObjectURL(new Blob([exportSubtitlesToSrt(subtitles)], { type: "text/plain" }));
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${detail.title}.srt`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                  className="rounded-full bg-[var(--bg-subtle)] px-2 py-1 text-[11px] text-[var(--text-muted)]"
                >
                  .SRT
                </button>
              )}
              <input
                ref={subUploadRef}
                type="file"
                accept=".srt,.vtt,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUploadSrt(f);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          {selectMode && (
            <div className="flex items-center justify-between bg-[var(--accent-soft)] px-4 py-2.5 text-xs">
              <span className="font-semibold text-[var(--accent-text)]">已勾选 {selectedSubIds.size} 句</span>
              <button
                type="button"
                disabled={selectedSubIds.size === 0 || batchMining}
                onClick={handleBatchMine}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-3.5 py-1 font-semibold text-[var(--accent-fg)] disabled:opacity-50"
              >
                <Layers className="h-3.5 w-3.5" />
                {batchMining ? "切片中..." : "一键批量制成卡片"}
              </button>
            </div>
          )}

          {asrProgress && (
            <div className="bg-[var(--accent-soft)] px-4 py-3 text-xs">
              <div className="flex items-center justify-between font-medium text-[var(--accent-text)]">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                  {asrProgress.msg}
                </span>
                <span className="font-mono-code">{asrProgress.pct}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/10">
                <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${Math.max(5, asrProgress.pct)}%` }} />
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3">
            {subtitles.length === 0 ? (
              <div className="mx-auto my-3 max-w-md rounded-2xl bg-[var(--bg-subtle)]/75 p-5 text-xs">
                <div className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
                  <Wand2 className="h-4 w-4 text-[var(--accent-text)]" />
                  这条素材还没有字幕？手机直接 AI 生成
                </div>
                <p className="mt-1.5 leading-relaxed text-[var(--text-secondary)]">
                  选「手机本地离线」无需任何密钥，首次下载约 40MB 模型后完全断网运行；粤语长视频推荐切「云端极速」5 秒出字。
                </p>
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setAsrMode("local")}
                      className={`rounded-2xl py-2.5 text-center font-semibold ${
                        asrMode === "local" ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "bg-[var(--bg-surface)] text-[var(--text-secondary)]"
                      }`}
                    >
                      📱 手机本地离线
                    </button>
                    <button
                      type="button"
                      onClick={() => setAsrMode("cloud")}
                      className={`rounded-2xl py-2.5 text-center font-semibold ${
                        asrMode === "cloud" ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "bg-[var(--bg-surface)] text-[var(--text-secondary)]"
                      }`}
                    >
                      ⚡ 云端极速高精度
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={asrLang}
                      onChange={(e) => setAsrLang(e.target.value)}
                      className="rounded-xl bg-[var(--bg-surface)] px-3 py-2 text-[var(--text-primary)]"
                    >
                      <option value="en">英语</option>
                      <option value="yue">粤语（自动标粤拼）</option>
                      <option value="zh">普通话</option>
                    </select>
                    {asrMode === "local" ? (
                      <select
                        value={asrModel}
                        onChange={(e) => setAsrModel(e.target.value)}
                        className="rounded-xl bg-[var(--bg-surface)] px-3 py-2 text-[var(--text-primary)]"
                      >
                        <option value="Xenova/whisper-tiny.en">纯英语极速 (40MB)</option>
                        <option value="Xenova/whisper-tiny">多语种轻量 (42MB)</option>
                        <option value="Xenova/whisper-base">高精度版 (75MB)</option>
                      </select>
                    ) : (
                      <div className="flex items-center rounded-xl bg-[var(--bg-surface)] px-3 text-[11px] text-[var(--text-muted)]">
                        设置页填免费 Groq Key
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={Boolean(asrProgress)}
                    onClick={handleGenerateSubtitles}
                    className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-[var(--text-primary)] py-3 font-semibold text-[var(--bg-surface)] disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4" />
                    {asrProgress ? "正在识别..." : "一键生成同步字幕"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {subtitles.map((sub, i) => {
                  const active = i === currentSubIndex;
                  const mined = minedSubIds.has(sub.id);
                  const checked = selectedSubIds.has(sub.id);
                  return (
                    <div
                      key={sub.id}
                      ref={active ? activeSubRowRef : undefined}
                      onClick={() => {
                        if (selectMode) {
                          setSelectedSubIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(sub.id)) next.delete(sub.id);
                            else next.add(sub.id);
                            return next;
                          });
                        } else {
                          jumpToSubtitle(sub);
                        }
                      }}
                      className={`relative flex cursor-pointer items-start gap-3 rounded-2xl px-3.5 py-3 transition ${
                        active
                          ? "bg-[var(--accent-soft)]"
                          : checked
                            ? "bg-[var(--accent-soft)]/60"
                            : "hover:bg-[var(--bg-subtle)]/70"
                      }`}
                    >
                      {active && <span className="absolute bottom-3 left-1 top-3 w-1 rounded-full bg-[var(--accent)]" />}

                      {selectMode ? (
                        <div className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border-strong)]"}`}>
                          {checked && <Check className="h-3 w-3" />}
                        </div>
                      ) : (
                        <span className="mt-1 w-9 shrink-0 font-mono-code text-[10px] text-[var(--text-muted)]">
                          {fmtTime(sub.start_ms / 1000)}
                        </span>
                      )}

                      <div className="min-w-0 flex-1">
                        <p
                          className={`leading-relaxed transition ${
                            hideSubtitleText && !active
                              ? "blur-sm select-none text-sm text-[var(--text-muted)]"
                              : active
                                ? "text-[15px] font-bold text-[var(--text-primary)]"
                                : "text-sm font-medium text-[var(--text-secondary)]"
                          }`}
                        >
                          <ClickableWordsText
                            text={sub.text}
                            lang={detail?.language || "en"}
                            enabled={tapLookupOn && !selectMode && (!hideSubtitleText || active)}
                            onWordClick={(word) => {
                              videoRef.current?.pause();
                              setLookupCtx({
                                word,
                                lang: detail?.language || "en",
                                sentence: sub.text,
                                translation: sub.translation || "",
                              });
                            }}
                          />
                        </p>
                        {sub.jyutping && !hideSubtitleText && (
                          <p className="mt-0.5 font-mono-code text-[11px] text-[var(--accent-text)]">{sub.jyutping}</p>
                        )}
                        {sub.translation && !hideSubtitleText && (
                          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{sub.translation}</p>
                        )}
                      </div>

                      {!selectMode && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openMineDrawer(sub);
                          }}
                          className={`shrink-0 rounded-full p-2 transition active:scale-90 ${
                            mined
                              ? "bg-emerald-500/15 text-emerald-500"
                              : "bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--accent)] hover:text-white"
                          }`}
                          title="把这一句做成复习卡"
                        >
                          {mined ? <Check className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 挖卡抽屉 */}
      {mineTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-3 backdrop-blur-xs sm:items-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-lg rounded-[28px] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-base font-bold text-[var(--text-primary)]">
                <Zap className="h-4 w-4 text-[var(--accent-text)]" />
                把这句切成原声复习卡
              </h3>
              <button type="button" onClick={() => setMineTarget(null)} className="rounded-full p-1 text-[var(--text-muted)]">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div className="rounded-2xl bg-[var(--bg-subtle)] p-3.5">
                <p className="text-sm font-bold text-[var(--text-primary)]">{mineTarget.text}</p>
                {mineTarget.jyutping && <p className="mt-1 font-mono-code text-xs text-[var(--accent-text)]">{mineTarget.jyutping}</p>}
              </div>
              <input value={mineChunk} onChange={(e) => setMineChunk(e.target.value)} placeholder="划出最想记住的重点词块（可选）" className="w-full rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/50 px-3.5 py-2.5 text-[var(--text-primary)] outline-none" />
              <input value={mineTrans} onChange={(e) => setMineTrans(e.target.value)} placeholder="中文释义" className="w-full rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/50 px-3.5 py-2.5 text-[var(--text-primary)] outline-none" />
              <input value={mineNote} onChange={(e) => setMineNote(e.target.value)} placeholder="场景笔记（可选）" className="w-full rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/50 px-3.5 py-2.5 text-[var(--text-primary)] outline-none" />
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setMineTarget(null)} className="rounded-full px-4 py-2.5 text-[var(--text-secondary)]">
                  取消
                </button>
                <button
                  type="button"
                  disabled={miningBusy}
                  onClick={() => executeMine(mineTarget, { focus_chunk: mineChunk, note: mineNote, translation: mineTrans })}
                  className="rounded-full bg-[var(--accent)] px-5 py-2.5 font-semibold text-[var(--accent-fg)] disabled:opacity-50"
                >
                  {miningBusy ? "切片中..." : "立即制卡"}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
      {/* 字幕点词即查离线词典抽屉 */}
      <WordQuickLookupModal
        query={lookupCtx?.word || null}
        langHint={lookupCtx?.lang || "en"}
        contextSentence={lookupCtx?.sentence || ""}
        contextTranslation={lookupCtx?.translation || ""}
        onClose={() => setLookupCtx(null)}
        onCardCreated={(msg) => {
          showToast(msg);
          onCardsChanged?.();
        }}
      />
    </div>
  );
}
