/**
 * EchoDeck v6.0 零本地下载 · 在线片库客户端（融合 fongmi-direct.json 国内免翻墙直连片源）：
 * - 内置 11 个经中国大陆三地无 VPN 实测秒开的纯直连 MacCMS JSON 片源（美剧/港剧粤语/电影/纪录片/动漫）
 * - 自动解析多线路 .m3u8 HLS 播放流（金鹰 / 闪电 / 非凡 / 红牛 / 光速 / 樱花等）
 * - 支持自定义添加任意标准 MacCMS JSON 源，或直接粘贴任意 .m3u8 / .mp4 / 小宇宙播客直链秒播
 * - 自动记忆追剧历史与播放进度，不占用手机本地 GB 级存储空间
 */

import { nativeHttpGet } from "./nativeBridge";

export interface VodSource {
  key: string;
  name: string;
  api: string;
  custom?: boolean;
}

export interface VodCategory {
  type_id: string;
  type_name: string;
}

export interface VodListItem {
  vod_id: string;
  vod_name: string;
  vod_pic: string;
  vod_remarks: string;
  type_name: string;
  vod_year?: string;
  vod_area?: string;
  vod_lang?: string;
}

export interface VodEpisode {
  name: string;
  url: string;
}

export interface VodPlayRoute {
  name: string;
  episodes: VodEpisode[];
}

export interface VodDetail extends VodListItem {
  vod_blurb: string;
  vod_actor?: string;
  routes: VodPlayRoute[];
}

export interface WatchHistoryItem {
  id: string; // sourceKey::vodId
  sourceKey: string;
  sourceApi: string;
  vodId: string;
  title: string;
  pic: string;
  routeName: string;
  episodeName: string;
  episodeUrl: string;
  language: string;
  positionSec: number;
  updatedAt: number;
}

/** 全部来自 fongmi-direct.json 的 11 条国内免翻墙直连 JSON 源 */
export const BUILTIN_VOD_SOURCES: VodSource[] = [
  { key: "cx_all", name: "🌟 创享聚合(全站)", api: "https://ys.cxkjg.cn/api/provide/vod" },
  { key: "jinying", name: "📡 金鹰直连", api: "https://ys.cxkjg.cn/api/provide/vod?source=2680151544" },
  { key: "shandian", name: "📡 闪电直连", api: "https://ys.cxkjg.cn/api/provide/vod?source=3848762792" },
  { key: "feifan", name: "📡 非凡直连", api: "https://ys.cxkjg.cn/api/provide/vod?source=1840804598" },
  { key: "hongniu", name: "📡 红牛直连", api: "https://ys.cxkjg.cn/api/provide/vod?source=2761253814" },
  { key: "subo", name: "📡 速博直连", api: "https://ys.cxkjg.cn/api/provide/vod?source=1016684692" },
  { key: "guangsu", name: "📡 光速直连", api: "https://ys.cxkjg.cn/api/provide/vod?source=4247318859" },
  { key: "yinghua", name: "📡 樱花动漫", api: "https://ys.cxkjg.cn/api/provide/vod?source=531717376" },
  { key: "ws", name: "📡 WS直连", api: "https://ys.cxkjg.cn/api/provide/vod?source=4118858385" },
  { key: "hdsn", name: "📡 HD(SN)", api: "https://ys.cxkjg.cn/api/provide/vod?source=1208629981" },
  { key: "uku", name: "📡 U酷直连", api: "https://ys.cxkjg.cn/api/provide/vod?source=4194624554" },
];

export interface CuratedStudyShow {
  id: string;
  title: string;
  query: string;
  channel: "en_drama" | "yue_drama" | "movie" | "doc";
  lang: "en" | "yue";
  level: string;
  accent: string;
  reason: string;
}

export const STUDY_CHANNELS: Array<{
  id: "curated" | "en_drama" | "yue_drama" | "movie" | "doc" | "browse";
  label: string;
}> = [
  { id: "curated", label: "精选精听" },
  { id: "en_drama", label: "美剧口语" },
  { id: "yue_drama", label: "港剧粤语" },
  { id: "movie", label: "经典电影" },
  { id: "doc", label: "英语纪录片" },
  { id: "browse", label: "全站片库" },
];

