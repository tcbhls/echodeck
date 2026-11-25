/**
 * EchoDeck 100% 独立手机本地存储与核心业务引擎（完全不需要电脑！）：
 * - IndexedDB 持久化：卡片(FSRS-4.5)、复习日志、音视频/切片/截图二进制 Blob、字幕轨、设置项
 * - 纯手机本地一键挖卡（Canvas 截帧 + Web Audio WAV 原声切片 + 粤拼自动注音）
 * - 纯手机直连 AI 精解与口语陪练（DeepSeek / 硅基流动 / OpenAI）
 * - 纯手机全量打包备份 (.echodeck.zip) 与标准 Anki (.csv / .tsv) 双向导入导出
 */

import { openDB, type IDBPDatabase } from "idb";
import JSZip from "jszip";
import type { CardItem, MediaItem, MediaSentenceHit, ReviewLog, SubtitleItem, VodCardRef } from "../types";
import { annotateJyutpingOffline } from "./cantoneseLocal";
import { previewIntervalsLocal, scheduleCardLocal } from "./fsrs";
import { captureVideoFrameBlob, probeMediaBlob, sliceAudioClipBlob } from "./mediaEngine";
import { BUILTIN_ZHIPU_KEY, nativeAiChat } from "./nativeBridge";
import { runOnDeviceChat } from "./localOnDeviceAi";
import { parseSubtitleText } from "./subtitleLocal";

const DB_NAME = "echodeck-standalone-v2";
const DB_VERSION = 1;

export interface AppSettings {
  whisper_mode: "local" | "cloud";
  whisper_local_model: string;
  whisper_hf_mirror: string;
  asr_base_url: string;
  asr_api_key: string;
  asr_model: string;
  clip_padding_ms: string;
  ai_provider_mode: "zhipu_free" | "local_ondevice" | "free" | "custom";
  zhipu_api_key: string;
  zhipu_model: string;
  ai_base_url: string;
  ai_api_key: string;
  ai_model: string;
  cobalt_endpoint: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  whisper_mode: "local",
  whisper_local_model: "Xenova/whisper-tiny",
  whisper_hf_mirror: "true",
  asr_base_url: "https://api.groq.com/openai/v1",
  asr_api_key: "",
  asr_model: "whisper-large-v3-turbo",
  clip_padding_ms: "180",
  ai_provider_mode: BUILTIN_ZHIPU_KEY ? "zhipu_free" : "free",
  zhipu_api_key: "",
  zhipu_model: "glm-4.7-flash",
  ai_base_url: "https://api.deepseek.com/v1",
  ai_api_key: "",
  ai_model: "deepseek-chat",
  cobalt_endpoint: "",
};

const SEED_CARDS: Array<Omit<CardItem, "state" | "stability" | "difficulty" | "elapsed_days" | "scheduled_days" | "reps" | "lapses" | "due_at" | "last_review_at" | "created_at" | "updated_at">> = [
  {
    id: "card_seed_movie_1",
    media_id: "",
    subtitle_id: "",
    front_text: "I didn't see that plot twist coming at all — it completely blew my mind.",
    back_text: "我完全没料到那个剧情反转，简直把我看呆了。",
    translation: "我完全没猜到那个剧情反转，简直太震撼了。",
    jyutping: "",
    focus_chunk: "didn't see ... coming / plot twist / blew my mind",
    note: "看电影、追美剧聊观后感最地道的高频表达：not see sth coming（完全没料到）、blow one's mind（震撼/惊艳）。",
    language: "en",
    tags: ["美剧电影", "英语", "示例"],
    audio_clip_path: "./demo/seed_movie_1.mp3",
    image_path: "",
    context_prev: "",
    context_next: "",
    start_ms: 0,
    end_ms: 0,
  },
  {
    id: "card_seed_daily_1",
    media_id: "",
    subtitle_id: "",
    front_text: "Let's play it by ear this weekend and see what we're in the mood for.",
    back_text: "这周末咱们见机行事吧，到时候看心情决定干嘛。",
    translation: "这周末咱们看情况安排，到时候看想做什么。",
    jyutping: "",
    focus_chunk: "play it by ear / be in the mood for",
    note: "美剧和日常聊天超高频短语：play it by ear（随机应变、到时候再看）、in the mood for（有兴致/想做某事）。",
    language: "en",
    tags: ["日常口语", "英语", "示例"],
    audio_clip_path: "./demo/seed_daily_1.mp3",
    image_path: "",
    context_prev: "",
    context_next: "",
    start_ms: 0,
    end_ms: 0,
  },
  {
    id: "card_seed_yue_1",
    media_id: "",
    subtitle_id: "",
    front_text: "今晚得唔得閒一齊去睇戲食飯？聽講呢套片真係冇得彈！",
    back_text: "今晚有空一起去看电影吃饭吗？听说这部片子真是无可挑剔！",
    translation: "今晚有没有空一起看电影吃饭？听说这部电影真没得挑！",
    jyutping: "gam1 maan5 dak1 m4 dak1 haan4 jat1 cai4 heoi3 tai2 hei3 sik6 faan6? teng1 gong2 ni1 tou3 pin2 zan1 hai6 mou5 dak1 taan4!",
    focus_chunk: "得唔得閒 / 睇戲 / 冇得彈",
    note: "港剧生活最高频句式：「得閒」= 有空，「睇戲」= 看电影，「冇得彈」= 没毛病、无可挑剔。",
    language: "yue",
    tags: ["港剧粤语", "粤语", "示例"],
    audio_clip_path: "./demo/seed_yue_1.mp3",
    image_path: "",
    context_prev: "",
    context_next: "",
    start_ms: 0,
    end_ms: 0,
  },
  {
    id: "card_seed_yue_2",
    media_id: "",
    subtitle_id: "",
    front_text: "唔使咁緊張嘅，到時見步行步、隨機應變就搞掂啦。",
    back_text: "不用这么紧张的，到时候见机行事、随机应变就搞定啦。",
    translation: "别这么紧张，到时候走一步看一步、灵活应对就搞定了。",
    jyutping: "m4 sai2 gam3 gan2 zoeng1 ge3, dou3 si4 gin3 bou6 haang4 bou6, ceoi4 gei1 jing3 bin3 zau6 gaau2 dim6 laa1.",
    focus_chunk: "唔使 (m4 sai2) / 見步行步 / 搞掂",
    note: "港片日常安慰高频表达：「唔使」= 不用；「見步行步」= 走一步看一步；「搞掂」注意闭口 -m 尾。",
    language: "yue",
    tags: ["港剧粤语", "日常口语", "粤语", "示例"],
    audio_clip_path: "./demo/seed_yue_2.mp3",
    image_path: "",
    context_prev: "",
    context_next: "",
    start_ms: 0,
    end_ms: 0,
  },
];

let dbPromise: Promise<IDBPDatabase> | null = null;
const MAX_BLOB_URL_CACHE = 80;
const blobUrlCache = new Map<string, string>();

