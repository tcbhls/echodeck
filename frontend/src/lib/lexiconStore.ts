/**
 * EchoDeck v5.0 多语种海量离线词库与用法例句引擎：
 * - 内置 26,287 英语词 + 词形变化 (exchange) + 11,707 条真人英中双语例句池
 * - 内置 24,040 粤语词 + 简繁对照 + 粤拼 + 1,873 条地道粤语双语例句池
 * - 支持自由扩展任意语种（日语/韩语/法语/西语/德语/自定义）及 CSV/TSV/JSON 批量导入
 * - 支持 ⭐ 收藏 / ✅ 过单词 / ✍️ 个人造句本 / 🔎 影听字幕离线点词速查（含变形词还原）
 * - 支持每日学习目标 & 连续打卡天数统计（Streak）
 */

import { openDB, type IDBPDatabase } from "idb";
import JSZip from "jszip";
import type {
  CustomLanguage,
  DailyHabitStats,
  LexiconEntry,
  LexiconExample,
  UserWordSentence,
  WordMarkStatus,
} from "../types";
import { annotateJyutpingOffline } from "./cantoneseLocal";

const DB_NAME = "echodeck-lexicon-v1";
const DB_VERSION = 2;
const HABIT_KEY = "echodeck_daily_habit_v5";

export interface LanguageMeta {
  code: string;
  name: string;
  ttsLang: string;
  builtin?: boolean;
}

export const BUILTIN_LANGUAGES: LanguageMeta[] = [
  { code: "en", name: "英语", ttsLang: "en-US", builtin: true },
  { code: "yue", name: "粤语", ttsLang: "zh-HK", builtin: true },
];

export const FUTURE_LANGUAGE_PRESETS: CustomLanguage[] = [
  { code: "ja", name: "日语", ttsLang: "ja-JP" },
  { code: "ko", name: "韩语", ttsLang: "ko-KR" },
  { code: "fr", name: "法语", ttsLang: "fr-FR" },
  { code: "es", name: "西班牙语", ttsLang: "es-ES" },
  { code: "de", name: "德语", ttsLang: "de-DE" },
  { code: "it", name: "意大利语", ttsLang: "it-IT" },
];

export const EN_BOOK_FILTERS: Array<{ id: string; label: string }> = [
  { id: "", label: "全部词库" },
  { id: "ox", label: "牛津3000" },
  { id: "hot", label: "柯林斯高频" },
  { id: "cet4", label: "四级 CET4" },
  { id: "cet6", label: "六级 CET6" },
  { id: "ky", label: "考研" },
  { id: "ielts", label: "雅思" },
  { id: "toefl", label: "托福" },
  { id: "gre", label: "GRE" },
  { id: "gk", label: "高考" },
  { id: "zk", label: "中考" },
];

export const YUE_BOOK_FILTERS: Array<{ id: string; label: string }> = [
  { id: "", label: "全部粤词" },
  { id: "daily", label: "日常高频" },
  { id: "drama", label: "港剧常用" },
  { id: "slang", label: "地道口语" },
  { id: "adv", label: "进阶扩展" },
];

export interface WordFormBadge {
  label: string;
  value: string;
}

const EXCHANGE_LABEL_MAP: Record<string, string> = {
  p: "过去式",
  d: "过去分词",
  i: "现在分词",
  "3": "三单",
  s: "复数",
  r: "比较级",
  t: "最高级",
};

