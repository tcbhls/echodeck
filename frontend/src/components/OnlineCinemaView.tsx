/**
 * EchoDeck v6.5 沉浸式在线精听私教影院（零下载直连片库 × 深度语言教学闭环）：
 * 1. 语种精听影院大厅：按美剧口语 / 港剧粤语 / 经典电影 / 英语纪录片 / 全站 11 条国内直连源分频道导览
 * 2. 📸 截屏识台词：一键截帧调用智谱永久免费视觉大模型 (glm-4.6v-flash / glm-4v-flash)，自动识别画面字幕、拆词块、点词查 5 万词典
 * 3. 🙈 盲听遮字幕帘 + 🔁 复读刚这 5 秒 + 🎙️ 录音跟读对比（原声 vs 我的声音）
 * 4. 🎓 本剧 AI 课前高频词包（按剧定制缓存，带微软真人发音与一键挖卡）
 * 5. 🗣️ 影厅内置 AI 剧情陪聊（围绕正在看的剧集与本集已挖词块立刻练口语）
 * 6. 🔗 双向打通复习舱与每日打卡：每张卡片携带 vod_ref 定位锚点，复习时可一键跳回本集原秒精听
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  BookOpen,
  Camera,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Film,
  Flame,
  GraduationCap,
  Languages,
  Link2,
  Lock,
  Maximize2,
  MessageSquare,
  Mic,
  Minimize2,
  Pause,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  RotateCw,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Subtitles,
  Tv,
  Unlock,
  Upload,
  Volume2,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import {
  runEchoAgentTurn,
  type AgentActionReceipt,
  type AgentCorrection,
  type AgentTurnMessage,
  type AgentVodHitCard,
} from "../lib/aiAgentEngine";
import { echoAgentBridge } from "../lib/appAgentBridge";
import { annotateJyutpingOffline } from "../lib/cantoneseLocal";
import {
  downloadAndParseEnglishSubtitle,
  extractPureEnglishFromSubtitleLine,
  findBestSubtitleMatchForText,
  isSubtitleAlreadyAligned,
  pickBestTrackByDuration,
  searchOnlineEnglishSubtitles,
  type OnlineEnglishSubtitleOption,
} from "../lib/englishSubtitleFinder";
import { getDailyHabitStats, recordDailyActivity } from "../lib/lexiconStore";
import { createAdCleanHlsLoader, type M3u8CleanStats } from "../lib/m3u8AdFilter";
import { captureBottomSubtitleStripBlob, captureVideoFrameBlob } from "../lib/mediaEngine";
import { nativeSetFullscreenMode, speakOffline } from "../lib/nativeBridge";
import { PosterImage } from "./PosterImage";
import {
  analyzeCinemaFrameDirect,
  createCardLocal,
  explainCardDirect,
  generateShowVocabPackDirect,
  hasVisionSyncKeyLocal,
  listCardsByVodId,
  putBlob,
  readFrameSubtitleForSyncDirect,
  translateInlineSubtitlesDirect,
  updateCardLocal,
  type CinemaFrameAnalysis,
  type ShowVocabExpression,
} from "../lib/standaloneStore";
import { parseSubtitleText } from "../lib/subtitleLocal";
import {
  addCustomVodSource,
  addShowLookup,
  CURATED_STUDY_SHOWS,
  fetchVodDetail,
  fetchVodHome,
  getAllVodSources,
  getCachedShowPrep,
  getShowLookups,
  getWatchHistory,
  inferVodLanguage,
  saveCachedShowPrep,
  saveWatchHistory,
  searchVod,
  STUDY_CHANNELS,
  type CachedShowLookup,
  type CuratedStudyShow,
  type VodCategory,
  type VodDetail,
  type VodEpisode,
  type VodListItem,
  type VodSource,
  type WatchHistoryItem,
} from "../lib/vodClient";
import type { CardItem, DailyHabitStats, SubtitleItem, VodCardRef } from "../types";
import { AiAssistantBubble } from "./AiAssistantBubble";
import { ShadowRecorder } from "./ShadowRecorder";
import { ClickableWordsText, WordQuickLookupModal } from "./WordQuickLookupModal";

interface OnlineCinemaViewProps {
  initialVodRef?: VodCardRef | null;
  onConsumedVodRef?: () => void;
  onOpenCoachWithChunks?: (chunks: string[], lang: string) => void;
  onCardsChanged?: () => void;
}

type CockpitTab = "study" | "vocab" | "buddy" | "episodes";
type CurtainLevel = 0 | 1 | 2; // 0=关, 1=轻遮底部18%, 2=深遮底部26%

const SPEEDS = [0.6, 0.75, 0.8, 1.0, 1.25, 1.5];

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片编码失败"));
    reader.readAsDataURL(blob);
  });
}

/** 轻量级在线音频捕获（零大文件下载，仅在当前浏览器/WebView 支持 captureStream 时抓 5 秒演员原声） */
async function captureStreamAudioSnippet(video: HTMLVideoElement, durationMs = 5000): Promise<Blob | null> {
  try {
    const captureFn = (video as any).captureStream || (video as any).mozCaptureStream;
    if (typeof captureFn !== "function" || typeof MediaRecorder === "undefined") return null;
    const stream: MediaStream = captureFn.call(video);
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks || audioTracks.length === 0) return null;
    const audioOnly = new MediaStream(audioTracks);
    const mr = new MediaRecorder(audioOnly);
    const chunks: Blob[] = [];
    return await new Promise<Blob | null>((resolve) => {
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mr.onstop = () => {
        resolve(chunks.length > 0 ? new Blob(chunks, { type: mr.mimeType || "audio/webm" }) : null);
      };
      mr.onerror = () => resolve(null);
      mr.start();
      window.setTimeout(() => {
        if (mr.state !== "inactive") mr.stop();
      }, durationMs);
    });
  } catch {
    return null;
  }
}