/** LRU 有界 Blob ObjectURL 缓存，避免长时间复习/观影导致 WebView 内存只增不减 */
function cacheBlobUrl(id: string, blob: Blob): string {
  const existing = blobUrlCache.get(id);
  if (existing) {
    URL.revokeObjectURL(existing);
    blobUrlCache.delete(id);
  }
  const url = URL.createObjectURL(blob);
  blobUrlCache.set(id, url);
  while (blobUrlCache.size > MAX_BLOB_URL_CACHE) {
    const oldestKey = blobUrlCache.keys().next().value;
    if (!oldestKey) break;
    const oldestUrl = blobUrlCache.get(oldestKey);
    if (oldestUrl) {
      try {
        URL.revokeObjectURL(oldestUrl);
      } catch {
        // ignore
      }
    }
    blobUrlCache.delete(oldestKey);
  }
  return url;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("cards")) {
          db.createObjectStore("cards", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("media")) {
          db.createObjectStore("media", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("subtitles")) {
          const s = db.createObjectStore("subtitles", { keyPath: "id" });
          s.createIndex("by_media", "media_id");
        }
        if (!db.objectStoreNames.contains("blobs")) {
          db.createObjectStore("blobs", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("review_logs")) {
          db.createObjectStore("review_logs", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      },
    });
  }
  const db = await dbPromise;
  // 首次启动写入 4 张开箱示例卡
  const seeded = await db.get("meta", "seeded_v2");
  if (!seeded) {
    const now = new Date().toISOString();
    const tx = db.transaction(["cards", "meta"], "readwrite");
    const existingCount = await tx.objectStore("cards").count();
    if (existingCount === 0) {
      for (const s of SEED_CARDS) {
        await tx.objectStore("cards").put({
          ...s,
          state: 0,
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: 0,
          reps: 0,
          lapses: 0,
          due_at: now,
          last_review_at: "",
          created_at: now,
          updated_at: now,
        });
      }
    }
    await tx.objectStore("meta").put({ key: "seeded_v2", value: true });
    await tx.done;
  }
  // 覆盖升级兼容：给旧版已存在的 4 张内置示例卡补挂预置真人原声 MP3（不丢复习进度）
  const patchedSeedAudio = await db.get("meta", "seeded_audio_v51");
  if (!patchedSeedAudio) {
    const audioMap: Record<string, string> = {
      card_seed_movie_1: "./demo/seed_movie_1.mp3",
      card_seed_daily_1: "./demo/seed_daily_1.mp3",
      card_seed_yue_1: "./demo/seed_yue_1.mp3",
      card_seed_yue_2: "./demo/seed_yue_2.mp3",
    };
    const tx = db.transaction(["cards", "meta"], "readwrite");
    for (const [cid, apath] of Object.entries(audioMap)) {
      const existing = (await tx.objectStore("cards").get(cid)) as CardItem | undefined;
      if (existing && !existing.audio_clip_path) {
        await tx.objectStore("cards").put({ ...existing, audio_clip_path: apath });
      }
    }
    await tx.objectStore("meta").put({ key: "seeded_audio_v51", value: true });
    await tx.done;
  }
  // 首次加载自动预置一条内置真实原声「新手体验课」，让教学模式可直接带你现场体验复读与一键挖卡
  const seededLesson = await db.get("meta", "seeded_demo_lesson_v31");
  if (!seededLesson) {
    try {
      const resp = await fetch("./demo/starter_subs.json");
      if (resp.ok) {
        const meta = await resp.json();
        const now = new Date().toISOString();
        const medId = "med_starter_demo";
        const demoItem: MediaItem = {
          id: medId,
          title: "新手体验课 · 美剧电影高频地道表达",
          source_type: "内置体验课",
          source_url: "",
          file_path: "./demo/starter_lesson.mp3",
          mobile_path: "./demo/starter_lesson.mp3",
          audio_path: "./demo/starter_lesson.mp3",
          poster_path: "./demo/starter_cover.jpg",
          duration: Number(meta.duration || 10.5),
          language: "en",
          tags: ["新手体验", "美剧电影", "日常口语"],
          has_subtitles: 1,
          pin_offline: 1,
          created_at: now,
          updated_at: now,
        };
        const tx = db.transaction(["media", "subtitles", "meta"], "readwrite");
        await tx.objectStore("media").put(demoItem);
        for (const s of meta.subtitles || []) {
          await tx.objectStore("subtitles").put({
            id: `sub_${medId}_${s.idx}`,
            media_id: medId,
            idx: s.idx,
            start_ms: s.start_ms,
            end_ms: s.end_ms,
            text: s.text,
            translation: s.translation || "",
            jyutping: "",
          });
        }
        await tx.objectStore("meta").put({ key: "seeded_demo_lesson_v31", value: true });
        await tx.done;
      }
    } catch {
      // ignore
    }
  }
  return db;
}

// ---------------- Blob 二进制本地读写 ----------------

export async function putBlob(id: string, blob: Blob): Promise<string> {
  const db = await getDb();
  await db.put("blobs", { id, blob, size: blob.size, type: blob.type, updated_at: Date.now() });
  cacheBlobUrl(id, blob);
  return `blob:${id}`;
}

export async function getBlob(idOrRef: string): Promise<Blob | null> {
  if (!idOrRef) return null;
  if (idOrRef.startsWith("./") || idOrRef.startsWith("/") || idOrRef.startsWith("http")) {
    try {
      const resp = await fetch(idOrRef);
      if (resp.ok) return await resp.blob();
    } catch {
      return null;
    }
    return null;
  }
  const id = idOrRef.startsWith("blob:") ? idOrRef.slice(5) : idOrRef;
  const db = await getDb();
  const rec = await db.get("blobs", id);
  return rec?.blob || null;
}

export async function resolveMediaSrc(ref?: string): Promise<string> {
  if (!ref) return "";
  if (ref.startsWith("blob:")) {
    const id = ref.slice(5);
    const cached = blobUrlCache.get(id);
    if (cached) {
      // 刷新 LRU 热度顺序
      blobUrlCache.delete(id);
      blobUrlCache.set(id, cached);
      return cached;
    }
    const b = await getBlob(id);
    if (!b) return "";
    return cacheBlobUrl(id, b);
  }
  return ref;
}

export async function deleteBlob(idOrRef?: string): Promise<void> {
  if (!idOrRef) return;
  const id = idOrRef.startsWith("blob:") ? idOrRef.slice(5) : idOrRef;
  const db = await getDb();
  await db.delete("blobs", id);
  const old = blobUrlCache.get(id);
  if (old) {
    URL.revokeObjectURL(old);
    blobUrlCache.delete(id);
  }
}

// ---------------- 设置与统计 ----------------

export async function getSettingsLocal(): Promise<AppSettings> {
  const db = await getDb();
  const rec = await db.get("meta", "settings");
  const merged = { ...DEFAULT_SETTINGS, ...(rec?.value || {}) } as AppSettings;
  // 若从旧版升级到已内置智谱免费通道的 v6.0，且用户未自填付费 Key，自动启用智谱永久免费主力一次
  const migrated = await db.get("meta", "migrated_zhipu_v60");
  if (!migrated && BUILTIN_ZHIPU_KEY && merged.ai_provider_mode === "free" && !merged.ai_api_key) {
    merged.ai_provider_mode = "zhipu_free";
    await db.put("meta", { key: "settings", value: merged });
    await db.put("meta", { key: "migrated_zhipu_v60", value: true });
  }
  return merged;
}

export async function saveSettingsLocal(patch: Partial<AppSettings>): Promise<AppSettings> {
  const db = await getDb();
  const current = await getSettingsLocal();
  const next = { ...current, ...patch };
  await db.put("meta", { key: "settings", value: next });
  return next;
}