/** 将 ECDICT exchange 编码解析为直观中文词形变化标签 */
export function parseWordForms(exchange?: string): WordFormBadge[] {
  if (!exchange) return [];
  const out: WordFormBadge[] = [];
  const seen = new Set<string>();
  for (const seg of exchange.split("/")) {
    const [k, v] = seg.split(":");
    const label = EXCHANGE_LABEL_MAP[k];
    if (!label || !v) continue;
    const key = `${label}:${v}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, value: v });
  }
  return out;
}

export interface UsagePatternTip {
  title: string;
  formula: string;
  hint: string;
}

/** 根据词性与语种生成离线「怎么用 / 怎么造句」实用公式，兜底覆盖全部 50,000+ 词 */
export function buildUsagePatterns(entry: LexiconEntry): UsagePatternTip[] {
  const m = entry.meaning || "";
  const w = entry.word;
  const tips: UsagePatternTip[] = [];

  if (entry.lang === "en") {
    const isVerb = /\b(v|vt|vi)\./i.test(m);
    const isNoun = /\bn\./i.test(m);
    const isAdj = /\b(adj|a)\./i.test(m);
    const isAdv = /\badv\./i.test(m);

    if (isVerb) {
      tips.push({
        title: "动词造句结构",
        formula: `主语 + ${w} (+ 宾语 / 介词短语)`,
        hint: `口语试着套：I'm trying to ${w} ... / We should ${w} ...`,
      });
    }
    if (isNoun) {
      tips.push({
        title: "名词常见搭配",
        formula: `a / the / this + (形容词) + ${w}`,
        hint: `口语试着套：That's a great ${w} / What's the ${w} here?`,
      });
    }
    if (isAdj) {
      tips.push({
        title: "形容词修饰/表语",
        formula: `feel / look / seem + ${w}  或  a ${w} + 名词`,
        hint: `口语试着套：It feels really ${w} / That sounds pretty ${w}.`,
      });
    }
    if (isAdv) {
      tips.push({
        title: "副词修饰动作",
        formula: `动词 + ${w}  或  ${w} + 形容词`,
        hint: `口语试着套：She handled it ${w} / That's ${w} true.`,
      });
    }
    if (tips.length === 0) {
      tips.push({
        title: "口语造句思路",
        formula: `把「${w}」放进你今天刚经历的一件小事里`,
        hint: "先说主语 + 动作，再补时间/地点，一句短话胜过死背十遍中文。",
      });
    }
    return tips.slice(0, 2);
  }

  if (entry.lang === "yue") {
    tips.push({
      title: "粤语自然口语造句",
      formula: `我 / 你 / 佢 + (好 / 真係 / 唔係好) + ${w} + (呀 / 啦 / 喎)`,
      hint: `试试加句尾语气词「呀 / 啦 / 囉 / 喎」，读出来立刻有港剧自然语感。`,
    });
    return tips;
  }

  return [
    {
      title: "多语种场景造句",
      formula: `用「${w}」造一句 6~12 字的生活短句`,
      hint: "在下方「自己造一句」写下来，顺手存进复习舱效果最好。",
    },
  ];
}

let dbPromise: Promise<IDBPDatabase> | null = null;
const memoryCache = new Map<string, LexiconEntry[]>();
const enLookupIndex = new Map<string, LexiconEntry>();
const yueLookupIndex = new Map<string, LexiconEntry>();

async function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("marks")) {
          const s = db.createObjectStore("marks", { keyPath: "id" });
          s.createIndex("by_lang", "lang");
        }
        if (!db.objectStoreNames.contains("custom_words")) {
          const s = db.createObjectStore("custom_words", { keyPath: "id" });
          s.createIndex("by_lang", "lang");
        }
        if (!db.objectStoreNames.contains("languages")) {
          db.createObjectStore("languages", { keyPath: "code" });
        }
        if (!db.objectStoreNames.contains("user_sentences")) {
          const s = db.createObjectStore("user_sentences", { keyPath: "id" });
          s.createIndex("by_word", "wordId");
        }
      },
    });
  }
  return dbPromise;
}

export async function getAllLanguages(): Promise<LanguageMeta[]> {
  const db = await getDb();
  const custom = (await db.getAll("languages")) as CustomLanguage[];
  const merged = [...BUILTIN_LANGUAGES];
  for (const c of custom) {
    if (!merged.some((m) => m.code === c.code)) {
      merged.push({ ...c, builtin: false });
    }
  }
  return merged;
}

export async function addCustomLanguage(lang: CustomLanguage): Promise<LanguageMeta[]> {
  const db = await getDb();
  const code = lang.code.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") || `lang_${Date.now().toString(36)}`;
  await db.put("languages", { code, name: lang.name.trim(), ttsLang: lang.ttsLang || "en-US" });
  return getAllLanguages();
}