export const CURATED_STUDY_SHOWS: CuratedStudyShow[] = [
  {
    id: "friends",
    title: "老友记",
    query: "老友记",
    channel: "en_drama",
    lang: "en",
    level: "入门首选",
    accent: "标准美音",
    reason: "生活高频短句、日常寒暄与职场/朋友吐槽全覆盖",
  },
  {
    id: "modern_family",
    title: "摩登家庭",
    query: "摩登家庭",
    channel: "en_drama",
    lang: "en",
    level: "进阶口语",
    accent: "地道美音",
    reason: "语速自然、双关笑点多，练连读与家庭生活表达极佳",
  },
  {
    id: "tbbt",
    title: "生活大爆炸",
    query: "生活大爆炸",
    channel: "en_drama",
    lang: "en",
    level: "中级高频",
    accent: "清晰美音",
    reason: "发音清晰、对话密集，科技日常与美式吐槽词块极多",
  },
  {
    id: "desperate",
    title: "绝望主妇",
    query: "绝望主妇",
    channel: "en_drama",
    lang: "en",
    level: "精听神剧",
    accent: "播客级旁白",
    reason: "每集片头片尾经典独白，发音慢而优雅，适合跟读模仿",
  },
  {
    id: "news_queen",
    title: "新闻女王（粤语）",
    query: "新闻女王 粤语",
    channel: "yue_drama",
    lang: "yue",
    level: "现代职场粤语",
    accent: "纯正港粤",
    reason: "中英夹杂香港职场真实语境，高频港式金句极实用",
  },
  {
    id: "line_walker",
    title: "使徒行者（粤语）",
    query: "使徒行者",
    channel: "yue_drama",
    lang: "yue",
    level: "地道市井粤语",
    accent: "纯正港粤",
    reason: "警匪街头对白鲜活，学最接地气的香港口语俚语",
  },
  {
    id: "infernal_affairs",
    title: "无间道（粤语）",
    query: "无间道",
    channel: "yue_drama",
    lang: "yue",
    level: "港片精听必刷",
    accent: "纯正港粤",
    reason: "台词精炼经典，节奏克制，适合逐句盲听与影子跟读",
  },
  {
    id: "come_home_love",
    title: "爱回家之开心速递",
    query: "爱回家",
    channel: "yue_drama",
    lang: "yue",
    level: "日常粤语宝库",
    accent: "香港家庭粤语",
    reason: "贴近香港街坊日常吃饭聊天，听懂这部基本通吃港粤",
  },
  {
    id: "forrest_gump",
    title: "阿甘正传",
    query: "阿甘正传",
    channel: "movie",
    lang: "en",
    level: "入门精听电影",
    accent: "慢速美音",
    reason: "语速温和清晰、句子结构直白，影史最佳精听入门片",
  },
  {
    id: "green_book",
    title: "绿皮书",
    query: "绿皮书",
    channel: "movie",
    lang: "en",
    level: "高分口语电影",
    accent: "口语 vs 正式体",
    reason: "两种截然不同的英语风格碰撞，一次听懂街头俚语与优雅表达",
  },
  {
    id: "shawshank",
    title: "肖申克的救赎",
    query: "肖申克的救赎",
    channel: "movie",
    lang: "en",
    level: "中级精听必刷",
    accent: "磁性美式旁白",
    reason: "摩根·弗里曼旁白字正腔圆，练听力节奏与长句理解",
  },
  {
    id: "planet_earth",
    title: "地球脉动",
    query: "地球脉动",
    channel: "doc",
    lang: "en",
    level: "BBC 权威英音",
    accent: "纯正英音",
    reason: "大卫·爱登堡教科书级英音解说，积累高级书面与科普表达",
  },
  {
    id: "blue_planet",
    title: "蓝色星球",
    query: "蓝色星球",
    channel: "doc",
    lang: "en",
    level: "沉浸英音精听",
    accent: "纯正英音",
    reason: "画面震撼、解说留白充足，非常适合开盲听帘做精听复述",
  },
];

export const QUICK_STUDY_SEARCHES: Array<{ label: string; query: string; lang: "en" | "yue" }> = [
  { label: "老友记(美剧)", query: "老友记", lang: "en" },
  { label: "摩登家庭(美剧)", query: "摩登家庭", lang: "en" },
  { label: "生活大爆炸", query: "生活大爆炸", lang: "en" },
  { label: "新闻女王 粤语", query: "新闻女王 粤语", lang: "yue" },
  { label: "使徒行者 粤语", query: "使徒行者", lang: "yue" },
  { label: "无间道 粤语", query: "无间道", lang: "yue" },
  { label: "地球脉动", query: "地球脉动", lang: "en" },
];

const CUSTOM_SOURCES_KEY = "echodeck_vod_custom_sources_v6";
const WATCH_HISTORY_KEY = "echodeck_vod_history_v6";
const SHOW_PREP_CACHE_KEY = "echodeck_show_prep_cache_v65";
const SHOW_LOOKUPS_KEY = "echodeck_show_lookups_v65";