export async function getAppStats(): Promise<{
  totalCards: number;
  dueCards: number;
  reviewedToday: number;
  mediaCount: number;
  storageBytes: number;
}> {
  const db = await getDb();
  const [cards, media, logs, blobs] = await Promise.all([
    db.getAll("cards") as Promise<CardItem[]>,
    db.getAll("media") as Promise<MediaItem[]>,
    db.getAll("review_logs") as Promise<ReviewLog[]>,
    db.getAll("blobs") as Promise<Array<{ size?: number }>>,
  ]);
  const nowIso = new Date().toISOString();
  const todayPrefix = nowIso.slice(0, 10);
  const activeCards = cards.filter((c) => !c.is_deleted);
  const activeMedia = media.filter((m) => !m.is_deleted);
  return {
    totalCards: activeCards.length,
    dueCards: activeCards.filter((c) => c.due_at <= nowIso).length,
    reviewedToday: logs.filter((l) => l.reviewed_at >= todayPrefix).length,
    mediaCount: activeMedia.length,
    storageBytes: blobs.reduce((acc, b) => acc + (b.size || 0), 0),
  };
}

// ---------------- 卡片与 FSRS-4.5 本地复习 ----------------

export async function listCardsLocal(): Promise<CardItem[]> {
  const db = await getDb();
  const all = (await db.getAll("cards")) as CardItem[];
  return all
    .filter((c) => !c.is_deleted)
    .sort((a, b) => a.due_at.localeCompare(b.due_at))
    .map((c) => ({ ...c, intervals: previewIntervalsLocal(c) }));
}

export async function createCardLocal(input: {
  front_text: string;
  translation: string;
  jyutping?: string;
  focus_chunk?: string;
  note?: string;
  language: string;
  tags: string[];
  image_path?: string;
  audio_clip_path?: string;
  vod_ref?: VodCardRef;
}): Promise<CardItem> {
  const db = await getDb();
  const now = new Date().toISOString();
  const jp =
    input.jyutping?.trim() ||
    (input.language === "yue" ? annotateJyutpingOffline(input.front_text).jyutping : "");

  const card: CardItem = {
    id: makeId("card"),
    media_id: "",
    subtitle_id: "",
    front_text: input.front_text.trim(),
    back_text: input.translation.trim(),
    translation: input.translation.trim(),
    jyutping: jp,
    focus_chunk: (input.focus_chunk || "").trim(),
    note: (input.note || "").trim(),
    language: input.language || "en",
    tags: input.tags,
    audio_clip_path: input.audio_clip_path || "",
    image_path: input.image_path || "",
    vod_ref: input.vod_ref,
    context_prev: "",
    context_next: "",
    start_ms: 0,
    end_ms: 0,
    state: 0,
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    due_at: now,
    last_review_at: "",
    created_at: now,
    updated_at: now,
  };
  await db.put("cards", card);
  return { ...card, intervals: previewIntervalsLocal(card) };
}

export async function updateCardLocal(cardId: string, patch: Partial<CardItem>): Promise<CardItem> {
  const db = await getDb();
  const cur = (await db.get("cards", cardId)) as CardItem | undefined;
  if (!cur) throw new Error("卡片不存在");
  const updated: CardItem = {
    ...cur,
    ...patch,
    back_text: patch.translation ?? cur.back_text,
    updated_at: new Date().toISOString(),
  };
  await db.put("cards", updated);
  return { ...updated, intervals: previewIntervalsLocal(updated) };
}

export async function deleteCardLocal(cardId: string): Promise<void> {
  const db = await getDb();
  const cur = (await db.get("cards", cardId)) as CardItem | undefined;
  if (cur) {
    await deleteBlob(cur.audio_clip_path);
    await deleteBlob(cur.image_path);
  }
  await db.delete("cards", cardId);
}

export async function reviewCardStandalone(
  card: CardItem,
  rating: 1 | 2 | 3 | 4,
  reviewMs = 0
): Promise<CardItem> {
  const db = await getDb();
  const updated = scheduleCardLocal(card, rating);
  await db.put("cards", updated);
  const log: ReviewLog = {
    id: makeId("rev"),
    card_id: card.id,
    rating,
    state: updated.state,
    scheduled_days: updated.scheduled_days,
    review_ms: reviewMs,
    reviewed_at: new Date().toISOString(),
    synced_from: "standalone-mobile",
  };
  await db.put("review_logs", log);
  return updated;
}

// ---------------- 本地媒体库与字幕管理 ----------------

export async function importMediaBlobLocal(params: {
  blob: Blob;
  title: string;
  sourceType: string;
  sourceUrl?: string;
  language: string;
  tags: string[];
  subtitleRawText?: string;
  subtitleFilename?: string;
}): Promise<MediaItem> {
  const db = await getDb();
  const mediaId = makeId("med");
  const fileRef = await putBlob(`media_${mediaId}`, params.blob);
  const probe = await probeMediaBlob(params.blob);
  const posterRef = probe.posterBlob ? await putBlob(`poster_${mediaId}`, probe.posterBlob) : "";

  let subs: SubtitleItem[] = [];
  if (params.subtitleRawText?.trim()) {
    subs = parseSubtitleText(params.subtitleRawText, mediaId, params.subtitleFilename || "sub.srt");
    if (params.language === "yue") {
      subs = subs.map((s) => ({ ...s, jyutping: annotateJyutpingOffline(s.text).jyutping }));
    }
  }

  const now = new Date().toISOString();
  const item: MediaItem = {
    id: mediaId,
    title: params.title.trim() || "未命名素材",
    source_type: params.sourceType,
    source_url: params.sourceUrl || "",
    file_path: fileRef,
    mobile_path: fileRef,
    audio_path: fileRef,
    poster_path: posterRef,
    duration: probe.duration,
    language: params.language === "auto" ? "en" : params.language,
    tags: params.tags,
    has_subtitles: subs.length > 0 ? 1 : 0,
    pin_offline: 1,
    created_at: now,
    updated_at: now,
  };

  await db.put("media", item);
  if (subs.length > 0) {
    await replaceSubtitlesLocal(mediaId, subs);
  }
  return { ...item, subtitles: subs, subtitle_count: subs.length, card_count: 0 };
}

export async function listMediaStandalone(): Promise<MediaItem[]> {
  const db = await getDb();
  const [items, subs, cards] = await Promise.all([
    db.getAll("media") as Promise<MediaItem[]>,
    db.getAll("subtitles") as Promise<SubtitleItem[]>,
    db.getAll("cards") as Promise<CardItem[]>,
  ]);
  const subCountMap = new Map<string, number>();
  for (const s of subs) subCountMap.set(s.media_id, (subCountMap.get(s.media_id) || 0) + 1);
  const cardCountMap = new Map<string, number>();
  for (const c of cards) {
    if (!c.is_deleted && c.media_id) {
      cardCountMap.set(c.media_id, (cardCountMap.get(c.media_id) || 0) + 1);
    }
  }
  return items
    .filter((m) => !m.is_deleted)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((m) => ({
      ...m,
      subtitle_count: subCountMap.get(m.id) || 0,
      card_count: cardCountMap.get(m.id) || 0,
    }));
}