/** 解压并加载内置 v5 英语/粤语离线词库（含词形变化与真人双语例句池） */
async function loadBuiltinLexicon(lang: string): Promise<LexiconEntry[]> {
  if (memoryCache.has(lang)) return memoryCache.get(lang)!;
  if (lang !== "en" && lang !== "yue") return [];

  const file = lang === "en" ? "./lexicon/en_core.zip" : "./lexicon/yue_core.zip";
  const resp = await fetch(file);
  if (!resp.ok) throw new Error(`内置词库加载失败 (${resp.status})`);
  const zipBuf = await resp.arrayBuffer();
  const zip = await JSZip.loadAsync(zipBuf);
  const firstName = Object.keys(zip.files)[0];
  const jsonStr = await zip.file(firstName)!.async("string");
  const parsed = JSON.parse(jsonStr);
  const rawItems: any[] = Array.isArray(parsed.items) ? parsed.items : [];
  const sentsPool: Array<[string, string]> = Array.isArray(parsed.sents) ? parsed.sents : [];

  const resolveExamples = (ids: unknown): LexiconExample[] => {
    if (!Array.isArray(ids) || sentsPool.length === 0) return [];
    const out: LexiconExample[] = [];
    for (const id of ids) {
      const pair = sentsPool[Number(id)];
      if (pair && pair[0]) {
        out.push({ text: pair[0], translation: pair[1] || "" });
      }
    }
    return out;
  };

  const list: LexiconEntry[] = rawItems.map((row, idx) => {
    if (lang === "en") {
      // v5: [word, phonetic, meaning, tagStr, exchangeStr, exampleIds]
      const word = String(row[0] || "");
      const exchange = String(row[4] || "");
      const entry: LexiconEntry = {
        id: `en:${word.toLowerCase()}`,
        word,
        phonetic: String(row[1] || ""),
        meaning: String(row[2] || ""),
        tags: String(row[3] || "").split(/\s+/).filter(Boolean),
        lang: "en",
        exchange,
        examples: resolveExamples(row[5]),
      };
      // 建立极速精确 + 变形词反查索引（用于影听点词即查）
      const lw = word.toLowerCase();
      if (!enLookupIndex.has(lw)) enLookupIndex.set(lw, entry);
      if (exchange) {
        for (const part of exchange.split("/")) {
          const [, val] = part.split(":");
          if (val && val.length >= 2) {
            const lv = val.toLowerCase();
            if (!enLookupIndex.has(lv)) enLookupIndex.set(lv, entry);
          }
        }
      }
      return entry;
    }

    // yue v5: [trad, simp, jyutping, meaning, tagStr, exampleIds]
    const trad = String(row[0] || "");
    const simp = String(row[1] || "");
    const entry: LexiconEntry = {
      id: `yue:${trad}_${idx}`,
      word: trad,
      alt: simp !== trad ? simp : "",
      phonetic: String(row[2] || ""),
      meaning: String(row[3] || ""),
      tags: String(row[4] || "").split(/\s+/).filter(Boolean),
      lang: "yue",
      examples: resolveExamples(row[5]),
    };
    if (!yueLookupIndex.has(trad)) yueLookupIndex.set(trad, entry);
    if (simp && !yueLookupIndex.has(simp)) yueLookupIndex.set(simp, entry);
    return entry;
  });

  memoryCache.set(lang, list);
  return list;
}

export async function loadLexiconForLanguage(lang: string): Promise<LexiconEntry[]> {
  const db = await getDb();
  const [builtin, custom] = await Promise.all([
    loadBuiltinLexicon(lang).catch(() => []),
    db.getAllFromIndex("custom_words", "by_lang", lang) as Promise<LexiconEntry[]>,
  ]);
  const sortedCustom = [...custom].sort((a, b) => b.id.localeCompare(a.id));
  return [...sortedCustom, ...builtin];
}