export interface CachedShowLookup {
  word: string;
  lang: string;
  timeSec: number;
  createdAt: number;
}

export function getCachedShowPrep<T = any>(cacheKey: string): T[] | null {
  try {
    const raw = localStorage.getItem(SHOW_PREP_CACHE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    const hit = map?.[cacheKey];
    return Array.isArray(hit) && hit.length > 0 ? hit : null;
  } catch {
    return null;
  }
}

export function saveCachedShowPrep(cacheKey: string, items: any[]): void {
  try {
    const raw = localStorage.getItem(SHOW_PREP_CACHE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[cacheKey] = items;
    // 只保留最近 20 部剧的预习包防止 localStorage 膨胀
    const keys = Object.keys(map);
    if (keys.length > 20) {
      delete map[keys[0]];
    }
    localStorage.setItem(SHOW_PREP_CACHE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function getShowLookups(showKey: string): CachedShowLookup[] {
  try {
    const raw = localStorage.getItem(SHOW_LOOKUPS_KEY);
    if (!raw) return [];
    const map = JSON.parse(raw);
    return Array.isArray(map?.[showKey]) ? map[showKey] : [];
  } catch {
    return [];
  }
}

export function addShowLookup(showKey: string, entry: CachedShowLookup): CachedShowLookup[] {
  const cur = getShowLookups(showKey).filter((x) => x.word.toLowerCase() !== entry.word.toLowerCase());
  const next = [entry, ...cur].slice(0, 40);
  try {
    const raw = localStorage.getItem(SHOW_LOOKUPS_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[showKey] = next;
    localStorage.setItem(SHOW_LOOKUPS_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
  return next;
}

export function getAllVodSources(): VodSource[] {
  try {
    const raw = localStorage.getItem(CUSTOM_SOURCES_KEY);
    const custom: VodSource[] = raw ? JSON.parse(raw) : [];
    return [...BUILTIN_VOD_SOURCES, ...custom];
  } catch {
    return BUILTIN_VOD_SOURCES;
  }
}

export function addCustomVodSource(name: string, api: string): VodSource[] {
  const cleanApi = api.trim();
  const cleanName = name.trim() || "自定义片源";
  if (!cleanApi) return getAllVodSources();
  try {
    const raw = localStorage.getItem(CUSTOM_SOURCES_KEY);
    const custom: VodSource[] = raw ? JSON.parse(raw) : [];
    const next = [
      ...custom.filter((c) => c.api !== cleanApi),
      { key: `custom_${Date.now().toString(36)}`, name: `🔗 ${cleanName}`, api: cleanApi, custom: true },
    ];
    localStorage.setItem(CUSTOM_SOURCES_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return getAllVodSources();
}

export function getWatchHistory(): WatchHistoryItem[] {
  try {
    const raw = localStorage.getItem(WATCH_HISTORY_KEY);
    const arr: WatchHistoryItem[] = raw ? JSON.parse(raw) : [];
    return arr.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 24);
  } catch {
    return [];
  }
}

export function saveWatchHistory(item: WatchHistoryItem): WatchHistoryItem[] {
  const cur = getWatchHistory().filter((x) => x.id !== item.id);
  const next = [item, ...cur].slice(0, 24);
  try {
    localStorage.setItem(WATCH_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

function buildVodUrl(baseApi: string, params: Record<string, string | number | undefined>): string {
  const sep = baseApi.includes("?") ? "&" : "?";
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return qs ? `${baseApi}${sep}${qs}` : baseApi;
}

async function fetchJson(url: string): Promise<any> {
  const text = await nativeHttpGet(url);
  return JSON.parse(text);
}

export async function fetchVodHome(
  sourceApi: string,
  typeId = "",
  page = 1
): Promise<{ categories: VodCategory[]; items: VodListItem[]; pagecount: number }> {
  // 拉取分类 + 最新列表（ac=detail 一次性带回封面图与备注）
  const [catRes, listRes] = await Promise.all([
    page === 1 && !typeId ? fetchJson(buildVodUrl(sourceApi, { ac: "list", pg: 1 })).catch(() => ({})) : Promise.resolve({}),
    fetchJson(buildVodUrl(sourceApi, { ac: "detail", t: typeId || undefined, pg: page })),
  ]);

  const rawClasses = Array.isArray(catRes?.class)
    ? catRes.class
    : Array.isArray(listRes?.class)
      ? listRes.class
      : [];
  const categories: VodCategory[] = rawClasses
    .map((c: any) => ({
      type_id: String(c.type_id ?? ""),
      type_name: String(c.type_name ?? "").trim(),
    }))
    .filter((c: VodCategory) => c.type_id && c.type_name);

  const items: VodListItem[] = (Array.isArray(listRes?.list) ? listRes.list : []).map(normalizeListItem);
  return {
    categories,
    items,
    pagecount: Number(listRes?.pagecount || 1),
  };
}

export async function searchVod(sourceApi: string, keyword: string): Promise<VodListItem[]> {
  const q = keyword.trim();
  if (!q) return [];
  const data = await fetchJson(buildVodUrl(sourceApi, { ac: "detail", wd: q }));
  return (Array.isArray(data?.list) ? data.list : []).map(normalizeListItem);
}

export async function fetchVodDetail(sourceApi: string, vodId: string): Promise<VodDetail | null> {
  const data = await fetchJson(buildVodUrl(sourceApi, { ac: "detail", ids: vodId }));
  const raw = Array.isArray(data?.list) ? data.list[0] : null;
  if (!raw) return null;

  const fromNames = String(raw.vod_play_from || "")
    .split("$$$")
    .map((s) => s.trim());
  const urlGroups = String(raw.vod_play_url || "").split("$$$");

  const routes: VodPlayRoute[] = [];
  for (let i = 0; i < urlGroups.length; i++) {
    const groupStr = (urlGroups[i] || "").trim();
    if (!groupStr) continue;
    const episodes: VodEpisode[] = [];
    for (const seg of groupStr.split("#")) {
      const cleanSeg = seg.trim();
      if (!cleanSeg) continue;
      const idx = cleanSeg.indexOf("$");
      let name = `第${episodes.length + 1}集`;
      let url = cleanSeg;
      if (idx > 0) {
        name = cleanSeg.slice(0, idx).trim() || name;
        url = cleanSeg.slice(idx + 1).trim();
      }
      if (/^https?:\/\//i.test(url)) {
        episodes.push({ name, url });
      }
    }
    if (episodes.length > 0) {
      routes.push({
        name: fromNames[i] || `线路 ${i + 1}`,
        episodes,
      });
    }
  }

  // 优先把直接 .m3u8 / .mp4 且广告最少的优质国内直连线路排在前面
  const routePriority = (name: string): number => {
    if (/金鹰|jy/i.test(name)) return 0;
    if (/HD\(SN\)|sn/i.test(name)) return 1;
    if (/非凡|ff/i.test(name)) return 2;
    if (/量子|lz/i.test(name)) return 3;
    if (/红牛|hn/i.test(name)) return 4;
    if (/闪电|sd/i.test(name)) return 5;
    return 10;
  };
  routes.sort((a, b) => {
    const aDirect = /\.(m3u8|mp4)(\?|$)/i.test(a.episodes[0]?.url || "") ? 0 : 1;
    const bDirect = /\.(m3u8|mp4)(\?|$)/i.test(b.episodes[0]?.url || "") ? 0 : 1;
    if (aDirect !== bDirect) return aDirect - bDirect;
    return routePriority(a.name) - routePriority(b.name);
  });

  const base = normalizeListItem(raw);
  const blurb = String(raw.vod_blurb || raw.vod_content || "")
    .replace(/<[^>]+>/g, "")
    .trim();

  return {
    ...base,
    vod_blurb: blurb,
    vod_actor: String(raw.vod_actor || "").trim(),
    routes,
  };
}

/** 推断片源默认学习语言（港剧/粤语标 yue，欧美/英语标 en） */
export function inferVodLanguage(item: Pick<VodListItem, "vod_name" | "type_name" | "vod_area" | "vod_lang">): "en" | "yue" {
  const joined = `${item.vod_name} ${item.type_name} ${item.vod_area || ""} ${item.vod_lang || ""}`;
  if (/粤语|香港|港剧|TVB|粵語/i.test(joined)) return "yue";
  return "en";
}

function normalizeListItem(raw: any): VodListItem {
  return {
    vod_id: String(raw.vod_id ?? ""),
    vod_name: String(raw.vod_name ?? "").trim(),
    vod_pic: String(raw.vod_pic ?? "").trim(),
    vod_remarks: String(raw.vod_remarks ?? "").trim(),
    type_name: String(raw.type_name ?? "").trim(),
    vod_year: raw.vod_year ? String(raw.vod_year) : "",
    vod_area: raw.vod_area ? String(raw.vod_area) : "",
    vod_lang: raw.vod_lang ? String(raw.vod_lang) : "",
  };
}