export async function getMediaDetailStandalone(mediaId: string): Promise<MediaItem | null> {
  const db = await getDb();
  const item = (await db.get("media", mediaId)) as MediaItem | undefined;
  if (!item || item.is_deleted) return null;
  const subs = (await db.getAllFromIndex("subtitles", "by_media", mediaId)) as SubtitleItem[];
  subs.sort((a, b) => a.idx - b.idx);
  const allCards = (await db.getAll("cards")) as CardItem[];
  const mined = allCards
    .filter((c) => !c.is_deleted && c.media_id === mediaId)
    .map((c) => ({
      id: c.id,
      subtitle_id: c.subtitle_id,
      front_text: c.front_text,
      start_ms: c.start_ms,
      end_ms: c.end_ms,
    }));
  return { ...item, subtitles: subs, mined_cards: mined };
}

export async function replaceSubtitlesLocal(mediaId: string, subs: SubtitleItem[], lang?: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["subtitles", "media"], "readwrite");
  const idx = tx.objectStore("subtitles").index("by_media");
  const keys = await idx.getAllKeys(mediaId);
  for (const k of keys) await tx.objectStore("subtitles").delete(k);
  for (const s of subs) await tx.objectStore("subtitles").put(s);
  const med = (await tx.objectStore("media").get(mediaId)) as MediaItem | undefined;
  if (med) {
    med.has_subtitles = subs.length > 0 ? 1 : 0;
    if (lang && lang !== "auto") med.language = lang;
    med.updated_at = new Date().toISOString();
    await tx.objectStore("media").put(med);
  }
  await tx.done;
}

export async function annotateMediaJyutpingLocal(mediaId: string): Promise<number> {
  const detail = await getMediaDetailStandalone(mediaId);
  if (!detail?.subtitles) return 0;
  const updated = detail.subtitles.map((s) => ({
    ...s,
    jyutping: annotateJyutpingOffline(s.text).jyutping,
  }));
  await replaceSubtitlesLocal(mediaId, updated, "yue");
  return updated.length;
}

export async function deleteMediaStandalone(mediaId: string): Promise<void> {
  const db = await getDb();
  const med = (await db.get("media", mediaId)) as MediaItem | undefined;
  if (med) {
    await deleteBlob(med.file_path);
    await deleteBlob(med.poster_path);
  }
  const tx = db.transaction(["media", "subtitles"], "readwrite");
  await tx.objectStore("media").delete(mediaId);
  const keys = await tx.objectStore("subtitles").index("by_media").getAllKeys(mediaId);
  for (const k of keys) await tx.objectStore("subtitles").delete(k);
  await tx.done;
}

// ---------------- 纯手机本地一键挖卡（Canvas 截帧 + Web Audio 原声切片） ----------------

export async function mineCardInPhone(params: {
  media: MediaItem;
  subtitle: SubtitleItem;
  videoEl?: HTMLVideoElement | null;
  focusChunk?: string;
  translation?: string;
  note?: string;
  extraTags?: string[];
  contextPrev?: string;
  contextNext?: string;
}): Promise<CardItem> {
  const db = await getDb();
  const settings = await getSettingsLocal();
  const paddingMs = Number(settings.clip_padding_ms || 180);
  const cardId = makeId("card");

  // 1. 从视频元素零延迟截高清 JPEG 帧
  let imageRef = "";
  if (params.videoEl && params.videoEl.videoWidth > 0) {
    const frameBlob = await captureVideoFrameBlob(params.videoEl, 854);
    if (frameBlob) {
      imageRef = await putBlob(`frame_${cardId}`, frameBlob);
    }
  } else if (params.media.poster_path) {
    imageRef = params.media.poster_path;
  }

  // 2. 用 Web Audio 在手机本地精确切出单句原声 WAV Blob
  let audioRef = "";
  const mediaBlob = await getBlob(params.media.file_path);
  if (mediaBlob) {
    const wavBlob = await sliceAudioClipBlob(
      params.media.id,
      mediaBlob,
      params.subtitle.start_ms,
      params.subtitle.end_ms,
      paddingMs
    );
    if (wavBlob) {
      audioRef = await putBlob(`clip_${cardId}`, wavBlob);
    }
  }

  const lang = params.media.language || "en";
  const jp =
    params.subtitle.jyutping ||
    (lang === "yue" ? annotateJyutpingOffline(params.subtitle.text).jyutping : "");
  const mergedTags = Array.from(new Set([...(params.media.tags || []), ...(params.extraTags || [])]));
  const now = new Date().toISOString();

  const card: CardItem = {
    id: cardId,
    media_id: params.media.id,
    subtitle_id: params.subtitle.id,
    front_text: params.subtitle.text.trim(),
    back_text: (params.translation ?? params.subtitle.translation ?? "").trim(),
    translation: (params.translation ?? params.subtitle.translation ?? "").trim(),
    jyutping: jp,
    focus_chunk: (params.focusChunk || "").trim(),
    note: (params.note || "").trim(),
    language: lang,
    tags: mergedTags,
    audio_clip_path: audioRef,
    image_path: imageRef,
    context_prev: params.contextPrev || "",
    context_next: params.contextNext || "",
    start_ms: params.subtitle.start_ms,
    end_ms: params.subtitle.end_ms,
    state: 0,
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    due_at: now,
    last_review_at: "",
    created_at: now,
    updated_at: now,
  };

  await db.put("cards", card);
  return { ...card, intervals: previewIntervalsLocal(card) };
}

// ---------------- 纯手机端直接调用 AI（智谱 GLM-4-Flash 永久免费主力 + 免Key双容灾免费通道 + 自有付费API） ----------------

export async function callAiDirectWithCurrentSettings(
  messages: Array<{ role: string; content: string }>,
  temperature = 0.45,
  jsonMode = false
): Promise<string> {
  const settings = await getSettingsLocal();
  return callOpenAiDirect(settings, messages, temperature, jsonMode);
}

/** 撤回最近一次 FSRS 误评分，完整恢复卡片原有复习计划快照 */
export async function restoreCardSnapshotLocal(snapshot: CardItem): Promise<CardItem> {
  const db = await getDb();
  const { intervals: _drop, ...clean } = snapshot as CardItem & { intervals?: unknown };
  await db.put("cards", clean);
  return { ...(clean as CardItem), intervals: previewIntervalsLocal(clean as CardItem) };
}

/** 设置页一键测试当前 AI 引擎连通性与真实首响耗时 */
export async function testAiConnectivityDirect(overrideSettings?: AppSettings): Promise<{
  ok: boolean;
  latencyMs: number;
  preview: string;
  error?: string;
}> {
  const started = Date.now();
  try {
    const cfg = overrideSettings || (await getSettingsLocal());
    const out = await callOpenAiDirect(
      cfg,
      [
        { role: "system", content: "Reply with OK only." },
        { role: "user", content: "ping" },
      ],
      0.1,
      false
    );
    const latencyMs = Date.now() - started;
    if (!out || !out.trim()) {
      return { ok: false, latencyMs, preview: "", error: "接口返回为空，请检查模型名与 Key" };
    }
    return { ok: true, latencyMs, preview: out.trim().slice(0, 48) };
  } catch (e: any) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      preview: "",
      error: String(e?.message || "连接失败，请检查网络或 API 配置"),
    };
  }
}

