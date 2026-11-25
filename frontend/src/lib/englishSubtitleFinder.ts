/**
 * EchoDeck v7.5 纯英文字幕自动搜挂与去中文净化引擎：
 * 1. 解决「只想要英文字幕、不想要中文字幕」痛点：
 *    - 自动解析中文剧名+季数+集数（如《老友记 第五季 · 第01集》 -> Friends S05E01 / tt0108778）
 *    - 零 Key 零跨域直连 OpenSubtitles v3 (Stremio 开放节点) 自动搜出多条纯正 UTF-8 英文 .srt 字幕
 *    - 内置 50+ 热门美剧/英剧/电影/纪录片 IMDb 毫秒级直查表 + 免费 AI 自动英译剧名 + Cinemeta 自动搜 IMDb ID
 * 2. 双语 .SRT 字幕「去中文留纯英」净化：自动剔除字幕文件中的中文翻译行与站点广告水印行
 */
import type { SubtitleItem } from "../types";
import { nativeHttpGet } from "./nativeBridge";
import { callAiDirectWithCurrentSettings } from "./standaloneStore";
import { parseSubtitleText } from "./subtitleLocal";

export interface OnlineEnglishSubtitleOption {
  id: string;
  label: string;
  url: string;
  lang: string;
}

/** 热门美剧/英剧/电影/纪录片 IMDb 极速直查表（0ms 命中，免搜索延迟） */
const KNOWN_IMDB_MAP: Array<{ patterns: RegExp[]; imdb: string; type: "series" | "movie"; enTitle: string }> = [
  { patterns: [/老友记|六人行|friends/i], imdb: "tt0108778", type: "series", enTitle: "Friends" },
  { patterns: [/摩登家庭|modern\s*family/i], imdb: "tt1442437", type: "series", enTitle: "Modern Family" },
  { patterns: [/生活大爆炸|big\s*bang\s*theory/i], imdb: "tt0898266", type: "series", enTitle: "The Big Bang Theory" },
  { patterns: [/小谢尔顿|young\s*sheldon/i], imdb: "tt6226232", type: "series", enTitle: "Young Sheldon" },
  { patterns: [/绝望主妇|desperate\s*housewives/i], imdb: "tt0410975", type: "series", enTitle: "Desperate Housewives" },
  { patterns: [/老爸老妈|how\s*i\s*met\s*your\s*mother/i], imdb: "tt0460649", type: "series", enTitle: "How I Met Your Mother" },
  { patterns: [/破产姐妹|2\s*broke\s*girls/i], imdb: "tt1845307", type: "series", enTitle: "2 Broke Girls" },
  { patterns: [/绝命毒师|breaking\s*bad/i], imdb: "tt0903747", type: "series", enTitle: "Breaking Bad" },
  { patterns: [/风骚律师|better\s*call\s*saul/i], imdb: "tt3032476", type: "series", enTitle: "Better Call Saul" },
  { patterns: [/权力的游戏|冰与火之歌|game\s*of\s*thrones/i], imdb: "tt0944947", type: "series", enTitle: "Game of Thrones" },
  { patterns: [/神探夏洛克|sherlock/i], imdb: "tt1475582", type: "series", enTitle: "Sherlock" },
  { patterns: [/纸牌屋|house\s*of\s*cards/i], imdb: "tt1856010", type: "series", enTitle: "House of Cards" },
  { patterns: [/瑞克和莫蒂|rick\s*and\s*morty/i], imdb: "tt2861424", type: "series", enTitle: "Rick and Morty" },
  { patterns: [/怪奇物语|stranger\s*things/i], imdb: "tt4574334", type: "series", enTitle: "Stranger Things" },
  { patterns: [/办公室|the\s*office/i], imdb: "tt0386676", type: "series", enTitle: "The Office" },
  { patterns: [/唐顿庄园|downton\s*abbey/i], imdb: "tt1606375", type: "series", enTitle: "Downton Abbey" },
  { patterns: [/王冠|the\s*crown/i], imdb: "tt4786824", type: "series", enTitle: "The Crown" },
  { patterns: [/黑镜|black\s*mirror/i], imdb: "tt2085059", type: "series", enTitle: "Black Mirror" },
  { patterns: [/越狱|prison\s*break/i], imdb: "tt0455275", type: "series", enTitle: "Prison Break" },
  { patterns: [/行尸走肉|walking\s*dead/i], imdb: "tt1520211", type: "series", enTitle: "The Walking Dead" },
  { patterns: [/西部世界|westworld/i], imdb: "tt0475784", type: "series", enTitle: "Westworld" },
  { patterns: [/继承之战|succession/i], imdb: "tt7660850", type: "series", enTitle: "Succession" },
  { patterns: [/人生切割术|severance/i], imdb: "tt11280740", type: "series", enTitle: "Severance" },
  { patterns: [/熊家餐馆|the\s*bear/i], imdb: "tt14452776", type: "series", enTitle: "The Bear" },
  { patterns: [/足球教练|ted\s*lasso/i], imdb: "tt10986410", type: "series", enTitle: "Ted Lasso" },
  { patterns: [/法律与秩序|law\s*&\s*order/i], imdb: "tt0098844", type: "series", enTitle: "Law & Order" },
  { patterns: [/善地|the\s*good\s*place/i], imdb: "tt4955642", type: "series", enTitle: "The Good Place" },
  { patterns: [/神盾局特工|agents\s*of\s*s\.?h\.?i\.?e\.?l\.?d/i], imdb: "tt2364582", type: "series", enTitle: "Agents of S.H.I.E.L.D." },
  { patterns: [/硅谷|silicon\s*valley/i], imdb: "tt2575988", type: "series", enTitle: "Silicon Valley" },
  { patterns: [/无耻之徒|shameless/i], imdb: "tt1586680", type: "series", enTitle: "Shameless" },
  { patterns: [/傲骨贤妻|good\s*wife/i], imdb: "tt1442462", type: "series", enTitle: "The Good Wife" },
  { patterns: [/金装律师|suits/i], imdb: "tt1632701", type: "series", enTitle: "Suits" },
  { patterns: [/地球脉动|planet\s*earth/i], imdb: "tt0795176", type: "series", enTitle: "Planet Earth" },
  { patterns: [/蓝色星球|blue\s*planet/i], imdb: "tt0296310", type: "series", enTitle: "The Blue Planet" },
  { patterns: [/阿甘正传|forrest\s*gump/i], imdb: "tt0109830", type: "movie", enTitle: "Forrest Gump" },
  { patterns: [/肖申克的救赎|shawshank/i], imdb: "tt0111161", type: "movie", enTitle: "The Shawshank Redemption" },
  { patterns: [/绿皮书|green\s*book/i], imdb: "tt6966692", type: "movie", enTitle: "Green Book" },
  { patterns: [/盗梦空间|inception/i], imdb: "tt1375666", type: "movie", enTitle: "Inception" },
  { patterns: [/星际穿越|interstellar/i], imdb: "tt0816692", type: "movie", enTitle: "Interstellar" },
  { patterns: [/当幸福来敲门|pursuit\s*of\s*happyness/i], imdb: "tt0454921", type: "movie", enTitle: "The Pursuit of Happyness" },
  { patterns: [/泰坦尼克号|titanic/i], imdb: "tt0120338", type: "movie", enTitle: "Titanic" },
  { patterns: [/楚门的世界|truman\s*show/i], imdb: "tt0120382", type: "movie", enTitle: "The Truman Show" },
  { patterns: [/教父|godfather/i], imdb: "tt0068646", type: "movie", enTitle: "The Godfather" },
  { patterns: [/怦然心动|flipped/i], imdb: "tt0817177", type: "movie", enTitle: "Flipped" },
  { patterns: [/疯狂动物城|zootopia/i], imdb: "tt2948356", type: "movie", enTitle: "Zootopia" },
  { patterns: [/寻梦环游记|coco/i], imdb: "tt2380307", type: "movie", enTitle: "Coco" },
  { patterns: [/爱乐之城|la\s*la\s*land/i], imdb: "tt3783958", type: "movie", enTitle: "La La Land" },
  { patterns: [/奥本海默|oppenheimer/i], imdb: "tt15398776", type: "movie", enTitle: "Oppenheimer" },
  { patterns: [/沙丘|dune/i], imdb: "tt1160419", type: "movie", enTitle: "Dune" },
];