export function OnlineCinemaView({
  initialVodRef,
  onConsumedVodRef,
  onOpenCoachWithChunks,
  onCardsChanged,
}: OnlineCinemaViewProps) {
  const [sources, setSources] = useState<VodSource[]>(() => getAllVodSources());
  const [sourceKey, setSourceKey] = useState<string>(() => getAllVodSources()[0].key);
  const currentSource = useMemo(
    () => sources.find((s) => s.key === sourceKey) || sources[0],
    [sources, sourceKey]
  );

  // 大厅状态（语种精听分频道 + 打卡进度 + 片库浏览）
  const [studyChannel, setStudyChannel] = useState<"curated" | "en_drama" | "yue_drama" | "movie" | "doc" | "browse">("curated");
  const [habit, setHabit] = useState<DailyHabitStats>(() => getDailyHabitStats());
  const [allVodCards, setAllVodCards] = useState<CardItem[]>([]);
  const [categories, setCategories] = useState<VodCategory[]>([]);
  const [activeCat, setActiveCat] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [items, setItems] = useState<VodListItem[]>([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState("");
  const [history, setHistory] = useState<WatchHistoryItem[]>(() => getWatchHistory());

  // 播放页状态
  const [detail, setDetail] = useState<VodDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [routeIdx, setRouteIdx] = useState(0);
  const [epIdx, setEpIdx] = useState(0);
  const [directStream, setDirectStream] = useState<{ title: string; url: string; lang: "en" | "yue" } | null>(null);
  const [pendingSeekSec, setPendingSeekSec] = useState<number>(0);
  const [studyLang, setStudyLang] = useState<"en" | "yue">("en");
  const [cockpitTab, setCockpitTab] = useState<CockpitTab>("study");

  // 播放器精听控制状态
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [scrubSec, setScrubSec] = useState<number | null>(null);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1.0);
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const [quickLoop5s, setQuickLoop5s] = useState(false);
  const [curtainLevel, setCurtainLevel] = useState<CurtainLevel>(0);
  const [peekingCurtain, setPeekingCurtain] = useState(false);
  const [streamError, setStreamError] = useState("");

  // 🛡️ FongMi 同款 M3U8 切片去广告 + 顶部/角标水印广告遮罩（默认开启，彻底挡掉顶部赌博滚动字）
  const [adFilterOn, setAdFilterOn] = useState(true);
  const [adCleanStats, setAdCleanStats] = useState<M3u8CleanStats | null>(null);
  const [bannerAdMask, setBannerAdMask] = useState<boolean>(() => {
    try {
      return localStorage.getItem("echodeck_banner_ad_mask") !== "0";
    } catch {
      return true;
    }
  });

  // 🇺🇸 纯英字幕自动搜挂 + 只遮中文保原英条 + AI 看画面自动对齐引擎
  const [subDisplayMode, setSubDisplayMode] = useState<"en_only" | "cover_zh_keep_en" | "bilingual" | "raw">("en_only");
  const [coverZhHeight, setCoverZhHeight] = useState<"sm" | "md" | "lg">("md");
  const [zhStripBottomPct, setZhStripBottomPct] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("echodeck_zh_strip_bottom");
      if (raw !== null && raw !== "") {
        const v = Number(raw);
        if (Number.isFinite(v) && v >= 0 && v <= 30) return v;
      }
      return 6.5;
    } catch {
      return 6.5;
    }
  });
  const [zhStripHeightPct, setZhStripHeightPct] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("echodeck_zh_strip_height");
      if (raw !== null && raw !== "") {
        const v = Number(raw);
        if (Number.isFinite(v) && v >= 4 && v <= 22) return v;
      }
      return 8.5;
    } catch {
      return 8.5;
    }
  });
  const [subOffsetSec, setSubOffsetSec] = useState(0);
  const [enSubBusy, setEnSubBusy] = useState(false);
  const [subSyncBusy, setSubSyncBusy] = useState(false);
  const [autoSyncOnSeek, setAutoSyncOnSeek] = useState(true);
  const [showSubSyncModal, setShowSubSyncModal] = useState(false);
  const [syncCueSearch, setSyncCueSearch] = useState("");
  const [enSubOptions, setEnSubOptions] = useState<OnlineEnglishSubtitleOption[]>([]);
  const [enSubIdx, setEnSubIdx] = useState(0);
  const [manualEnTitle, setManualEnTitle] = useState("");

  // ⛶ 自定义沉浸全屏观影状态（彻底取代浏览器原生全屏，确保盲听/遮中文/去广告/点词/一键记卡全屏 100% 保留！）
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [isScreenLocked, setIsScreenLocked] = useState(false);
  const [quickSavingCard, setQuickSavingCard] = useState(false);
  const hudTimerRef = useRef<number | null>(null);
  const isScrubbingRef = useRef(false);
  const preSeekSecRef = useRef(0);
  const postSeekSyncTimerRef = useRef<number | null>(null);
  const syncRunIdRef = useRef(0);
  const lastVideoTapRef = useRef<{ time: number; xRatio: number }>({ time: 0, xRatio: 0.5 });
  const singleTapTimerRef = useRef<number | null>(null);
  const [doubleTapFeedback, setDoubleTapFeedback] = useState("");

  // 📸 截屏识台词（智谱免费视觉 AI）结果卡
  const [scanBusy, setScanBusy] = useState(false);
  const [scanResult, setScanResult] = useState<{
    analysis: CinemaFrameAnalysis;
    frameBlob: Blob;
    previewUrl: string;
    timeSec: number;
    saved: boolean;
  } | null>(null);
  const [clipRecording, setClipRecording] = useState(false);
  const [pendingAudioBlob, setPendingAudioBlob] = useState<Blob | null>(null);

  // 本剧已挖卡片 + 课前词包 + 本剧查词记录
  const [showCards, setShowCards] = useState<CardItem[]>([]);
  const [prepItems, setPrepItems] = useState<ShowVocabExpression[]>([]);
  const [prepBusy, setPrepBusy] = useState(false);
  const [savedPrepSet, setSavedPrepSet] = useState<Set<string>>(new Set());
  const [showLookups, setShowLookups] = useState<CachedShowLookup[]>([]);

  // 影厅内置全权限 AI 剧情陪聊（沉浸目标语回复 + 中文提问先复述 + 点击气泡看中文翻译 + 纠错权限）
  const [buddyHistory, setBuddyHistory] = useState<
    Array<{
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
    }>
  >([]);
  const [buddyInput, setBuddyInput] = useState("");
  const [buddyBusy, setBuddyBusy] = useState(false);
  const [savedBuddyCorr, setSavedBuddyCorr] = useState<Set<string>>(new Set());

  // 可选外挂 .srt/.vtt 字幕 + AI 翻译 + 点词即查 + 记卡片弹窗
  const [extSubs, setExtSubs] = useState<SubtitleItem[]>([]);
  const [translatingExt, setTranslatingExt] = useState(false);
  const [quickWordInput, setQuickWordInput] = useState("");
  const [lookupCtx, setLookupCtx] = useState<{ word: string; lang: string; sentence: string; translation: string } | null>(null);

  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteFront, setNoteFront] = useState("");
  const [noteTrans, setNoteTrans] = useState("");
  const [noteChunk, setNoteChunk] = useState("");
  const [noteExplain, setNoteExplain] = useState("");
  const [noteLang, setNoteLang] = useState<"en" | "yue">("en");
  const [noteBusy, setNoteBusy] = useState(false);
  const [aiAssistBusy, setAiAssistBusy] = useState(false);

  // 添加自定义片源 / 直链播弹窗
  const [showAddModal, setShowAddModal] = useState(false);
  const [customSourceName, setCustomSourceName] = useState("");
  const [customSourceApi, setCustomSourceApi] = useState("");
  const [directUrlInput, setDirectUrlInput] = useState("");
  const [directTitleInput, setDirectTitleInput] = useState("");

  const [toast, setToast] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const srtInputRef = useRef<HTMLInputElement | null>(null);
  const lastSavedHistSecRef = useRef<number>(0);
  const peekTimerRef = useRef<number | null>(null);
  const studySecAccRef = useRef<number>(0);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((c) => (c === msg ? "" : c)), 2800);
  };

  // 加载所有在线影厅挖出的卡片计数（用于在首页“最近在追”上显示每部剧已挖几句）
  const refreshVodCards = useCallback(async (vodId?: string) => {
    const all = await listCardsByVodId();
    setAllVodCards(all);
    if (vodId) {
      setShowCards(all.filter((c) => c.vod_ref?.vodId === vodId).sort((a, b) => (a.vod_ref?.timeSec || 0) - (b.vod_ref?.timeSec || 0)));
    }
  }, []);

  useEffect(() => {
    refreshVodCards();
  }, [refreshVodCards]);

  const vodCardCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of allVodCards) {
      const id = c.vod_ref?.vodId;
      if (id) map[id] = (map[id] || 0) + 1;
    }
    return map;
  }, [allVodCards]);

  // ---------------- 加载在线片库列表 ----------------
  const loadCatalog = useCallback(
    async (srcApi: string, cat: string, pg: number, append = false) => {
      setLoadingList(true);
      setListError("");
      try {
        const res = await fetchVodHome(srcApi, cat, pg);
        if (res.categories.length > 0) setCategories(res.categories);
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setPage(pg);
        setPageCount(res.pagecount);
      } catch (e: any) {
        setListError(`当前线路加载失败（${e.message || "网络超时"}），可切上方其他直连片源重试`);
      } finally {
        setLoadingList(false);
      }
    },
    []
  );

  useEffect(() => {
    if (searchQuery) return;
    loadCatalog(currentSource.api, activeCat, 1, false);
  }, [currentSource.api, activeCat, searchQuery, loadCatalog]);

  const handleSearch = async (kw?: string, switchBrowse = true) => {
    const q = (kw ?? searchInput).trim();
    setSearchInput(q);
    if (!q) {
      setSearchQuery("");
      return;
    }
    if (switchBrowse) setStudyChannel("browse");
    setSearchQuery(q);
    setLoadingList(true);
    setListError("");
    try {
      const list = await searchVod(currentSource.api, q);
      setItems(list);
      setPageCount(1);
    } catch (e: any) {
      setListError(`搜索失败：${e.message || "网络异常"}，可切换其他片源重试`);
    } finally {
      setLoadingList(false);
    }
  };

  // ---------------- 打开某部片子 / 历史续播 / 从复习舱一键跳回 ----------------
  const openVodItem = useCallback(
    async (
      vodId: string,
      srcApi = currentSource.api,
      resumeRoute?: string,
      resumeEp?: string,
      resumeSec = 0,
      langHint?: "en" | "yue"
    ) => {
      setLoadingDetail(true);
      setStreamError("");
      setDirectStream(null);
      setExtSubs([]);
      setLoopA(null);
      setLoopB(null);
      setQuickLoop5s(false);
      setScanResult((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return null;
      });
      setPendingAudioBlob(null);
      setBuddyHistory([]);
      setCockpitTab("study");

      try {
        const d = await fetchVodDetail(srcApi, vodId);
        if (!d || d.routes.length === 0) {
          showToast("该片源暂无可用直连播放线路，请换一个片源搜片");
          return;
        }
        setDetail(d);
        const rIdx = resumeRoute ? Math.max(0, d.routes.findIndex((r) => r.name === resumeRoute)) : 0;
        const eIdx = resumeEp
          ? Math.max(0, (d.routes[rIdx]?.episodes || []).findIndex((e) => e.name === resumeEp))
          : 0;
        setRouteIdx(rIdx);
        setEpIdx(eIdx);
        const inferred = langHint || inferVodLanguage(d);
        setStudyLang(inferred);
        setNoteLang(inferred);
        echoAgentBridge.setActiveStudyLang(inferred);
        setPendingSeekSec(resumeSec);

        // 加载该剧缓存的课前预习词包、本剧查词历史、以及复习舱里该剧已挖的台词卡
        const showKey = `${d.vod_id}_${inferred}`;
        setPrepItems(getCachedShowPrep<ShowVocabExpression>(showKey) || []);
        setShowLookups(getShowLookups(d.vod_id));
        setSavedPrepSet(new Set());
        refreshVodCards(d.vod_id);
      } catch (e: any) {
        showToast(`获取剧集失败：${e.message}`);
      } finally {
        setLoadingDetail(false);
      }
    },
    [currentSource.api, refreshVodCards]
  );

  // 点击精选语言学习剧卡：自动秒搜直连片库，搜到精准结果直接列出或一步秒开
  const openCuratedShow = async (show: CuratedStudyShow) => {
    setSearchInput(show.query);
    setStudyChannel("browse");
    setSearchQuery(show.query);
    setLoadingList(true);
    setListError("");
    try {
      const list = await searchVod(currentSource.api, show.query);
      setItems(list);
      setPageCount(1);
      if (list.length === 1) {
        openVodItem(list[0].vod_id, currentSource.api, undefined, undefined, 0, show.lang);
      } else if (list.length > 0) {
        showToast(`已为你找到 ${list.length} 部《${show.title}》直连片源，点选季数/版本即刻精听`);
      }
    } catch (e: any) {
      setListError(`检索《${show.title}》失败：${e.message || "网络异常"}`);
    } finally {
      setLoadingList(false);
    }
  };

  // 响应从「今日复习」点击「🎬 回影厅听原片段」或 AI 搜片卡片点击「立即播放」跳回
  useEffect(() => {
    if (!initialVodRef) return;
    if (initialVodRef.sourceKey && sources.some((s) => s.key === initialVodRef.sourceKey)) {
      setSourceKey(initialVodRef.sourceKey);
    }
    openVodItem(
      initialVodRef.vodId,
      initialVodRef.sourceApi || currentSource.api,
      initialVodRef.routeName,
      initialVodRef.episodeName,
      initialVodRef.timeSec || 0
    );
    onConsumedVodRef?.();
  }, [initialVodRef, openVodItem, currentSource.api, onConsumedVodRef, sources]);

  const activeRoute = detail?.routes[routeIdx] || null;
  const activeEpisode: VodEpisode | null = activeRoute?.episodes[epIdx] || null;
  const activeStreamUrl = directStream?.url || activeEpisode?.url || "";
  const activeTitle = directStream?.title || (detail ? `${detail.vod_name} · ${activeEpisode?.name || ""}` : "");
  const activeShowName = directStream?.title || detail?.vod_name || "";
  const activeVodKey = detail?.vod_id || (directStream ? `direct_${directStream.title}` : "");

  // 清理截屏预览 URL 防止内存泄漏
  useEffect(() => {
    return () => {
      if (scanResult?.previewUrl) URL.revokeObjectURL(scanResult.previewUrl);
      if (peekTimerRef.current) window.clearTimeout(peekTimerRef.current);
    };
  }, [scanResult?.previewUrl]);

  // ---------------- HLS.js 流媒体播放引擎（集成 FongMi 同款智能 M3U8 去切片广告 + 自动回退原生 <video>） ----------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeStreamUrl) return;

    setStreamError("");
    setAdCleanStats(null);
    setCurrentTime(0);
    setScrubSec(null);
    setDuration(0);
    setLoopA(null);
    setLoopB(null);
    setQuickLoop5s(false);
    setExtSubs([]);
    setEnSubOptions([]);
    setEnSubIdx(0);
    setSubOffsetSec(0);
    lastSavedHistSecRef.current = 0;
    // 切换剧集或线路时取消上一集未完成的 AI 字幕校准任务，避免偏移串集污染！
    if (postSeekSyncTimerRef.current) {
      window.clearTimeout(postSeekSyncTimerRef.current);
      postSeekSyncTimerRef.current = null;
    }
    syncRunIdRef.current += 1;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isM3u8 = /\.m3u8(\?|$)/i.test(activeStreamUrl) || activeStreamUrl.includes("m3u8");

    const seekIfNeeded = () => {
      video.playbackRate = speed;
      if (pendingSeekSec > 2 && (!video.duration || video.duration > pendingSeekSec + 3)) {
        video.currentTime = pendingSeekSec;
        setPendingSeekSec(0);
      }
    };

    if (isM3u8 && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        fragLoadingTimeOut: 15000,
        pLoader: createAdCleanHlsLoader(adFilterOn, (stats) => {
          setAdCleanStats((prev) => ({
            removedSegments: (prev?.removedSegments || 0) + stats.removedSegments,
            removedBlocks: (prev?.removedBlocks || 0) + stats.removedBlocks,
            removedSeconds: (prev?.removedSeconds || 0) + stats.removedSeconds,
          }));
        }) as any,
      });
      hlsRef.current = hls;
      hls.loadSource(activeStreamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        seekIfNeeded();
        video.play().catch(() => undefined);
      });
      hls.on(Hls.Events.ERROR, (_ev, data) => {
        if (data.fatal) {
          hls.destroy();
          hlsRef.current = null;
          if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = activeStreamUrl;
            video.play().catch(() => undefined);
          } else {
            setStreamError("当前线路加载较慢或波动，点下方「选集与字幕」切换金鹰/HD(SN)/非凡线路秒开");
          }
        }
      });
    } else {
      video.src = activeStreamUrl;
      video.addEventListener("loadedmetadata", seekIfNeeded, { once: true });
      video.play().catch(() => undefined);
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [activeStreamUrl, adFilterOn]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  // 播放时长学习统计：每有效精听满 60 秒自动打卡 +1 分钟
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      studySecAccRef.current += 5;
      if (studySecAccRef.current >= 60) {
        studySecAccRef.current -= 60;
        setHabit(recordDailyActivity("cinema_min"));
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [playing]);

  // 持久化顶部广告遮罩与「只遮中文条」微调参数
  useEffect(() => {
    try {
      localStorage.setItem("echodeck_banner_ad_mask", bannerAdMask ? "1" : "0");
    } catch {
      // ignore storage quota errors
    }
  }, [bannerAdMask]);

  useEffect(() => {
    try {
      localStorage.setItem("echodeck_zh_strip_bottom", String(zhStripBottomPct));
      localStorage.setItem("echodeck_zh_strip_height", String(zhStripHeightPct));
    } catch {
      // ignore
    }
  }, [zhStripBottomPct, zhStripHeightPct]);

  // 高精度字幕时钟：播放期间每 100ms 直接对齐真实 video.currentTime（摆脱浏览器 250~500ms 粗糙 timeupdate 滞后）
  useEffect(() => {
    if (!playing || extSubs.length === 0) return;
    const timer = window.setInterval(() => {
      const el = videoRef.current;
      if (el && !isScrubbingRef.current && !el.seeking) {
        setCurrentTime(el.currentTime);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [playing, extSubs.length]);

  // 字幕自动对齐回调引用（供 seeked 事件安全调用最新状态）
  const autoAlignRef = useRef<(opts?: {
    silent?: boolean;
    subsOverride?: SubtitleItem[];
    optionsOverride?: OnlineEnglishSubtitleOption[];
    activeIdxOverride?: number;
  }) => Promise<void>>(async () => undefined);

  // 监听播放进度、拖动 seeked 真帧落地、A-B 循环与自动记住追剧进度
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onTime = () => {
      if (isScrubbingRef.current) return;
      const t = el.currentTime;
      setCurrentTime(t);
      if (loopA !== null && loopB !== null && loopB > loopA + 0.3 && t >= loopB) {
        el.currentTime = loopA;
        if (el.paused) el.play().catch(() => undefined);
        return;
      }
      if (detail && activeRoute && activeEpisode && Math.abs(t - lastSavedHistSecRef.current) >= 8) {
        lastSavedHistSecRef.current = t;
        setHistory(
          saveWatchHistory({
            id: `${currentSource.key}::${detail.vod_id}`,
            sourceKey: currentSource.key,
            sourceApi: currentSource.api,
            vodId: detail.vod_id,
            title: detail.vod_name,
            pic: detail.vod_pic,
            routeName: activeRoute.name,
            episodeName: activeEpisode.name,
            episodeUrl: activeEpisode.url,
            language: studyLang,
            positionSec: Math.floor(t),
            updatedAt: Date.now(),
          })
        );
      }
    };
    const onSeeking = () => {
      if (!isScrubbingRef.current) {
        setCurrentTime(el.currentTime);
      }
    };
    const onSeeked = () => {
      const landedSec = el.currentTime;
      setCurrentTime(landedSec);
      const jumpedSec = Math.abs(landedSec - preSeekSecRef.current);
      preSeekSecRef.current = landedSec;
      // 当用户大跨度拖动进度条（>= 12 秒）且处于外挂纯英模式时，静默用免费视觉 AI 校对一次画面台词防止硬嵌广告/不同剪辑偏移
      if (jumpedSec >= 12 && extSubs.length > 0 && subDisplayMode === "en_only" && autoSyncOnSeek) {
        if (postSeekSyncTimerRef.current) window.clearTimeout(postSeekSyncTimerRef.current);
        postSeekSyncTimerRef.current = window.setTimeout(() => {
          autoAlignRef.current({ silent: true });
        }, 950);
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onMeta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        setDuration(el.duration);
      }
      el.playbackRate = speed;
    };

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("seeking", onSeeking);
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("seeking", onSeeking);
      el.removeEventListener("seeked", onSeeked);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
    };
  }, [loopA, loopB, detail, activeRoute, activeEpisode, currentSource, studyLang, speed, extSubs.length, subDisplayMode, autoSyncOnSeek]);

  const effectiveTime = scrubSec !== null ? scrubSec : currentTime;

  const activeExtSubIdx = useMemo(() => {
    const ms = (effectiveTime + subOffsetSec) * 1000;
    for (let i = 0; i < extSubs.length; i++) {
      if (ms >= extSubs[i].start_ms - 80 && ms <= extSubs[i].end_ms + 80) return i;
    }
    return -1;
  }, [extSubs, effectiveTime, subOffsetSec]);

  /** 统一的进度条定位提交（确保记录跳前秒数、一次性 seek 不打架、seeked 自动回调真帧时间） */
  const commitVideoSeek = useCallback((targetSec: number) => {
    const el = videoRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(el.duration || duration || targetSec, targetSec));
    preSeekSecRef.current = el.currentTime;
    el.currentTime = clamped;
    setCurrentTime(clamped);
  }, [duration]);

  /** ⚡ AI 看画面一键对齐外挂纯英字幕（直接截取黑幕底下的真实原视频帧底部字幕区 -> 全轨模糊匹配 -> 自动补偿偏移甚至自动切对版本！） */
  const runAutoAlignSubtitles = async (opts?: {
    silent?: boolean;
    subsOverride?: SubtitleItem[];
    optionsOverride?: OnlineEnglishSubtitleOption[];
    activeIdxOverride?: number;
  }) => {
    const silent = Boolean(opts?.silent);
    const el = videoRef.current;
    const workingSubs = opts?.subsOverride || extSubs;
    const workingOptions = opts?.optionsOverride || enSubOptions;
    const workingIdx = opts?.activeIdxOverride ?? enSubIdx;

    if (!el || workingSubs.length === 0) {
      if (!silent) showToast("请先挂载纯英字幕再执行画面校准");
      return;
    }
    if (el.readyState < 2) {
      if (!silent) showToast("视频画面尚未解码完成，请稍等 1 秒再试");
      return;
    }

    const canVision = await hasVisionSyncKeyLocal();
    if (!canVision) {
      if (!silent) {
        setShowSubSyncModal(true);
        showToast("当前环境未注入视觉 Key，已打开「听句秒对齐 / 手动微调」面板");
      }
      return;
    }

    const myRunId = ++syncRunIdRef.current;
    if (!silent) setSubSyncBusy(true);
    try {
      const snapSec = el.currentTime;
      const stripBlob = await captureBottomSubtitleStripBlob(el, 800, 0.35);
      if (!stripBlob || myRunId !== syncRunIdRef.current) return;

      const dataUrl = await blobToDataUrl(stripBlob);
      const ocr = await readFrameSubtitleForSyncDirect(dataUrl);
      if (myRunId !== syncRunIdRef.current) return;

      if (!ocr.hasSubtitle || !ocr.en) {
        if (!silent) {
          showToast("当前画面暂无对白字幕，请等人物开口出字幕时再点「AI 对齐」");
        }
        return;
      }

      // 检查当前时刻外挂字幕是否已经与画面一致
      const curMs = (snapSec + subOffsetSec) * 1000;
      const curCue = workingSubs.find((s) => curMs >= s.start_ms - 500 && curMs <= s.end_ms + 500);
      if (curCue && isSubtitleAlreadyAligned(ocr.en, curCue.text)) {
        if (!silent) {
          showToast(`✅ 当前纯英字幕已与画面同步（${subOffsetSec >= 0 ? "+" : ""}${subOffsetSec}s）`);
        }
        return;
      }

      // 1) 在当前字幕轨中全量模糊检索画面对应的那一句
      const hit = findBestSubtitleMatchForText(workingSubs, ocr.en, snapSec);
      const minThreshold = silent ? 0.5 : 0.36;
      if (hit && hit.score >= minThreshold) {
        setSubOffsetSec(hit.suggestedOffsetSec);
        showToast(
          `${silent ? "⚡ 检测到偏移，已自动对齐字幕" : "✅ AI 已精准对齐画面字幕"}（${
            hit.suggestedOffsetSec >= 0 ? "+" : ""
          }${hit.suggestedOffsetSec}s）`
        );
        return;
      }

      // 2) 若当前轨匹配度低且有其他候选版本，自动扫描其余版本寻找最吻合的一条！
      if (workingOptions.length > 1) {
        const otherIndices = workingOptions
          .map((_, idx) => idx)
          .filter((idx) => idx !== workingIdx)
          .slice(0, 3);
        const settled = await Promise.allSettled(
          otherIndices.map(async (idx) => {
            const subs = await downloadAndParseEnglishSubtitle(workingOptions[idx].url);
            const m = findBestSubtitleMatchForText(subs, ocr.en, snapSec);
            return { idx, subs, hit: m };
          })
        );
        if (myRunId !== syncRunIdRef.current) return;

        let bestAlt: { idx: number; subs: SubtitleItem[]; hit: NonNullable<ReturnType<typeof findBestSubtitleMatchForText>> } | null = null;
        for (const r of settled) {
          if (r.status === "fulfilled" && r.value.hit && r.value.hit.score >= 0.44) {
            if (!bestAlt || r.value.hit.score > bestAlt.hit.score) {
              bestAlt = { idx: r.value.idx, subs: r.value.subs, hit: r.value.hit };
            }
          }
        }
        if (bestAlt) {
          setExtSubs(bestAlt.subs);
          setEnSubIdx(bestAlt.idx);
          setSubOffsetSec(bestAlt.hit.suggestedOffsetSec);
          showToast(
            `✅ 已自动切换至更吻合的纯英字幕 #${bestAlt.idx + 1} 并对齐（${
              bestAlt.hit.suggestedOffsetSec >= 0 ? "+" : ""
            }${bestAlt.hit.suggestedOffsetSec}s）`
          );
          return;
        }
      }

      if (!silent) {
        const seedKw = ocr.en
          .split(/\s+/)
          .filter((w) => w.length >= 4)
          .slice(0, 2)
          .join(" ");
        setSyncCueSearch(seedKw);
        setShowSubSyncModal(true);
        showToast("当前字幕版本与画面剪辑差异较大，可点「只遮中文·保原英」实现 0 延迟同步");
      }
    } catch (e: any) {
      if (!silent) {
        showToast(`自动对齐稍忙：${e?.message || "可点「字幕校准」微调或切「只遮中文·保原英」"}`);
      }
    } finally {
      if (!silent) setSubSyncBusy(false);
    }
  };
  autoAlignRef.current = runAutoAlignSubtitles;

  // ---------------- 🇺🇸 一键在线搜挂纯英文字幕（智能按片长选最佳版本 + 自动对齐画面） ----------------
  const handleAutoFetchEnglishSub = async (customEnQuery?: string): Promise<string> => {
    if (!activeShowName || enSubBusy) return "当前无可匹配的影片";
    setEnSubBusy(true);
    try {
      const searchRes = await searchOnlineEnglishSubtitles({
        showTitle: activeShowName,
        episodeName: activeEpisode?.name || "",
        isMultiEpisode: (activeRoute?.episodes.length || 0) > 1,
        manualEnQuery: (customEnQuery ?? manualEnTitle).trim() || undefined,
      });
      setEnSubOptions(searchRes.options);

      // 同时预拉取前 3 条字幕轨，按视频真实时长自动挑选最吻合剪辑版（不再盲选 #1 错轨！）
      const probeSlice = searchRes.options.slice(0, 3);
      const settled = await Promise.allSettled(
        probeSlice.map(async (opt, idx) => ({
          idx,
          subs: await downloadAndParseEnglishSubtitle(opt.url),
        }))
      );
      const validTracks = settled
        .filter((r): r is PromiseFulfilledResult<{ idx: number; subs: SubtitleItem[] }> => r.status === "fulfilled")
        .map((r) => r.value);

      if (validTracks.length === 0) {
        throw new Error("在线英文字幕下载失败，请稍后重试或切「只遮中文·保原英」");
      }

      const realDuration = videoRef.current?.duration || duration || 0;
      const chosen = pickBestTrackByDuration(validTracks, realDuration) || validTracks[0];
      setEnSubIdx(chosen.idx);
      setExtSubs(chosen.subs);
      setSubDisplayMode("en_only");
      setCurtainLevel(0); // 交给纯英遮中文底条接管
      setSubOffsetSec(0);
      const msg = `已挂载 ${searchRes.enTitle} 纯英字幕 #${chosen.idx + 1}（${chosen.subs.length} 句），已遮盖画面中文`;
      showToast(msg);

      // 若视频正在播放且已有画面，650ms 后静默触发一次 AI 画面校对，开场即精准对齐
      if (videoRef.current && videoRef.current.readyState >= 2 && videoRef.current.currentTime > 2) {
        window.setTimeout(() => {
          autoAlignRef.current({
            silent: true,
            subsOverride: chosen.subs,
            optionsOverride: searchRes.options,
            activeIdxOverride: chosen.idx,
          });
        }, 650);
      }
      return msg;
    } catch (e: any) {
      const errMsg = e?.message || "未找到该集在线英文字幕";
      showToast(errMsg);
      return errMsg;
    } finally {
      setEnSubBusy(false);
    }
  };

  const handleSwitchEnSubTrack = async (idx: number) => {
    const target = enSubOptions[idx];
    if (!target || enSubBusy) return;
    setEnSubBusy(true);
    try {
      const parsedSubs = await downloadAndParseEnglishSubtitle(target.url);
      setExtSubs(parsedSubs);
      setEnSubIdx(idx);
      setSubOffsetSec(0);
      setSubDisplayMode("en_only");
      showToast(`已切换至 ${target.label}（${parsedSubs.length} 句）`);
    } catch (e: any) {
      showToast(e?.message || "切换字幕轨失败");
    } finally {
      setEnSubBusy(false);
    }
  };

  // ---------------- 一键「复读刚这 5 秒」 ----------------
  const toggleQuickLoop5s = () => {
    const el = videoRef.current;
    if (!el) return;
    if (quickLoop5s) {
      setQuickLoop5s(false);
      setLoopA(null);
      setLoopB(null);
      showToast("已解除单句循环");
      return;
    }
    const end = Math.max(1.5, el.currentTime + 0.3);
    const start = Math.max(0, end - 5.2);
    setLoopA(start);
    setLoopB(end);
    setQuickLoop5s(true);
    el.currentTime = start;
    el.play().catch(() => undefined);
    showToast(`已锁定 ${fmtTime(start)}–${fmtTime(end)} 单句精听循环`);
  };

  // ---------------- 🙈 盲听遮字幕帘偷看 2.5 秒 ----------------
  const handlePeekCurtain = () => {
    if (curtainLevel === 0) return;
    setPeekingCurtain(true);
    if (peekTimerRef.current) window.clearTimeout(peekTimerRef.current);
    peekTimerRef.current = window.setTimeout(() => setPeekingCurtain(false), 2500);
  };

  // ---------------- 📸 一键截屏识台词（智谱免费视觉大模型 GLM-4.6V-Flash） ----------------
  const handleVisionScanFrame = async () => {
    const el = videoRef.current;
    if (!el || scanBusy) return;
    el.pause();
    const snapSec = el.currentTime;
    setScanBusy(true);
    try {
      const frameBlob = await captureVideoFrameBlob(el, 960);
      if (!frameBlob) {
        showToast("画面尚未加载出视频帧，请先播放 1 秒后再试");
        return;
      }
      const dataUrl = await blobToDataUrl(frameBlob);
      const analysis = await analyzeCinemaFrameDirect({
        imageDataUrl: dataUrl,
        showTitle: activeShowName || "在线影视",
        language: studyLang,
      });
      setScanResult((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return {
          analysis,
          frameBlob,
          previewUrl: URL.createObjectURL(frameBlob),
          timeSec: snapSec,
          saved: false,
        };
      });
      setCockpitTab("study");
      showToast("已识别画面台词与地道词块，点句中单词即可离线查词");
    } catch (e: any) {
      if (String(e?.message).includes("NO_VISION_KEY")) {
        showToast("当前网页预览无智谱视觉 Key，已打开手动记台词并支持 AI 补译");
        openQuickNoteCard(activeExtSubIdx >= 0 ? extSubs[activeExtSubIdx] : undefined);
      } else {
        showToast(`截屏识台词失败：${e?.message || "请重试或改用手动记这句"}`);
      }
    } finally {
      setScanBusy(false);
    }
  };

  // 将截屏识出的台词一键存入今日复习（连带剧照 + vod_ref 定位锚点 + 可选原声音频）
  const handleSaveScanToFsrs = async () => {
    if (!scanResult || scanResult.saved || !scanResult.analysis.original_text.trim()) return;
    setNoteBusy(true);
    try {
      const imagePath = await putBlob(`online_frame_${Date.now().toString(36)}`, scanResult.frameBlob);
      let audioPath = "";
      if (pendingAudioBlob) {
        audioPath = await putBlob(`online_audio_${Date.now().toString(36)}`, pendingAudioBlob);
        setPendingAudioBlob(null);
      }
      const vodRef: VodCardRef | undefined =
        detail && activeRoute && activeEpisode
          ? {
              sourceKey: currentSource.key,
              sourceApi: currentSource.api,
              vodId: detail.vod_id,
              title: detail.vod_name,
              routeName: activeRoute.name,
              episodeName: activeEpisode.name,
              timeSec: Math.max(0, Math.floor(scanResult.timeSec) - 1),
            }
          : undefined;

      await createCardLocal({
        front_text: scanResult.analysis.original_text,
        translation: scanResult.analysis.translation,
        jyutping: studyLang === "yue" ? annotateJyutpingOffline(scanResult.analysis.original_text).jyutping : "",
        focus_chunk: scanResult.analysis.focus_chunk,
        note: [
          scanResult.analysis.explanation,
          `来自：${activeTitle} @ ${fmtTime(scanResult.timeSec)}`,
        ]
          .filter(Boolean)
          .join("\n"),
        language: studyLang,
        tags: ["在线影院", studyLang === "yue" ? "港剧粤语" : "美剧电影", activeShowName.slice(0, 12)].filter(Boolean),
        image_path: imagePath,
        audio_clip_path: audioPath,
        vod_ref: vodRef,
      });

      setScanResult((prev) => (prev ? { ...prev, saved: true } : null));
      setHabit(recordDailyActivity("cinema_line"));
      refreshVodCards(detail?.vod_id);
      onCardsChanged?.();
      showToast("已连同剧照与原片时间点收入「今日复习」");
    } finally {
      setNoteBusy(false);
    }
  };

  // 轻量抓取 5 秒剧集原声音频切片（放进即将保存的卡片里）
  const handleGrab5sClip = async () => {
    const el = videoRef.current;
    if (!el || clipRecording) return;
    setClipRecording(true);
    try {
      const start = Math.max(0, el.currentTime - 4.5);
      el.currentTime = start;
      await el.play().catch(() => undefined);
      const blob = await captureStreamAudioSnippet(el, 5000);
      el.pause();
      if (blob && blob.size > 800) {
        setPendingAudioBlob(blob);
        showToast("已捕获 5 秒剧集演员原声！保存卡片时将自动附带");
      } else {
        showToast("当前播放线路不支持抓取原声流，复习时将自动用微软真人人声朗读");
      }
    } finally {
      setClipRecording(false);
    }
  };

  // ---------------- 🎓 课前高频词包（AI 针对本剧定制 + 本地缓存） ----------------
  const handleGeneratePrep = async (forceRefresh = false) => {
    if (!activeShowName || prepBusy) return;
    const cacheKey = `${activeVodKey}_${studyLang}`;
    if (!forceRefresh) {
      const cached = getCachedShowPrep<ShowVocabExpression>(cacheKey);
      if (cached) {
        setPrepItems(cached);
        return;
      }
    }
    setPrepBusy(true);
    try {
      const list = await generateShowVocabPackDirect({
        title: activeShowName,
        blurb: detail?.vod_blurb || "",
        typeName: detail?.type_name || "",
        language: studyLang,
      });
      setPrepItems(list);
      saveCachedShowPrep(cacheKey, list);
      showToast(`已生成《${activeShowName}》${list.length} 条高频地道表达预习包`);
    } catch (e: any) {
      showToast(`预习包生成失败：${e?.message || "请稍后重试"}`);
    } finally {
      setPrepBusy(false);
    }
  };

  const handleSavePrepToCard = async (item: ShowVocabExpression) => {
    if (savedPrepSet.has(item.phrase)) return;
    const vodRef: VodCardRef | undefined =
      detail && activeRoute && activeEpisode
        ? {
            sourceKey: currentSource.key,
            sourceApi: currentSource.api,
            vodId: detail.vod_id,
            title: detail.vod_name,
            routeName: activeRoute.name,
            episodeName: activeEpisode.name,
            timeSec: Math.floor(currentTime),
          }
        : undefined;
    await createCardLocal({
      front_text: item.example || item.phrase,
      translation: item.example_zh || item.meaning,
      jyutping: studyLang === "yue" ? annotateJyutpingOffline(item.example || item.phrase).jyutping : "",
      focus_chunk: `${item.phrase}（${item.meaning}）`,
      note: `《${activeShowName}》课前高频词包 · ${item.phonetic || ""}`,
      language: studyLang,
      tags: ["在线影院", "课前词包", studyLang === "yue" ? "港剧粤语" : "美剧电影"],
      vod_ref: vodRef,
    });
    setSavedPrepSet((prev) => new Set(prev).add(item.phrase));
    setHabit(recordDailyActivity("cinema_line"));
    refreshVodCards(detail?.vod_id);
    onCardsChanged?.();
    showToast(`已将「${item.phrase}」收入今日复习`);
  };

  // ---------------- 🗣️ 影厅内置全权限 AI 剧情陪聊（同时具备收藏当前台词、控播、查词与纠错权限） ----------------
  const handleSendBuddy = async (customText?: string) => {
    const text = (customText ?? buddyInput).trim();
    if (buddyBusy) return;
    const displayUser = text || `（开始聊《${activeShowName}》${activeEpisode?.name || ""}）`;
    const promptText =
      text ||
      `我们正在看《${activeShowName}》（${activeEpisode?.name || "当前片段"}），请用${studyLang === "yue" ? "地道香港粤语" : "自然口语英语"}开场聊一聊，并引导我用刚学到的词块回答。`;

    const nextHistory = [...buddyHistory, { id: `bu_${Date.now().toString(36)}`, role: "user" as const, content: displayUser }];
    setBuddyHistory(nextHistory);
    if (!customText) setBuddyInput("");
    setBuddyBusy(true);
    try {
      const minedChunks = [
        ...showCards.map((c) => c.focus_chunk || c.front_text.slice(0, 28)).filter(Boolean),
        ...prepItems.map((p) => p.phrase),
      ].slice(0, 6);

      const agentHistory: AgentTurnMessage[] = nextHistory.slice(0, -1).map((h, idx) => ({
        id: h.id || `bh_${idx}`,
        role: h.role,
        content: h.content,
        correction: h.correction,
        createdAt: Date.now(),
      }));

      const res = await runEchoAgentTurn({
        userInput: promptText,
        history: agentHistory,
        targetLang: studyLang,
        extraContext: `当前在在线影厅《${activeShowName}》(${activeEpisode?.name || ""})的「剧情陪聊」Tab。目标练习词块：${minedChunks.join("、") || "自由发挥"}。你可以一边用当前语种聊剧情、把中文问句先转外语复述到 user_recast、纠正用户外语表达到 correction，一边在用户说「帮我收藏这句/记一下/倒退几秒/开盲听/把某词加进词库」时直接调用对应工具执行！`,
      });

      setBuddyHistory((prev) => [
        ...prev,
        {
          id: res.id,
          role: "assistant",
          content: res.content,
          replyZh: res.replyZh,
          userQuestionRecast: res.userQuestionRecast,
          targetLang: res.targetLang || studyLang,
          speakText: res.speakText,
          speakLang: res.speakLang || studyLang,
          receipts: res.receipts,
          correction: res.correction,
          vodCards: res.vodCards,
        },
      ]);
      if (videoRef.current?.paused && res.speakText) {
        speakOffline(res.speakText, res.speakLang || studyLang, 0.96);
      }
    } catch (e: any) {
      showToast(`剧情陪聊失败：${e?.message || "请重试"}`);
    } finally {
      setBuddyBusy(false);
    }
  };

  const handleSaveBuddyCorrection = async (turnKey: string, corr: AgentCorrection) => {
    if (savedBuddyCorr.has(turnKey)) return;
    const vodRef: VodCardRef | undefined =
      detail && activeRoute && activeEpisode
        ? {
            sourceKey: currentSource.key,
            sourceApi: currentSource.api,
            vodId: detail.vod_id,
            title: detail.vod_name,
            routeName: activeRoute.name,
            episodeName: activeEpisode.name,
            timeSec: Math.floor(currentTime),
          }
        : undefined;
    await createCardLocal({
      front_text: corr.improved,
      translation: corr.original ? `升级自：${corr.original}` : corr.reason,
      jyutping: corr.lang === "yue" ? annotateJyutpingOffline(corr.improved).jyutping : "",
      focus_chunk: corr.focus_chunk || "",
      note: `《${activeShowName}》剧情陪聊 AI 纠错：${corr.reason}`,
      language: corr.lang,
      tags: ["在线影院", "AI纠错升级", corr.lang === "yue" ? "港剧粤语" : "美剧电影"],
      vod_ref: vodRef,
    });
    setSavedBuddyCorr((prev) => new Set(prev).add(turnKey));
    setHabit(recordDailyActivity("cinema_line"));
    refreshVodCards(detail?.vod_id);
    echoAgentBridge.notifyDataChanged();
    onCardsChanged?.();
    showToast("已将地道升级句存入「今日复习」");
  };

  // ---------------- 向全局全权限 AI 总线注册在线影厅实时控制权限 ----------------
  const agentStateRef = useRef({
    detail,
    directStream,
    activeRoute,
    activeEpisode,
    activeTitle,
    activeShowName,
    currentSource,
    studyLang,
    currentTime,
    duration,
    playing,
    speed,
    curtainLevel,
    loopA,
    loopB,
    showCardsCount: showCards.length,
    openVodItem,
    handleSearch,
    handleGeneratePrep,
    handleAutoFetchEnglishSub,
    refreshVodCards,
    onCardsChanged,
  });
  agentStateRef.current = {
    detail,
    directStream,
    activeRoute,
    activeEpisode,
    activeTitle,
    activeShowName,
    currentSource,
    studyLang,
    currentTime,
    duration,
    playing,
    speed,
    curtainLevel,
    loopA,
    loopB,
    showCardsCount: showCards.length,
    openVodItem,
    handleSearch,
    handleGeneratePrep,
    handleAutoFetchEnglishSub,
    refreshVodCards,
    onCardsChanged,
  };

  useEffect(() => {
    echoAgentBridge.registerCinema({
      getSnapshot: () => {
        const s = agentStateRef.current;
        return {
          isPlayerOpen: Boolean(s.detail || s.directStream),
          showTitle: s.activeShowName,
          episodeName: s.activeEpisode?.name || (s.directStream ? "直链播放" : ""),
          routeName: s.activeRoute?.name || "",
          vodId: s.detail?.vod_id || "",
          sourceKey: s.currentSource.key,
          sourceApi: s.currentSource.api,
          language: s.studyLang,
          currentTimeSec: videoRef.current?.currentTime ?? s.currentTime,
          durationSec: videoRef.current?.duration || s.duration,
          playing: s.playing,
          speed: s.speed,
          curtainLevel: s.curtainLevel,
          loopActive: s.loopA !== null && s.loopB !== null,
          blurb: s.detail?.vod_blurb || "",
          minedCount: s.showCardsCount,
          episodeCount: s.activeRoute?.episodes.length || 0,
        };
      },
      captureCurrentFrameAndVodRef: async () => {
        const s = agentStateRef.current;
        const el = videoRef.current;
        const sec = el ? el.currentTime : s.currentTime;
        let imagePath = "";
        if (el) {
          const blob = await captureVideoFrameBlob(el, 854).catch(() => null);
          if (blob) {
            imagePath = await putBlob(`online_frame_${Date.now().toString(36)}`, blob);
          }
        }
        const vodRef: VodCardRef | undefined =
          s.detail && s.activeRoute && s.activeEpisode
            ? {
                sourceKey: s.currentSource.key,
                sourceApi: s.currentSource.api,
                vodId: s.detail.vod_id,
                title: s.detail.vod_name,
                routeName: s.activeRoute.name,
                episodeName: s.activeEpisode.name,
                timeSec: Math.max(0, Math.floor(sec) - 1),
              }
            : undefined;
        return { imagePath, vodRef, activeTitle: s.activeTitle, timeSec: sec };
      },
      captureAndSaveCurrentLine: async (hintText?: string) => {
        const s = agentStateRef.current;
        const el = videoRef.current;
        if (!el) return { ok: false, message: "视频尚未加载完成" };
        el.pause();
        const snapSec = el.currentTime;
        const frameBlob = await captureVideoFrameBlob(el, 960).catch(() => null);
        let imagePath = "";
        if (frameBlob) {
          imagePath = await putBlob(`online_frame_${Date.now().toString(36)}`, frameBlob);
        }

        let front = (hintText || "").trim();
        let translation = "";
        let focusChunk = "";
        let explanation = "";

        if (!front && frameBlob) {
          try {
            const dataUrl = await blobToDataUrl(frameBlob);
            const analysis = await analyzeCinemaFrameDirect({
              imageDataUrl: dataUrl,
              showTitle: s.activeShowName || "在线影视",
              language: s.studyLang,
            });
            front = analysis.original_text;
            translation = analysis.translation;
            focusChunk = analysis.focus_chunk;
            explanation = analysis.explanation;
            setScanResult((prev) => {
              if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
              return {
                analysis,
                frameBlob,
                previewUrl: URL.createObjectURL(frameBlob),
                timeSec: snapSec,
                saved: true,
              };
            });
          } catch (e: any) {
            return {
              ok: false,
              message:
                String(e?.message).includes("NO_VISION_KEY")
                  ? "当前网页预览未注入智谱视觉 Key，请直接告诉我你想收藏的台词文本"
                  : e?.message || "视觉识词失败",
            };
          }
        } else if (front) {
          try {
            const exp = await explainCardDirect(front, s.studyLang, "");
            const mTrans = exp.match(/【传神译文】[:：]?\s*(.+)/);
            const mChunk = exp.match(/【核心词块】[:：]?\s*(.+)/);
            translation = mTrans?.[1]?.trim() || "";
            focusChunk = mChunk?.[1]?.trim().slice(0, 48) || "";
            explanation = exp;
          } catch {
            // keep front text even if explanation fails
          }
        }

        if (!front) {
          return { ok: false, message: "当前画面未检测到清晰台词，可把你想记的句子直接发给我收藏" };
        }

        const vodRef: VodCardRef | undefined =
          s.detail && s.activeRoute && s.activeEpisode
            ? {
                sourceKey: s.currentSource.key,
                sourceApi: s.currentSource.api,
                vodId: s.detail.vod_id,
                title: s.detail.vod_name,
                routeName: s.activeRoute.name,
                episodeName: s.activeEpisode.name,
                timeSec: Math.max(0, Math.floor(snapSec) - 1),
              }
            : undefined;

        const card = await createCardLocal({
          front_text: front,
          translation,
          jyutping: s.studyLang === "yue" ? annotateJyutpingOffline(front).jyutping : "",
          focus_chunk: focusChunk,
          note: [explanation, `AI 助教在线影厅摘录：${s.activeTitle} @ ${fmtTime(snapSec)}`].filter(Boolean).join("\n"),
          language: s.studyLang,
          tags: ["在线影院", "AI助教收藏", s.studyLang === "yue" ? "港剧粤语" : "美剧电影"],
          image_path: imagePath,
          vod_ref: vodRef,
        });
        setHabit(recordDailyActivity("cinema_line"));
        s.refreshVodCards(s.detail?.vod_id);
        s.onCardsChanged?.();
        showToast(`AI 助教已收藏：「${front.slice(0, 26)}」`);
        return { ok: true, message: "已收藏进今日复习", card };
      },
      control: async (cmd) => {
        const s = agentStateRef.current;
        const el = videoRef.current;
        switch (cmd.type) {
          case "play":
            el?.play().catch(() => undefined);
            return "已继续播放";
          case "pause":
            el?.pause();
            return "已暂停播放";
          case "seek_delta":
            if (el) el.currentTime = Math.max(0, el.currentTime + cmd.deltaSec);
            return `已${cmd.deltaSec < 0 ? "倒退" : "快进"} ${Math.abs(cmd.deltaSec)} 秒`;
          case "seek_to":
            if (el) el.currentTime = Math.max(0, cmd.sec);
            return `已跳转到 ${fmtTime(cmd.sec)}`;
          case "loop_last_5s":
            if (el) {
              const end = Math.max(1.5, el.currentTime + 0.3);
              const start = Math.max(0, end - 5.2);
              setLoopA(start);
              setLoopB(end);
              setQuickLoop5s(true);
              el.currentTime = start;
              el.play().catch(() => undefined);
              return `已开启 ${fmtTime(start)}–${fmtTime(end)} 五秒单句循环`;
            }
            return "播放器未就绪";
          case "clear_loop":
            setLoopA(null);
            setLoopB(null);
            setQuickLoop5s(false);
            return "已关闭区间循环";
          case "set_speed": {
            const clamped = Math.max(0.5, Math.min(2.0, cmd.speed));
            setSpeed(clamped);
            if (el) el.playbackRate = clamped;
            return `倍速已调至 ${clamped}x`;
          }
          case "set_curtain":
            setPeekingCurtain(false);
            setCurtainLevel(cmd.level);
            return cmd.level === 0 ? "已关闭盲听遮字幕帘" : `已开启盲听遮字幕帘（${cmd.level === 2 ? "高档" : "中档"}）`;
          case "auto_english_sub":
            return await s.handleAutoFetchEnglishSub(cmd.manualEnQuery);
          case "set_ad_guard": {
            const notes: string[] = [];
            if (typeof cmd.adFilter === "boolean") {
              setAdFilterOn(cmd.adFilter);
              notes.push(cmd.adFilter ? "已开启 M3U8 去插播广告" : "已关闭 M3U8 去广告");
            }
            if (typeof cmd.bannerMask === "boolean") {
              setBannerAdMask(cmd.bannerMask);
              notes.push(cmd.bannerMask ? "已开启顶部/角标水印遮罩" : "已关闭水印遮罩");
            }
            return notes.join("，") || "广告防护已就绪";
          }
          case "switch_episode": {
            const total = s.activeRoute?.episodes.length || 0;
            if (total === 0) return "当前无可切换剧集";
            const idx = Math.max(0, Math.min(total - 1, cmd.episodeNumber - 1));
            setEpIdx(idx);
            return `已切到 ${s.activeRoute?.episodes[idx]?.name || `第${idx + 1}集`}`;
          }
          case "search_show":
            setDetail(null);
            setDirectStream(null);
            await s.handleSearch(cmd.query, true);
            return `已搜索《${cmd.query}》直连片源`;
        }
      },
      generatePrepPack: async () => {
        const s = agentStateRef.current;
        setCockpitTab("vocab");
        await s.handleGeneratePrep(false);
        return `已为《${s.activeShowName}》准备好课前高频词包`;
      },
    });
    return () => echoAgentBridge.registerCinema(null);
  }, []);

  useEffect(() => {
    return echoAgentBridge.subscribeDataChange(() => {
      setHabit(getDailyHabitStats());
      refreshVodCards(agentStateRef.current.detail?.vod_id);
    });
  }, [refreshVodCards]);

  // ---------------- 外挂 .srt/.vtt 字幕与 AI 翻译 ----------------
  const handleLoadExtSrt = async (file: File) => {
    try {
      const txt = await file.text();
      const parsed = parseSubtitleText(txt, file.name);
      if (parsed.length === 0) throw new Error("未解析出有效字幕条目");
      const mapped: SubtitleItem[] = parsed.map((p, idx) => ({
        id: `ext_${idx}`,
        media_id: "online",
        idx,
        start_ms: p.start_ms,
        end_ms: p.end_ms,
        text: p.text,
        translation: p.translation || "",
        jyutping: studyLang === "yue" ? annotateJyutpingOffline(p.text).jyutping : "",
      }));
      setExtSubs(mapped);
      showToast(`已挂上 ${mapped.length} 条外挂字幕，点字幕词可离线查词`);
    } catch (e: any) {
      showToast(`字幕加载失败：${e.message}`);
    }
  };

  const handleTranslateExtSubs = async () => {
    if (extSubs.length === 0 || translatingExt) return;
    setTranslatingExt(true);
    try {
      const translated = await translateInlineSubtitlesDirect(extSubs);
      setExtSubs(translated);
      showToast("外挂字幕 AI 译文已生成");
    } catch (e: any) {
      showToast(`字幕翻译失败：${e?.message || "请重试"}`);
    } finally {
      setTranslatingExt(false);
    }
  };

  // ---------------- 统一查词（自动记入本剧查词历史） ----------------
  const openWordLookup = (word: string, sentence = "", translation = "") => {
    const clean = word.trim();
    if (!clean) return;
    videoRef.current?.pause();
    setLookupCtx({ word: clean, lang: studyLang, sentence, translation });
    if (activeVodKey) {
      setShowLookups(
        addShowLookup(activeVodKey, {
          word: clean,
          lang: studyLang,
          timeSec: Math.floor(currentTime),
          createdAt: Date.now(),
        })
      );
    }
  };

  // ---------------- 手动「记这句」卡片弹窗 ----------------
  const openQuickNoteCard = (presetSub?: SubtitleItem) => {
    videoRef.current?.pause();
    setNoteFront(presetSub?.text || "");
    setNoteTrans(presetSub?.translation || "");
    setNoteChunk("");
    setNoteExplain("");
    setNoteLang(studyLang);
    setShowNoteModal(true);
  };

  const handleAiFillCard = async () => {
    if (!noteFront.trim() || aiAssistBusy) return;
    setAiAssistBusy(true);
    try {
      const reply = await explainCardDirect(noteFront.trim(), noteLang, noteChunk.trim());
      if (!noteTrans.trim()) {
        const m = reply.match(/【传神译文】[:：]?\s*(.+)/);
        if (m?.[1]) setNoteTrans(m[1].trim());
        else setNoteTrans(reply.slice(0, 120));
      }
      if (!noteChunk.trim()) {
        const m = reply.match(/【核心词块】[:：]?\s*(.+)/);
        if (m?.[1]) setNoteChunk(m[1].trim().slice(0, 48));
      }
      setNoteExplain(reply);
      showToast("AI 已补全译文、词块与精讲笔记");
    } catch (e: any) {
      showToast(e.message || "AI 辅助失败");
    } finally {
      setAiAssistBusy(false);
    }
  };

  const handleSaveStreamCard = async () => {
    if (!noteFront.trim() || noteBusy) return;
    setNoteBusy(true);
    try {
      let imagePath = "";
      if (videoRef.current) {
        const frameBlob = await captureVideoFrameBlob(videoRef.current).catch(() => null);
        if (frameBlob) {
          imagePath = await putBlob(`online_frame_${Date.now().toString(36)}`, frameBlob);
        }
      }
      let audioPath = "";
      if (pendingAudioBlob) {
        audioPath = await putBlob(`online_audio_${Date.now().toString(36)}`, pendingAudioBlob);
        setPendingAudioBlob(null);
      }
      const vodRef: VodCardRef | undefined =
        detail && activeRoute && activeEpisode
          ? {
              sourceKey: currentSource.key,
              sourceApi: currentSource.api,
              vodId: detail.vod_id,
              title: detail.vod_name,
              routeName: activeRoute.name,
              episodeName: activeEpisode.name,
              timeSec: Math.max(0, Math.floor(currentTime) - 1),
            }
          : undefined;

      await createCardLocal({
        front_text: noteFront.trim(),
        translation: noteTrans.trim(),
        jyutping: noteLang === "yue" ? annotateJyutpingOffline(noteFront.trim()).jyutping : "",
        focus_chunk: noteChunk.trim(),
        note: [noteExplain.trim(), `在线精听摘录：${activeTitle} @ ${fmtTime(currentTime)}`].filter(Boolean).join("\n"),
        language: noteLang,
        tags: ["在线影院", noteLang === "yue" ? "港剧粤语" : "美剧电影", activeShowName.slice(0, 12)].filter(Boolean),
        image_path: imagePath,
        audio_clip_path: audioPath,
        vod_ref: vodRef,
      });
      setShowNoteModal(false);
      setNoteFront("");
      setNoteTrans("");
      setNoteChunk("");
      setNoteExplain("");
      setHabit(recordDailyActivity("cinema_line"));
      refreshVodCards(detail?.vod_id);
      onCardsChanged?.();
      showToast("已将台词连同剧照与原片定位收入「今日复习」");
    } finally {
      setNoteBusy(false);
    }
  };

  // 跟读对比：自动倒回 4.5 秒播放演员原声
  const replayLastLineForCompare = async () => {
    const el = videoRef.current;
    if (!el) return;
    const start = loopA !== null ? loopA : Math.max(0, el.currentTime - 4.5);
    const end = loopB !== null ? loopB : start + 4.5;
    el.currentTime = start;
    await el.play().catch(() => undefined);
    await new Promise<void>((resolve) => {
      window.setTimeout(() => {
        el.pause();
        resolve();
      }, Math.min(6000, Math.max(2000, (end - start) * 1000)));
    });
  };

  // ---------------- ⛶ 自定义沉浸全屏控制 + 锁屏防误触 + 点屏呼出精听小 UI ----------------
  const scheduleHudHide = useCallback((delayMs = 4200) => {
    if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
    hudTimerRef.current = window.setTimeout(() => {
      setHudVisible(false);
    }, delayMs);
  }, []);

  const enterFullscreen = useCallback(async () => {
    setIsFullscreen(true);
    setIsScreenLocked(false);
    setHudVisible(true);
    scheduleHudHide(4000);
    await nativeSetFullscreenMode(true, true);
  }, [scheduleHudHide]);

  const exitFullscreen = useCallback(async () => {
    setIsFullscreen(false);
    setIsScreenLocked(false);
    setHudVisible(true);
    if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
    await nativeSetFullscreenMode(false, false);
  }, []);

  // 组件卸载、按 ESC 或 Android 系统返回手势时自动退出全屏并恢复状态栏与竖屏
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        // 仅当由原生浏览器全屏主动退出时同步关闭（移动端 CSS 满屏不受影响）
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        exitFullscreen();
      }
    };
    const onNativeBack = () => {
      if (isFullscreen) {
        exitFullscreen();
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("echodeck:exit-fullscreen", onNativeBack);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("echodeck:exit-fullscreen", onNativeBack);
    };
  }, [isFullscreen, exitFullscreen]);

  // Android 返回手势分层回退：全屏 → 查词弹窗 / 字幕校准 / 记卡 / 添加片源 → 退出播放页返回大厅
  useEffect(() => {
    const onCloseOverlay = (ev: Event) => {
      if (isFullscreen) {
        ev.preventDefault();
        exitFullscreen();
        return;
      }
      if (lookupCtx) {
        ev.preventDefault();
        setLookupCtx(null);
        return;
      }
      if (showSubSyncModal) {
        ev.preventDefault();
        setShowSubSyncModal(false);
        return;
      }
      if (showNoteModal) {
        ev.preventDefault();
        setShowNoteModal(false);
        return;
      }
      if (showAddModal) {
        ev.preventDefault();
        setShowAddModal(false);
        return;
      }
      if (detail || directStream) {
        ev.preventDefault();
        setDetail(null);
        setDirectStream(null);
        setExtSubs([]);
        setScanResult(null);
      }
    };
    window.addEventListener("echodeck:close-overlay", onCloseOverlay);
    return () => window.removeEventListener("echodeck:close-overlay", onCloseOverlay);
  }, [isFullscreen, exitFullscreen, lookupCtx, showSubSyncModal, showNoteModal, showAddModal, detail, directStream]);

  useEffect(() => {
    return () => {
      if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
      if (postSeekSyncTimerRef.current) window.clearTimeout(postSeekSyncTimerRef.current);
      if (singleTapTimerRef.current) window.clearTimeout(singleTapTimerRef.current);
      nativeSetFullscreenMode(false, false);
    };
  }, []);

  const flashDoubleTap = (label: string) => {
    setDoubleTapFeedback(label);
    window.setTimeout(() => {
      setDoubleTapFeedback((cur) => (cur === label ? "" : cur));
    }, 750);
  };

  /** 智能区分单击与双击：单击切换精听 HUD 显隐；非锁屏时双击左区 -10s、双击右区 +10s、双击中区播放/暂停 */
  const handleTapVideoSurface = (e: React.MouseEvent<HTMLVideoElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xRatio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
    const now = Date.now();
    const prev = lastVideoTapRef.current;

    if (!isScreenLocked && now - prev.time < 270 && Math.abs(xRatio - prev.xRatio) < 0.25) {
      if (singleTapTimerRef.current) {
        window.clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      lastVideoTapRef.current = { time: 0, xRatio: 0.5 };
      const el = videoRef.current;
      if (!el) return;
      if (xRatio < 0.33) {
        commitVideoSeek(Math.max(0, el.currentTime - 10));
        flashDoubleTap("⏪ -10s");
      } else if (xRatio > 0.67) {
        commitVideoSeek(el.currentTime + 10);
        flashDoubleTap("⏩ +10s");
      } else {
        if (el.paused) {
          el.play().catch(() => undefined);
          flashDoubleTap("▶ 继续播放");
        } else {
          el.pause();
          flashDoubleTap("⏸ 已暂停");
        }
      }
      return;
    }

    lastVideoTapRef.current = { time: now, xRatio };
    if (singleTapTimerRef.current) window.clearTimeout(singleTapTimerRef.current);
    singleTapTimerRef.current = window.setTimeout(() => {
      singleTapTimerRef.current = null;
      setHudVisible((vis) => {
        if (vis) {
          if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
          return false;
        }
        scheduleHudHide(isScreenLocked ? 2800 : 4200);
        return true;
      });
    }, 220);
  };

  /** 全屏（或小屏）不中断观影：点一下小 UI 一键记录当前剧情对应的词卡（含剧照 + 原片定位锚点） */
  const handleOneTapPlotCard = async () => {
    if (quickSavingCard) return;
    const el = videoRef.current;
    if (!el) return;
    const snapSec = el.currentTime;
    setQuickSavingCard(true);
    try {
      const frameBlob = await captureVideoFrameBlob(el, 960).catch(() => null);
      const imagePath = frameBlob ? await putBlob(`online_frame_${Date.now().toString(36)}`, frameBlob) : "";
      const vodRef: VodCardRef | undefined =
        detail && activeRoute && activeEpisode
          ? {
              sourceKey: currentSource.key,
              sourceApi: currentSource.api,
              vodId: detail.vod_id,
              title: detail.vod_name,
              routeName: activeRoute.name,
              episodeName: activeEpisode.name,
              timeSec: Math.max(0, Math.floor(snapSec) - 1),
            }
          : undefined;

      // 优先 1：处于外挂纯英/双语字幕模式且当前有对应句 -> 毫秒级直接入卡（零打断继续看剧！）
      if (
        (subDisplayMode === "en_only" || subDisplayMode === "bilingual") &&
        activeExtSubIdx >= 0 &&
        extSubs[activeExtSubIdx]
      ) {
        const sub = extSubs[activeExtSubIdx];
        const cleanFront =
          subDisplayMode === "en_only"
            ? extractPureEnglishFromSubtitleLine(sub.text) || sub.text
            : sub.text;
        const prevLine = activeExtSubIdx > 0 ? extSubs[activeExtSubIdx - 1]?.text || "" : "";
        const nextLine = activeExtSubIdx + 1 < extSubs.length ? extSubs[activeExtSubIdx + 1]?.text || "" : "";

        const created = await createCardLocal({
          front_text: cleanFront,
          translation: sub.translation || "",
          jyutping: studyLang === "yue" ? annotateJyutpingOffline(cleanFront).jyutping : "",
          focus_chunk: "",
          note: [
            prevLine ? `上文：${prevLine}` : "",
            nextLine ? `下文：${nextLine}` : "",
            `全屏观影一键摘录：${activeTitle} @ ${fmtTime(snapSec)}`,
          ]
            .filter(Boolean)
            .join("\n"),
          language: studyLang,
          tags: ["在线影院", "全屏秒记", studyLang === "yue" ? "港剧粤语" : "美剧电影"],
          image_path: imagePath,
          vod_ref: vodRef,
        });
        setHabit(recordDailyActivity("cinema_line"));
        refreshVodCards(detail?.vod_id);
        echoAgentBridge.notifyDataChanged();
        onCardsChanged?.();
        showToast(`✅ 已记下剧情词卡：「${cleanFront.slice(0, 32)}${cleanFront.length > 32 ? "..." : ""}」`);

        // 若无中文译文，静默在后台用免费 AI 自动补全中文译文与核心词块，完全不打断看剧！
        if (!sub.translation) {
          explainCardDirect(cleanFront, studyLang, "")
            .then(async (reply) => {
              const mTrans = reply.match(/【传神译文】[:：]?\s*(.+)/);
              const mChunk = reply.match(/【核心词块】[:：]?\s*(.+)/);
              const trans = mTrans?.[1]?.trim() || "";
              const chunk = mChunk?.[1]?.trim().slice(0, 48) || "";
              if (trans || chunk) {
                await updateCardLocal(created.id, {
                  translation: trans || created.translation,
                  focus_chunk: chunk || created.focus_chunk,
                  note: `${reply}\n${created.note}`,
                });
                refreshVodCards(detail?.vod_id);
                echoAgentBridge.notifyDataChanged();
              }
            })
            .catch(() => undefined);
        }
        return;
      }

      // 优先 2：没挂外挂字幕 -> 用智谱免费视觉大模型直接识当前视频帧烧录字幕并自动存卡！
      if (frameBlob) {
        try {
          const dataUrl = await blobToDataUrl(frameBlob);
          const analysis = await analyzeCinemaFrameDirect({
            imageDataUrl: dataUrl,
            showTitle: activeShowName || "在线影视",
            language: studyLang,
          });
          if (analysis.original_text) {
            await createCardLocal({
              front_text: analysis.original_text,
              translation: analysis.translation,
              jyutping: studyLang === "yue" ? annotateJyutpingOffline(analysis.original_text).jyutping : "",
              focus_chunk: analysis.focus_chunk,
              note: [analysis.explanation, `全屏视觉秒记：${activeTitle} @ ${fmtTime(snapSec)}`]
                .filter(Boolean)
                .join("\n"),
              language: studyLang,
              tags: ["在线影院", "全屏秒记", studyLang === "yue" ? "港剧粤语" : "美剧电影"],
              image_path: imagePath,
              vod_ref: vodRef,
            });
            setHabit(recordDailyActivity("cinema_line"));
            refreshVodCards(detail?.vod_id);
            echoAgentBridge.notifyDataChanged();
            onCardsChanged?.();
            showToast(`✅ 全屏视觉已存卡：「${analysis.original_text.slice(0, 30)}」`);
            return;
          }
        } catch (e: any) {
          if (!String(e?.message).includes("NO_VISION_KEY")) {
            showToast(`识图稍忙，已打开全屏记词卡浮层：${e?.message || ""}`);
          }
        }
      }

      // 兜底 3：直接在全屏之上弹出轻量「记这句」浮层（绝不退出全屏！）
      openQuickNoteCard(undefined);
    } finally {
      setQuickSavingCard(false);
    }
  };

  const cycleSpeed = () => {
    const idx = SPEEDS.indexOf(speed);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    setSpeed(next);
    showToast(`播放倍速：${next}x`);
  };

  // ==================== 视图 B：沉浸式在线精听私教座舱 ====================
  if (detail || directStream) {
    const curtainHeightClass = curtainLevel === 2 ? "h-[28%]" : "h-[20%]";
    const showControlsBar = hudVisible && !(isFullscreen && isScreenLocked);

    return (
      <div className="flex h-full flex-col overflow-hidden">
        {toast && (
          <div className="fixed left-1/2 top-4 z-[99] max-w-[90vw] -translate-x-1/2 rounded-full bg-black/85 px-4 py-2 text-xs font-semibold text-white shadow-2xl backdrop-blur-md">
            {toast}
          </div>
        )}

        {/* 顶栏：返回片库 + 剧名集数 + 语种切换 */}
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-1.5">
          <button
            type="button"
            onClick={() => {
              if (isFullscreen) exitFullscreen();
              setDetail(null);
              setDirectStream(null);
              setExtSubs([]);
              setScanResult(null);
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] shadow-xs"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回大厅
          </button>
          <span className="min-w-0 flex-1 truncate text-center text-xs font-bold text-[var(--text-primary)]">
            {activeTitle}
          </span>
          <button
            type="button"
            onClick={() => {
              const next = studyLang === "en" ? "yue" : "en";
              setStudyLang(next);
              setNoteLang(next);
              echoAgentBridge.setActiveStudyLang(next);
              showToast(`已切换本剧及 AI 学习语种为：${next === "yue" ? "香港粤语" : "英语"}`);
            }}
            className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2.5 py-1.5 text-[11px] font-bold text-[var(--accent-text)]"
          >
            {studyLang === "yue" ? "🇭🇰 粤语" : "🇺🇸 英语"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-28">
          <div className="mx-auto max-w-3xl space-y-3">
            {/* 视频播放窗（自定义全屏容器：小屏与全屏共享 100% 全部盲听/遮中文/去广告/点词/一键记词卡能力！） */}
            <div className="surface-card overflow-hidden rounded-[24px]">
              <div
                className={
                  isFullscreen
                    ? "fixed inset-0 z-[70] flex h-[100dvh] w-[100dvw] select-none items-center justify-center bg-black"
                    : "relative aspect-video w-full select-none bg-black"
                }
              >
                <video
                  ref={videoRef}
                  playsInline
                  crossOrigin="anonymous"
                  onClick={handleTapVideoSurface}
                  className="h-full w-full object-contain"
                />

                {/* ⏩ 双击快退/快进/暂停轻反馈提示 */}
                {doubleTapFeedback && (
                  <div className="pointer-events-none absolute left-1/2 top-1/2 z-[45] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/75 px-4 py-2 text-sm font-bold text-white shadow-xl backdrop-blur-md">
                    {doubleTapFeedback}
                  </div>
                )}

                {/* 🛡️ FongMi 去广告生效徽章（右上角，小屏与全屏均生效，全屏 HUD 展开时避让顶栏按钮） */}
                {adCleanStats && adCleanStats.removedSegments > 0 && (!isFullscreen || hudVisible) && (
                  <div
                    className={`pointer-events-none absolute right-3 z-20 inline-flex items-center gap-1 rounded-full bg-emerald-600/85 px-2.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-xs ${
                      isFullscreen && showControlsBar ? "top-14" : "top-3"
                    }`}
                  >
                    <ShieldCheck className="h-3 w-3" />
                    已切 {adCleanStats.removedBlocks} 段广告 (-{adCleanStats.removedSeconds}s)
                  </div>
                )}

                {/* 🧹 顶部赌博滚动飘字/角标水印实心遮罩（默认开启，平滑影院黑边效果，绝不透字！） */}
                {bannerAdMask && (
                  <>
                    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[13.5%] bg-black" />
                    <div className="pointer-events-none absolute inset-x-0 top-[13.5%] z-10 h-2 bg-gradient-to-b from-black/90 to-transparent" />
                  </>
                )}

                {/* 🎞️ 「只遮中文·保原英」精确遮条（仅遮挡画面上方中文字幕行，原片下方英文字幕 0ms 零延迟永不漂移！） */}
                {subDisplayMode === "cover_zh_keep_en" && curtainLevel === 0 && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-20 bg-black transition-all duration-150"
                    style={{
                      bottom: `${zhStripBottomPct}%`,
                      height: `${zhStripHeightPct}%`,
                    }}
                  />
                )}

                {/* 🙈 盲听磨砂遮字幕帘（全屏下依然 100% 保留！HUD 展开时「偷看」按钮自动上浮避让进度条） */}
                {curtainLevel > 0 && !peekingCurtain && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePeekCurtain();
                      }}
                      className={`absolute inset-x-0 bottom-0 z-20 flex items-center justify-center bg-black/85 backdrop-blur-md transition ${curtainHeightClass}`}
                      title="点一下偷看原字幕 2.5 秒"
                    >
                      {!showControlsBar && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-white/90">
                          <EyeOff className="h-3 w-3" />
                          盲听遮字幕中 · 点此偷看 2.5 秒
                        </span>
                      )}
                    </button>
                    {showControlsBar && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePeekCurtain();
                        }}
                        className={`absolute left-1/2 z-[35] -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-black/80 px-3 py-1 text-[11px] font-semibold text-white/95 shadow-lg backdrop-blur-md active:scale-95 ${
                          isFullscreen ? "bottom-[70px]" : "bottom-[64px]"
                        }`}
                      >
                        <EyeOff className="h-3 w-3" />
                        盲听遮字幕中 · 点此偷看 2.5 秒
                      </button>
                    )}
                  </>
                )}

                {/* 🇺🇸 纯英覆盖模式：底黑幕常驻盖死中文，字幕文本在 HUD 展开时自动上浮避让进度条与两侧按钮，确保 100% 零遮挡可点查！ */}
                {extSubs.length > 0 && subDisplayMode === "en_only" && curtainLevel === 0 && (
                  <>
                    <div
                      className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-black transition ${
                        isFullscreen
                          ? coverZhHeight === "lg"
                            ? "h-[26%]"
                            : coverZhHeight === "sm"
                              ? "h-[15%]"
                              : "h-[20%]"
                          : coverZhHeight === "lg"
                            ? "h-[28%]"
                            : coverZhHeight === "sm"
                              ? "h-[17%]"
                              : "h-[22%]"
                      }`}
                    />
                    <div
                      className={`pointer-events-none absolute inset-x-0 flex justify-center px-4 transition-all duration-150 ${
                        showControlsBar
                          ? isFullscreen
                            ? "bottom-[68px] z-[35]"
                            : "bottom-[64px] z-[35]"
                          : isFullscreen
                            ? "bottom-3 z-[25]"
                            : "bottom-2 z-[25]"
                      }`}
                    >
                      {activeExtSubIdx >= 0 && extSubs[activeExtSubIdx] ? (
                        <div
                          className={`pointer-events-auto text-center font-semibold leading-snug text-white ${
                            isFullscreen
                              ? showControlsBar
                                ? "max-w-[calc(100%-290px)] rounded-xl bg-black/85 px-3.5 py-1 text-sm sm:text-base shadow-lg backdrop-blur-xs"
                                : "max-w-[92%] text-base sm:text-xl"
                              : showControlsBar
                                ? "max-w-[94%] rounded-lg bg-black/85 px-2.5 py-0.5 text-[12px] shadow-md"
                                : "max-w-[94%] text-[13px] sm:text-sm"
                          }`}
                        >
                          <ClickableWordsText
                            text={extractPureEnglishFromSubtitleLine(extSubs[activeExtSubIdx].text) || extSubs[activeExtSubIdx].text}
                            lang="en"
                            onWordClick={(w) =>
                              openWordLookup(
                                w,
                                extractPureEnglishFromSubtitleLine(extSubs[activeExtSubIdx].text) || extSubs[activeExtSubIdx].text,
                                ""
                              )
                            }
                          />
                        </div>
                      ) : !showControlsBar ? (
                        <span className="text-[10px] text-white/30">纯英模式 · 已遮盖画面中文字幕</span>
                      ) : null}
                    </div>
                  </>
                )}

                {/* 🌐 双语外挂字幕浮层（小屏与全屏通用，HUD 展开时同样上浮避让进度条） */}
                {activeExtSubIdx >= 0 && extSubs[activeExtSubIdx] && subDisplayMode === "bilingual" && (curtainLevel === 0 || peekingCurtain) && (
                  <div
                    className={`pointer-events-none absolute inset-x-4 flex justify-center transition-all duration-150 ${
                      showControlsBar
                        ? isFullscreen
                          ? "bottom-[68px] z-[35]"
                          : "bottom-[64px] z-[35]"
                        : isFullscreen
                          ? "bottom-5 z-20"
                          : "bottom-3 z-20"
                    }`}
                  >
                    <div
                      className={`pointer-events-auto rounded-xl bg-black/80 px-3.5 py-1.5 text-center font-semibold text-white backdrop-blur-xs ${
                        isFullscreen
                          ? showControlsBar
                            ? "max-w-[calc(100%-290px)] text-sm"
                            : "max-w-[90%] text-base"
                          : "max-w-[94%] text-xs"
                      }`}
                    >
                      <div>
                        <ClickableWordsText
                          text={extSubs[activeExtSubIdx].text}
                          lang={studyLang}
                          onWordClick={(w) =>
                            openWordLookup(w, extSubs[activeExtSubIdx].text, extSubs[activeExtSubIdx].translation)
                          }
                        />
                      </div>
                      {extSubs[activeExtSubIdx].translation && (
                        <div className="mt-0.5 text-[11px] font-normal text-white/80">
                          {extSubs[activeExtSubIdx].translation}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ==================== 自定义轻点呼出 HUD（小屏简洁播控 / 全屏含锁屏键 + 右侧精听小 UI） ==================== */}
                {hudVisible && (
                  <>
                    {/* 全屏锁屏态：仅显示左侧「🔓 解锁全屏」小按钮，防止观影误触 */}
                    {isFullscreen && isScreenLocked ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsScreenLocked(false);
                          scheduleHudHide(4200);
                          showToast("已解锁全屏控制");
                        }}
                        className="absolute left-4 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-1 rounded-2xl bg-black/65 px-3 py-2.5 text-white shadow-lg backdrop-blur-md active:scale-95"
                      >
                        <Lock className="h-5 w-5 text-amber-400" />
                        <span className="text-[10px] font-bold">已锁屏</span>
                      </button>
                    ) : (
                      <>
                        {/* 全屏顶部轻透明导航栏 */}
                        {isFullscreen && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-2 bg-gradient-to-b from-black/80 via-black/45 to-transparent px-4 pb-4 pt-3 text-white"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <button
                                type="button"
                                onClick={exitFullscreen}
                                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold backdrop-blur-md active:scale-95"
                              >
                                <ArrowLeft className="h-4 w-4" />
                                退出全屏
                              </button>
                              <span className="truncate text-xs font-bold text-white/95">{activeTitle}</span>
                            </div>

                            <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
                              <button
                                type="button"
                                onClick={cycleSpeed}
                                className="rounded-full bg-white/15 px-2.5 py-1 font-mono-code font-bold backdrop-blur-md"
                              >
                                {speed}x
                              </button>
                              <button
                                type="button"
                                onClick={() => setBannerAdMask((v) => !v)}
                                className={`rounded-full px-2.5 py-1 font-semibold backdrop-blur-md ${
                                  bannerAdMask ? "bg-amber-500 text-black" : "bg-white/15 text-white/90"
                                }`}
                              >
                                遮水印
                              </button>
                            </div>
                          </div>
                        )}

                        {/* 全屏左侧悬浮「🔒 锁全屏」小按钮 */}
                        {isFullscreen && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsScreenLocked(true);
                              scheduleHudHide(2400);
                              showToast("已锁定全屏，防误触");
                            }}
                            title="锁定全屏"
                            className="absolute left-3.5 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-0.5 rounded-2xl bg-black/55 px-2.5 py-2 text-white/90 backdrop-blur-md transition active:scale-95"
                          >
                            <Unlock className="h-4 w-4" />
                            <span className="text-[10px] font-semibold">锁屏</span>
                          </button>
                        )}

                        {/* 全屏右侧悬浮「⚡ 精听小 UI 面板」（2列紧凑布局，适配横屏 360px~430px 高度零遮挡！） */}
                        {isFullscreen && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-3 top-1/2 z-30 grid w-[124px] -translate-y-1/2 grid-cols-2 gap-1.5"
                          >
                            <button
                              type="button"
                              disabled={quickSavingCard}
                              onClick={() => {
                                scheduleHudHide(4500);
                                handleOneTapPlotCard();
                              }}
                              className="col-span-2 flex items-center justify-center gap-1 rounded-2xl bg-[var(--accent)] px-2.5 py-2.5 text-[var(--accent-fg)] shadow-lg transition active:scale-95 disabled:opacity-60"
                              title="不退出全屏，一键把当前这句剧情存进复习词卡"
                            >
                              <Zap className="h-3.5 w-3.5 shrink-0" />
                              <span className="text-[11px] font-bold leading-none">
                                {quickSavingCard ? "存卡中..." : "一键记剧情卡"}
                              </span>
                            </button>

                            <button
                              type="button"
                              disabled={enSubBusy}
                              onClick={() => {
                                scheduleHudHide(4500);
                                if (subDisplayMode === "en_only" && extSubs.length > 0) {
                                  setSubDisplayMode("cover_zh_keep_en");
                                  setCurtainLevel(0);
                                  showToast("已切至「只遮中文·保原英」（原片英文 0 延迟零漂移）");
                                } else if (subDisplayMode === "cover_zh_keep_en") {
                                  setSubDisplayMode("raw");
                                  showToast("已切回原画字幕");
                                } else if (extSubs.length > 0) {
                                  setSubDisplayMode("en_only");
                                  setCurtainLevel(0);
                                  showToast("已切回外挂纯英字幕（可点词查义）");
                                } else {
                                  handleAutoFetchEnglishSub();
                                }
                              }}
                              className={`flex flex-col items-center justify-center gap-0.5 rounded-2xl py-2 backdrop-blur-md active:scale-95 ${
                                (extSubs.length > 0 && subDisplayMode === "en_only") || subDisplayMode === "cover_zh_keep_en"
                                  ? "bg-sky-500 text-white"
                                  : "bg-black/65 text-white/95"
                              }`}
                            >
                              <Subtitles className="h-3.5 w-3.5" />
                              <span className="text-[9px] font-semibold leading-none">
                                {enSubBusy
                                  ? "搜英字"
                                  : subDisplayMode === "cover_zh_keep_en"
                                    ? "保原英✓"
                                    : "纯英遮中"}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                scheduleHudHide(4500);
                                setPeekingCurtain(false);
                                setCurtainLevel((lv) => ((lv + 1) % 3) as CurtainLevel);
                              }}
                              className={`flex flex-col items-center justify-center gap-0.5 rounded-2xl py-2 backdrop-blur-md active:scale-95 ${
                                curtainLevel > 0 ? "bg-indigo-500 text-white" : "bg-black/65 text-white/95"
                              }`}
                            >
                              {curtainLevel > 0 ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              <span className="text-[9px] font-semibold leading-none">
                                {curtainLevel === 0 ? "盲听遮字" : curtainLevel === 1 ? "盲听·中" : "盲听·高"}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                scheduleHudHide(4500);
                                toggleQuickLoop5s();
                              }}
                              className={`flex flex-col items-center justify-center gap-0.5 rounded-2xl py-2 backdrop-blur-md active:scale-95 ${
                                quickLoop5s ? "bg-emerald-500 text-white" : "bg-black/65 text-white/95"
                              }`}
                            >
                              <Repeat className="h-3.5 w-3.5" />
                              <span className="text-[9px] font-semibold leading-none">
                                {quickLoop5s ? "循环中" : "复读5秒"}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                scheduleHudHide(4500);
                                openQuickNoteCard(activeExtSubIdx >= 0 ? extSubs[activeExtSubIdx] : undefined);
                              }}
                              className="flex flex-col items-center justify-center gap-0.5 rounded-2xl bg-black/65 py-2 text-white backdrop-blur-md active:scale-95"
                              title="全屏内细记/AI补译词卡"
                            >
                              <Camera className="h-3.5 w-3.5 text-amber-300" />
                              <span className="text-[9px] font-semibold leading-none">细记词卡</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                videoRef.current?.pause();
                                echoAgentBridge.openCopilot();
                              }}
                              className="col-span-2 flex items-center justify-center gap-1 rounded-2xl bg-black/65 py-1.5 text-white backdrop-blur-md active:scale-95"
                            >
                              <Sparkles className="h-3.5 w-3.5 text-orange-400" />
                              <span className="text-[10px] font-semibold leading-none">呼出全权限 AI</span>
                            </button>
                          </div>
                        )}

                        {/* 底部自定义播放进度条 + 播放/倒退/快进/字幕校准/全屏切换（拖动松手精准落帧，绝不打架！） */}
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/90 via-black/65 to-transparent px-3 pb-2 pt-2 text-white"
                        >
                          <div className="mb-1 flex items-center gap-2">
                            <span className="font-mono-code text-[10px] text-white/85">{fmtTime(effectiveTime)}</span>
                            <input
                              type="range"
                              min={0}
                              max={Math.max(1, duration || 1)}
                              step={0.5}
                              value={Math.min(effectiveTime, duration || 1)}
                              onPointerDown={() => {
                                isScrubbingRef.current = true;
                                preSeekSecRef.current = videoRef.current?.currentTime ?? currentTime;
                                if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
                              }}
                              onTouchStart={() => {
                                isScrubbingRef.current = true;
                                preSeekSecRef.current = videoRef.current?.currentTime ?? currentTime;
                                if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
                              }}
                              onChange={(e) => {
                                const sec = parseFloat(e.target.value);
                                if (isScrubbingRef.current) {
                                  setScrubSec(sec);
                                } else {
                                  commitVideoSeek(sec);
                                  scheduleHudHide(4200);
                                }
                              }}
                              onPointerUp={(e) => {
                                if (!isScrubbingRef.current) return;
                                isScrubbingRef.current = false;
                                const sec = parseFloat((e.currentTarget as HTMLInputElement).value);
                                setScrubSec(null);
                                commitVideoSeek(sec);
                                scheduleHudHide(4200);
                              }}
                              onTouchEnd={(e) => {
                                if (!isScrubbingRef.current) return;
                                isScrubbingRef.current = false;
                                const sec = parseFloat((e.currentTarget as HTMLInputElement).value);
                                setScrubSec(null);
                                commitVideoSeek(sec);
                                scheduleHudHide(4200);
                              }}
                              onPointerCancel={() => {
                                isScrubbingRef.current = false;
                                setScrubSec(null);
                                scheduleHudHide(4200);
                              }}
                              className="h-1 flex-1 cursor-pointer accent-[var(--accent)] focus:outline-none"
                            />
                            <span className="font-mono-code text-[10px] text-white/75">{fmtTime(duration)}</span>
                          </div>

                          <div className="flex items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  const el = videoRef.current;
                                  if (!el) return;
                                  if (el.paused) el.play().catch(() => undefined);
                                  else el.pause();
                                  scheduleHudHide(4200);
                                }}
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-xs active:scale-95"
                              >
                                {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  commitVideoSeek(Math.max(0, (videoRef.current?.currentTime ?? currentTime) - 3));
                                  scheduleHudHide(4200);
                                }}
                                className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/95"
                              >
                                -3s
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  commitVideoSeek((videoRef.current?.currentTime ?? currentTime) + 3);
                                  scheduleHudHide(4200);
                                }}
                                className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/95"
                              >
                                +3s
                              </button>
                              {isFullscreen && extSubs.length > 0 && subDisplayMode === "en_only" && (
                                <button
                                  type="button"
                                  disabled={subSyncBusy}
                                  onClick={() => {
                                    scheduleHudHide(5200);
                                    runAutoAlignSubtitles({ silent: false });
                                  }}
                                  className="inline-flex items-center gap-1 rounded-full bg-sky-500/85 px-2.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-xs active:scale-95 disabled:opacity-60"
                                  title="AI 看当前画面字幕，0.1 秒自动校准外挂纯英时间轴"
                                >
                                  <Wand2 className="h-3 w-3" />
                                  {subSyncBusy ? "对齐中..." : "AI对齐"}
                                </button>
                              )}
                              {isFullscreen && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
                                    setShowSubSyncModal(true);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/95 active:scale-95"
                                  title="打开全屏字幕校准（切只遮中文保原英 / ±30s~±0.5s / 听句秒对齐）"
                                >
                                  <SlidersHorizontal className="h-3 w-3" />
                                  校准字幕
                                </button>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5">
                              {!isFullscreen && (
                                <button
                                  type="button"
                                  disabled={quickSavingCard}
                                  onClick={handleOneTapPlotCard}
                                  className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-2.5 py-1 text-[10px] font-bold text-[var(--accent-fg)]"
                                >
                                  <Zap className="h-3 w-3" />
                                  秒记剧情卡
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => (isFullscreen ? exitFullscreen() : enterFullscreen())}
                                className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-xs active:scale-95"
                                title={isFullscreen ? "退出沉浸全屏" : "进入沉浸精听全屏（保留盲听/遮中文/一键记词卡）"}
                              >
                                {isFullscreen ? (
                                  <>
                                    <Minimize2 className="h-3.5 w-3.5" />
                                    退出全屏
                                  </>
                                ) : (
                                  <>
                                    <Maximize2 className="h-3.5 w-3.5" />
                                    精听全屏
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>

              {streamError && (
                <div className="bg-amber-500/12 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
                  {streamError}
                </div>
              )}

              {/* 单手精听主控台 */}
              <div className="space-y-2.5 p-3.5 text-xs">
                {/* 第一排：播放控制 + 📸 截屏识台词主 C 位按钮 */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 3);
                      }}
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-subtle)] px-2.5 py-1.5 font-semibold text-[var(--text-primary)]"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      -3s
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const el = videoRef.current;
                        if (!el) return;
                        if (el.paused) el.play().catch(() => undefined);
                        else el.pause();
                      }}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--text-primary)] text-[var(--bg-surface)] shadow-xs"
                    >
                      {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (videoRef.current) videoRef.current.currentTime += 3;
                      }}
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-subtle)] px-2.5 py-1.5 font-semibold text-[var(--text-primary)]"
                    >
                      +3s
                      <RotateCw className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* 📸 一键截屏识台词 + 手动记这句 */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={scanBusy}
                      onClick={handleVisionScanFrame}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3.5 py-2 text-xs font-bold text-[var(--accent-fg)] shadow-sm transition active:scale-95 disabled:opacity-60"
                    >
                      <Camera className="h-3.5 w-3.5" />
                      {scanBusy ? "视觉识词中..." : "截屏识台词"}
                    </button>
                    <button
                      type="button"
                      onClick={() => openQuickNoteCard(activeExtSubIdx >= 0 ? extSubs[activeExtSubIdx] : undefined)}
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-subtle)] px-3 py-2 font-semibold text-[var(--text-primary)]"
                      title="手动输入台词记卡"
                    >
                      <Zap className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                      记这句
                    </button>
                  </div>
                </div>

                {/* 第二排：🇺🇸 纯英字幕(遮中文) + 🎞️ 只遮中文保原英 + 复读5秒 + 盲听帘 + 去广告/遮水印 */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={enSubBusy}
                    onClick={() => {
                      if (extSubs.length > 0 && subDisplayMode === "en_only") {
                        setSubDisplayMode("raw");
                        showToast("已暂时切回原画字幕");
                      } else if (extSubs.length > 0) {
                        setSubDisplayMode("en_only");
                        setCurtainLevel(0);
                        showToast("已开启外挂纯英字幕（可点词查义）");
                      } else {
                        handleAutoFetchEnglishSub();
                      }
                    }}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                      extSubs.length > 0 && subDisplayMode === "en_only"
                        ? "bg-sky-600 text-white shadow-xs"
                        : "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                    }`}
                  >
                    <Subtitles className="h-3.5 w-3.5" />
                    {enSubBusy
                      ? "搜纯英字幕..."
                      : extSubs.length > 0 && subDisplayMode === "en_only"
                        ? "外挂纯英 ✓"
                        : "纯英字幕(遮中文)"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (subDisplayMode === "cover_zh_keep_en") {
                        setSubDisplayMode(extSubs.length > 0 ? "en_only" : "raw");
                        showToast("已关闭「只遮中文·保原英」条");
                      } else {
                        setSubDisplayMode("cover_zh_keep_en");
                        setCurtainLevel(0);
                        showToast("已开启「只遮中文·保原英」：保留原片英文字幕，拖条永不漂移");
                      }
                    }}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-bold transition ${
                      subDisplayMode === "cover_zh_keep_en"
                        ? "bg-violet-600 text-white shadow-xs"
                        : "bg-violet-500/12 text-violet-700 dark:text-violet-300"
                    }`}
                    title="适合自带中英双语字幕的原片：只盖掉上方中文，留出下方原片英文，拖进度条永远 0 延迟"
                  >
                    只遮中文·保原英
                  </button>

                  <button
                    type="button"
                    onClick={toggleQuickLoop5s}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition ${
                      quickLoop5s
                        ? "bg-[var(--accent-soft)] text-[var(--accent-text)] ring-1 ring-[var(--accent-ring)]"
                        : "bg-[var(--bg-subtle)] text-[var(--text-primary)]"
                    }`}
                  >
                    <Repeat className="h-3.5 w-3.5" />
                    {quickLoop5s ? "循环5秒中" : "复读5秒"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPeekingCurtain(false);
                      setCurtainLevel((lv) => ((lv + 1) % 3) as CurtainLevel);
                    }}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition ${
                      curtainLevel > 0
                        ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"
                        : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {curtainLevel > 0 ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {curtainLevel === 0 ? "盲听帘" : curtainLevel === 1 ? "盲听帘·中" : "盲听帘·高"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAdFilterOn((v) => {
                        const next = !v;
                        showToast(next ? "已开启 FongMi 同款 M3U8 智能去插播广告" : "已关闭 M3U8 切片过滤");
                        return next;
                      });
                    }}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition ${
                      adFilterOn
                        ? "bg-emerald-500/14 text-emerald-700 dark:text-emerald-300"
                        : "bg-[var(--bg-subtle)] text-[var(--text-muted)]"
                    }`}
                    title="FongMi/TV 同款 M3U8 去切片插播广告"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {adFilterOn ? "去插播广告 ✓" : "去广告关"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setBannerAdMask((v) => {
                        const next = !v;
                        showToast(next ? "已遮挡顶部滚动飘字与角标水印广告" : "已关闭水印遮罩");
                        return next;
                      });
                    }}
                    className={`rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition ${
                      bannerAdMask
                        ? "bg-amber-500/16 text-amber-700 dark:text-amber-300"
                        : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {bannerAdMask ? "遮水印 ✓" : "遮水印"}
                  </button>
                </div>

                {/* 纯英字幕校准栏（挂上外挂字幕或开启「只遮中文·保原英」后自动出现：AI看画面一键对齐 / 听句秒对齐 / 遮条微调 / 换版本） */}
                {(extSubs.length > 0 || subDisplayMode === "cover_zh_keep_en") && (
                  <div className="flex flex-wrap items-center gap-1.5 rounded-2xl bg-[var(--bg-subtle)]/65 px-2.5 py-2 text-[11px]">
                    {extSubs.length > 0 && subDisplayMode !== "cover_zh_keep_en" ? (
                      <>
                        <button
                          type="button"
                          disabled={subSyncBusy}
                          onClick={() => runAutoAlignSubtitles({ silent: false })}
                          className="inline-flex items-center gap-1 rounded-full bg-sky-600 px-2.5 py-0.5 font-bold text-white shadow-xs active:scale-95 disabled:opacity-60"
                        >
                          <Wand2 className="h-3 w-3" />
                          {subSyncBusy ? "AI对齐中..." : "AI看画面对齐"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSubOffsetSec((v) => Math.round((v - 2) * 10) / 10)}
                          className="rounded-full bg-[var(--bg-surface)] px-2 py-0.5 font-mono-code font-semibold text-[var(--text-primary)]"
                        >
                          -2s
                        </button>
                        <button
                          type="button"
                          onClick={() => setSubOffsetSec((v) => Math.round((v - 0.5) * 10) / 10)}
                          className="rounded-full bg-[var(--bg-surface)] px-2 py-0.5 font-mono-code font-semibold text-[var(--text-primary)]"
                        >
                          -0.5s
                        </button>
                        <button
                          type="button"
                          onClick={() => setSubOffsetSec(0)}
                          className="rounded-full bg-[var(--bg-surface)] px-2 py-0.5 font-mono-code text-[var(--text-muted)]"
                          title="点击归零偏移"
                        >
                          {subOffsetSec >= 0 ? `+${subOffsetSec}s` : `${subOffsetSec}s`}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSubOffsetSec((v) => Math.round((v + 0.5) * 10) / 10)}
                          className="rounded-full bg-[var(--bg-surface)] px-2 py-0.5 font-mono-code font-semibold text-[var(--text-primary)]"
                        >
                          +0.5s
                        </button>
                        <button
                          type="button"
                          onClick={() => setSubOffsetSec((v) => Math.round((v + 2) * 10) / 10)}
                          className="rounded-full bg-[var(--bg-surface)] px-2 py-0.5 font-mono-code font-semibold text-[var(--text-primary)]"
                        >
                          +2s
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowSubSyncModal(true)}
                          className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 font-bold text-[var(--accent-text)]"
                        >
                          <SlidersHorizontal className="h-3 w-3" />
                          高级校准/听句对齐
                        </button>
                        {enSubOptions.length > 1 && (
                          <button
                            type="button"
                            disabled={enSubBusy}
                            onClick={() => handleSwitchEnSubTrack((enSubIdx + 1) % enSubOptions.length)}
                            className="rounded-full bg-[var(--bg-surface)] px-2 py-0.5 font-semibold text-sky-600 dark:text-sky-400"
                          >
                            换版本 ({enSubIdx + 1}/{enSubOptions.length})
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="font-bold text-violet-600 dark:text-violet-400">遮中文条微调:</span>
                        <button
                          type="button"
                          onClick={() => setZhStripBottomPct((v) => Math.min(28, Math.round((v + 1) * 10) / 10))}
                          className="rounded-full bg-[var(--bg-surface)] px-2 py-0.5 font-semibold text-[var(--text-primary)]"
                        >
                          上移↑
                        </button>
                        <button
                          type="button"
                          onClick={() => setZhStripBottomPct((v) => Math.max(0, Math.round((v - 1) * 10) / 10))}
                          className="rounded-full bg-[var(--bg-surface)] px-2 py-0.5 font-semibold text-[var(--text-primary)]"
                        >
                          下移↓
                        </button>
                        <button
                          type="button"
                          onClick={() => setZhStripHeightPct((v) => Math.min(20, Math.round((v + 1) * 10) / 10))}
                          className="rounded-full bg-[var(--bg-surface)] px-2 py-0.5 font-semibold text-[var(--text-primary)]"
                        >
                          加厚+
                        </button>
                        <button
                          type="button"
                          onClick={() => setZhStripHeightPct((v) => Math.max(4, Math.round((v - 1) * 10) / 10))}
                          className="rounded-full bg-[var(--bg-surface)] px-2 py-0.5 font-semibold text-[var(--text-primary)]"
                        >
                          变窄-
                        </button>
                        <span className="font-mono-code text-[10px] text-[var(--text-muted)]">
                          底{zhStripBottomPct}% · 高{zhStripHeightPct}%
                        </span>
                      </>
                    )}
                  </div>
                )}

                {/* 第三排：变速 + A-B 精调 + 进度 */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1">
                    {SPEEDS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSpeed(s)}
                        className={`rounded-full px-2 py-1 font-mono-code text-[11px] font-semibold ${
                          speed === s
                            ? "bg-[var(--text-primary)] text-[var(--bg-surface)]"
                            : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                        }`}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 font-mono-code text-[11px]">
                    <button
                      type="button"
                      onClick={() => {
                        setQuickLoop5s(false);
                        setLoopA(currentTime);
                      }}
                      className={`rounded-full px-2 py-1 font-semibold ${
                        loopA !== null ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                      }`}
                    >
                      A {loopA !== null ? fmtTime(loopA) : "起点"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickLoop5s(false);
                        setLoopB(currentTime);
                      }}
                      className={`rounded-full px-2 py-1 font-semibold ${
                        loopB !== null ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                      }`}
                    >
                      B {loopB !== null ? fmtTime(loopB) : "终点"}
                    </button>
                    {(loopA !== null || loopB !== null) && (
                      <button
                        type="button"
                        onClick={() => {
                          setQuickLoop5s(false);
                          setLoopA(null);
                          setLoopB(null);
                        }}
                        className="rounded-full px-1.5 py-1 text-rose-500"
                      >
                        清
                      </button>
                    )}
                    <span className="ml-1 text-[var(--text-muted)]">
                      {fmtTime(currentTime)}/{fmtTime(duration)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 📸 截屏识台词实时教学卡（识别后立即浮现，句中所有词可点查 5 万离线词典） */}
            {scanResult && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="surface-card space-y-3 rounded-[24px] border border-[var(--accent-ring)] p-4 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <img
                      src={scanResult.previewUrl}
                      alt="截帧"
                      className="h-12 w-20 shrink-0 rounded-xl object-cover bg-black"
                    />
                    <div>
                      <div className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--accent-text)]">
                        <Sparkles className="h-3 w-3" />
                        智谱视觉识词 · {fmtTime(scanResult.timeSec)}
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                        点下面句子中任意单词可直接离线查词收藏
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setScanResult(null)}
                    className="rounded-full p-1 text-[var(--text-muted)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* 可点词原句 + 粤拼 */}
                <div className="rounded-2xl bg-[var(--bg-subtle)]/70 p-3.5">
                  <p className="text-[15px] font-bold leading-relaxed text-[var(--text-primary)]">
                    <ClickableWordsText
                      text={scanResult.analysis.original_text || "（未能读出文字，请重试或手动编辑）"}
                      lang={studyLang}
                      onWordClick={(w) =>
                        openWordLookup(w, scanResult.analysis.original_text, scanResult.analysis.translation)
                      }
                    />
                  </p>
                  {studyLang === "yue" && scanResult.analysis.original_text && (
                    <p className="mt-1 font-mono-code text-[11px] text-[var(--accent-text)]">
                      {annotateJyutpingOffline(scanResult.analysis.original_text).jyutping}
                    </p>
                  )}
                  {scanResult.analysis.translation && (
                    <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                      {scanResult.analysis.translation}
                    </p>
                  )}
                </div>

                {scanResult.analysis.focus_chunk && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--accent-text)]">
                      词块 · {scanResult.analysis.focus_chunk}
                    </span>
                    {scanResult.analysis.keywords.map((kw) => (
                      <button
                        key={kw}
                        type="button"
                        onClick={() =>
                          openWordLookup(kw, scanResult.analysis.original_text, scanResult.analysis.translation)
                        }
                        className="rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)]"
                      >
                        查 {kw}
                      </button>
                    ))}
                  </div>
                )}

                {scanResult.analysis.explanation && (
                  <p className="rounded-xl bg-[var(--bg-subtle)]/45 px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                    💡 {scanResult.analysis.explanation}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => speakOffline(scanResult.analysis.original_text, studyLang, 0.95)}
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-subtle)] px-3 py-1.5 font-semibold text-[var(--text-primary)]"
                  >
                    <Volume2 className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                    真人精读
                  </button>
                  <button
                    type="button"
                    onClick={() => speakOffline(scanResult.analysis.original_text, studyLang, 0.72)}
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-subtle)] px-3 py-1.5 font-medium text-[var(--text-secondary)]"
                  >
                    0.7x 慢读
                  </button>
                  <button
                    type="button"
                    disabled={scanResult.saved || noteBusy}
                    onClick={handleSaveScanToFsrs}
                    className={`ml-auto inline-flex items-center gap-1 rounded-full px-4 py-2 font-bold shadow-xs transition active:scale-95 ${
                      scanResult.saved
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-[var(--accent)] text-[var(--accent-fg)]"
                    }`}
                  >
                    {scanResult.saved ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        已入今日复习
                      </>
                    ) : (
                      <>
                        <Zap className="h-3.5 w-3.5" />
                        一键存入复习卡
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            )}

            {/* 四合一精听私教工作台切换栏 */}
            <div className="grid grid-cols-4 gap-1 rounded-2xl bg-[var(--bg-subtle)] p-1 text-[11px] font-semibold">
              {[
                { id: "study" as const, label: `精听(${showCards.length})`, icon: Mic },
                { id: "vocab" as const, label: "词汇预习", icon: GraduationCap },
                { id: "buddy" as const, label: "剧情陪聊", icon: MessageSquare },
                { id: "episodes" as const, label: "选集字幕", icon: Tv },
              ].map((t) => {
                const Icon = t.icon;
                const active = cockpitTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setCockpitTab(t.id)}
                    className={`inline-flex items-center justify-center gap-1 rounded-xl py-2 transition ${
                      active
                        ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs"
                        : "text-[var(--text-secondary)]"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* ===== Tab 1：精听跟读 + 本集台词时间轴 ===== */}
            {cockpitTab === "study" && (
              <div className="space-y-3 text-xs">
                {/* 影子跟读 + 抓原声音频 */}
                <div className="surface-card space-y-2.5 rounded-[22px] p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-[var(--text-primary)]">影子跟读 · 模仿演员开口说</div>
                    <button
                      type="button"
                      disabled={clipRecording}
                      onClick={handleGrab5sClip}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        pendingAudioBlob
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                      }`}
                    >
                      <Volume2 className="h-3 w-3" />
                      {clipRecording ? "捕获原声中..." : pendingAudioBlob ? "已抓5秒原声 ✓" : "抓5秒原声入卡"}
                    </button>
                  </div>
                  <ShadowRecorder compact onPlayOriginal={replayLastLineForCompare} />
                  <p className="text-[11px] text-[var(--text-muted)]">
                    听完一句点「录跟读」，点「对比原声」自动回退 4.5 秒先放演员原声再放你的模仿。
                  </p>
                </div>

                {/* 本剧已挖台词时间轴 */}
                <div className="surface-card space-y-2.5 rounded-[22px] p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-[var(--text-primary)]">
                      本剧已挖台词笔记 ({showCards.length})
                    </div>
                    <span className="text-[11px] text-[var(--text-muted)]">点时间点秒回原片段</span>
                  </div>

                  {showCards.length === 0 ? (
                    <div className="rounded-2xl bg-[var(--bg-subtle)]/55 p-4 text-center text-[11px] leading-relaxed text-[var(--text-muted)]">
                      看到地道台词时点上方橙色 <b className="text-[var(--accent-text)]">「截屏识台词」</b>，AI 会自动从画面提取字幕、拆词块并同步进「今日复习」抗遗忘队列。
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {showCards.map((c) => (
                        <div
                          key={c.id}
                          className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/40 p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (!c.vod_ref) return;
                                // 修复跨集跳转 Bug：如果卡片来自本剧其他集数，自动先切集再精准定位到原秒！
                                if (
                                  c.vod_ref.episodeName &&
                                  activeRoute &&
                                  c.vod_ref.episodeName !== activeEpisode?.name
                                ) {
                                  const targetEpIdx = activeRoute.episodes.findIndex(
                                    (ep) => ep.name === c.vod_ref?.episodeName
                                  );
                                  if (targetEpIdx >= 0) {
                                    setPendingSeekSec(c.vod_ref.timeSec);
                                    setEpIdx(targetEpIdx);
                                    showToast(`已切至 ${c.vod_ref.episodeName} @ ${fmtTime(c.vod_ref.timeSec)}`);
                                    return;
                                  }
                                }
                                commitVideoSeek(c.vod_ref.timeSec);
                                videoRef.current?.play().catch(() => undefined);
                              }}
                              className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 font-mono-code text-[10px] font-bold text-[var(--accent-text)]"
                            >
                              <Play className="h-2.5 w-2.5 fill-current" />
                              {c.vod_ref?.episodeName || ""} {fmtTime(c.vod_ref?.timeSec || 0)}
                            </button>
                            <button
                              type="button"
                              onClick={() => speakOffline(c.front_text, c.language || studyLang, 0.95)}
                              className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-surface)] px-2.5 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]"
                            >
                              <Volume2 className="h-3 w-3 text-[var(--accent-text)]" />
                              真人朗读
                            </button>
                          </div>
                          <p className="mt-2 text-xs font-bold leading-relaxed text-[var(--text-primary)]">
                            <ClickableWordsText
                              text={c.front_text}
                              lang={c.language || studyLang}
                              onWordClick={(w) => openWordLookup(w, c.front_text, c.translation)}
                            />
                          </p>
                          {c.jyutping && (
                            <p className="mt-0.5 font-mono-code text-[10px] text-[var(--accent-text)]">{c.jyutping}</p>
                          )}
                          {c.translation && (
                            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{c.translation}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ===== Tab 2：词汇预习（本剧 AI 高频词包 + 5 万离线词典速查 + 本剧查词本） ===== */}
            {cockpitTab === "vocab" && (
              <div className="space-y-3 text-xs">
                {/* 边看边查 5 万离线词典速查条 */}
                <div className="surface-card flex items-center gap-2 rounded-2xl p-2.5">
                  <BookOpen className="ml-1 h-4 w-4 shrink-0 text-[var(--accent-text)]" />
                  <input
                    value={quickWordInput}
                    onChange={(e) => setQuickWordInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && quickWordInput.trim()) {
                        openWordLookup(quickWordInput.trim());
                        setQuickWordInput("");
                      }
                    }}
                    placeholder="听到生词/粤语词？输入查 5 万离线词库、例句并收藏..."
                    className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text-primary)] outline-none"
                  />
                  <button
                    type="button"
                    disabled={!quickWordInput.trim()}
                    onClick={() => {
                      openWordLookup(quickWordInput.trim());
                      setQuickWordInput("");
                    }}
                    className="shrink-0 rounded-full bg-[var(--accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--accent-fg)] disabled:opacity-40"
                  >
                    查词
                  </button>
                </div>

                {/* 本剧 AI 课前高频词包 */}
                <div className="surface-card space-y-3 rounded-[22px] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-[var(--text-primary)]">
                        《{activeShowName}》课前高频词包
                      </div>
                      <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                        看前花 30 秒扫一遍本剧地道高频表达，看剧时耳朵秒懂
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={prepBusy}
                      onClick={() => handleGeneratePrep(prepItems.length > 0)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--accent-fg)] disabled:opacity-50"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {prepBusy ? "生成中..." : prepItems.length > 0 ? "换一批" : "AI 生成词包"}
                    </button>
                  </div>

                  {prepItems.length > 0 && (
                    <div className="space-y-2">
                      {prepItems.map((item, idx) => {
                        const isSaved = savedPrepSet.has(item.phrase);
                        return (
                          <div
                            key={`${item.phrase}-${idx}`}
                            className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/40 p-3"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-sm font-bold text-[var(--text-primary)]">
                                    <ClickableWordsText
                                      text={item.phrase}
                                      lang={studyLang}
                                      onWordClick={(w) => openWordLookup(w, item.example, item.example_zh)}
                                    />
                                  </span>
                                  {item.phonetic && (
                                    <span className="font-mono-code text-[10px] text-[var(--accent-text)]">
                                      {item.phonetic}
                                    </span>
                                  )}
                                </div>
                                <div className="mt-0.5 text-xs font-medium text-[var(--text-secondary)]">
                                  {item.meaning}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => speakOffline(item.example || item.phrase, studyLang, 0.94)}
                                  className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--bg-surface)] text-[var(--accent-text)]"
                                  title="微软真人朗读"
                                >
                                  <Volume2 className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={isSaved}
                                  onClick={() => handleSavePrepToCard(item)}
                                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                                    isSaved
                                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                      : "bg-[var(--accent-soft)] text-[var(--accent-text)]"
                                  }`}
                                >
                                  {isSaved ? "已收卡" : "+ 收进复习"}
                                </button>
                              </div>
                            </div>
                            {item.example && (
                              <div className="mt-2 rounded-xl bg-[var(--bg-surface)]/80 px-2.5 py-1.5 text-[11px] leading-relaxed">
                                <div className="font-medium text-[var(--text-primary)]">
                                  <ClickableWordsText
                                    text={item.example}
                                    lang={studyLang}
                                    onWordClick={(w) => openWordLookup(w, item.example, item.example_zh)}
                                  />
                                </div>
                                {item.example_zh && (
                                  <div className="mt-0.5 text-[var(--text-muted)]">{item.example_zh}</div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 本剧查过的生词记录 */}
                {showLookups.length > 0 && (
                  <div className="surface-card space-y-2 rounded-[22px] p-4">
                    <div className="font-bold text-[var(--text-primary)]">
                      本剧查过的生词 ({showLookups.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {showLookups.map((lk) => (
                        <button
                          key={`${lk.word}-${lk.createdAt}`}
                          type="button"
                          onClick={() => openWordLookup(lk.word)}
                          className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-subtle)] px-3 py-1 text-[11px] font-semibold text-[var(--text-primary)]"
                        >
                          <span>{lk.word}</span>
                          <span className="font-mono-code text-[10px] text-[var(--text-muted)]">
                            {fmtTime(lk.timeSec)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ===== Tab 3：影厅内置 AI 剧情陪聊 ===== */}
            {cockpitTab === "buddy" && (
              <div className="surface-card space-y-3 rounded-[22px] p-4 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-bold text-[var(--text-primary)]">
                      用《{activeShowName}》练口语（AI 剧情陪聊）
                    </div>
                    <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                      看完一集趁热打铁，把刚挖的词块在聊天里真正说出来
                    </p>
                  </div>
                  {onOpenCoachWithChunks && (
                    <button
                      type="button"
                      onClick={() => {
                        const chunks = showCards.map((c) => c.focus_chunk || c.front_text.slice(0, 24)).filter(Boolean);
                        onOpenCoachWithChunks(
                          chunks.length > 0 ? chunks : [activeShowName],
                          studyLang
                        );
                      }}
                      className="shrink-0 rounded-full bg-[var(--bg-subtle)] px-2.5 py-1 text-[10px] font-semibold text-[var(--text-secondary)]"
                    >
                      去完整私教
                    </button>
                  )}
                </div>

                <div className="max-h-72 space-y-2.5 overflow-y-auto rounded-2xl bg-[var(--bg-subtle)]/40 p-3">
                  {buddyHistory.length === 0 ? (
                    <div className="py-6 text-center">
                      <p className="text-xs text-[var(--text-secondary)]">
                        点击下方按钮，AI 搭子会结合《{activeShowName}》和你刚挖的词块，用
                        {studyLang === "yue" ? "地道香港粤语" : "自然口语英语"}跟你聊剧情！
                      </p>
                      <button
                        type="button"
                        disabled={buddyBusy}
                        onClick={() => {
                          videoRef.current?.pause();
                          handleSendBuddy("");
                        }}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-bold text-[var(--accent-fg)] shadow-xs disabled:opacity-50"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {buddyBusy ? "搭子正在开场..." : "开始聊这一集"}
                      </button>
                    </div>
                  ) : (
                    buddyHistory.map((turn, idx) => {
                      const turnKey = turn.id || `bd_${idx}`;
                      return (
                        <div key={turnKey} className={`flex flex-col ${turn.role === "user" ? "items-end" : "items-start"}`}>
                          {turn.role === "user" ? (
                            <div className="max-w-[88%] rounded-2xl bg-[var(--accent)] px-3.5 py-2.5 text-xs font-medium leading-relaxed text-[var(--accent-fg)]">
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
                                targetLang: turn.targetLang || studyLang,
                                speakText: turn.speakText,
                                speakLang: turn.speakLang || studyLang,
                                receipts: turn.receipts,
                                correction: turn.correction,
                                vodCards: turn.vodCards,
                                createdAt: Date.now(),
                              }}
                              prevUserText={idx > 0 && buddyHistory[idx - 1]?.role === "user" ? buddyHistory[idx - 1].content : ""}
                              compact
                              onSavedCard={showToast}
                              correctionSaved={savedBuddyCorr.has(turnKey)}
                              onSaveCorrection={(corr) => handleSaveBuddyCorrection(turnKey, corr)}
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

                <div className="flex items-center gap-2">
                  <input
                    value={buddyInput}
                    onChange={(e) => setBuddyInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && buddyInput.trim()) handleSendBuddy();
                    }}
                    placeholder={
                      studyLang === "yue"
                        ? "用粤语回复剧情感受（不会写也可用中文混着说）..."
                        : "用英语聊聊刚看的片段（卡壳夹中文也没关系）..."
                    }
                    className="min-w-0 flex-1 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    type="button"
                    disabled={buddyBusy || !buddyInput.trim()}
                    onClick={() => handleSendBuddy()}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)] disabled:opacity-40"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* ===== Tab 4：选集、线路与外挂 .SRT 字幕 ===== */}
            {cockpitTab === "episodes" && (
              <div className="space-y-3 text-xs">
                {/* 纯英字幕在线搜索 + 外挂 .srt 管理 */}
                <div className="surface-card space-y-2.5 rounded-[22px] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-bold text-[var(--text-primary)]">
                      纯英在线字幕 & 外挂 .SRT {extSubs.length > 0 ? `(${extSubs.length} 句)` : ""}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        disabled={enSubBusy}
                        onClick={() => handleAutoFetchEnglishSub()}
                        className="inline-flex items-center gap-1 rounded-full bg-sky-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                      >
                        <Subtitles className="h-3.5 w-3.5" />
                        {enSubBusy ? "搜索中..." : "在线挂纯英字幕"}
                      </button>
                      <button
                        type="button"
                        onClick={() => srtInputRef.current?.click()}
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-subtle)] px-3 py-1.5 text-[11px] font-semibold text-[var(--text-primary)]"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        导入 .SRT
                      </button>
                      {extSubs.length > 0 && (
                        <button
                          type="button"
                          disabled={translatingExt}
                          onClick={handleTranslateExtSubs}
                          className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-[11px] font-semibold text-[var(--accent-text)] disabled:opacity-50"
                        >
                          <Languages className="h-3.5 w-3.5" />
                          {translatingExt ? "翻译中..." : "AI 补译文"}
                        </button>
                      )}
                      <input
                        ref={srtInputRef}
                        type="file"
                        accept=".srt,.vtt,.json"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleLoadExtSrt(f);
                          e.target.value = "";
                        }}
                      />
                    </div>
                  </div>

                  {/* 手动指定英文片名搜索在线纯英字幕（解决冷门片自动识别不准） */}
                  <div className="flex items-center gap-1.5">
                    <input
                      value={manualEnTitle}
                      onChange={(e) => setManualEnTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && manualEnTitle.trim()) handleAutoFetchEnglishSub(manualEnTitle.trim());
                      }}
                      placeholder="冷门片可填英文原名搜纯英字幕（如 Friends / Suits）..."
                      className="min-w-0 flex-1 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/50 px-3 py-1.5 text-[11px] text-[var(--text-primary)] outline-none"
                    />
                    <button
                      type="button"
                      disabled={enSubBusy || !manualEnTitle.trim()}
                      onClick={() => handleAutoFetchEnglishSub(manualEnTitle.trim())}
                      className="shrink-0 rounded-xl bg-[var(--text-primary)] px-3 py-1.5 text-[11px] font-semibold text-[var(--bg-surface)] disabled:opacity-40"
                    >
                      精准搜英字
                    </button>
                  </div>

                  {enSubOptions.length > 1 && (
                    <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
                      {enSubOptions.map((opt, idx) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleSwitchEnSubTrack(idx)}
                          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                            enSubIdx === idx
                              ? "bg-sky-600 text-white"
                              : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {extSubs.length > 0 ? (
                    <div className="max-h-56 space-y-1.5 overflow-y-auto">
                      {extSubs.map((sub, i) => {
                        const active = i === activeExtSubIdx;
                        const displayLine =
                          subDisplayMode === "en_only"
                            ? extractPureEnglishFromSubtitleLine(sub.text) || sub.text
                            : sub.text;
                        return (
                          <div
                            key={sub.id}
                            onClick={() => {
                              if (videoRef.current) {
                                videoRef.current.currentTime = Math.max(0, sub.start_ms / 1000 - subOffsetSec);
                                videoRef.current.play().catch(() => undefined);
                              }
                            }}
                            className={`flex cursor-pointer items-start justify-between gap-2 rounded-xl px-3 py-2 ${
                              active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--bg-subtle)]"
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className={active ? "font-bold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}>
                                <ClickableWordsText
                                  text={displayLine}
                                  lang={studyLang}
                                  onWordClick={(w) => openWordLookup(w, displayLine, subDisplayMode === "en_only" ? "" : sub.translation)}
                                />
                              </p>
                              {subDisplayMode !== "en_only" && sub.translation && (
                                <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{sub.translation}</p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openQuickNoteCard({ ...sub, text: displayLine });
                              }}
                              className="shrink-0 rounded-full bg-[var(--bg-surface)] p-1.5 text-[var(--accent-text)]"
                            >
                              <Zap className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[11px] text-[var(--text-muted)]">
                      点「在线挂纯英字幕」会自动匹配 OpenSubtitles 纯英 .srt 并把画面底部中文字幕盖住，实现 100% 纯英沉浸观看与点词查词典！
                    </p>
                  )}
                </div>

                {/* 切换播放线路 + 选集面板 */}
                {detail && (
                  <div className="surface-card space-y-3 rounded-[22px] p-4">
                    <div>
                      <div className="mb-1.5 font-bold text-[var(--text-primary)]">切换播放线路（卡顿秒切）</div>
                      <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
                        {detail.routes.map((r, idx) => (
                          <button
                            key={`${r.name}-${idx}`}
                            type="button"
                            onClick={() => {
                              setRouteIdx(idx);
                              setEpIdx((prev) => Math.min(prev, r.episodes.length - 1));
                            }}
                            className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                              routeIdx === idx
                                ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                                : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                            }`}
                          >
                            {r.name} ({r.episodes.length})
                          </button>
                        ))}
                      </div>
                    </div>

                    {activeRoute && (
                      <div>
                        <div className="mb-1.5 font-bold text-[var(--text-primary)]">选集 ({activeRoute.episodes.length})</div>
                        <div className="grid max-h-48 grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-5">
                          {activeRoute.episodes.map((ep, idx) => (
                            <button
                              key={`${ep.name}-${idx}`}
                              type="button"
                              onClick={() => setEpIdx(idx)}
                              className={`truncate rounded-xl px-2.5 py-2 text-[11px] font-semibold transition ${
                                epIdx === idx
                                  ? "bg-[var(--text-primary)] text-[var(--bg-surface)]"
                                  : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                              }`}
                            >
                              {ep.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {detail.vod_blurb && (
                      <p className="border-t border-[var(--border-hairline)] pt-2.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
                        {detail.vod_blurb}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 手动记下台词弹窗（z-[85]，确保在全屏横屏观影之上也可直接操作而不退全屏） */}
        {showNoteModal && (
          <div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/55 p-3 backdrop-blur-xs sm:items-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-md rounded-[28px] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 shadow-2xl"
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-base font-bold text-[var(--text-primary)]">
                  <Zap className="h-4 w-4 text-[var(--accent-text)]" />
                  记下这句台词进复习舱
                </h3>
                <button type="button" onClick={() => setShowNoteModal(false)} className="rounded-full p-1 text-[var(--text-muted)]">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex gap-1.5">
                    {[
                      { id: "en" as const, label: "英语" },
                      { id: "yue" as const, label: "粤语（自动标粤拼）" },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setNoteLang(opt.id)}
                        className={`rounded-full px-3 py-1 font-semibold ${
                          noteLang === opt.id ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={!noteFront.trim() || aiAssistBusy}
                    onClick={handleAiFillCard}
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-text)] disabled:opacity-40"
                  >
                    <Sparkles className="h-3 w-3" />
                    {aiAssistBusy ? "补全中..." : "AI 补译文与讲解"}
                  </button>
                </div>
                <textarea
                  rows={2}
                  value={noteFront}
                  onChange={(e) => setNoteFront(e.target.value)}
                  placeholder="输入刚听到的原句台词（也可直接点播放器「截屏识台词」免打字）..."
                  className="w-full rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-subtle)]/50 p-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
                <input
                  value={noteChunk}
                  onChange={(e) => setNoteChunk(e.target.value)}
                  placeholder="核心词块 / 地道表达（可选）"
                  className="w-full rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/50 px-3.5 py-2.5 text-[var(--text-primary)] outline-none"
                />
                <input
                  value={noteTrans}
                  onChange={(e) => setNoteTrans(e.target.value)}
                  placeholder="中文意思（点右上角 AI 补全）"
                  className="w-full rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/50 px-3.5 py-2.5 text-[var(--text-primary)] outline-none"
                />
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setShowNoteModal(false)} className="rounded-full px-4 py-2 text-[var(--text-secondary)]">
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={!noteFront.trim() || noteBusy}
                    onClick={handleSaveStreamCard}
                    className="rounded-full bg-[var(--accent)] px-5 py-2 font-semibold text-[var(--accent-fg)] disabled:opacity-40"
                  >
                    {noteBusy ? "保存中..." : "收入今日复习"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* 全屏通用「字幕校准与同步」轻量浮层（z-[85]，横屏/竖屏均零裁切：切只遮中文保原英 / AI看画面对齐 / ±30s~±0.5s / 听句秒对齐） */}
        {showSubSyncModal && (
          <div
            onClick={() => setShowSubSyncModal(false)}
            className="fixed inset-0 z-[85] flex items-center justify-center bg-black/55 p-3 backdrop-blur-xs"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-[24px] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-4 text-xs shadow-2xl"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-[var(--text-primary)]">
                  <SlidersHorizontal className="h-4 w-4 text-sky-500" />
                  纯英字幕校准与同步
                </h3>
                <button
                  type="button"
                  onClick={() => setShowSubSyncModal(false)}
                  className="rounded-full p-1 text-[var(--text-muted)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* 模式三选一 */}
              <div className="mb-3 grid grid-cols-3 gap-1.5">
                {[
                  { id: "en_only" as const, label: "外挂纯英(点词)" },
                  { id: "cover_zh_keep_en" as const, label: "只遮中文·保原英" },
                  { id: "raw" as const, label: "原画不遮" },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      if (m.id === "en_only" && extSubs.length === 0) {
                        handleAutoFetchEnglishSub();
                      } else {
                        setSubDisplayMode(m.id);
                        setCurtainLevel(0);
                      }
                    }}
                    className={`rounded-xl px-2 py-2 text-[11px] font-bold transition ${
                      subDisplayMode === m.id
                        ? "bg-sky-600 text-white shadow-xs"
                        : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {subDisplayMode === "cover_zh_keep_en" ? (
                <div className="space-y-2.5 rounded-2xl bg-[var(--bg-subtle)]/60 p-3">
                  <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                    直接遮挡原片上方的中文字幕行，保留原片自带的英文字幕——无论怎么拖动进度条都 <strong className="text-[var(--text-primary)]">0ms 延迟、永不漂移</strong>。
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setZhStripBottomPct((v) => Math.min(28, Math.round((v + 1) * 10) / 10))}
                      className="rounded-full bg-[var(--bg-surface)] px-3 py-1 font-semibold text-[var(--text-primary)]"
                    >
                      遮条上移 ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => setZhStripBottomPct((v) => Math.max(0, Math.round((v - 1) * 10) / 10))}
                      className="rounded-full bg-[var(--bg-surface)] px-3 py-1 font-semibold text-[var(--text-primary)]"
                    >
                      遮条下移 ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => setZhStripHeightPct((v) => Math.min(20, Math.round((v + 1) * 10) / 10))}
                      className="rounded-full bg-[var(--bg-surface)] px-3 py-1 font-semibold text-[var(--text-primary)]"
                    >
                      加厚 +
                    </button>
                    <button
                      type="button"
                      onClick={() => setZhStripHeightPct((v) => Math.max(4, Math.round((v - 1) * 10) / 10))}
                      className="rounded-full bg-[var(--bg-surface)] px-3 py-1 font-semibold text-[var(--text-primary)]"
                    >
                      变窄 -
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setZhStripBottomPct(6.5);
                        setZhStripHeightPct(8.5);
                      }}
                      className="rounded-full bg-[var(--bg-surface)] px-2.5 py-1 text-[var(--text-muted)]"
                    >
                      重置默认
                    </button>
                  </div>
                  <div className="font-mono-code text-[10px] text-[var(--text-muted)]">
                    当前遮条参数：距底 {zhStripBottomPct}% · 高度 {zhStripHeightPct}%
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* AI 一键对齐 + 拖条自动校对开关 */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-sky-500/10 p-2.5">
                    <button
                      type="button"
                      disabled={subSyncBusy || extSubs.length === 0}
                      onClick={() => runAutoAlignSubtitles({ silent: false })}
                      className="inline-flex items-center gap-1.5 rounded-full bg-sky-600 px-3.5 py-1.5 font-bold text-white shadow-xs active:scale-95 disabled:opacity-50"
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      {subSyncBusy ? "AI 识别画面字幕中..." : "AI 看画面一键对齐"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAutoSyncOnSeek((v) => !v)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        autoSyncOnSeek
                          ? "bg-emerald-500/18 text-emerald-700 dark:text-emerald-300"
                          : "bg-[var(--bg-subtle)] text-[var(--text-muted)]"
                      }`}
                    >
                      拖条后自动对齐：{autoSyncOnSeek ? "开" : "关"}
                    </button>
                  </div>

                  {/* 大跨度 + 精细偏移微调（覆盖 ±30s ~ ±0.5s） */}
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="font-semibold text-[var(--text-secondary)]">
                        时间轴补偿（当前 <span className="font-mono-code text-[var(--text-primary)]">{subOffsetSec >= 0 ? `+${subOffsetSec}s` : `${subOffsetSec}s`}</span>）
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setCoverZhHeight((h) => (h === "sm" ? "md" : h === "md" ? "lg" : "sm"))}
                          className="rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]"
                        >
                          底黑幕:{coverZhHeight === "sm" ? "低" : coverZhHeight === "lg" ? "高" : "中"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSubOffsetSec(0)}
                          className="rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]"
                        >
                          归零
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                      {[-30, -10, -2, -0.5, 0.5, 2, 10, 30].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setSubOffsetSec((v) => Math.round((v + d) * 10) / 10)}
                          className="rounded-xl bg-[var(--bg-subtle)] py-1.5 font-mono-code text-[11px] font-semibold text-[var(--text-primary)] active:scale-95"
                        >
                          {d > 0 ? `+${d}s` : `${d}s`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 切换在线英文字幕版本 */}
                  {enSubOptions.length > 1 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-[var(--text-secondary)]">换字幕轨:</span>
                      {enSubOptions.map((opt, idx) => (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={enSubBusy}
                          onClick={() => handleSwitchEnSubTrack(idx)}
                          className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                            enSubIdx === idx
                              ? "bg-sky-600 text-white"
                              : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                          }`}
                        >
                          #{idx + 1}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* 听句秒对齐：搜一个刚听到的词，点选那句直接锚定时间轴！ */}
                  {extSubs.length > 0 && (
                    <div className="space-y-1.5 rounded-2xl border border-[var(--border-hairline)] p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-[var(--text-primary)]">听句秒对齐（点选当前画面正在说的那句）</span>
                        <span className="font-mono-code text-[10px] text-[var(--text-muted)]">画面 {fmtTime(currentTime)}</span>
                      </div>
                      <input
                        value={syncCueSearch}
                        onChange={(e) => setSyncCueSearch(e.target.value)}
                        placeholder="输入刚听到或看到的任意英文词（如 twin / ring）秒搜对齐..."
                        className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/60 px-3 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-sky-500"
                      />
                      <div className="max-h-36 space-y-1 overflow-y-auto pr-0.5">
                        {(() => {
                          const q = syncCueSearch.trim().toLowerCase();
                          const list = q
                            ? extSubs.filter((s) => s.text.toLowerCase().includes(q)).slice(0, 12)
                            : extSubs
                                .filter((s) => Math.abs(s.start_ms / 1000 - (currentTime + subOffsetSec)) <= 90)
                                .slice(0, 14);
                          const display = list.length > 0 ? list : extSubs.slice(0, 10);
                          return display.map((cue) => (
                            <button
                              key={cue.id}
                              type="button"
                              onClick={() => {
                                const curVidSec = videoRef.current?.currentTime ?? currentTime;
                                const targetOffset = Math.round(((cue.start_ms + cue.end_ms) / 2000 - curVidSec) * 10) / 10;
                                setSubOffsetSec(targetOffset);
                                showToast(`✅ 已锚定至该句（补偿 ${targetOffset >= 0 ? "+" : ""}${targetOffset}s）`);
                                setShowSubSyncModal(false);
                              }}
                              className="flex w-full items-center justify-between gap-2 rounded-xl bg-[var(--bg-subtle)]/70 px-2.5 py-1.5 text-left transition hover:bg-sky-500/15"
                            >
                              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--text-primary)]">
                                {cue.text}
                              </span>
                              <span className="shrink-0 rounded-full bg-sky-500/15 px-2 py-0.5 font-mono-code text-[10px] font-bold text-sky-600 dark:text-sky-400">
                                {fmtTime(cue.start_ms / 1000)} 对齐
                              </span>
                            </button>
                          ));
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <WordQuickLookupModal
          query={lookupCtx?.word || null}
          langHint={lookupCtx?.lang || studyLang}
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

  // ==================== 视图 A：语种精听影院大厅 ====================
  const visibleCurated =
    studyChannel === "curated"
      ? CURATED_STUDY_SHOWS
      : CURATED_STUDY_SHOWS.filter((s) => s.channel === studyChannel);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {toast && (
        <div className="fixed left-1/2 top-16 z-50 max-w-sm -translate-x-1/2 rounded-full bg-[var(--text-primary)] px-4 py-2 text-xs font-medium text-[var(--bg-surface)] shadow-xl">
          {toast}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-28 pt-1 sm:px-6">
        <div className="mx-auto max-w-4xl space-y-3">
          {/* 今日看剧精听学习看板 */}
          <div className="surface-card flex items-center justify-between gap-2 rounded-2xl px-3.5 py-2.5 text-[11px]">
            <div className="flex flex-wrap items-center gap-2.5 text-[var(--text-secondary)]">
              <span className="inline-flex items-center gap-1 font-bold text-[var(--accent-text)]">
                <Flame className="h-3.5 w-3.5" />
                连学 {habit.streakDays} 天
              </span>
              <span>
                今日看剧精听 <b className="text-[var(--text-primary)]">{habit.todayCinemaMinutes || 0}</b> 分钟
              </span>
              <span>
                影厅挖句 <b className="text-[var(--text-primary)]">{habit.todayMinedLines || 0}</b> 条
              </span>
            </div>
            <span className="shrink-0 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
              零下载直连
            </span>
          </div>

          {/* 顶部搜片条 + 一键直链 */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearch();
                }}
                placeholder="搜任意美剧、港剧粤语、电影、纪录片在线精听..."
                className="w-full rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] py-2.5 pl-10 pr-16 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput("");
                    setSearchQuery("");
                  }}
                  className="absolute right-12 top-1/2 -translate-y-1/2 p-1 text-[var(--text-muted)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => handleSearch()}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-xl bg-[var(--accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--accent-fg)]"
              >
                搜片
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="inline-flex shrink-0 items-center gap-1 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2.5 text-xs font-semibold text-[var(--text-primary)]"
              title="添加自定义片源或粘贴 .m3u8 直链播"
            >
              <Plus className="h-4 w-4 text-[var(--accent-text)]" />
              直链
            </button>
          </div>

          {/* 语种精听学习分频道 */}
          <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {STUDY_CHANNELS.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => {
                  setStudyChannel(ch.id);
                  if (ch.id !== "browse") setSearchQuery("");
                }}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  studyChannel === ch.id
                    ? "bg-[var(--text-primary)] text-[var(--bg-surface)]"
                    : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-hairline)]"
                }`}
              >
                {ch.label}
              </button>
            ))}
          </div>

          {/* 最近追剧续播条（展示每部剧已挖台词数） */}
          {history.length > 0 && !searchQuery && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1 text-[11px] font-bold text-[var(--text-muted)]">
                <Clock className="h-3.5 w-3.5" />
                最近精听（点开直接续播）
              </div>
              <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
                {history.slice(0, 8).map((h) => {
                  const cnt = vodCardCountMap[h.vodId] || 0;
                  return (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => openVodItem(h.vodId, h.sourceApi, h.routeName, h.episodeName, h.positionSec)}
                      className="surface-card flex w-48 shrink-0 items-center gap-2 rounded-2xl p-2 text-left transition active:scale-[0.98]"
                    >
                      <PosterImage
                        src={h.pic}
                        alt={h.title}
                        compact
                        className="h-12 w-9 shrink-0 rounded-lg object-cover bg-[var(--bg-subtle)]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold text-[var(--text-primary)]">{h.title}</div>
                        <div className="mt-0.5 truncate text-[10px] text-[var(--accent-text)]">
                          {h.episodeName} · {fmtTime(h.positionSec)}
                        </div>
                        <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                          已挖 {cnt} 句进复习舱
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 语种精选精听片单（非全站浏览/非搜索时展示） */}
          {studyChannel !== "browse" && !searchQuery && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-bold text-[var(--text-primary)]">
                  适合精听的精选剧单（点开直连秒播 · 支持截屏识台词）
                </span>
                <button
                  type="button"
                  onClick={() => setStudyChannel("browse")}
                  className="font-semibold text-[var(--accent-text)]"
                >
                  逛全站片库 →
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {visibleCurated.map((show) => (
                  <button
                    key={show.id}
                    type="button"
                    onClick={() => openCuratedShow(show)}
                    className="surface-card flex items-start justify-between gap-3 rounded-2xl p-3.5 text-left transition active:scale-[0.99]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-bold text-[var(--text-primary)]">{show.title}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            show.lang === "yue"
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                              : "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                          }`}
                        >
                          {show.accent}
                        </span>
                        <span className="rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
                          {show.level}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-muted)]">{show.reason}</p>
                    </div>
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-text)]">
                      <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 全站 11 条直连源片库与搜索结果区 */}
          {(studyChannel === "browse" || searchQuery) && (
            <>
              {/* 11 条国内免翻墙直连片源切换条 */}
              <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {sources.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => {
                      setSourceKey(s.key);
                      setActiveCat("");
                      if (searchQuery) handleSearch(searchQuery, true);
                    }}
                    className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                      sourceKey === s.key
                        ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                        : "border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>

              {/* 分类筛选 */}
              {!searchQuery && categories.length > 0 && (
                <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
                  <button
                    type="button"
                    onClick={() => setActiveCat("")}
                    className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-medium ${
                      activeCat === "" ? "bg-[var(--text-primary)] font-semibold text-[var(--bg-surface)]" : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                    }`}
                  >
                    全部最新
                  </button>
                  {categories.slice(0, 14).map((c) => (
                    <button
                      key={c.type_id}
                      type="button"
                      onClick={() => setActiveCat(c.type_id)}
                      className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-medium ${
                        activeCat === c.type_id ? "bg-[var(--text-primary)] font-semibold text-[var(--bg-surface)]" : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                      }`}
                    >
                      {c.type_name}
                    </button>
                  ))}
                </div>
              )}

              {/* 片单封面网格 */}
              {loadingDetail ? (
                <div className="py-16 text-center text-xs text-[var(--text-muted)]">正在解析高清直连播放流...</div>
              ) : loadingList && items.length === 0 ? (
                <div className="py-16 text-center text-xs text-[var(--text-muted)]">正在连接国内直连片库...</div>
              ) : listError ? (
                <div className="surface-card rounded-2xl p-6 text-center text-xs text-[var(--text-secondary)]">
                  <p>{listError}</p>
                  <button
                    type="button"
                    onClick={() => loadCatalog(currentSource.api, activeCat, 1, false)}
                    className="mt-3 rounded-full bg-[var(--accent)] px-4 py-2 font-semibold text-[var(--accent-fg)]"
                  >
                    重试当前源
                  </button>
                </div>
              ) : items.length === 0 ? (
                <div className="surface-card rounded-2xl py-14 text-center text-xs text-[var(--text-muted)]">
                  当前源未找到相关影片，点上方换一个直连片源搜搜看
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {items.map((item) => (
                      <button
                        key={`${currentSource.key}_${item.vod_id}`}
                        type="button"
                        onClick={() => openVodItem(item.vod_id)}
                        className="surface-card group overflow-hidden rounded-[20px] text-left transition active:scale-[0.98]"
                      >
                        <div className="relative aspect-[3/4] w-full overflow-hidden bg-[var(--bg-subtle)]">
                          <PosterImage
                            src={item.vod_pic}
                            alt={item.vod_name}
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                          />
                          {item.vod_remarks && (
                            <span className="absolute bottom-1.5 right-1.5 max-w-[85%] truncate rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              {item.vod_remarks}
                            </span>
                          )}
                          {item.type_name && (
                            <span className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-white/90">
                              {item.type_name}
                            </span>
                          )}
                        </div>
                        <div className="p-2.5">
                          <div className="line-clamp-2 text-xs font-bold leading-snug text-[var(--text-primary)]">
                            {item.vod_name}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>

                  {!searchQuery && page < pageCount && (
                    <button
                      type="button"
                      disabled={loadingList}
                      onClick={() => loadCatalog(currentSource.api, activeCat, page + 1, true)}
                      className="w-full rounded-2xl bg-[var(--bg-subtle)] py-3 text-xs font-semibold text-[var(--text-secondary)]"
                    >
                      {loadingList ? "加载中..." : `加载下一页 (${page}/${pageCount})`}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* 弹窗：直链秒播 / 添加自定义片源 */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-3 backdrop-blur-xs sm:items-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md rounded-[28px] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-base font-bold text-[var(--text-primary)]">
                <Link2 className="h-4 w-4 text-[var(--accent-text)]" />
                直链秒播 / 添加在线片源
              </h3>
              <button type="button" onClick={() => setShowAddModal(false)} className="rounded-full p-1 text-[var(--text-muted)]">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="space-y-2 rounded-2xl bg-[var(--bg-subtle)]/55 p-3.5">
                <div className="font-bold text-[var(--text-primary)]">1. 粘贴任意 .m3u8 / .mp4 / 播客直链（零下载精听）</div>
                <input
                  value={directTitleInput}
                  onChange={(e) => setDirectTitleInput(e.target.value)}
                  placeholder="标题（可选，如：新闻女王 第1集）"
                  className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2 text-[var(--text-primary)] outline-none"
                />
                <input
                  value={directUrlInput}
                  onChange={(e) => setDirectUrlInput(e.target.value)}
                  placeholder="https://.../index.m3u8 或 .mp4 / .mp3"
                  className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2 font-mono-code text-[var(--text-primary)] outline-none"
                />
                <button
                  type="button"
                  disabled={!directUrlInput.trim()}
                  onClick={() => {
                    const lang = /粤|港|yue/i.test(directTitleInput) ? "yue" : "en";
                    setDirectStream({
                      title: directTitleInput.trim() || "在线直链精听",
                      url: directUrlInput.trim(),
                      lang,
                    });
                    setStudyLang(lang);
                    setNoteLang(lang);
                    setShowAddModal(false);
                    setDirectUrlInput("");
                    setDirectTitleInput("");
                  }}
                  className="w-full rounded-full bg-[var(--accent)] py-2 font-semibold text-[var(--accent-fg)] disabled:opacity-40"
                >
                  立即零下载秒播
                </button>
              </div>

              <div className="space-y-2 rounded-2xl bg-[var(--bg-subtle)]/55 p-3.5">
                <div className="font-bold text-[var(--text-primary)]">2. 添加自定义 JSON 片源（MacCMS / TVBox type:1）</div>
                <input
                  value={customSourceName}
                  onChange={(e) => setCustomSourceName(e.target.value)}
                  placeholder="片源名称（如：备用直连）"
                  className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2 text-[var(--text-primary)] outline-none"
                />
                <input
                  value={customSourceApi}
                  onChange={(e) => setCustomSourceApi(e.target.value)}
                  placeholder="https://.../api.php/provide/vod"
                  className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2 font-mono-code text-[var(--text-primary)] outline-none"
                />
                <button
                  type="button"
                  disabled={!customSourceApi.trim()}
                  onClick={() => {
                    const next = addCustomVodSource(customSourceName, customSourceApi);
                    setSources(next);
                    setSourceKey(next[next.length - 1].key);
                    setStudyChannel("browse");
                    setShowAddModal(false);
                    setCustomSourceName("");
                    setCustomSourceApi("");
                    showToast("已添加自定义在线片源");
                  }}
                  className="w-full rounded-full bg-[var(--text-primary)] py-2 font-semibold text-[var(--bg-surface)] disabled:opacity-40"
                >
                  保存并切换到此片源
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
