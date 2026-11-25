/**
 * EchoDeck v7.0 全局全权限 AI 控制总线 (App-Wide Agent Bridge)：
 * 让 AI 助教拥有对整个 App 的完整读写与实操权限，实时联动：
 * - 在线精听影院播放器（截帧识词收藏、播放/暂停、跳转、5秒循环、调速、盲听帘、切集、搜片、课前词包）
 * - 今日复习舱（读取当前卡、直接打分翻下一张、刷新队列）
 * - 全局导航、深浅色外观、真人人声性别、以及全量数据变更热刷新广播
 */
import type { CardItem, TabKey, VodCardRef } from "../types";

export interface CinemaLiveSnapshot {
  isPlayerOpen: boolean;
  showTitle: string;
  episodeName: string;
  routeName: string;
  vodId: string;
  sourceKey: string;
  sourceApi: string;
  language: "en" | "yue";
  currentTimeSec: number;
  durationSec: number;
  playing: boolean;
  speed: number;
  curtainLevel: 0 | 1 | 2;
  loopActive: boolean;
  blurb: string;
  minedCount: number;
  episodeCount: number;
}

export type CinemaControlCommand =
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek_delta"; deltaSec: number }
  | { type: "seek_to"; sec: number }
  | { type: "loop_last_5s" }
  | { type: "clear_loop" }
  | { type: "set_speed"; speed: number }
  | { type: "set_curtain"; level: 0 | 1 | 2 }
  | { type: "auto_english_sub"; manualEnQuery?: string }
  | { type: "set_ad_guard"; adFilter?: boolean; bannerMask?: boolean }
  | { type: "switch_episode"; episodeNumber: number }
  | { type: "search_show"; query: string };

export interface CinemaAgentController {
  getSnapshot: () => CinemaLiveSnapshot;
  captureAndSaveCurrentLine: (hintText?: string) => Promise<{
    ok: boolean;
    message: string;
    card?: CardItem;
  }>;
  captureCurrentFrameAndVodRef: () => Promise<{
    imagePath: string;
    vodRef?: VodCardRef;
    activeTitle: string;
    timeSec: number;
  }>;
  control: (cmd: CinemaControlCommand) => Promise<string>;
  generatePrepPack: () => Promise<string>;
}

export interface ReviewLiveSnapshot {
  currentCard: CardItem | null;
  dueCount: number;
  totalCount: number;
  blindMode: boolean;
  revealed: boolean;
}

export interface ReviewAgentController {
  getSnapshot: () => ReviewLiveSnapshot;
  rateCurrent: (rating: 1 | 2 | 3 | 4) => Promise<string>;
  toggleBlindMode: (enabled?: boolean) => void;
  revealCurrent: () => void;
  refresh: () => Promise<void>;
}

export interface AppAgentController {
  getActiveTab: () => TabKey;
  getTheme: () => "light" | "dark";
  navigate: (tab: TabKey, subTab?: "cantonese" | "coach" | "settings") => void;
  setTheme: (theme: "light" | "dark") => void;
  jumpToVodRef: (ref: VodCardRef) => void;
  refreshStats: () => void;
  openCopilot: (presetPrompt?: string) => void;
}

const ACTIVE_STUDY_LANG_KEY = "echodeck_active_study_lang_v85";

export interface StudyLangDescriptor {
  code: string;
  label: string;
  shortLabel: string;
  flag: string;
  nativePromptName: string;
  speechRecLang: string;
}