const CN_NUM_MAP: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function parseChineseOrArabicInt(raw: string): number {
  const s = raw.trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s === "十") return 10;
  if (s.includes("十")) {
    const [left, right] = s.split("十");
    const tens = left ? CN_NUM_MAP[left] || 1 : 1;
    const ones = right ? CN_NUM_MAP[right] || 0 : 0;
    return tens * 10 + ones;
  }
  return CN_NUM_MAP[s] || 0;
}

/** 从剧名与集名自动解析季数和集数（例如 "老友记 第五季" + "第01集" -> S05E01） */
export function parseSeasonAndEpisode(showTitle: string, episodeName: string, isMultiEp: boolean): {
  season: number;
  episode: number;
  isSeries: boolean;
} {
  let season = 1;
  let episode = 1;
  let detectedSeries = isMultiEp;

  const sMatch =
    showTitle.match(/第([零一二两三四五六七八九十\d]+)[季部]/i) ||
    showTitle.match(/\bS0?(\d{1,2})\b/i) ||
    showTitle.match(/Season\s*(\d{1,2})/i);
  if (sMatch) {
    const n = parseChineseOrArabicInt(sMatch[1]);
    if (n > 0) {
      season = n;
      detectedSeries = true;
    }
  }

  const eMatch =
    episodeName.match(/第?0*(\d{1,3})[集话話期]/i) ||
    episodeName.match(/E0*(\d{1,3})\b/i) ||
    episodeName.match(/^0*(\d{1,3})$/);
  if (eMatch) {
    const n = parseInt(eMatch[1], 10);
    if (n > 0) {
      episode = n;
      detectedSeries = true;
    }
  }

  return { season, episode, isSeries: detectedSeries };
}