async function callOpenAiDirect(
  settings: AppSettings,
  messages: Array<{ role: string; content: string }>,
  temperature = 0.55,
  jsonMode = false
): Promise<string> {
  const mode = settings.ai_provider_mode || (BUILTIN_ZHIPU_KEY ? "zhipu_free" : "free");

  // 模式 A：App 专属端侧开源离线 AI（Qwen3-0.6B / HY-MT1.5 / Qwen2.5-0.5B，100% 运行在手机 App 自身内，断网可用）
  if (mode === "local_ondevice") {
    try {
      const localRes = await runOnDeviceChat(messages, temperature);
      if (localRes) return localRes;
    } catch {
      // 若尚未下载本地权重或运行出错，平滑降级至智谱/免Key免费通道确保不卡死
    }
  }

  // 模式 B（默认主力）：智谱免费 Flash 级联（GLM-4.7-Flash JSON模式 -> 429自动退避重试 -> GLM-4-Flash-250414 -> GLM-4-Flash）
  if (mode === "zhipu_free" || mode === "local_ondevice") {
    const zhipuKey = (settings.zhipu_api_key || BUILTIN_ZHIPU_KEY || "").trim();
    if (zhipuKey) {
      const preferred = (settings.zhipu_model || "glm-4.7-flash").trim();
      const candidates = Array.from(new Set([preferred, "glm-4.7-flash", "glm-4-flash-250414", "glm-4-flash"]));
      for (const m of candidates) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const out = await nativeAiChat({
              freeMode: false,
              url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
              apiKey: zhipuKey,
              model: m,
              messages,
              temperature,
              jsonMode: jsonMode && attempt === 0,
            });
            if (out && out.trim()) return out;
          } catch (err: any) {
            const msg = String(err?.message || "");
            if (attempt === 0 && (msg.includes("429") || msg.includes("1302") || msg.includes("json"))) {
              await new Promise((r) => setTimeout(r, 420));
              continue;
            }
            break;
          }
        }
      }
      return nativeAiChat({ freeMode: true, messages, temperature });
    }
    return nativeAiChat({ freeMode: true, messages, temperature });
  }

  // 免费主力 2：免 Key 公共免费通道（ch.at + Pollinations 双容灾）
  if (mode === "free") {
    return nativeAiChat({ freeMode: true, messages, temperature });
  }

  // 进阶自选：用户自有付费 / 兼容 OpenAI API（DeepSeek / 硅基流动 / OpenAI 等）
  const key = (settings.ai_api_key || "").trim();
  if (!key) {
    return nativeAiChat({ freeMode: true, messages, temperature });
  }
  const base = (settings.ai_base_url || "https://api.deepseek.com/v1").replace(/\/$/, "");
  const endpoint = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;

  return nativeAiChat({
    freeMode: false,
    url: endpoint,
    apiKey: key,
    model: (settings.ai_model || "deepseek-chat").trim(),
    messages,
    temperature,
    jsonMode,
  });
}

export async function explainCardDirect(sentence: string, language: string, focusChunk = ""): Promise<string> {
  const settings = await getSettingsLocal();
  const langLabel = language === "yue" ? "香港粤语" : language === "en" ? "英语" : "外语";
  const prompt = `你是一位极接地气的${langLabel}实战口语教练，熟悉影视剧对白、播客访谈和真实生活表达。
请对下面这句原声台词做极简、高含金量的拆解（220 字以内，用中文）：
句子：${sentence}
${focusChunk ? `重点词块：${focusChunk}` : ""}
请严格按 4 点输出：
1. 【核心词块】：挑最值得背的 1~2 个地道短语/俚语并解释；
2. 【避坑/正字】：指出中式英语常见坑（粤语则指易错懒音和正字）；
3. 【实战例句】：给 2 句真实生活、电影或聊日常场景的实用替换例句（附中文）；
4. 【传神译文】：1 句最自然的中文口语翻译。`;
  return callOpenAiDirect(
    settings,
    [
      { role: "system", content: "你是一个简洁犀利、接地气的英语与粤语实战口语教练。" },
      { role: "user", content: prompt },
    ],
    0.5
  );
}

export async function translateSubtitlesDirect(mediaId: string): Promise<number> {
  const settings = await getSettingsLocal();
  const detail = await getMediaDetailStandalone(mediaId);
  if (!detail?.subtitles?.length) return 0;
  const subs = [...detail.subtitles];
  const batchSize = 18;
  for (let i = 0; i < subs.length; i += batchSize) {
    const batch = subs.slice(i, i + batchSize);
    const numbered = batch.map((s, idx) => `${idx + 1}. ${s.text}`).join("\n");
    const reply = await callOpenAiDirect(
      settings,
      [
        {
          role: "system",
          content: "你是专业字幕翻译，只按原编号逐行输出地道简体中文译文，不要任何多余解释。",
        },
        { role: "user", content: numbered },
      ],
      0.3
    );
    const lines = reply.split("\n").map((l) => l.trim()).filter(Boolean);
    batch.forEach((item, idx) => {
      const matched = lines.find((l) => l.startsWith(`${idx + 1}.`)) || lines[idx] || "";
      item.translation = matched.replace(/^\d+\.\s*/, "").trim();
    });
  }
  await replaceSubtitlesLocal(mediaId, subs);
  return subs.length;
}

export async function chatCoachDirect(params: {
  history: Array<{ role: string; content: string }>;
  language: string;
  topic: string;
  targetChunks: string[];
}): Promise<{ reply: string; speakText: string; coachNote: string }> {
  const settings = await getSettingsLocal();
  const langName =
    params.language === "yue"
      ? "地道香港粤语（用自然粤语书面口语，如 係/唔/冇/嘅/咗）"
      : "natural conversational English";
  const chunksHint = params.targetChunks.slice(0, 5).join("、") || "free talk";
  const sys = `You are a friendly sparring partner chatting with the user about "${params.topic}" in ${langName}.
Target chunks to practice: ${chunksHint}.
Format EVERY reply into two parts separated by "---COACH---":
Part 1: Natural 2-3 sentence conversational reply in ${langName} ending with a follow-up question.
---COACH---
Part 2: Brief Simplified Chinese feedback (<= 80 chars) polishing the user's last sentence into more native expression.`;

  const raw = await callOpenAiDirect(settings, [{ role: "system", content: sys }, ...params.history.slice(-12)], 0.75);
  if (raw.includes("---COACH---")) {
    const [speak, note] = raw.split("---COACH---", 2);
    return { reply: raw, speakText: speak.trim(), coachNote: note.trim() };
  }
  return { reply: raw, speakText: raw, coachNote: "" };
}