export const STUDY_LANGUAGE_CATALOG: StudyLangDescriptor[] = [
  { code: "en", label: "英语", shortLabel: "英语", flag: "🇺🇸", nativePromptName: "natural conversational English (American/British everyday spoken English)", speechRecLang: "en-US" },
  { code: "yue", label: "香港粤语", shortLabel: "粤语", flag: "🇭🇰", nativePromptName: "authentic spoken Hong Kong Cantonese (地道香港粤语口语，务必使用自然粤语用字如 係/唔/冇/嘅/咗/啲/喺/點解/幫我，不要写普通话书面语)", speechRecLang: "zh-HK" },
  { code: "ja", label: "日语", shortLabel: "日语", flag: "🇯🇵", nativePromptName: "natural spoken Japanese (自然な日常日本語)", speechRecLang: "ja-JP" },
  { code: "ko", label: "韩语", shortLabel: "韩语", flag: "🇰🇷", nativePromptName: "natural spoken Korean (자연스러운 일상 한국어)", speechRecLang: "ko-KR" },
  { code: "fr", label: "法语", shortLabel: "法语", flag: "🇫🇷", nativePromptName: "natural everyday French (français parlé naturel)", speechRecLang: "fr-FR" },
  { code: "es", label: "西班牙语", shortLabel: "西语", flag: "🇪🇸", nativePromptName: "natural everyday Spanish (español conversacional)", speechRecLang: "es-ES" },
  { code: "de", label: "德语", shortLabel: "德语", flag: "🇩🇪", nativePromptName: "natural everyday German (natürliches Alltagsdeutsch)", speechRecLang: "de-DE" },
  { code: "it", label: "意大利语", shortLabel: "意语", flag: "🇮🇹", nativePromptName: "natural everyday Italian (italiano quotidiano)", speechRecLang: "it-IT" },
];

export function getStudyLangMeta(code: string): StudyLangDescriptor {
  const norm = (code || "en").trim().toLowerCase();
  const found = STUDY_LANGUAGE_CATALOG.find((item) => item.code === norm);
  if (found) return found;
  return {
    code: norm || "en",
    label: norm.toUpperCase(),
    shortLabel: norm.toUpperCase(),
    flag: "🌐",
    nativePromptName: `natural spoken language (${norm})`,
    speechRecLang: norm.includes("-") ? norm : `${norm}-${norm.toUpperCase()}`,
  };
}

class EchoAgentBridge {
  private cinemaCtrl: CinemaAgentController | null = null;
  private reviewCtrl: ReviewAgentController | null = null;
  private appCtrl: AppAgentController | null = null;
  private dataListeners = new Set<() => void>();
  private langListeners = new Set<(lang: string) => void>();
  private activeStudyLang: string = (() => {
    try {
      return localStorage.getItem(ACTIVE_STUDY_LANG_KEY) || "en";
    } catch {
      return "en";
    }
  })();

  getActiveStudyLang(): string {
    return this.activeStudyLang || "en";
  }

  setActiveStudyLang(lang: string) {
    const clean = (lang || "en").trim().toLowerCase();
    if (!clean || clean === this.activeStudyLang) return;
    this.activeStudyLang = clean;
    try {
      localStorage.setItem(ACTIVE_STUDY_LANG_KEY, clean);
    } catch {
      // ignore storage errors
    }
    this.langListeners.forEach((cb) => {
      try {
        cb(clean);
      } catch {
        // ignore listener errors
      }
    });
  }

  subscribeActiveStudyLang(cb: (lang: string) => void): () => void {
    this.langListeners.add(cb);
    return () => {
      this.langListeners.delete(cb);
    };
  }

  registerCinema(ctrl: CinemaAgentController | null) {
    this.cinemaCtrl = ctrl;
  }

  getCinema(): CinemaAgentController | null {
    return this.cinemaCtrl;
  }

  registerReview(ctrl: ReviewAgentController | null) {
    this.reviewCtrl = ctrl;
  }

  getReview(): ReviewAgentController | null {
    return this.reviewCtrl;
  }

  registerApp(ctrl: AppAgentController | null) {
    this.appCtrl = ctrl;
  }

  getApp(): AppAgentController | null {
    return this.appCtrl;
  }

  openCopilot(presetPrompt?: string) {
    this.appCtrl?.openCopilot(presetPrompt);
  }

  subscribeDataChange(cb: () => void): () => void {
    this.dataListeners.add(cb);
    return () => {
      this.dataListeners.delete(cb);
    };
  }

  notifyDataChanged() {
    this.appCtrl?.refreshStats();
    this.dataListeners.forEach((cb) => {
      try {
        cb();
      } catch {
        // ignore listener errors
      }
    });
  }
}

export const echoAgentBridge = new EchoAgentBridge();