/** 清理双语字幕中的中文行与广告水印行，只保留纯净英文字幕 */
export function extractPureEnglishFromSubtitleLine(rawText: string): string {
  const cleanedLines = rawText
    .replace(/<[^>]+>/g, "")
    .replace(/\{\\[^}]+\}/g, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      // 剔除常见字幕组/广告水印行
      if (/allsubs\.org|opensubtitles|subhd|zimuku|subtitles\s+by|synced\s+and\s+corrected|www\.\w+\.\w+/i.test(l)) {
        return false;
      }
      // 如果这一行几乎全是中文且不含足够英文字母，直接剥离中文行
      const cjkCount = (l.match(/[\u4e00-\u9fff]/g) || []).length;
      const latinCount = (l.match(/[A-Za-z]/g) || []).length;
      if (cjkCount > 0 && latinCount < 2) return false;
      return true;
    })
    // 若同一行中混排中文与英文，剥离中文片段保留英文
    .map((l) => l.replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/g, " ").replace(/\s{2,}/g, " ").trim())
    .filter((l) => /[A-Za-z0-9]/.test(l));

  return cleanedLines.join(" ").trim();
}

/** 把任意剧名解析为 IMDb ID (tt...) */
async function resolveImdbId(
  showTitle: string,
  isSeriesHint: boolean,
  manualEnQuery?: string
): Promise<{ imdbId: string; type: "series" | "movie"; enTitle: string } | null> {
  const searchBasis = (manualEnQuery || showTitle).trim();
  if (!manualEnQuery) {
    for (const hit of KNOWN_IMDB_MAP) {
      if (hit.patterns.some((rx) => rx.test(showTitle))) {
        return { imdbId: hit.imdb, type: hit.type, enTitle: hit.enTitle };
      }
    }
  }

  // 若是中文片名且未在内置表命中，先用免费 AI 秒翻官方英文片名
  let enQuery = searchBasis
    .replace(/第[零一二两三四五六七八九十\d]+[季部]/g, "")
    .replace(/(粤语|国语|中字|高清|HD|BD|TC|蓝光|完整版|未删减)/gi, "")
    .trim();

  if (/[\u4e00-\u9fff]/.test(enQuery)) {
    try {
      const translated = await callAiDirectWithCurrentSettings(
        [
          {
            role: "system",
            content: "只输出该影视作品最标准的 IMDb 官方英文原名（如 Friends / Breaking Bad / Forrest Gump），不要任何标点、年份或解释。",
          },
          { role: "user", content: enQuery },
        ],
        0.1
      );
      const cleanEn = translated.replace(/["'《》\n].*/g, "").trim();
      if (cleanEn && /[A-Za-z]/.test(cleanEn)) {
        enQuery = cleanEn;
      }
    } catch {
      // ignore and fall through
    }
  }

  const order: Array<"series" | "movie"> = isSeriesHint ? ["series", "movie"] : ["movie", "series"];
  for (const kind of order) {
    try {
      const url = `https://v3-cinemeta.strem.io/catalog/${kind}/top/search=${encodeURIComponent(enQuery)}.json`;
      const raw = await nativeHttpGet(url);
      const data = JSON.parse(raw);
      const first = Array.isArray(data?.metas) ? data.metas.find((m: any) => /^tt\d+/.test(String(m?.imdb_id || m?.id || ""))) : null;
      if (first) {
        return {
          imdbId: String(first.imdb_id || first.id),
          type: kind,
          enTitle: String(first.name || enQuery),
        };
      }
    } catch {
      // try next kind
    }
  }
  return null;
}

/** 一键在线检索当前剧集/电影的纯正英文字幕列表（零 Key / 零登录 / 国内实测直连） */
export async function searchOnlineEnglishSubtitles(params: {
  showTitle: string;
  episodeName: string;
  isMultiEpisode: boolean;
  manualEnQuery?: string;
}): Promise<{
  enTitle: string;
  season: number;
  episode: number;
  options: OnlineEnglishSubtitleOption[];
}> {
  const { season, episode, isSeries } = parseSeasonAndEpisode(
    params.showTitle,
    params.episodeName,
    params.isMultiEpisode
  );

  const resolved = await resolveImdbId(params.showTitle, isSeries, params.manualEnQuery);
  if (!resolved) {
    throw new Error("未能匹配到该影片的英文片名，可在下方输入英文片名重试（如 Friends）");
  }

  const subEndpoint =
    resolved.type === "series"
      ? `https://opensubtitles-v3.strem.io/subtitles/series/${resolved.imdbId}:${season}:${episode}.json`
      : `https://opensubtitles-v3.strem.io/subtitles/movie/${resolved.imdbId}.json`;

  const raw = await nativeHttpGet(subEndpoint);
  const data = JSON.parse(raw);
  const list: any[] = Array.isArray(data?.subtitles) ? data.subtitles : [];

  // 严格只保留英文字幕（排除中文/双语字幕）
  const engOnly = list
    .filter((s) => /^(eng|en|en-us|en-gb)$/i.test(String(s?.lang || "")) && /^https?:\/\//i.test(String(s?.url || "")))
    .slice(0, 6)
    .map((s, idx) => ({
      id: String(s.id || `eng_${idx}`),
      label: `纯英字幕 #${idx + 1} (${resolved.enTitle}${resolved.type === "series" ? ` S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}` : ""})`,
      url: String(s.url),
      lang: "en",
    }));

  if (engOnly.length === 0) {
    throw new Error(`未找到《${resolved.enTitle}》本集的在线英文字幕，可换搜英文片名或导入本地 .srt`);
  }

  return {
    enTitle: resolved.enTitle,
    season,
    episode,
    options: engOnly,
  };
}

/** 下载并净化一条在线纯英文字幕，转为 EchoDeck 交互式点词字幕轨 */
export async function downloadAndParseEnglishSubtitle(url: string): Promise<SubtitleItem[]> {
  const raw = await nativeHttpGet(url);
  const parsed = parseSubtitleText(raw, "online_en.srt");
  const cleanList: SubtitleItem[] = [];
  for (const p of parsed) {
    const pureEn = extractPureEnglishFromSubtitleLine(p.text);
    if (!pureEn) continue;
    cleanList.push({
      id: `en_sub_${cleanList.length}`,
      media_id: "online",
      idx: cleanList.length,
      start_ms: p.start_ms,
      end_ms: p.end_ms,
      text: pureEn,
      translation: "",
      jyutping: "",
    });
  }
  if (cleanList.length === 0) {
    throw new Error("该条字幕解析为空，请点下方切换下一条英文字幕");
  }
  return cleanList;
}

const STOP_WORDS = new Set([
  "a", "an", "the", "to", "of", "in", "on", "at", "is", "are", "was", "were",
  "be", "i", "you", "he", "she", "it", "we", "they", "me", "my", "your", "and", "or", "but", "so",
]);

function normalizeEnTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/n['’]t\b/g, " not")
    .replace(/['’]re\b/g, " are")
    .replace(/['’]ve\b/g, " have")
    .replace(/['’]ll\b/g, " will")
    .replace(/['’]m\b/g, " am")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function scoreSentenceSimilarity(queryTokens: string[], queryClean: string, candText: string): number {
  if (queryTokens.length === 0) return 0;
  const candTokens = normalizeEnTokens(candText);
  if (candTokens.length === 0) return 0;

  const candSet = new Set(candTokens);
  const querySet = new Set(queryTokens);

  let qWeight = 0;
  let hitWeight = 0;
  for (const w of querySet) {
    const wt = STOP_WORDS.has(w) ? 0.45 : w.length >= 4 ? 1.8 : 1.1;
    qWeight += wt;
    if (candSet.has(w)) hitWeight += wt;
  }

  let cWeight = 0;
  let cHit = 0;
  for (const w of candSet) {
    const wt = STOP_WORDS.has(w) ? 0.45 : w.length >= 4 ? 1.8 : 1.1;
    cWeight += wt;
    if (querySet.has(w)) cHit += wt;
  }

  const recall = qWeight > 0 ? hitWeight / qWeight : 0;
  const precision = cWeight > 0 ? cHit / cWeight : 0;
  const f1 = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;

  const candClean = candTokens.join(" ");
  let subBonus = 0;
  if (queryClean.length >= 8 && (candClean.includes(queryClean) || queryClean.includes(candClean))) {
    subBonus = 0.22;
  }

  return Math.min(1, f1 * 0.72 + recall * 0.28 + subBonus);
}

export interface SubtitleAlignmentHit {
  cueIndex: number;
  cue: SubtitleItem;
  score: number;
  suggestedOffsetSec: number;
}

/** 在整条外挂英文字幕中，按语义词元 + 相邻双句拼接精确找到与当前画面烧录台词对应的那一句，并算出精确时间补偿秒数 */
export function findBestSubtitleMatchForText(
  subs: SubtitleItem[],
  ocrEnText: string,
  videoTimeSec: number
): SubtitleAlignmentHit | null {
  const queryTokens = normalizeEnTokens(ocrEnText);
  if (queryTokens.length === 0 || subs.length === 0) return null;
  const queryClean = queryTokens.join(" ");

  let best: SubtitleAlignmentHit | null = null;
  let bestRank = -1;

  for (let i = 0; i < subs.length; i++) {
    const cue = subs[i];
    const singleScore = scoreSentenceSimilarity(queryTokens, queryClean, cue.text);

    // 兼容单屏双句拆成两条相邻 SRT 字幕的情况
    let combinedScore = 0;
    if (i + 1 < subs.length && subs[i + 1].start_ms - cue.end_ms <= 2600) {
      combinedScore = scoreSentenceSimilarity(queryTokens, queryClean, `${cue.text} ${subs[i + 1].text}`);
    }

    const baseScore = Math.max(singleScore, combinedScore * 0.96);
    if (baseScore < 0.25) continue;

    const cueMidSec =
      combinedScore > singleScore && i + 1 < subs.length
        ? (cue.start_ms + subs[i + 1].end_ms) / 2000
        : (cue.start_ms + cue.end_ms) / 2000;
    const dist = Math.abs(cueMidSec - videoTimeSec);
    // 温和的时间就近加成：区分高频短句（如 "What?"），但不阻挡纠正 15s~600s 的真实大偏移
    const proximityBonus = 0.055 * Math.exp(-dist / 180);
    const rank = baseScore + proximityBonus;

    if (rank > bestRank) {
      bestRank = rank;
      best = {
        cueIndex: i,
        cue,
        score: baseScore,
        suggestedOffsetSec: Math.round((cueMidSec - videoTimeSec) * 10) / 10,
      };
    }
  }

  return best;
}

/** 比较当前外挂字幕展示句与画面 OCR 句是否已经一致 */
export function isSubtitleAlreadyAligned(ocrEnText: string, activeSubText: string): boolean {
  const qTokens = normalizeEnTokens(ocrEnText);
  if (qTokens.length === 0 || !activeSubText.trim()) return false;
  return scoreSentenceSimilarity(qTokens, qTokens.join(" "), activeSubText) >= 0.48;
}

/** 根据视频实际总时长智能挑选最匹配的字幕轨（优先时长吻合、句数完整，避开不同剪辑版/25fps PAL 错轨） */
export function pickBestTrackByDuration(
  candidates: Array<{ idx: number; subs: SubtitleItem[] }>,
  videoDurationSec: number
): { idx: number; subs: SubtitleItem[] } | null {
  if (candidates.length === 0) return null;
  if (!Number.isFinite(videoDurationSec) || videoDurationSec < 120) {
    return candidates[0];
  }

  let best = candidates[0];
  let bestScore = -1e9;
  for (const c of candidates) {
    if (c.subs.length === 0) continue;
    const lastSec = c.subs[c.subs.length - 1].end_ms / 1000;
    const ratio = lastSec / videoDurationSec;
    // 正常剧集最后一句通常在片长 78%~99% 处（片尾曲前），超出片长或短于 60% 大概率是错剪辑/错集
    let score = 0;
    if (ratio > 1.03) {
      score -= (ratio - 1.0) * 120;
    } else if (ratio < 0.65) {
      score -= (0.75 - ratio) * 90;
    } else {
      score += 40 - Math.abs(ratio - 0.91) * 50;
    }
    score += Math.min(20, c.subs.length / 20);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}