/** 供影听字幕 / 复习卡片点击任意单词时毫秒级离线速查（自动还原过去式/复数/进行时） */
export async function lookupWordOffline(
  rawQuery: string,
  preferredLang?: string
): Promise<LexiconEntry | null> {
  const cleaned = rawQuery.trim().replace(/^[^A-Za-z\u4e00-\u9fff]+|[^A-Za-z\u4e00-\u9fff'-]+$/g, "");
  if (!cleaned) return null;

  const isCjk = /[\u4e00-\u9fff]/.test(cleaned);
  if (isCjk || preferredLang === "yue") {
    await loadBuiltinLexicon("yue").catch(() => []);
    if (yueLookupIndex.has(cleaned)) return yueLookupIndex.get(cleaned)!;
    // 尝试匹配最长的 2~4 字子词
    for (let len = Math.min(4, cleaned.length); len >= 1; len--) {
      const sub = cleaned.slice(0, len);
      if (yueLookupIndex.has(sub)) return yueLookupIndex.get(sub)!;
    }
    return null;
  }

  await loadBuiltinLexicon("en").catch(() => []);
  const lower = cleaned.toLowerCase();
  if (enLookupIndex.has(lower)) return enLookupIndex.get(lower)!;

  // 常见英语词尾容错还原
  const guesses: string[] = [];
  if (lower.endsWith("'s") || lower.endsWith("’s")) guesses.push(lower.slice(0, -2));
  if (lower.endsWith("ies") && lower.length > 4) guesses.push(lower.slice(0, -3) + "y");
  if (lower.endsWith("es") && lower.length > 3) guesses.push(lower.slice(0, -2));
  if (lower.endsWith("s") && lower.length > 3) guesses.push(lower.slice(0, -1));
  if (lower.endsWith("ied") && lower.length > 4) guesses.push(lower.slice(0, -3) + "y");
  if (lower.endsWith("ed") && lower.length > 4) {
    guesses.push(lower.slice(0, -2), lower.slice(0, -1));
  }
  if (lower.endsWith("ing") && lower.length > 5) {
    guesses.push(lower.slice(0, -3), lower.slice(0, -3) + "e", lower.slice(0, -4));
  }
  for (const g of guesses) {
    if (enLookupIndex.has(g)) return enLookupIndex.get(g)!;
  }
  return null;
}

export async function getWordMarksMap(lang: string): Promise<Map<string, WordMarkStatus>> {
  const db = await getDb();
  const rows = (await db.getAllFromIndex("marks", "by_lang", lang)) as Array<{
    id: string;
    lang: string;
    status: WordMarkStatus;
  }>;
  const map = new Map<string, WordMarkStatus>();
  for (const r of rows) {
    if (r.status && r.status !== "none") {
      map.set(r.id, r.status);
    }
  }
  return map;
}

export async function getSingleWordMark(id: string): Promise<WordMarkStatus> {
  const db = await getDb();
  const rec = (await db.get("marks", id)) as { status?: WordMarkStatus } | undefined;
  return rec?.status || "none";
}

export async function setWordMark(id: string, lang: string, status: WordMarkStatus): Promise<void> {
  const db = await getDb();
  if (status === "none") {
    await db.delete("marks", id);
  } else {
    await db.put("marks", { id, lang, status, updated_at: Date.now() });
  }
  if (status === "passed") {
    recordDailyActivity("word");
  }
}

export async function addCustomWord(input: {
  word: string;
  phonetic?: string;
  meaning: string;
  lang: string;
  tags?: string[];
  alt?: string;
  exampleText?: string;
  exampleTrans?: string;
}): Promise<LexiconEntry> {
  const db = await getDb();
  const word = input.word.trim();
  const phonetic =
    input.phonetic?.trim() ||
    (input.lang === "yue" ? annotateJyutpingOffline(word).jyutping : "");

  const examples: LexiconExample[] = input.exampleText?.trim()
    ? [{ text: input.exampleText.trim(), translation: input.exampleTrans?.trim() || "" }]
    : [];

  const entry: LexiconEntry = {
    id: `custom_${input.lang}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    word,
    alt: input.alt?.trim() || "",
    phonetic,
    meaning: input.meaning.trim(),
    tags: input.tags?.length ? input.tags : ["自建"],
    lang: input.lang,
    isCustom: true,
    examples,
  };
  await db.put("custom_words", entry);
  return entry;
}

export async function deleteCustomWord(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("custom_words", id);
  await db.delete("marks", id);
}

// ---------------- 用户自造句 / 个人例句本 ----------------

export async function getUserSentences(wordId: string): Promise<UserWordSentence[]> {
  const db = await getDb();
  const list = (await db.getAllFromIndex("user_sentences", "by_word", wordId)) as UserWordSentence[];
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveUserSentence(input: {
  wordId: string;
  lang: string;
  sentence: string;
  translation?: string;
  aiFeedback?: string;
}): Promise<UserWordSentence> {
  const db = await getDb();
  const rec: UserWordSentence = {
    id: `usent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    wordId: input.wordId,
    lang: input.lang,
    sentence: input.sentence.trim(),
    translation: (input.translation || "").trim(),
    aiFeedback: input.aiFeedback,
    createdAt: Date.now(),
  };
  await db.put("user_sentences", rec);
  return rec;
}

export async function deleteUserSentence(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("user_sentences", id);
}

// ---------------- 每日学习目标 & 连续打卡统计 ----------------

function localDayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function prevDayStr(todayStr: string): string {
  const [y, m, d] = todayStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return localDayStr(dt);
}

export function getDailyHabitStats(): DailyHabitStats {
  const today = localDayStr();
  const fallback: DailyHabitStats = {
    todayDate: today,
    todayPassedWords: 0,
    todayReviewedCards: 0,
    dailyWordGoal: 20,
    dailyReviewGoal: 10,
    streakDays: 0,
    lastActiveDate: "",
  };
  try {
    const raw = localStorage.getItem(HABIT_KEY);
    if (!raw) return fallback;
    const parsed = { ...fallback, ...JSON.parse(raw) } as DailyHabitStats;
    if (parsed.todayDate !== today) {
      const yesterday = prevDayStr(today);
      const keepStreak = parsed.lastActiveDate === yesterday || parsed.lastActiveDate === today;
      return {
        ...parsed,
        todayDate: today,
        todayPassedWords: 0,
        todayReviewedCards: 0,
        todayCinemaMinutes: 0,
        todayMinedLines: 0,
        streakDays: keepStreak ? parsed.streakDays : 0,
      };
    }
    return parsed;
  } catch {
    return fallback;
  }
}

export function recordDailyActivity(kind: "word" | "review" | "cinema_line" | "cinema_min"): DailyHabitStats {
  const today = localDayStr();
  const cur = getDailyHabitStats();
  const yesterday = prevDayStr(today);

  let nextStreak = cur.streakDays;
  if (cur.lastActiveDate !== today) {
    nextStreak = cur.lastActiveDate === yesterday ? cur.streakDays + 1 : 1;
  }

  const next: DailyHabitStats = {
    ...cur,
    todayDate: today,
    todayPassedWords: cur.todayPassedWords + (kind === "word" ? 1 : 0),
    todayReviewedCards: cur.todayReviewedCards + (kind === "review" ? 1 : 0),
    todayCinemaMinutes: (cur.todayCinemaMinutes || 0) + (kind === "cinema_min" ? 1 : 0),
    todayMinedLines: (cur.todayMinedLines || 0) + (kind === "cinema_line" ? 1 : 0),
    streakDays: nextStreak,
    lastActiveDate: today,
  };
  try {
    localStorage.setItem(HABIT_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
  return next;
}

/** 撤回上一张卡片评分时同步回退今日复习计数 */
export function undoDailyReviewActivity(): DailyHabitStats {
  const cur = getDailyHabitStats();
  const next: DailyHabitStats = {
    ...cur,
    todayReviewedCards: Math.max(0, cur.todayReviewedCards - 1),
  };
  try {
    localStorage.setItem(HABIT_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
  return next;
}

export function updateDailyGoals(dailyWordGoal: number, dailyReviewGoal: number): DailyHabitStats {
  const cur = getDailyHabitStats();
  const next: DailyHabitStats = {
    ...cur,
    dailyWordGoal: Math.max(5, Math.min(200, Math.round(dailyWordGoal))),
    dailyReviewGoal: Math.max(3, Math.min(100, Math.round(dailyReviewGoal))),
  };
  try {
    localStorage.setItem(HABIT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

/** 批量导入其他语种或自定义词表（支持 CSV / TSV / JSON） */
export async function importCustomLexiconFile(file: File, lang: string): Promise<number> {
  const db = await getDb();
  const raw = (await file.text()).replace(/^\uFEFF/, "").trim();
  if (!raw) return 0;

  const entries: LexiconEntry[] = [];
  if (file.name.toLowerCase().endsWith(".json") || raw.startsWith("[") || raw.startsWith("{")) {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];
    arr.forEach((item: any, idx: number) => {
      const w = String(item.word || item.term || item[0] || "").trim();
      const m = String(item.meaning || item.translation || item.definition || item[2] || item[1] || "").trim();
      const p = String(item.phonetic || item.reading || item.jyutping || item[1] || "").trim();
      const ex = String(item.example || item.sentence || "").trim();
      if (!w) return;
      entries.push({
        id: `imp_${lang}_${Date.now().toString(36)}_${idx}`,
        word: w,
        phonetic: p === m ? "" : p,
        meaning: m,
        tags: ["导入"],
        lang,
        isCustom: true,
        examples: ex ? [{ text: ex, translation: String(item.exampleTranslation || "") }] : [],
      });
    });
  } else {
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    const delim = raw.includes("\t") || file.name.toLowerCase().endsWith(".tsv") ? "\t" : ",";
    lines.forEach((line, idx) => {
      const cols = line.split(delim).map((s) => s.replace(/^"|"$/g, "").trim());
      if (!cols[0]) return;
      // 支持两列 [单词, 释义]、三列 [单词, 音标, 释义]、四列 [单词, 音标, 释义, 例句]
      const word = cols[0];
      const phonetic = cols.length >= 3 ? cols[1] : lang === "yue" ? annotateJyutpingOffline(word).jyutping : "";
      const meaning = cols.length >= 3 ? cols[2] : cols[1] || "";
      const exampleText = cols.length >= 4 ? cols[3] : "";
      entries.push({
        id: `imp_${lang}_${Date.now().toString(36)}_${idx}`,
        word,
        phonetic,
        meaning,
        tags: ["导入"],
        lang,
        isCustom: true,
        examples: exampleText ? [{ text: exampleText, translation: cols[4] || "" }] : [],
      });
    });
  }

  const tx = db.transaction("custom_words", "readwrite");
  for (const e of entries) {
    await tx.store.put(e);
  }
  await tx.done;
  return entries.length;
}
