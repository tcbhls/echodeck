export type TabKey = "review" | "lexicon" | "studio" | "ingest" | "sync";

export interface LexiconExample {
  text: string;
  translation: string;
}

export interface LexiconEntry {
  id: string;
  word: string;
  alt?: string; // 如粤语简体对照或日语假名
  phonetic: string; // IPA 音标 / 粤拼 Jyutping / 罗马音
  meaning: string;
  tags: string[];
  lang: string; // "en" | "yue" | "ja" | "ko" | string
  isCustom?: boolean;
  exchange?: string; // 词形变化编码，如 "p:broke/d:broken/i:breaking"
  examples?: LexiconExample[]; // 内置真人双语例句
}

export interface UserWordSentence {
  id: string;
  wordId: string;
  lang: string;
  sentence: string;
  translation: string;
  aiFeedback?: string;
  createdAt: number;
}

export interface MediaSentenceHit {
  mediaId: string;
  mediaTitle: string;
  subtitleId: string;
  startMs: number;
  text: string;
  translation: string;
  jyutping: string;
}

export interface DailyHabitStats {
  todayDate: string;
  todayPassedWords: number;
  todayReviewedCards: number;
  todayCinemaMinutes?: number;
  todayMinedLines?: number;
  dailyWordGoal: number;
  dailyReviewGoal: number;
  streakDays: number;
  lastActiveDate: string;
}

export interface VodCardRef {
  sourceKey: string;
  sourceApi: string;
  vodId: string;
  title: string;
  routeName: string;
  episodeName: string;
  timeSec: number;
}

export interface CustomLanguage {
  code: string;
  name: string;
  ttsLang: string;
}

export type WordMarkStatus = "none" | "favorite" | "passed";

export interface MediaItem {
  id: string;
  title: string;
  source_type: string;
  source_url: string;
  file_path: string;
  mobile_path: string;
  audio_path: string;
  poster_path: string;
  duration: number;
  language: string;
  tags: string[];
  has_subtitles: number;
  pin_offline: number;
  subtitle_count?: number;
  card_count?: number;
  created_at: string;
  updated_at: string;
  is_deleted?: number;
  subtitles?: SubtitleItem[];
  mined_cards?: Array<{ id: string; subtitle_id: string; front_text: string; start_ms: number; end_ms: number }>;
}

export interface SubtitleItem {
  id: string;
  media_id: string;
  idx: number;
  start_ms: number;
  end_ms: number;
  text: string;
  translation: string;
  jyutping: string;
}

export interface CardItem {
  id: string;
  media_id: string;
  subtitle_id: string;
  front_text: string;
  back_text: string;
  translation: string;
  jyutping: string;
  focus_chunk: string;
  note: string;
  language: string;
  tags: string[];
  audio_clip_path: string;
  image_path: string;
  vod_ref?: VodCardRef;
  context_prev: string;
  context_next: string;
  start_ms: number;
  end_ms: number;
  state: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  due_at: string;
  last_review_at: string;
  created_at: string;
  updated_at: string;
  is_deleted?: number;
  intervals?: Record<number, string>;
}

export interface ReviewLog {
  id: string;
  card_id: string;
  rating: number;
  state: number;
  scheduled_days: number;
  review_ms: number;
  reviewed_at: string;
  synced_from: string;
}

export interface IngestJob {
  id: string;
  job_type: "download" | "whisper" | "translate" | string;
  target_url: string;
  title: string;
  language: string;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  message: string;
  result_media_id: string;
  created_at: string;
  updated_at: string;
}

export interface PendingUrlItem {
  id: string;
  url: string;
  language: string;
  audio_only: boolean;
  auto_whisper: boolean;
  auto_translate: boolean;
  tags: string[];
  created_at: string;
}

export interface SystemInfo {
  app: string;
  version: string;
  port: number;
  lan_ips: string[];
  lan_urls: string[];
  primary_url: string;
  qr_svg: string;
  capabilities: {
    whisper_device: string;
    whisper_compute: string;
    ffmpeg: string;
    bbdown: boolean;
  };
  stats: {
    total_cards: number;
    due_cards: number;
    reviewed_today: number;
    media_count: number;
    running_jobs: number;
  };
}

export interface CantoneseToken {
  char: string;
  jp: string;
}

export interface GlossaryItem {
  word: string;
  jyutping: string;
  meaning: string;
  tip: string;
}