/** 扫描用户已导入的影听素材字幕，反查某个单词在真实看过的电影/播客里出现过的原句 */
export async function findSubtitlesContainingWord(
  word: string,
  exchange?: string,
  lang?: string
): Promise<MediaSentenceHit[]> {
  const cleanWord = word.trim();
  if (!cleanWord) return [];
  const db = await getDb();
  const [allMedia, allSubs] = await Promise.all([
    db.getAll("media") as Promise<MediaItem[]>,
    db.getAll("subtitles") as Promise<SubtitleItem[]>,
  ]);
  const mediaMap = new Map(allMedia.map((m) => [m.id, m]));
  const hits: MediaSentenceHit[] = [];

  if (lang === "en" || /^[A-Za-z][A-Za-z\-' ]*$/.test(cleanWord)) {
    const forms = new Set<string>([cleanWord.toLowerCase()]);
    if (exchange) {
      for (const part of exchange.split("/")) {
        const [, val] = part.split(":");
        if (val && val.length >= 2) forms.add(val.toLowerCase());
      }
    }
    const escaped = Array.from(forms)
      .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    const rx = new RegExp(`\\b(?:${escaped})\\b`, "i");
    for (const sub of allSubs) {
      if (rx.test(sub.text)) {
        const m = mediaMap.get(sub.media_id);
        hits.push({
          mediaId: sub.media_id,
          mediaTitle: m?.title || "本地影听素材",
          subtitleId: sub.id,
          startMs: sub.start_ms,
          text: sub.text,
          translation: sub.translation || "",
          jyutping: sub.jyutping || "",
        });
        if (hits.length >= 6) break;
      }
    }
  } else {
    for (const sub of allSubs) {
      if (sub.text.includes(cleanWord)) {
        const m = mediaMap.get(sub.media_id);
        hits.push({
          mediaId: sub.media_id,
          mediaTitle: m?.title || "本地影听素材",
          subtitleId: sub.id,
          startMs: sub.start_ms,
          text: sub.text,
          translation: sub.translation || "",
          jyutping: sub.jyutping || "",
        });
        if (hits.length >= 6) break;
      }
    }
  }

  return hits;
}

/** AI 单词造句与用法拆解 / 批改用户自造句（支持英语、粤语及任意扩展语种） */
export async function aiWordCoachDirect(params: {
  word: string;
  meaning: string;
  lang: string;
  langName: string;
  userSentence?: string;
}): Promise<string> {
  const settings = await getSettingsLocal();
  const isCheck = Boolean(params.userSentence?.trim());
  const yueHint =
    params.lang === "yue"
      ? `（粤拼参考：${annotateJyutpingOffline(params.word).jyutping}；请严格按上面权威词典释义使用该粤语词，不要曲解词义）`
      : "";
  const prompt = isCheck
    ? `请帮我批改这个用「${params.word}」（${params.langName}，权威词典释义：${params.meaning}${yueHint}）造的句子：
「${params.userSentence}」
请用简体中文简洁回复（控制在 220 字内）：
1. 语法与地道程度打分（1-10分）并指出问题或亮点；
2. 给出 1 句母语者最自然的润色版；
3. 再给 2 个该词高频口语搭配（带简短中文）。`
    : `请教我怎么在真实口语/影视对话中地道使用「${params.word}」（${params.langName}，权威词典释义：${params.meaning}${yueHint}）。
请用简体中文清晰排版（控制在 260 字内）：
1. 3 个最高频固定搭配（短语 + 中文）；
2. 3 句不同生活/电影场景的地道造句（原句 + 自然简体中文翻译）；
3. 1 句避坑提示（最容易中式误用的点）。`;

  return callOpenAiDirect(
    settings,
    [
      {
        role: "system",
        content: "你是务实、接地气的语言教练，严格遵循用户给出的权威词典释义来造句和纠错，拒绝胡编词义和废话。",
      },
      { role: "user", content: prompt },
    ],
    0.45
  );
}

// ---------------- 在线影厅深度教育 AI 引擎（智谱免费视觉识台词 + 课前词包 + 字幕译文 + 剧情陪聊） ----------------

export interface CinemaFrameAnalysis {
  original_text: string;
  translation: string;
  focus_chunk: string;
  explanation: string;
  keywords: string[];
}

export interface ShowVocabExpression {
  phrase: string;
  phonetic: string;
  meaning: string;
  example: string;
  example_zh: string;
}

function extractJsonString(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const objStart = raw.indexOf("{");
  const arrStart = raw.indexOf("[");
  if (arrStart >= 0 && (objStart < 0 || arrStart < objStart)) {
    const arrEnd = raw.lastIndexOf("]");
    if (arrEnd > arrStart) return raw.slice(arrStart, arrEnd + 1);
  }
  if (objStart >= 0) {
    const objEnd = raw.lastIndexOf("}");
    if (objEnd > objStart) return raw.slice(objStart, objEnd + 1);
  }
  return raw.trim();
}

/** 列出某部在线影视在复习舱里已经挖出的所有台词卡片（用于在影厅展示时间轴笔记与统计） */
export async function listCardsByVodId(vodId?: string): Promise<CardItem[]> {
  const all = await listCardsLocal();
  if (!vodId) return all.filter((c) => Boolean(c.vod_ref));
  return all
    .filter((c) => c.vod_ref?.vodId === vodId)
    .sort((a, b) => (a.vod_ref?.timeSec || 0) - (b.vod_ref?.timeSec || 0));
}

/** 截屏识台词：用智谱永久免费视觉大模型 (glm-4.6v-flash / glm-4v-flash) 自动 OCR 画面字幕并做口语拆解 */
export async function analyzeCinemaFrameDirect(params: {
  imageDataUrl: string;
  showTitle: string;
  language: "en" | "yue";
}): Promise<CinemaFrameAnalysis> {
  const settings = await getSettingsLocal();
  const zhipuKey = (settings.zhipu_api_key || BUILTIN_ZHIPU_KEY || "").trim();
  const customKey = settings.ai_provider_mode === "custom" ? (settings.ai_api_key || "").trim() : "";

  const langDesc =
    params.language === "yue"
      ? "香港粤语（保留地道粤语口语字如 係/唔/冇/嘅/咗/啲）"
      : "地道英语（保留完整英文原句，去掉无意义水印/台标）";

  const prompt = `你正在帮用户用《${params.showTitle}》学${langDesc}。请仔细查看这张影视截帧画面：
1. 如果画面里有外语/粤语字幕，精准逐字提取当前正在说的台词原句到 original_text；如果画面只有中文字幕，请把这句中文字幕地道还原成剧中角色会说的${langDesc}原句；如果画面此刻没有字幕，请用一句最贴合当前人物表情与场景的地道${langDesc}台词作为学习句。
2. 输出严格 JSON（不要多余废话）：
{
  "original_text": "提取或还原的${params.language === "yue" ? "粤语" : "英语"}原句",
  "translation": "最自然传神的简体中文口语译文",
  "focus_chunk": "这句里最值得背的 1~2 个地道短语/俚语/表达",
  "explanation": "80字以内中文口语精讲（指出连读/用法/避坑点）",
  "keywords": ["词1", "词2", "词3"]
}`;

  const messages = [
    {
      role: "user",
      content: [
        { type: "image_url" as const, image_url: { url: params.imageDataUrl } },
        { type: "text" as const, text: prompt },
      ],
    },
  ];

  let raw = "";
  if (zhipuKey) {
    // 智谱永久免费多模态视觉模型双模型自动容灾
    const visionModels = ["glm-4.6v-flash", "glm-4v-flash"];
    let lastErr: Error | null = null;
    for (const vm of visionModels) {
      try {
        raw = await nativeAiChat({
          freeMode: false,
          url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
          apiKey: zhipuKey,
          model: vm,
          messages,
          temperature: 0.25,
        });
        if (raw) break;
      } catch (e: any) {
        lastErr = e;
      }
    }
    if (!raw) {
      throw lastErr || new Error("智谱免费视觉识图通道暂时繁忙，请稍后再试");
    }
  } else if (customKey) {
    const base = (settings.ai_base_url || "https://api.openai.com/v1").replace(/\/$/, "");
    const endpoint = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
    raw = await nativeAiChat({
      freeMode: false,
      url: endpoint,
      apiKey: customKey,
      model: (settings.ai_model || "gpt-4o-mini").trim(),
      messages,
      temperature: 0.25,
    });
  } else {
    throw new Error("NO_VISION_KEY");
  }

  try {
    const parsed = JSON.parse(extractJsonString(raw));
    return {
      original_text: String(parsed.original_text || "").trim(),
      translation: String(parsed.translation || "").trim(),
      focus_chunk: String(parsed.focus_chunk || "").trim(),
      explanation: String(parsed.explanation || "").trim(),
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.map((k: any) => String(k).trim()).filter(Boolean).slice(0, 5)
        : [],
    };
  } catch {
    return {
      original_text: raw.split("\n")[0]?.replace(/^["'\s]+|["'\s]+$/g, "").slice(0, 140) || "",
      translation: "",
      focus_chunk: "",
      explanation: raw.slice(0, 220),
      keywords: [],
    };
  }
}

/** 极速字幕对齐专用 OCR：只读取画面底部烧录字幕（不生成长讲解，延迟极低），用于拖动进度条后把外挂纯英字幕自动校准回 0.1 秒精度 */
export async function readFrameSubtitleForSyncDirect(imageDataUrl: string): Promise<{
  en: string;
  zh: string;
  hasSubtitle: boolean;
}> {
  const settings = await getSettingsLocal();
  const zhipuKey = (settings.zhipu_api_key || BUILTIN_ZHIPU_KEY || "").trim();
  const customKey = settings.ai_provider_mode === "custom" ? (settings.ai_api_key || "").trim() : "";

  const prompt = `Read ONLY the dialogue subtitle text at the bottom of this video frame crop. Ignore watermarks, logos, or gambling ads.
Return strict JSON only:
{"hasSubtitle": true/false, "en": "exact verbatim English subtitle on screen (if only Chinese is visible, give a literal concise English translation)", "zh": "Chinese subtitle on screen or empty string"}
If there is NO dialogue subtitle visible, return {"hasSubtitle": false, "en": "", "zh": ""}.`;

  const messages = [
    {
      role: "user",
      content: [
        { type: "image_url" as const, image_url: { url: imageDataUrl } },
        { type: "text" as const, text: prompt },
      ],
    },
  ];

  let raw = "";
  if (zhipuKey) {
    for (const vm of ["glm-4.6v-flash", "glm-4v-flash"]) {
      try {
        raw = await nativeAiChat({
          freeMode: false,
          url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
          apiKey: zhipuKey,
          model: vm,
          messages,
          temperature: 0.1,
        });
        if (raw) break;
      } catch {
        // try fallback vision model
      }
    }
  } else if (customKey) {
    const base = (settings.ai_base_url || "https://api.openai.com/v1").replace(/\/$/, "");
    const endpoint = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
    raw = await nativeAiChat({
      freeMode: false,
      url: endpoint,
      apiKey: customKey,
      model: (settings.ai_model || "gpt-4o-mini").trim(),
      messages,
      temperature: 0.1,
    });
  } else {
    throw new Error("NO_VISION_KEY");
  }

  if (!raw) return { en: "", zh: "", hasSubtitle: false };
  try {
    const parsed = JSON.parse(extractJsonString(raw));
    const en = String(parsed.en || "").trim();
    const zh = String(parsed.zh || "").trim();
    const hasSubtitle = Boolean(parsed.hasSubtitle !== false && (en.length >= 2 || zh.length >= 2));
    return { en, zh, hasSubtitle };
  } catch {
    return { en: "", zh: "", hasSubtitle: false };
  }
}

export async function hasVisionSyncKeyLocal(): Promise<boolean> {
  const settings = await getSettingsLocal();
  const zhipuKey = (settings.zhipu_api_key || BUILTIN_ZHIPU_KEY || "").trim();
  const customKey = settings.ai_provider_mode === "custom" ? (settings.ai_api_key || "").trim() : "";
  return Boolean(zhipuKey || customKey);
}

/** 极速按需中文翻译兜底（当 AI 回复缺省中文译文时，用户点击气泡瞬间翻译成自然简体中文） */
export async function translateTextToZhDirect(text: string, sourceLang = "en"): Promise<string> {
  const clean = text.trim();
  if (!clean) return "";
  const settings = await getSettingsLocal();
  const raw = await callOpenAiDirect(
    settings,
    [
      {
        role: "system",
        content: "你是专业语言私教翻译官，只输出最自然、口语化的简体中文翻译结果，不要加任何前缀、引号或额外解释。",
      },
      {
        role: "user",
        content: `请把下面这段 ${sourceLang === "yue" ? "香港粤语" : sourceLang} 内容翻译成自然简体中文：\n${clean}`,
      },
    ],
    0.2
  );
  return raw.trim();
}

/** 100% 确定性中文提问转目标语地道复述（防止小模型在短句如「还没好吗」「要多久」时漏掉复述！） */
export async function recastChineseToTargetLangDirect(
  chineseQuestion: string,
  targetLangDesc = "natural conversational English"
): Promise<string> {
  const clean = chineseQuestion.trim();
  if (!clean) return "";
  const settings = await getSettingsLocal();
  const raw = await callOpenAiDirect(
    settings,
    [
      {
        role: "system",
        content: `You are a native speaking coach. Convert the user's Mandarin Chinese question or request into ONE short, natural, idiomatic sentence in ${targetLangDesc}. Output ONLY the translated/recast sentence itself — NO quotes, NO Chinese explanations, NO prefixes.`,
      },
      {
        role: "user",
        content: clean,
      },
    ],
    0.2
  );
  return raw
    .replace(/^["'“”「」]+|["'“”「」]+$/g, "")
    .split(/\r?\n/)[0]
    .trim();
}

/** 课前预习包：按剧名、类型和简介生成 6 条本剧最高频地道表达 */
export async function generateShowVocabPackDirect(params: {
  title: string;
  blurb: string;
  typeName: string;
  language: "en" | "yue";
}): Promise<ShowVocabExpression[]> {
  const settings = await getSettingsLocal();
  const isYue = params.language === "yue";
  const prompt = `用户准备用影视剧《${params.title}》（分类：${params.typeName || "影视"}；简介：${(params.blurb || "无").slice(0, 140)}）进行${isYue ? "香港粤语" : "地道英语"}精听学习。
请为其量身定制 6 条看这部剧前最值得预习的高频地道口语词块/俚语/实用表达。
严格只输出 JSON 数组，不要任何前后解释：
[
  {
    "phrase": "${isYue ? "地道香港粤语词块（如 搞掂 / 唔该晒 / 食死猫）" : "地道英文短语或高频表达（如 figure out / cut someone some slack）"}",
    "phonetic": "${isYue ? "粤拼" : "音标或核心连读提示"}",
    "meaning": "极简中文释义（15字内）",
    "example": "一句贴合本剧风格的真实台词例句",
    "example_zh": "这句例句的自然中文翻译"
  }
]`;

  const raw = await callOpenAiDirect(
    settings,
    [
      { role: "system", content: "你是影视语言教学专家，只返回合法 JSON 数组，拒绝废话和 Markdown 以外的文字。" },
      { role: "user", content: prompt },
    ],
    0.5
  );

  const parsed = JSON.parse(extractJsonString(raw));
  const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
  return arr
    .map((x: any) => ({
      phrase: String(x.phrase || x.word || "").trim(),
      phonetic:
        String(x.phonetic || "").trim() ||
        (isYue ? annotateJyutpingOffline(String(x.phrase || "")).jyutping : ""),
      meaning: String(x.meaning || "").trim(),
      example: String(x.example || "").trim(),
      example_zh: String(x.example_zh || x.translation || "").trim(),
    }))
    .filter((x: ShowVocabExpression) => x.phrase && x.meaning)
    .slice(0, 8);
}

/** 翻译在线影厅加载的外挂 .srt/.vtt 字幕（前 40 条快速翻译或分批翻译） */
export async function translateInlineSubtitlesDirect(items: SubtitleItem[]): Promise<SubtitleItem[]> {
  const settings = await getSettingsLocal();
  const next = items.map((s) => ({ ...s }));
  const target = next.filter((s) => !s.translation?.trim()).slice(0, 60);
  const batchSize = 18;
  for (let i = 0; i < target.length; i += batchSize) {
    const batch = target.slice(i, i + batchSize);
    const numbered = batch.map((s, idx) => `${idx + 1}. ${s.text}`).join("\n");
    const reply = await callOpenAiDirect(
      settings,
      [
        { role: "system", content: "你是专业影视字幕翻译，只按原编号逐行输出自然流畅的简体中文译文，不要多余解释。" },
        { role: "user", content: numbered },
      ],
      0.3
    );
    const lines = reply.split("\n").map((l) => l.trim()).filter(Boolean);
    batch.forEach((item, idx) => {
      const matched = lines.find((l) => l.startsWith(`${idx + 1}.`)) || lines[idx] || "";
      item.translation = matched.replace(/^\d+\.\s*/, "").trim();
    });
  }
  return next;
}

/** 影厅内置剧情陪聊：结合正在看的剧名、集数与刚挖的台词词块立刻练口语 */
export async function chatCinemaBuddyDirect(params: {
  showTitle: string;
  episodeName: string;
  blurb: string;
  language: "en" | "yue";
  minedChunks: string[];
  history: Array<{ role: string; content: string }>;
}): Promise<{ speakText: string; coachNote: string }> {
  const settings = await getSettingsLocal();
  const langName =
    params.language === "yue"
      ? "地道香港粤语（用自然粤语口语字，如 係/唔/冇/嘅/咗/啲）"
      : "natural conversational English";
  const chunksHint = params.minedChunks.slice(0, 6).join("、") || "everyday show expressions";

  const sys = `You are a warm, witty language-learning watch-buddy watching "${params.showTitle}" (${params.episodeName}) with the user.
Show context: ${(params.blurb || "popular drama/movie").slice(0, 140)}
Expressions the user wants to practice from this show: ${chunksHint}.
Format EVERY reply into two parts separated by "---COACH---":
Part 1: A natural, engaging 2-sentence reply in ${langName} reacting to the show/user and asking 1 easy question that nudges them to use the target expressions.
---COACH---
Part 2: Brief Simplified Chinese note (<= 75 chars): give a quick Chinese gist of your reply or polish the user's last sentence into more native ${params.language === "yue" ? "港粤" : "美式"} expression.`;

  const userMsgs =
    params.history.length > 0
      ? params.history.slice(-10)
      : [{ role: "user", content: `We are watching "${params.showTitle}" (${params.episodeName}). Start a fun casual chat about it!` }];

  const raw = await callOpenAiDirect(settings, [{ role: "system", content: sys }, ...userMsgs], 0.72);
  if (raw.includes("---COACH---")) {
    const [speak, note] = raw.split("---COACH---", 2);
    return { speakText: speak.trim(), coachNote: note.trim() };
  }
  return { speakText: raw.trim(), coachNote: "" };
}

// ---------------- 纯手机本地打包备份 / Anki CSV 导入导出 ----------------

export async function exportFullBackupZip(): Promise<Blob> {
  const zip = new JSZip();
  const cards = await listCardsLocal();
  const settings = await getSettingsLocal();
  const mediaFolder = zip.folder("media")!;

  const exportedCards = [];
  for (const c of cards) {
    const copy = { ...c };
    if (c.audio_clip_path?.startsWith("blob:")) {
      const b = await getBlob(c.audio_clip_path);
      if (b) {
        const fname = `${c.id}.wav`;
        mediaFolder.file(fname, b);
        copy.audio_clip_path = `zip:${fname}`;
      }
    }
    if (c.image_path?.startsWith("blob:")) {
      const b = await getBlob(c.image_path);
      if (b) {
        const fname = `${c.id}.jpg`;
        mediaFolder.file(fname, b);
        copy.image_path = `zip:${fname}`;
      }
    }
    exportedCards.push(copy);
  }

  zip.file(
    "echodeck-backup.json",
    JSON.stringify({ version: 2, exported_at: new Date().toISOString(), cards: exportedCards, settings }, null, 2)
  );
  return zip.generateAsync({ type: "blob" });
}

export async function exportAnkiTsvBlob(): Promise<Blob> {
  const cards = await listCardsLocal();
  const clean = (s: string) => (s || "").replace(/[\t\r\n]+/g, " ").trim();
  const lines = cards.map((c) =>
    [
      clean(c.front_text),
      clean(c.translation),
      clean(c.jyutping),
      clean(c.focus_chunk),
      clean(c.note),
      (c.tags || []).join(" "),
    ].join("\t")
  );
  return new Blob(["\uFEFF" + lines.join("\n")], { type: "text/tab-separated-values;charset=utf-8" });
}

export async function importBackupOrCsvFile(file: File): Promise<number> {
  const lower = file.name.toLowerCase();
  const db = await getDb();

  // 1. 导入 EchoDeck 全量备份包 (.zip)
  if (lower.endsWith(".zip")) {
    const zip = await JSZip.loadAsync(file);
    const jsonEntry = zip.file("echodeck-backup.json");
    if (!jsonEntry) throw new Error("未在 ZIP 中找到 echodeck-backup.json");
    const parsed = JSON.parse(await jsonEntry.async("string"));
    const cards: CardItem[] = Array.isArray(parsed.cards) ? parsed.cards : [];
    let count = 0;
    for (const c of cards) {
      const copy = { ...c };
      if (copy.audio_clip_path?.startsWith("zip:")) {
        const fname = copy.audio_clip_path.slice(4);
        const entry = zip.file(`media/${fname}`);
        if (entry) {
          copy.audio_clip_path = await putBlob(`clip_${copy.id}`, await entry.async("blob"));
        } else {
          copy.audio_clip_path = "";
        }
      }
      if (copy.image_path?.startsWith("zip:")) {
        const fname = copy.image_path.slice(4);
        const entry = zip.file(`media/${fname}`);
        if (entry) {
          copy.image_path = await putBlob(`frame_${copy.id}`, await entry.async("blob"));
        } else {
          copy.image_path = "";
        }
      }
      await db.put("cards", copy);
      count += 1;
    }
    return count;
  }

  // 2. 导入 Anki / 通用 CSV / TSV 词表
  const raw = await file.text();
  const rows = raw.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  const delim = raw.includes("\t") || lower.endsWith(".tsv") ? "\t" : ",";
  let count = 0;
  for (const row of rows) {
    const cols = row.split(delim).map((s) => s.replace(/^"|"$/g, "").trim());
    if (!cols[0]) continue;
    const front = cols[0];
    const lang = /[嘅喺佢咗啲唔冇係]/.test(front) ? "yue" : /[A-Za-z]{3,}/.test(front) ? "en" : "zh";
    await createCardLocal({
      front_text: front,
      translation: cols[1] || "",
      jyutping: cols[2] || "",
      focus_chunk: cols[3] || "",
      note: cols[4] || "",
      language: lang,
      tags: cols[5] ? cols[5].split(/\s+/).filter(Boolean) : ["导入"],
    });
    count += 1;
  }
  return count;
}
