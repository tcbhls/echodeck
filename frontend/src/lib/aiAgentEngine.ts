/**
 * EchoDeck v7.0 全权限 AI 助教引擎 (18 项 App 级可执行权限 + 实时中英/粤语表达纠错 + 多轮自主工具调用)：
 * - 兼容所有已接入 AI 模型（智谱 GLM-4-Flash 永久免费主力 / 免 Key 公共通道 / 自有 DeepSeek & OpenAI）
 * - 拥有完整 App 权限：
 *   1) 在线影厅：截屏视觉识台词并直接收藏、控播放/跳转/5秒复读/调速/盲听遮字幕帘/选集/搜片/生成课前词包
 *   2) 复习词卡：查询/新建/修改/删除 FSRS 复习卡、直接为当前复习卡打分、跳回原片片段
 *   3) 50,327 离线词库：查词释义例句、直接收藏/斩词/自建词条、写入个人造句本、抽查收藏生词、反查影听字幕
 *   4) 语音与系统：调用微软 Neural 真人港粤/美音朗读示范、查学习统计、改每日目标、切换页面与深浅主题/音色
 *   5) 表达纠错：只要用户发言含英文或粤语表达，自动输出结构化「纠错 + 地道升级版」并可一键存卡/朗读
 */
import type { CardItem, TabKey } from "../types";
import { echoAgentBridge, getStudyLangMeta } from "./appAgentBridge";
import { annotateJyutpingOffline } from "./cantoneseLocal";
import {
  addCustomWord,
  getDailyHabitStats,
  getWordMarksMap,
  loadLexiconForLanguage,
  lookupWordOffline,
  recordDailyActivity,
  saveUserSentence,
  setWordMark,
  updateDailyGoals,
} from "./lexiconStore";
import {
  addLearnerMemory,
  buildLearnerMemoryPromptBlock,
  removeLearnerMemory,
  type LearnerMemoryItem,
} from "./learnerMemory";
import { getVoiceGenderPref, setVoiceGenderPref, speakOffline } from "./nativeBridge";
import { getSelectedVoiceId, getVoicePresetById, setSelectedVoiceId } from "./voiceCatalog";
import {
  callAiDirectWithCurrentSettings,
  createCardLocal,
  deleteCardLocal,
  findSubtitlesContainingWord,
  getAppStats,
  getSettingsLocal,
  listCardsLocal,
  recastChineseToTargetLangDirect,
  saveSettingsLocal,
  translateTextToZhDirect,
  updateCardLocal,
} from "./standaloneStore";
import { getAllVodSources, getWatchHistory, searchVod } from "./vodClient";

export interface AgentActionReceipt {
  tool: string;
  ok: boolean;
  label: string;
  detail?: string;
}

export interface AgentCorrection {
  original: string;
  improved: string;
  lang: string;
  reason: string;
  focus_chunk?: string;
}

export interface AgentVodHitCard {
  vodId: string;
  title: string;
  pic: string;
  remarks: string;
  typeName: string;
  sourceKey: string;
  sourceName: string;
  sourceApi: string;
}

export interface AgentSuggestedReply {
  label: string;
  prompt: string;
  zhHint?: string;
}

export interface AgentTurnMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 本条 AI 回复的完整自然简体中文翻译（默认折叠，点击 AI 回答气泡立即显隐） */
  replyZh?: string;
  /** 当用户用中文提问时，AI 先将用户问题转换为当前学习语种的地道复述 */
  userQuestionRecast?: string;
  /** 本轮目标学习语种（如 en / yue / ja / ko / fr / es / de / it） */
  targetLang?: string;
  /** 搜片结果直达播放卡片（点击「立即播放」直接进入影厅开播！） */
  vodCards?: AgentVodHitCard[];
  /** 智能上下文快捷跟进/回复选项（点一下直接接话或继续下一步） */
  suggestedReplies?: AgentSuggestedReply[];
  receipts?: AgentActionReceipt[];
  correction?: AgentCorrection | null;
  speakText?: string;
  speakLang?: string;
  savedRecast?: boolean;
  savedCorrection?: boolean;
  createdAt: number;
}

interface RawToolCall {
  tool: string;
  args?: Record<string, any>;
}

interface ParsedAgentPayload {
  actions: RawToolCall[];
  need_followup?: boolean;
  user_recast?: string;
  correction?: AgentCorrection | null;
  reply: string;
  reply_zh?: string;
  speak_text?: string;
  speak_lang?: string;
  suggested_replies?: AgentSuggestedReply[];
}

/** 判断用户是否使用了普通话中文提问（用于触发「先用目标语种复述用户问题」） */
export function isChineseUserQuestion(text: string, targetLang: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const cjkChars = trimmed.match(/[\u4e00-\u9fff]/g) || [];
  if (cjkChars.length === 0) return false;
  // 学日语时：如果夹有平假名/片假名，说明用户正在用日语表达，不算纯中文提问
  if (targetLang === "ja" && /[\u3040-\u30ff]/.test(trimmed)) return false;
  // 学粤语时：如果已大量使用粤语口语专属用字，视为已经在说粤语；否则普通话中文依然需转为地道港粤复述
  if (targetLang === "yue") {
    const yueDistinct = trimmed.match(/[係唔冇嘅咗啲喺點解乜嘢邊度邊個睇講嚟俾搵啱唔該多謝搞掂㗎嘛喇喎咩]/g) || [];
    if (yueDistinct.length >= 2) return false;
  }
  return cjkChars.length >= 2 || (cjkChars.length >= 1 && !/[A-Za-z]{4,}/.test(trimmed));
}

const READ_TOOLS = new Set([
  "search_online_cinema",
  "search_lexicon",
  "list_review_cards",
  "list_favorite_words",
  "search_media_subtitles",
  "get_study_stats",
]);

/** 校验 AI 给出的中文提问复述是否真的用目标语种写成（防止漏填、照抄中文或误把 AI 自己的回答填进 user_recast） */
function isValidRecastForLang(recast: string, originalInput: string, targetLang: string): boolean {
  const r = recast.trim();
  if (r.length < 2) return false;
  if (r === originalInput.trim()) return false;
  // 防止二轮时模型误把自己的回答（"I found several..." / "I've saved..."）塞进 user_recast
  if (/^(I found|I have found|I've found|I've saved|I have saved|I noted|Here are|All set!)/i.test(r)) {
    return false;
  }
  if (["en", "fr", "es", "de", "it"].includes(targetLang)) {
    const latin = (r.match(/[A-Za-z]/g) || []).length;
    const cjk = (r.match(/[\u4e00-\u9fff]/g) || []).length;
    return latin >= 3 && latin > cjk;
  }
  if (targetLang === "ko") {
    return /[\uac00-\ud7af]/.test(r);
  }
  if (targetLang === "ja") {
    return /[\u3040-\u30ff]/.test(r);
  }
  return true;
}

const EN_STOP_WORDS = new Set([
  "the", "a", "an", "of", "in", "on", "to", "for", "and", "or", "my", "is", "at", "by", "new", "old", "big", "all",
]);

/** 从用户中文原话里提取真实中文片名（防止大模型把「生化危机」「新闻女王」擅自翻成英文导致国内片库搜不到或误搜 "The"！） */
function extractChineseTitleFromInput(userInput?: string): string {
  const raw = String(userInput || "").trim();
  if (!raw || !/[\u4e00-\u9fff]{2,}/.test(raw)) return "";

  // 1. 优先提取书名号/引号里的片名，如《新闻女王 粤语》
  const bracketed = raw.match(/[《「『]([^》」』]{2,32})[》」』]/);
  if (bracketed?.[1]) {
    return bracketed[1].trim();
  }

  // 2. 去掉常见口语指令前缀与后缀，提取剩余中文片名（如「帮我找找生化危机 爆发夜」->「生化危机 爆发夜」）
  const stripped = raw
    .replace(
      /(请|麻烦|可以|能不能|帮我|给我|去在线影厅|在线影厅|去影厅|影厅里?|找一下|找找|搜一下|搜一搜|搜索|查一下|查查|看一下|看看|我想看|想看|看一部|播放|点播|有没有|一下|一部|那部|这个|电影|电视剧|剧集|美剧|港剧|英剧|日剧|韩剧|动漫|综艺|吧|呀|啊|吗|呢)/g,
      " "
    )
    .replace(/[，。！？、,.!?""'']/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return /[\u4e00-\u9fff]{2,}/.test(stripped) ? stripped : "";
}

/** 跨多条国内直连片库智能搜片（优先保留用户中文片名 + 自动处理带副标题/语种后缀缩词兜底 + 严禁搜英文虚词 "The"！） */
async function searchOnlineCinemaMultiSource(
  rawQuery: string,
  originalUserInput?: string
): Promise<{
  effectiveQuery: string;
  hits: AgentVodHitCard[];
}> {
  const cleanArg = rawQuery.replace(/[《》「」"'?？!！]/g, "").trim();
  const extractedZh = extractChineseTitleFromInput(originalUserInput);

  const buildCandidates = (text: string): string[] => {
    const t = text.replace(/[《》「」"'?？!！]/g, "").trim();
    if (!t) return [];
    const strippedTag = t
      .replace(/\s*(粤语版?|英语版?|国语版?|原声版?|中字|美剧|港剧|英剧|电影|全集|高清|cantonese|english|version)\s*/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const parts = strippedTag.split(/[\s:：·\-—]+/).filter(Boolean);
    const firstPart = parts[0] || "";
    const out: string[] = [t, strippedTag];

    // 仅当首段是 >=2 字中文，或 >=4 字母且非英文停用词（严禁把 "The News Queen" 截成 "The"！）时才加入缩词兜底
    const firstIsValidCjk = /[\u4e00-\u9fff]{2,}/.test(firstPart);
    const firstIsValidEn =
      !firstIsValidCjk &&
      firstPart.length >= 4 &&
      !EN_STOP_WORDS.has(firstPart.toLowerCase());
    if (firstIsValidCjk || firstIsValidEn) {
      out.push(firstPart);
    }

    // 若中文主片名很长且无空格（如「生化危机爆发夜」），追加前 4 字兜底
    const pureCjk = strippedTag.replace(/[^\u4e00-\u9fff]/g, "");
    if (pureCjk.length >= 6 && firstPart === strippedTag) {
      out.push(pureCjk.slice(0, 4));
    }
    return out.filter((q) => {
      if (q.length < 2) return false;
      if (/^[A-Za-z]+$/.test(q) && (q.length < 4 || EN_STOP_WORDS.has(q.toLowerCase()))) return false;
      return true;
    });
  };

  // 国内片源库按中文片名索引：若 AI 擅自把用户中文片名翻成了英文，把用户原本的中文片名排在最前面搜！
  const argHasCjk = /[\u4e00-\u9fff]{2,}/.test(cleanArg);
  const rawCandidates = !argHasCjk && extractedZh
    ? [...buildCandidates(extractedZh), ...buildCandidates(cleanArg)]
    : [...buildCandidates(cleanArg), ...(extractedZh ? buildCandidates(extractedZh) : [])];
  const queries = Array.from(new Set(rawCandidates));
  if (queries.length === 0) return { effectiveQuery: cleanArg || extractedZh, hits: [] };

  const sources = getAllVodSources().slice(0, 4);
  const collected: AgentVodHitCard[] = [];
  const seen = new Set<string>();
  let usedQuery = queries[0];

  for (const q of queries) {
    for (const src of sources) {
      try {
        const list = await searchVod(src.api, q);
        if (list.length > 0) {
          usedQuery = q;
          for (const item of list.slice(0, 6)) {
            const key = `${src.key}::${item.vod_id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            collected.push({
              vodId: item.vod_id,
              title: item.vod_name,
              pic: item.vod_pic || "",
              remarks: item.vod_remarks || "",
              typeName: item.type_name || "",
              sourceKey: src.key,
              sourceName: src.name,
              sourceApi: src.api,
            });
          }
          if (collected.length >= 6) break;
        }
      } catch {
        // 换下一条直连源
      }
    }
    if (collected.length > 0) break;
  }

  return { effectiveQuery: usedQuery, hits: collected.slice(0, 6) };
}

/** 栈式修复被免费通道中途截断的 JSON（确保即使尾部 suggested_replies 被截断，actions/reply/reply_zh 也 100% 完整执行不漏原始 JSON！） */
function repairTruncatedJson(text: string): Record<string, any> | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  const src = text.slice(start).trim();

  // 策略 1：栈式追踪未闭合引号与括号，裁剪残缺尾键后自动补齐闭合符
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  let lastGoodCommaOrClose = -1;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (ch === "\\") {
        esc = true;
      } else if (ch === '"') {
        inStr = false;
        lastGoodCommaOrClose = i;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === "{") {
      stack.push("}");
    } else if (ch === "[") {
      stack.push("]");
    } else if (ch === "}" || ch === "]") {
      if (stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop();
        lastGoodCommaOrClose = i;
      }
    }
  }

  const attempts: string[] = [];
  // 尝试 A：直接闭合当前位置（若在字符串内则先补引号）
  let base = src.replace(/\\$/, "");
  if (inStr) base += '"';
  base = base.replace(/,\s*$/, "");
  attempts.push(base + [...stack].reverse().join(""));

  // 尝试 B：回退到最后一个完整 } 或 ] 或 " 处，再按当时的栈闭合（最适合尾部 suggested_replies 半截断场景！）
  if (lastGoodCommaOrClose > 10) {
    const cut = src.slice(0, lastGoodCommaOrClose + 1).replace(/,\s*$/, "");
    // 重算 cut 处的未闭合栈
    let s2InStr = false;
    let s2Esc = false;
    const s2Stack: string[] = [];
    for (let i = 0; i < cut.length; i++) {
      const c = cut[i];
      if (s2InStr) {
        if (s2Esc) s2Esc = false;
        else if (c === "\\") s2Esc = true;
        else if (c === '"') s2InStr = false;
        continue;
      }
      if (c === '"') s2InStr = true;
      else if (c === "{") s2Stack.push("}");
      else if (c === "[") s2Stack.push("]");
      else if ((c === "}" || c === "]") && s2Stack[s2Stack.length - 1] === c) s2Stack.pop();
    }
    // 去掉悬空的 "key": 后再闭合
    const cleanedCut = cut.replace(/,?\s*"[^"]*"\s*:\s*$/, "").replace(/,\s*$/, "");
    attempts.push(cleanedCut + [...s2Stack].reverse().join(""));
  }

  for (const cand of attempts) {
    try {
      const normalized = cand
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (m) => m.replace(/\r?\n/g, "\\n"));
      const parsed = JSON.parse(normalized);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // try next strategy
    }
  }

  // 策略 2：字段级精准抢救（单独提取完整的 actions 数组、reply、reply_zh、user_recast、speak_text）
  const salvaged: Record<string, any> = {};
  const extractStrField = (key: string): string => {
    const rx = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "s");
    const m = src.match(rx);
    if (!m?.[1]) return "";
    try {
      return JSON.parse(`"${m[1].replace(/\r?\n/g, "\\n")}"`);
    } catch {
      return m[1].replace(/\\"/g, '"').replace(/\\n/g, "\n");
    }
  };
  const actionsKeyIdx = src.indexOf('"actions"');
  if (actionsKeyIdx >= 0) {
    const arrStart = src.indexOf("[", actionsKeyIdx);
    if (arrStart >= 0) {
      let depth = 0;
      let aInStr = false;
      let aEsc = false;
      for (let i = arrStart; i < src.length; i++) {
        const c = src[i];
        if (aInStr) {
          if (aEsc) aEsc = false;
          else if (c === "\\") aEsc = true;
          else if (c === '"') aInStr = false;
          continue;
        }
        if (c === '"') aInStr = true;
        else if (c === "[") depth++;
        else if (c === "]") {
          depth--;
          if (depth === 0) {
            try {
              const arrRaw = src
                .slice(arrStart, i + 1)
                .replace(/,\s*([}\]])/g, "$1")
                .replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (m) => m.replace(/\r?\n/g, "\\n"));
              salvaged.actions = JSON.parse(arrRaw);
            } catch {
              // ignore
            }
            break;
          }
        }
      }
    }
  }
  const rep = extractStrField("reply");
  const repZh = extractStrField("reply_zh");
  const recast = extractStrField("user_recast");
  const spk = extractStrField("speak_text");
  const spkLang = extractStrField("speak_lang");
  if (rep) salvaged.reply = rep;
  if (repZh) salvaged.reply_zh = repZh;
  if (recast) salvaged.user_recast = recast;
  if (spk) salvaged.speak_text = spk;
  if (spkLang) salvaged.speak_lang = spkLang;
  if (salvaged.reply || Array.isArray(salvaged.actions)) {
    return salvaged;
  }
  return null;
}

function extractJsonObject(raw: string): Record<string, any> | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = candidate.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch {
      try {
        const repaired = slice
          .replace(/,\s*([}\]])/g, "$1")
          .replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (m) => m.replace(/\r?\n/g, "\\n"));
        return JSON.parse(repaired);
      } catch {
        // 交由截断 JSON 自动闭合与字段抢救器处理
      }
    }
  }
  return repairTruncatedJson(candidate);
}

function parseSuggestedReplies(raw: any): AgentSuggestedReply[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentSuggestedReply[] = [];
  for (const item of raw.slice(0, 3)) {
    if (typeof item === "string" && item.trim()) {
      const s = item.trim().slice(0, 60);
      out.push({ label: s, prompt: s });
    } else if (item && typeof item === "object") {
      const label = String(item.label || item.text || item.prompt || "").trim().slice(0, 48);
      const prompt = String(item.prompt || item.text || item.label || "").trim().slice(0, 120);
      const zhHint = String(item.zh_hint || item.zhHint || item.zh || "").trim().slice(0, 36);
      if (label && prompt) {
        out.push({ label, prompt, zhHint: zhHint || undefined });
      }
    }
  }
  return out;
}

function parseAgentResponse(raw: string, fallbackLang = "en"): ParsedAgentPayload {
  const obj = extractJsonObject(raw);
  if (obj && (typeof obj.reply === "string" || Array.isArray(obj.actions) || obj.correction || obj.user_recast)) {
    const actions: RawToolCall[] = Array.isArray(obj.actions)
      ? obj.actions
          .filter((a: any) => a && typeof a.tool === "string")
          .map((a: any) => ({ tool: String(a.tool).trim(), args: a.args && typeof a.args === "object" ? a.args : {} }))
      : [];
    let correction: AgentCorrection | null = null;
    if (obj.correction && typeof obj.correction === "object" && obj.correction.improved) {
      correction = {
        original: String(obj.correction.original || "").trim(),
        improved: String(obj.correction.improved || "").trim(),
        lang: String(obj.correction.lang || fallbackLang || "en").trim().toLowerCase(),
        reason: String(obj.correction.reason || "").trim(),
        focus_chunk: String(obj.correction.focus_chunk || "").trim(),
      };
    }
    const recastRaw = obj.user_recast ?? obj.question_recast ?? obj.recast_question ?? "";
    const replyZhRaw = obj.reply_zh ?? obj.chinese_translation ?? obj.translation_zh ?? "";
    const suggested = parseSuggestedReplies(obj.suggested_replies ?? obj.quick_replies ?? obj.next_steps);
    return {
      actions,
      need_followup: Boolean(obj.need_followup),
      user_recast: typeof recastRaw === "string" ? recastRaw.trim() : "",
      correction,
      reply: String(obj.reply || "").trim(),
      reply_zh: typeof replyZhRaw === "string" ? replyZhRaw.trim() : "",
      speak_text: obj.speak_text ? String(obj.speak_text).trim() : "",
      speak_lang: String(obj.speak_lang || fallbackLang || "en").trim().toLowerCase(),
      suggested_replies: suggested,
    };
  }
  return {
    actions: [],
    need_followup: false,
    user_recast: "",
    correction: null,
    reply: raw.trim(),
    reply_zh: "",
    suggested_replies: [],
  };
}

/** 组装实时 App 上下文 + 长期学习记忆 + 最近剧集与薄弱卡画像，让 AI 真正认识并记住用户 */
async function buildLiveContextSummary(extraContext?: string): Promise<string> {
  const appCtrl = echoAgentBridge.getApp();
  const cinemaCtrl = echoAgentBridge.getCinema();
  const reviewCtrl = echoAgentBridge.getReview();

  const tab = appCtrl?.getActiveTab() || "review";
  const theme = appCtrl?.getTheme() || "light";
  const habit = getDailyHabitStats();
  const stats = await getAppStats();
  const activeVoice = getVoicePresetById(getSelectedVoiceId());
  const voiceGender = getVoiceGenderPref();

  const activeLang = echoAgentBridge.getActiveStudyLang();
  const activeMeta = getStudyLangMeta(activeLang);

  const lines: string[] = [
    `当前学习目标语种: ${activeMeta.flag} ${activeMeta.label} (${activeMeta.code})`,
    `当前页面Tab: ${tab} (review=今日复习, lexicon=词库, studio=在线影厅与精听, ingest=导入, sync=粤语工具与私教设置)`,
    `外观与音色: theme=${theme}, 当前朗读音色=${activeVoice.shortName}(${activeVoice.id}/${voiceGender})`,
    `学习统计: 总词卡=${stats.totalCards}, 今日待复习=${stats.dueCards}, 今日已复习=${stats.reviewedToday}, 今日过词=${habit.todayPassedWords}/${habit.dailyWordGoal}, 影厅精听=${habit.todayCinemaMinutes || 0}分钟, 今日影厅挖句=${habit.todayMinedLines || 0}, 连续打卡=${habit.streakDays}天`,
    `【用户长期记忆档案】:\n${buildLearnerMemoryPromptBlock()}`,
  ];

  // 自动注入用户最近追过的 3 部剧
  try {
    const recentShows = getWatchHistory().slice(0, 3);
    if (recentShows.length > 0) {
      lines.push(
        `【最近在追的剧】: ${recentShows.map((s) => `《${s.title}》(${s.episodeName || ""})`).join("、")}`
      );
    }
  } catch {
    // ignore
  }

  // 自动注入当前最需要复习的 4 张待复习/易错卡片（让 AI 无需等用户提醒就能主动结合复习）
  try {
    const allCards = (await listCardsLocal()).filter((c) => !c.language || c.language === activeLang);
    const nowIso = new Date().toISOString();
    const dueOrWeak = allCards
      .filter((c) => c.due_at <= nowIso || (c.lapses || 0) > 0)
      .slice(0, 4);
    const pick = dueOrWeak.length > 0 ? dueOrWeak : allCards.slice(0, 3);
    if (pick.length > 0) {
      lines.push(
        `【用户近期重点词卡】: ${pick
          .map((c) => `"${c.front_text.slice(0, 46)}"(${c.focus_chunk || c.translation.slice(0, 18)})`)
          .join(" | ")}`
      );
    }
  } catch {
    // ignore
  }

  // 自动注入用户最近收藏的 6 个生词
  try {
    const marks = await getWordMarksMap(activeLang);
    const favIds = Object.values(marks)
      .filter((m) => m.status === "favorite")
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 6)
      .map((m) => m.wordId.replace(/^[a-z]+:/, ""));
    if (favIds.length > 0) {
      lines.push(`【最近收藏生词】: ${favIds.join(", ")}`);
    }
  } catch {
    // ignore
  }

  if (cinemaCtrl) {
    const snap = cinemaCtrl.getSnapshot();
    if (snap.isPlayerOpen) {
      lines.push(
        `【在线影厅正在播放】: 剧名=《${snap.showTitle}》, 集数=${snap.episodeName}, 当前进度=${Math.floor(snap.currentTimeSec)}秒/${Math.floor(snap.durationSec)}秒, 语种=${snap.language === "yue" ? "香港粤语" : "英语"}, 播放中=${snap.playing}, 倍速=${snap.speed}x, 盲听遮字幕帘=${snap.curtainLevel}(0关/1中/2高), 区间循环=${snap.loopActive}, 本剧已挖卡=${snap.minedCount}张, 总集数=${snap.episodeCount}`
      );
    } else {
      lines.push("【在线影厅状态】: 位于影厅大厅，未打开具体影片");
    }
  }

  if (reviewCtrl) {
    const r = reviewCtrl.getSnapshot();
    if (r.currentCard) {
      lines.push(
        `【当前复习卡片】: id=${r.currentCard.id}, 原句="${r.currentCard.front_text}", 译文="${r.currentCard.translation}", 词块="${r.currentCard.focus_chunk}", 语种=${r.currentCard.language}, 盲听=${r.blindMode}, 已翻面=${r.revealed}`
      );
    } else {
      lines.push(`【复习舱状态】: 今日待复习=${r.dueCount}, 总卡=${r.totalCount}`);
    }
  }

  if (extraContext?.trim()) {
    lines.push(`补充场景: ${extraContext.trim()}`);
  }

  return lines.join("\n");
}

/** 执行单个 App 全权限工具，返回结构化回执 + 给 AI 二轮思考用的真实观测数据 + 可选直达播片卡片 */
async function executeTool(
  call: RawToolCall,
  originalUserInput?: string
): Promise<{
  receipt: AgentActionReceipt;
  observation: string;
  vodCards?: AgentVodHitCard[];
}> {
  const args = call.args || {};
  const tool = call.tool;

  try {
    switch (tool) {
      case "search_online_cinema": {
        const rawQ = String(args.query || args.title || args.keyword || args.show_name || args.name || "").trim();
        if (!rawQ && !originalUserInput) throw new Error("缺少影片名称 query");
        const { effectiveQuery, hits } = await searchOnlineCinemaMultiSource(rawQ, originalUserInput);
        const autoPlay = Boolean(args.auto_play);
        // 若用户明确要求「直接打开/立即播」，帮他秒切影厅开播第一条最匹配片源
        if (autoPlay && hits.length > 0) {
          const top = hits[0];
          echoAgentBridge.getApp()?.jumpToVodRef({
            sourceKey: top.sourceKey,
            sourceApi: top.sourceApi,
            vodId: top.vodId,
            title: top.title,
            routeName: "",
            episodeName: "",
            timeSec: 0,
          });
        } else {
          const cinema = echoAgentBridge.getCinema();
          if (cinema && !cinema.getSnapshot().isPlayerOpen) {
            cinema.control({ type: "search_show", query: effectiveQuery || rawQ }).catch(() => undefined);
          }
        }
        return {
          receipt: {
            tool,
            ok: hits.length > 0,
            label:
              hits.length > 0
                ? autoPlay
                  ? `已找到并直达开播《${hits[0].title}》（共 ${hits.length} 源）`
                  : `在线影厅搜到 ${hits.length} 部《${effectiveQuery}》片源`
                : `在线影厅暂未收录《${effectiveQuery || rawQ}》`,
            detail: hits.slice(0, 2).map((h) => h.title).join(" / ") || "可换简化中文片名再搜",
          },
          observation: JSON.stringify({
            requested_query: rawQ,
            effective_query: effectiveQuery,
            auto_played: autoPlay && hits.length > 0,
            total_found: hits.length,
            shows: hits.map((h) => ({
              title: h.title,
              remarks: h.remarks,
              type: h.typeName,
              source: h.sourceName,
            })),
            ui_note:
              hits.length > 0
                ? "Clickable Play cards are ALREADY displayed directly below your reply! Tell the user which titles were found and invite them to tap the Play button right below."
                : "No matching stream found across 4 Chinese VOD sources right now. Tell the user clearly and suggest a shorter or alternate title.",
          }),
          vodCards: hits,
        };
      }

      case "batch_create_review_cards": {
        const rawCards = Array.isArray(args.cards) ? args.cards.slice(0, 6) : [];
        if (rawCards.length === 0) throw new Error("缺少 cards 数组");
        const createdTitles: string[] = [];
        const defaultLang = echoAgentBridge.getActiveStudyLang() || "en";
        for (const item of rawCards) {
          const front = String(item?.front_text || item?.sentence || item?.text || "").trim();
          if (!front) continue;
          const lang = String(item?.language || item?.lang || defaultLang).trim().toLowerCase();
          await createCardLocal({
            front_text: front,
            translation: String(item?.translation || item?.zh || "").trim(),
            jyutping: lang === "yue" ? annotateJyutpingOffline(front).jyutping : "",
            focus_chunk: String(item?.focus_chunk || item?.chunk || "").trim(),
            note: String(item?.note || "").trim(),
            language: lang,
            tags: ["AI批量生成", getStudyLangMeta(lang).label],
          });
          createdTitles.push(front.slice(0, 36));
        }
        if (createdTitles.length === 0) throw new Error("有效卡片为空");
        recordDailyActivity("review");
        echoAgentBridge.notifyDataChanged();
        return {
          receipt: {
            tool,
            ok: true,
            label: `已批量存入 ${createdTitles.length} 张复习卡`,
            detail: createdTitles.slice(0, 2).join(" / "),
          },
          observation: JSON.stringify({ saved_count: createdTitles.length, cards: createdTitles }),
        };
      }

      case "save_learner_memory": {
        const text = String(args.text || args.fact || args.memory || "").trim();
        if (!text) throw new Error("缺少要记住的内容 text");
        const validCats: LearnerMemoryItem["category"][] = ["goal", "level", "interest", "weakness", "preference"];
        const cat = validCats.includes(args.category) ? (args.category as LearnerMemoryItem["category"]) : "preference";
        const saved = addLearnerMemory(text, cat);
        return {
          receipt: { tool, ok: true, label: `🧠 已长期记住：${saved.text}` },
          observation: JSON.stringify(saved),
        };
      }

      case "delete_learner_memory": {
        const kw = String(args.keyword || args.id || args.text || "").trim();
        const removed = removeLearnerMemory(kw);
        return {
          receipt: { tool, ok: removed, label: removed ? `🧠 已遗忘记忆「${kw}」` : `未找到匹配记忆「${kw}」` },
          observation: removed ? "deleted" : "not_found",
        };
      }

      case "capture_and_save_cinema_line": {
        const cinema = echoAgentBridge.getCinema();
        if (!cinema || !cinema.getSnapshot().isPlayerOpen) {
          return {
            receipt: { tool, ok: false, label: "当前未打开在线影厅视频" },
            observation: "未在播放具体在线视频，请先让用户打开某部剧或直接用 create_review_card 收藏用户说出的句子。",
          };
        }
        const hintRaw = args.hint_text || args.front_text || args.sentence || args.text;
        const res = await cinema.captureAndSaveCurrentLine(
          hintRaw ? String(hintRaw) : undefined
        );
        echoAgentBridge.notifyDataChanged();
        return {
          receipt: {
            tool,
            ok: res.ok,
            label: res.ok ? `已收藏影厅画面台词进「今日复习」` : "截屏识词未成功",
            detail: res.card?.front_text || res.message,
          },
          observation: JSON.stringify({ ok: res.ok, message: res.message, card: res.card ? { id: res.card.id, front_text: res.card.front_text, translation: res.card.translation, focus_chunk: res.card.focus_chunk } : null }),
        };
      }

      case "control_cinema_player": {
        const cinema = echoAgentBridge.getCinema();
        const action = String(args.action || "").trim();
        const searchCandidate = String(args.query || args.title || args.keyword || args.show_name || "").trim();
        // 无论当前是否在播放视频，只要是搜片意图直接转交跨源在线影厅搜片并出可点播卡片！
        if (action === "search_show" || (!action && searchCandidate)) {
          return executeTool({ tool: "search_online_cinema", args: { query: searchCandidate } }, originalUserInput);
        }

        if (!cinema || !cinema.getSnapshot().isPlayerOpen) {
          if (searchCandidate) {
            return executeTool({ tool: "search_online_cinema", args: { query: searchCandidate } }, originalUserInput);
          }
          return {
            receipt: { tool, ok: false, label: "当前没有正在播放的影厅视频" },
            observation: "当前未打开视频播放页。如果用户想找剧/搜片，请改用 search_online_cinema 工具！",
          };
        }

        let msg = "";
        if (action === "play") msg = await cinema.control({ type: "play" });
        else if (action === "pause") msg = await cinema.control({ type: "pause" });
        else if (action === "seek_delta") msg = await cinema.control({ type: "seek_delta", deltaSec: Number(args.delta_sec ?? -5) });
        else if (action === "seek_to") msg = await cinema.control({ type: "seek_to", sec: Number(args.sec ?? 0) });
        else if (action === "loop_last_5s") msg = await cinema.control({ type: "loop_last_5s" });
        else if (action === "clear_loop") msg = await cinema.control({ type: "clear_loop" });
        else if (action === "set_speed") msg = await cinema.control({ type: "set_speed", speed: Number(args.speed ?? 0.8) });
        else if (action === "set_curtain") msg = await cinema.control({ type: "set_curtain", level: Math.max(0, Math.min(2, Number(args.level ?? 1))) as 0 | 1 | 2 });
        else if (action === "auto_english_sub") msg = await cinema.control({ type: "auto_english_sub", manualEnQuery: args.query ? String(args.query) : undefined });
        else if (action === "set_ad_guard") msg = await cinema.control({ type: "set_ad_guard", adFilter: typeof args.ad_filter === "boolean" ? args.ad_filter : true, bannerMask: typeof args.banner_mask === "boolean" ? args.banner_mask : true });
        else if (action === "switch_episode") msg = await cinema.control({ type: "switch_episode", episodeNumber: Number(args.episode ?? 1) });
        else throw new Error(`未知播放指令: ${action}`);

        return {
          receipt: { tool, ok: true, label: `影厅操控：${msg}` },
          observation: msg,
        };
      }

      case "create_review_card": {
        const front = String(args.front_text || args.sentence || "").trim();
        if (!front) throw new Error("缺少 front_text 原句");
        const lang = String(args.language || args.lang || echoAgentBridge.getActiveStudyLang() || "en").trim().toLowerCase();
        const translation = String(args.translation || "").trim();
        const focusChunk = String(args.focus_chunk || "").trim();
        const note = String(args.note || "").trim();
        const tags: string[] = Array.isArray(args.tags) && args.tags.length > 0
          ? args.tags.map((t: any) => String(t).trim()).filter(Boolean)
          : ["AI助教收藏", lang === "yue" ? "港剧粤语" : getStudyLangMeta(lang).label];

        // 如果此刻正在看在线影厅，自动抓取剧照 + 原片时间点锚点 vod_ref！
        let imagePath = "";
        let vodRef = undefined;
        let cinemaNoteSuffix = "";
        const cinema = echoAgentBridge.getCinema();
        if (cinema && cinema.getSnapshot().isPlayerOpen) {
          const captured = await cinema.captureCurrentFrameAndVodRef().catch(() => null);
          if (captured) {
            imagePath = captured.imagePath;
            vodRef = captured.vodRef;
            if (!tags.includes("在线影院")) tags.unshift("在线影院");
            cinemaNoteSuffix = `来自在线影厅：${captured.activeTitle} @ ${Math.floor(captured.timeSec / 60)}:${String(Math.floor(captured.timeSec % 60)).padStart(2, "0")}`;
          }
        }

        const card = await createCardLocal({
          front_text: front,
          translation,
          jyutping: lang === "yue" ? annotateJyutpingOffline(front).jyutping : "",
          focus_chunk: focusChunk,
          note: [note, cinemaNoteSuffix].filter(Boolean).join("\n"),
          language: lang,
          tags,
          image_path: imagePath,
          vod_ref: vodRef,
        });
        recordDailyActivity(vodRef ? "cinema_line" : "review");
        echoAgentBridge.notifyDataChanged();

        return {
          receipt: {
            tool,
            ok: true,
            label: `已新建复习词卡${vodRef ? "（含剧照与原片定位）" : ""}`,
            detail: card.front_text,
          },
          observation: JSON.stringify({ id: card.id, front_text: card.front_text, translation: card.translation, has_vod_ref: Boolean(vodRef) }),
        };
      }

      case "list_review_cards": {
        const all = await listCardsLocal();
        const q = String(args.query || "").trim().toLowerCase();
        const lang = String(args.language || args.lang || "").trim();
        const dueOnly = Boolean(args.due_only);
        const limit = Math.max(1, Math.min(15, Number(args.limit || 8)));
        const nowIso = new Date().toISOString();

        const matched = all
          .filter((c) => {
            if (dueOnly && c.due_at > nowIso) return false;
            if (lang && c.language !== lang) return false;
            if (q) {
              const hay = `${c.front_text} ${c.translation} ${c.focus_chunk} ${c.note} ${(c.tags || []).join(" ")}`.toLowerCase();
              return hay.includes(q);
            }
            return true;
          })
          .slice(0, limit);

        return {
          receipt: { tool, ok: true, label: `查阅词卡库（命中 ${matched.length} 张）` },
          observation: JSON.stringify(
            matched.map((c) => ({
              id: c.id,
              front_text: c.front_text,
              translation: c.translation,
              focus_chunk: c.focus_chunk,
              language: c.language,
              tags: c.tags,
              note: c.note.slice(0, 80),
              has_vod_ref: Boolean(c.vod_ref),
            }))
          ),
        };
      }

      case "update_review_card": {
        let cardId = String(args.card_id || "").trim();
        if (!cardId) {
          cardId = echoAgentBridge.getReview()?.getSnapshot().currentCard?.id || "";
        }
        if (!cardId) {
          const all = await listCardsLocal();
          cardId = all[all.length - 1]?.id || "";
        }
        if (!cardId) throw new Error("未找到要更新的词卡");
        const patch: Partial<CardItem> = {};
        if (args.front_text) patch.front_text = String(args.front_text).trim();
        if (args.translation) patch.translation = String(args.translation).trim();
        if (args.focus_chunk) patch.focus_chunk = String(args.focus_chunk).trim();
        if (args.note) patch.note = String(args.note).trim();
        if (Array.isArray(args.tags)) patch.tags = args.tags.map(String);

        const updated = await updateCardLocal(cardId, patch);
        echoAgentBridge.notifyDataChanged();
        return {
          receipt: { tool, ok: true, label: "已更新词卡内容", detail: updated.front_text },
          observation: JSON.stringify({ id: updated.id, front_text: updated.front_text, note: updated.note.slice(0, 100) }),
        };
      }

      case "delete_review_card": {
        const cardId = String(args.card_id || "").trim();
        if (!cardId) throw new Error("需要提供 card_id");
        const all = await listCardsLocal();
        const target = all.find((c) => c.id === cardId);
        await deleteCardLocal(cardId);
        echoAgentBridge.notifyDataChanged();
        return {
          receipt: { tool, ok: true, label: "已删除指定词卡", detail: target?.front_text || cardId },
          observation: `deleted ${cardId}`,
        };
      }

      case "rate_current_review_card": {
        const review = echoAgentBridge.getReview();
        if (!review || !review.getSnapshot().currentCard) {
          return {
            receipt: { tool, ok: false, label: "当前不在复习卡片界面" },
            observation: "当前无正在复习的卡片。",
          };
        }
        const rating = Math.max(1, Math.min(4, Math.round(Number(args.rating || 3)))) as 1 | 2 | 3 | 4;
        const msg = await review.rateCurrent(rating);
        echoAgentBridge.notifyDataChanged();
        return {
          receipt: { tool, ok: true, label: msg },
          observation: msg,
        };
      }

      case "search_lexicon": {
        const q = String(args.query || args.word || "").trim();
        const lang = args.lang === "yue" ? "yue" : args.lang === "en" ? "en" : undefined;
        if (!q) throw new Error("缺少查词关键词");

        const exact = await lookupWordOffline(q, lang);
        const results = exact ? [exact] : [];
        if (results.length < 4) {
          const targetLang = lang || (/[\u4e00-\u9fff]/.test(q) ? "yue" : "en");
          const list = await loadLexiconForLanguage(targetLang);
          const low = q.toLowerCase();
          for (const entry of list) {
            if (results.some((r) => r.id === entry.id)) continue;
            if (
              entry.word.toLowerCase().includes(low) ||
              (entry.alt && entry.alt.includes(q)) ||
              entry.meaning.toLowerCase().includes(low)
            ) {
              results.push(entry);
              if (results.length >= 5) break;
            }
          }
        }
        return {
          receipt: { tool, ok: true, label: `查 5 万词库「${q}」（找到 ${results.length} 条）` },
          observation: JSON.stringify(
            results.map((r) => ({
              id: r.id,
              word: r.word,
              phonetic: r.phonetic,
              meaning: r.meaning,
              lang: r.lang,
              examples: (r.examples || []).slice(0, 2),
            }))
          ),
        };
      }

      case "mark_lexicon_word": {
        const word = String(args.word || "").trim();
        if (!word) throw new Error("缺少单词 word");
        const lang = args.lang === "yue" || /[\u4e00-\u9fff]/.test(word) ? "yue" : String(args.lang || "en");
        const status = (args.status === "passed" || args.status === "none" ? args.status : "favorite") as
          | "favorite"
          | "passed"
          | "none";

        let entry = await lookupWordOffline(word, lang);
        if (!entry) {
          // 离线词库未收录则自动建入自定义词库再标记，永不落空！
          entry = await addCustomWord({
            word,
            phonetic: String(args.phonetic || "").trim(),
            meaning: String(args.meaning || "AI 助教收录词汇").trim(),
            lang,
            tags: ["AI收录"],
            exampleText: String(args.example || "").trim(),
            exampleTrans: String(args.example_zh || "").trim(),
          });
        }
        await setWordMark(entry.id, entry.lang, status);
        echoAgentBridge.notifyDataChanged();

        const statusLabel = status === "favorite" ? "⭐ 已收藏进词库" : status === "passed" ? "✅ 已标为掌握(过词)" : "已取消标记";
        return {
          receipt: { tool, ok: true, label: `${statusLabel}「${entry.word}」`, detail: entry.meaning },
          observation: JSON.stringify({ id: entry.id, word: entry.word, meaning: entry.meaning, status }),
        };
      }

      case "add_word_sentence": {
        const word = String(args.word || "").trim();
        const sentence = String(args.sentence || "").trim();
        if (!word || !sentence) throw new Error("缺少 word 或 sentence");
        const lang = args.lang === "yue" || /[\u4e00-\u9fff]/.test(word) ? "yue" : String(args.lang || "en");
        let entry = await lookupWordOffline(word, lang);
        if (!entry) {
          entry = await addCustomWord({
            word,
            meaning: String(args.meaning || "AI 助教造句词").trim(),
            lang,
            tags: ["AI收录"],
          });
        }
        await saveUserSentence({
          wordId: entry.id,
          lang: entry.lang,
          sentence,
          translation: String(args.translation || "").trim(),
          aiFeedback: String(args.feedback || "AI 助教收录地道例句").trim(),
        });
        echoAgentBridge.notifyDataChanged();
        return {
          receipt: { tool, ok: true, label: `已写入「${entry.word}」个人造句本`, detail: sentence },
          observation: JSON.stringify({ word: entry.word, sentence }),
        };
      }

      case "list_favorite_words": {
        const lang = args.lang === "yue" ? "yue" : "en";
        const limit = Math.max(1, Math.min(20, Number(args.limit || 10)));
        const [words, marks] = await Promise.all([loadLexiconForLanguage(lang), getWordMarksMap(lang)]);
        const favs = words.filter((w) => marks.get(w.id) === "favorite").slice(0, limit);
        return {
          receipt: { tool, ok: true, label: `读取${lang === "yue" ? "粤语" : "英语"}收藏词（${favs.length} 个）` },
          observation: JSON.stringify(
            favs.map((f) => ({ word: f.word, phonetic: f.phonetic, meaning: f.meaning }))
          ),
        };
      }

      case "search_media_subtitles": {
        const word = String(args.word || args.query || "").trim();
        if (!word) throw new Error("缺少 word");
        const hits = await findSubtitlesContainingWord(word, undefined, args.lang);
        // 防误路由兜底：若用户搜的是中文电影/剧名且本地字幕 0 命中，自动改搜在线影厅直连片库！
        if (hits.length === 0 && /[\u4e00-\u9fff]{2,}/.test(word)) {
          return executeTool({ tool: "search_online_cinema", args: { query: word } }, originalUserInput);
        }
        return {
          receipt: { tool, ok: true, label: `反查本地字幕「${word}」（${hits.length} 句）` },
          observation: JSON.stringify(hits.slice(0, 6)),
        };
      }

      case "speak_aloud": {
        const text = String(args.text || "").trim();
        if (!text) throw new Error("缺少朗读内容 text");
        const lang = String(args.lang || echoAgentBridge.getActiveStudyLang() || "en").trim().toLowerCase();
        const rate = Math.max(0.6, Math.min(1.4, Number(args.rate || 0.95)));
        await speakOffline(text, lang, rate);
        return {
          receipt: { tool, ok: true, label: `微软真人朗读（${getStudyLangMeta(lang).shortLabel} ${rate}x）`, detail: text },
          observation: `spoken: ${text}`,
        };
      }

      case "generate_show_vocab_pack": {
        const cinema = echoAgentBridge.getCinema();
        if (!cinema || !cinema.getSnapshot().isPlayerOpen) {
          return {
            receipt: { tool, ok: false, label: "请先在在线影厅打开一部剧集" },
            observation: "当前未打开剧集。",
          };
        }
        const msg = await cinema.generatePrepPack();
        return {
          receipt: { tool, ok: true, label: msg },
          observation: msg,
        };
      }

      case "get_study_stats": {
        const habit = getDailyHabitStats();
        const stats = await getAppStats();
        return {
          receipt: { tool, ok: true, label: "已读取今日学习档案与统计" },
          observation: JSON.stringify({ habit, stats }),
        };
      }

      case "update_daily_goals": {
        const cur = getDailyHabitStats();
        const nextWordGoal = args.word_goal ? Number(args.word_goal) : cur.dailyWordGoal;
        const nextReviewGoal = args.review_goal ? Number(args.review_goal) : cur.dailyReviewGoal;
        const updated = updateDailyGoals(nextWordGoal, nextReviewGoal);
        echoAgentBridge.notifyDataChanged();
        return {
          receipt: {
            tool,
            ok: true,
            label: `已更新每日目标：过词 ${updated.dailyWordGoal} / 复习 ${updated.dailyReviewGoal}`,
          },
          observation: JSON.stringify(updated),
        };
      }

      case "navigate_app": {
        const tab = String(args.tab || "review") as TabKey;
        const validTabs: TabKey[] = ["review", "lexicon", "studio", "ingest", "sync"];
        const safeTab = validTabs.includes(tab) ? tab : "review";
        const sub = args.sub_tab as "cantonese" | "coach" | "settings" | undefined;
        echoAgentBridge.getApp()?.navigate(safeTab, sub);
        const names: Record<TabKey, string> = {
          review: "今日复习",
          lexicon: "多语种词库",
          studio: "在线精听影院",
          ingest: "导入素材",
          sync: "粤语与工具设置",
        };
        return {
          receipt: { tool, ok: true, label: `已为你跳转到「${names[safeTab]}」` },
          observation: `navigated to ${safeTab}`,
        };
      }

      case "update_app_settings": {
        const changes: string[] = [];
        if (args.theme === "dark" || args.theme === "light") {
          echoAgentBridge.getApp()?.setTheme(args.theme);
          changes.push(args.theme === "dark" ? "深色模式" : "浅色模式");
        }
        if (args.voice_id) {
          const vp = getVoicePresetById(String(args.voice_id).trim());
          setSelectedVoiceId(vp.id);
          changes.push(`AI 音色=${vp.shortName}`);
        } else if (args.voice_gender === "female" || args.voice_gender === "male") {
          setVoiceGenderPref(args.voice_gender);
          changes.push(args.voice_gender === "male" ? "微软真人男声" : "微软真人女声");
        }
        if (args.zhipu_model) {
          const s = await getSettingsLocal();
          await saveSettingsLocal({ ...s, zhipu_model: String(args.zhipu_model) });
          changes.push(`智谱模型=${args.zhipu_model}`);
        }
        if (args.study_lang) {
          const nextLang = String(args.study_lang).trim().toLowerCase();
          echoAgentBridge.setActiveStudyLang(nextLang);
          changes.push(`当前学习语种=${getStudyLangMeta(nextLang).label}`);
        }
        echoAgentBridge.notifyDataChanged();
        return {
          receipt: { tool, ok: true, label: `已调整设置：${changes.join("、") || "无变更"}` },
          observation: changes.join(", "),
        };
      }

      default:
        return {
          receipt: { tool, ok: false, label: `未识别工具: ${tool}` },
          observation: `unknown tool ${tool}`,
        };
    }
  } catch (e: any) {
    return {
      receipt: { tool, ok: false, label: `${tool} 执行失败`, detail: e?.message || "未知错误" },
      observation: `error: ${e?.message || "failed"}`,
    };
  }
}

function buildImmersionSystemPrompt(targetLang: string, userUsedChinese: boolean): string {
  const meta = getStudyLangMeta(targetLang);
  const exampleByLang =
    meta.code === "yue"
      ? `用户用普通话问："这句好地道，帮我收藏一下，顺便把速度调到 0.8 倍"
输出：
{"actions":[{"tool":"capture_and_save_cinema_line","args":{}},{"tool":"control_cinema_player","args":{"action":"set_speed","speed":0.8}}],"need_followup":false,"user_recast":"呢句好地道呀，幫我收藏咗佢，順便將倍速調慢到 0.8 倍得唔得？","correction":null,"reply":"搞掂晒！已經幫你截圖收藏咗呢句對白去「今日複習」，仲將播放速度調慢咗去 0.8x，而家聽落會清好多㗎！","reply_zh":"搞定啦！已经帮你截图把这句台词收藏进「今日复习」，还把播放速度调慢到了 0.8x，现在听起来会清楚很多！","speak_text":"搞掂晒！已經幫你收藏咗呢句對白，仲調慢咗去 0.8x。","speak_lang":"yue"}`
      : `用户用中文问："这句好地道，帮我收藏一下，顺便把速度调到 0.8 倍"
输出：
{"actions":[{"tool":"capture_and_save_cinema_line","args":{}},{"tool":"control_cinema_player","args":{"action":"set_speed","speed":0.8}}],"need_followup":false,"user_recast":"This line sounds so natural! Could you save it for me and slow the speed down to 0.8x?","correction":null,"reply":"All set! I've saved that line along with the frame screenshot to your review deck and slowed the video down to 0.8x so you can catch every word.","reply_zh":"搞定！我已经帮你把这句台词连同剧照存进「今日复习」，并把视频调慢到了 0.8 倍速方便你听清每个词。","speak_text":"All set! I've saved that line to your review deck and slowed it down to 0.8x.","speak_lang":"${meta.code}"}`;

  return `你是 EchoDeck（回声舱）App 的「沉浸式全权限 AI 语言私教」。你拥有这个 App 的全部 18 项真实操作权限，同时必须严格执行「全目标语沉浸教学法则」！

【当前用户正在学习的语种】：${meta.flag} ${meta.label}（code="${meta.code}" -> ${meta.nativePromptName}）

【你的 4 条核心铁律（必须 100% 遵守）】
1. **严格使用当前学习语种回答（reply 字段）**：
   - \`"reply"\` 必须 **100% 用 ${meta.label}（${meta.nativePromptName}）** 自然口语回复！绝不在 \`"reply"\` 里偷懒写普通话中文（除非在解释极个别中文专有名词或 App 按钮名）。
   - 同时必须在 \`"reply_zh"\` 字段里提供 \`"reply"\` 的**完整、自然、口语化的简体中文翻译**（方便用户看不懂时点击气泡一键看中文译文）。
2. **中文提问先复述成地道目标语（user_recast 字段）**：
   - ${userUsedChinese ? `本轮用户使用了中文提问，你**必须**先在 \`"user_recast"\` 字段里把用户这句话转换成母语者最自然、地道的 **${meta.label}** 复述出来！` : `只要用户本轮发言包含中文（或普通话），你必须先在 \`"user_recast"\` 字段里将用户的问题/需求转换成母语者最自然地道的 **${meta.label}** 复述出来；如果用户已经纯用 ${meta.label} 表达，则 \`"user_recast"\` 留空字符串 \`""\`。`}
3. **主动纠正外语表达（correction 字段）**：
   - 只要用户的消息包含英文/粤语/当前目标语表达且存在中式腔、语法小错或更地道说法，请在 \`"correction"\` 字段里给出母语者升级版（\`reason\` 用简短简体中文点评）；若没有可纠内容则 \`"correction": null\`。
4. **能执行就直接调用工具执行，且绝不编造「请稍等 / Hold on」假等待！**
   - 所有工具都会在你生成最终回复**之前**同步执行完毕。**严禁**回复 \`"Please hold on"\`, \`"Wait a moment"\`, \`"I am searching..."\`, \`"请稍等"\` —— 你必须直接基于工具真实返回的结果作答！
   - 当用户要**找电影、找美剧、找港剧、搜片**（如「帮我找找生化危机」「搜新闻女王」）时，**必须调用 \`search_online_cinema\`**（绝不要调用 \`search_media_subtitles\`！）。

【严格只输出一个合法 JSON 对象】（不要在 JSON 外面加额外解释文字）：
{
  "actions": [
    { "tool": "工具名", "args": { ... } }
  ],
  "need_followup": false,
  "user_recast": "若用户用中文提问，先帮他转换成自然地道的${meta.label}复述；否则留空字符串",
  "correction": null 或 {
    "original": "用户原句",
    "improved": "母语者最地道升级版",
    "lang": "${meta.code}",
    "reason": "60字内简体中文指出问题与亮点",
    "focus_chunk": "最值得背的1个核心词块"
  },
  "reply": "100% 使用地道 ${meta.label} 给用户的自然回复（像聪明主动的私人教练，结合记忆/进度给出真建议或追问，180词/字内）",
  "reply_zh": "上述 reply 的完整自然简体中文翻译（必填，用于点击气泡展开对照！）",
  "speak_text": "从 reply 中挑最核心的 1~2 句地道 ${meta.label}（供真人语音朗读）",
  "speak_lang": "${meta.code}",
  "suggested_replies": [
    { "label": "简短快捷选项1（如口语回复句或下一步操作）", "prompt": "点下后发送给你的完整消息", "zh_hint": "可选10字内中文提示" },
    { "label": "简短快捷选项2", "prompt": "点下后发送给你的完整消息", "zh_hint": "可选10字内中文提示" }
  ]
}

【你的 22 项 App 全权限与智能记忆工具清单】
- search_online_cinema: { "query": "严格保留中文片名，如 生化危机 / 新闻女王 / 老友记（绝不要翻成英文！）", "auto_play": false } -> **找剧/找电影/搜在线片源唯一专用工具！**（用户说「直接打开/播放」时把 auto_play 设 true；务必设 need_followup: true）
- save_learner_memory: { "text": "简洁中文记住用户的水平/兴趣/常犯错/偏好", "category": "goal"|"level"|"interest"|"weakness"|"preference" } -> **长期记忆工具！**用户提到偏好/水平/目标或反复犯同一错误时主动记住
- delete_learner_memory: { "keyword": "要删掉的记忆关键词" } -> 删除某条长期记忆
- batch_create_review_cards: { "cards": [{ "front_text": "地道原句", "translation": "中文", "focus_chunk": "词块", "note": "简评", "language": "${meta.code}" }] } -> 一次性批量生成并存入 2~6 张复习卡！
- capture_and_save_cinema_line: {} 或 { "hint_text": "可选台词提示" } -> 仅当正在播放影厅视频且用户只说「收藏画面里这句」时调用，自动截帧走视觉AI识别字幕并存卡！
- control_cinema_player: { "action": "play"|"pause"|"seek_delta"|"seek_to"|"loop_last_5s"|"clear_loop"|"set_speed"|"set_curtain"|"auto_english_sub"|"set_ad_guard"|"switch_episode", "delta_sec": -5, "sec": 120, "speed": 0.75, "level": 1, "ad_filter": true, "banner_mask": true, "episode": 2, "query": "Friends" } -> 仅用于操控正在播放的影厅视频！
- create_review_card: { "front_text": "原句", "translation": "中文", "focus_chunk": "核心词块", "note": "讲解笔记", "language": "${meta.code}", "tags": ["标签"] } -> 单句存卡
- list_review_cards: { "query": "关键词可选", "language": "${meta.code}"|"", "due_only": false, "limit": 8 } -> 查用户词卡库（读工具）
- update_review_card: { "card_id": "可选", "note": "...", "translation": "...", "focus_chunk": "..." }
- delete_review_card: { "card_id": "卡ID" }
- rate_current_review_card: { "rating": 1|2|3|4 } -> 1没听懂 2有点卡 3懂且会读 4脱口而出
- search_lexicon: { "query": "单词或中文", "lang": "${meta.code}" } -> 查离线词库（读工具）
- mark_lexicon_word: { "word": "词", "lang": "${meta.code}", "status": "favorite"|"passed"|"none", "meaning": "中文释义", "example": "可选例句" } -> 收藏或过词
- add_word_sentence: { "word": "词", "lang": "${meta.code}", "sentence": "地道例句", "translation": "中文", "feedback": "点评" } -> 写入词库个人造句本
- list_favorite_words: { "lang": "${meta.code}", "limit": 10 } -> 读取收藏词本（读工具）
- search_media_subtitles: { "word": "单个英文或粤语生词", "lang": "${meta.code}" } -> 仅用于在本地导入的 .srt 字幕里反查某个生词例句（**绝不要用于搜电影/找剧！**）
- speak_aloud: { "text": "要朗读的外语", "lang": "${meta.code}", "rate": 0.92 } -> 立刻调用真人发声
- generate_show_vocab_pack: {} -> 为当前剧生成课前高频词包
- get_study_stats: {} -> 查今日学习与打卡进度
- update_daily_goals: { "word_goal": 25, "review_goal": 15 } -> 改每日打卡目标
- navigate_app: { "tab": "review"|"lexicon"|"studio"|"ingest"|"sync", "sub_tab": "cantonese"|"coach"|"settings" } -> 跳转页面
- update_app_settings: { "theme": "dark"|"light", "voice_id": "edge_ava"|"edge_andrew"|"edge_emma"|"edge_brian"|"edge_aria"|"edge_sonia"|"edge_ryan"|"edge_natasha"|"edge_william"|"edge_hiumaan"|"supertonic_F1"|"supertonic_M1", "voice_gender": "female"|"male", "zhipu_model": "glm-4.7-flash", "study_lang": "en"|"yue"|"ja"|"ko"|"fr"|"es"|"de" } -> 调整设置、切换真人音色或学习语种

【智能体思考原则】
- 主动结合「用户长期记忆档案」「最近在追的剧」「近期重点词卡」给出贴身建议，不要像陌生客服一样客套！
- 支持最多 3 轮自主工具链（例如：先查待复习词卡/收藏生词 -> 再根据真实结果出题或批量建卡），并在每轮末提供 2~3 个自然好用的 suggested_replies 快捷选项！

【标准示例】
${exampleByLang}`;
}

function describeToolStepForUser(act: RawToolCall): string {
  switch (act.tool) {
    case "search_online_cinema":
      return `🎬 正在跨源检索影厅片源《${act.args?.query || "..."}》...`;
    case "batch_create_review_cards":
      return `📦 正在批量生成并存入复习卡...`;
    case "create_review_card":
      return `💾 正在收藏句子进今日复习...`;
    case "list_review_cards":
      return `📚 正在读取你的待复习词卡档案...`;
    case "list_favorite_words":
      return `⭐ 正在读取你的收藏生词本...`;
    case "search_lexicon":
      return `🔍 正在查 5 万离线词库「${act.args?.query || ""}」...`;
    case "save_learner_memory":
      return `🧠 正在写入长期学习记忆...`;
    case "capture_and_save_cinema_line":
      return `📸 正在截取影厅画面并识别字幕...`;
    case "control_cinema_player":
      return `🎛️ 正在实时操控在线影厅...`;
    case "get_study_stats":
      return `📊 正在汇总今日学习与连胜数据...`;
    default:
      return `⚡ 正在执行 App 权限操作...`;
  }
}

function buildFallbackSuggestions(
  allVodCards: AgentVodHitCard[],
  allReceipts: AgentActionReceipt[],
  activeLang: string
): AgentSuggestedReply[] {
  if (allVodCards.length > 0) {
    return [
      { label: "🗣️ 演一段剧里对话", prompt: `用《${allVodCards[0].title}》的风格和我演一段 3 轮口语情景对话` },
      { label: "📦 存 3 个高频词卡", prompt: `围绕《${allVodCards[0].title}》给我 3 个最实用的地道口语表达，并批量存进复习卡` },
    ];
  }
  if (allReceipts.some((r) => r.tool === "batch_create_review_cards" || r.tool === "create_review_card")) {
    return [
      { label: "🎯 立刻出题抽测我", prompt: "用刚才帮我存的那几句复习卡，给我出 2 道互动填空/翻译小测验" },
      { label: "📖 跳去今日复习", prompt: "帮我跳转到今日复习页面" },
    ];
  }
  if (activeLang === "yue") {
    return [
      { label: "🗣️ 继续用粤语深聊", prompt: "继续用更地道嘅港式口语同我倾落去，顺便教我 2 个地道俗语" },
      { label: "💾 存重点进复习卡", prompt: "把刚才回答里最值得背的那句地道表达帮我存进复习卡" },
    ];
  }
  return [
    { label: "🎙️ 接着练习造句", prompt: "给我一个生活场景，让我用刚才提到的地道表达造一句你来批改" },
    { label: "💾 存重点进复习卡", prompt: "把刚才回答里最实用的那句地道表达直接帮我存进今日复习卡" },
  ];
}

/** 运行一次多步 ReAct 全权限沉浸式 AI 助教对话（长期记忆 + 最多 3 轮自主工具链 + JSON 结构化输出 + 100% 中文外语复述 + 智能快捷跟进建议） */
export async function runEchoAgentTurn(params: {
  userInput: string;
  history: AgentTurnMessage[];
  extraContext?: string;
  targetLang?: string;
  onProgress?: (statusText: string) => void;
}): Promise<AgentTurnMessage> {
  const activeLang = (params.targetLang || echoAgentBridge.getActiveStudyLang() || "en").trim().toLowerCase();
  const meta = getStudyLangMeta(activeLang);
  const userUsedChinese = isChineseUserQuestion(params.userInput, activeLang);

  params.onProgress?.(`🧠 正在结合你的学习记忆分析需求...`);
  const liveCtx = await buildLiveContextSummary(params.extraContext);
  const compactHistory = params.history.slice(-10).map((m) => ({
    role: m.role,
    content: m.role === "assistant"
      ? `${m.content}${m.correction ? ` [纠错:${m.correction.improved}]` : ""}`
      : m.content,
  }));

  const sysPrompt = buildImmersionSystemPrompt(activeLang, userUsedChinese);
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: `${sysPrompt}\n\n【当前 App 实时状态与用户画像】\n${liveCtx}` },
    ...compactHistory,
    { role: "user", content: params.userInput },
  ];

  const allReceipts: AgentActionReceipt[] = [];
  const allVodCards: AgentVodHitCard[] = [];
  let finalParsed: ParsedAgentPayload = { actions: [], reply: "", reply_zh: "", user_recast: "", suggested_replies: [] };
  let capturedRecast = "";
  const MAX_ROUNDS = 3;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (round > 0) {
      params.onProgress?.(`✍️ 第 ${round + 1} 步：正在整合真实结果并组织${meta.shortLabel}回复...`);
    }
    const raw = await callAiDirectWithCurrentSettings(messages, 0.38, true);
    const parsed = parseAgentResponse(raw, activeLang);
    if (parsed.user_recast && isValidRecastForLang(parsed.user_recast, params.userInput, activeLang) && !capturedRecast) {
      capturedRecast = parsed.user_recast;
    }
    finalParsed = parsed;

    if (!parsed.actions.length) {
      break;
    }

    const observations: string[] = [];
    let calledReadTool = false;

    for (const act of parsed.actions.slice(0, 6)) {
      params.onProgress?.(describeToolStepForUser(act));
      if (READ_TOOLS.has(act.tool) || (act.tool === "control_cinema_player" && act.args?.action === "search_show")) {
        calledReadTool = true;
      }
      const res = await executeTool(act, params.userInput);
      allReceipts.push(res.receipt);
      if (res.vodCards && res.vodCards.length > 0) {
        for (const vc of res.vodCards) {
          if (!allVodCards.some((x) => x.vodId === vc.vodId && x.sourceKey === vc.sourceKey)) {
            allVodCards.push(vc);
          }
        }
      }
      observations.push(`[${act.tool}] ${res.receipt.ok ? "OK" : "FAIL"}: ${res.observation}`);
    }

    // 关键修复：只要前两轮执行了任意查询/搜片/读工具，或 AI 主动申请继续多步推理，强制进入下一轮读取真实结果再作答，绝不编造「请稍等」
    const canContinue = round < MAX_ROUNDS - 1;
    const shouldFollowup = canContinue && (parsed.need_followup || calledReadTool);
    if (!shouldFollowup) {
      break;
    }

    messages.push(
      { role: "assistant", content: raw },
      {
        role: "user",
        content: `【第 ${round + 1} 轮系统工具已同步执行完毕，真实返回结果如下】\n${observations.join("\n")}\n\n严禁再说「请稍等 / Please hold on / Let me check」！请直接根据以上真实数据，如需继续执行后续动作（如批量存卡/记记忆）可继续调工具，否则直接用 **${meta.label}** 给出最终 reply、完整简体中文翻译 reply_zh、2~3 个实用 suggested_replies${userUsedChinese ? `，并保留对用户问题的 ${meta.label} 复述到 user_recast` : ""}（输出合法 JSON，结束时 actions 设为 []，need_followup 设为 false）。`,
      }
    );
  }

  // 100% 确定性中文提问复述兜底：优先保留首轮对用户问题的精准复述，哪怕用户只发「还没好吗」等短中文也必出地道外语复述卡！
  let finalRecast = (capturedRecast || finalParsed.user_recast || "").trim();
  if (userUsedChinese && !isValidRecastForLang(finalRecast, params.userInput, activeLang)) {
    try {
      const guaranteed = await recastChineseToTargetLangDirect(params.userInput, meta.nativePromptName);
      if (guaranteed) finalRecast = guaranteed;
    } catch {
      // keep existing if fallback fails
    }
  }

  const failedReceipts = allReceipts.filter((r) => !r.ok);
  const failedNoteEn =
    failedReceipts.length > 0 && allVodCards.length === 0
      ? `\n\n⚠️ Note: ${failedReceipts.map((f) => `${f.label}${f.detail ? ` (${f.detail})` : ""}`).join("; ")}`
      : "";
  const failedNoteZh =
    failedReceipts.length > 0 && allVodCards.length === 0
      ? `\n\n⚠️ 其中有步骤未成功：${failedReceipts.map((f) => `${f.label}${f.detail ? `（${f.detail}）` : ""}`).join("；")}`
      : "";

  const fallbackReplyByLang =
    activeLang === "yue"
      ? allVodCards.length > 0
        ? `已經幫你搵到 ${allVodCards.length} 部片源啦！直接點下面張卡片嘅「立即播放」就可以開睇！`
        : allReceipts.length > 0
          ? `搞掂咗！已經幫你完成咗：${allReceipts.map((r) => r.label).join("、")}。仲有咩需要隨時出聲！`
          : "冇問題，隨時同我講你想練啲咩或者幫你點操作 App！"
      : activeLang === "ja"
        ? allVodCards.length > 0
          ? `${allVodCards.length}件の動画が見つかりました！下のカードの「再生」をタップすればすぐ見られますよ！`
          : allReceipts.length > 0
            ? `完了しました！リクエストされた操作を実行しました。他に手伝うことはありますか？`
            : "いつでも話しかけてください！フレーズ保存や単語検索もお任せください。"
        : allVodCards.length > 0
          ? `I found ${allVodCards.length} playable results for you! Tap "Play" on any card below to jump straight in.`
          : allReceipts.length > 0
            ? `All done! I've completed your request. Let me know what you'd like to practice next!`
            : "I'm ready whenever you are! Ask me anything or tell me what to do in EchoDeck.";

  const fallbackReplyZh =
    allVodCards.length > 0
      ? `已经帮你搜到 ${allVodCards.length} 个直连片源！直接点下方卡片上的「立即播放」就能秒开观看。`
      : allReceipts.length > 0
        ? `已执行完成：${allReceipts.map((r) => r.label).join("；")}。还需要练什么随时告诉我！`
        : "准备好了！随时告诉我你想找片、查词、收藏台词、操控影厅还是练口语！";

  const mainContent = (finalParsed.reply || fallbackReplyByLang) + failedNoteEn;
  let zhTranslation =
    (finalParsed.reply_zh || (finalParsed.reply ? "" : fallbackReplyZh)) +
    (finalParsed.reply_zh || !finalParsed.reply ? failedNoteZh : "");

  // 若主模型漏填 reply_zh，同步补齐中文翻译确保点击气泡 0ms 展开
  if (!zhTranslation.trim() && mainContent.trim()) {
    try {
      zhTranslation = await translateTextToZhDirect(mainContent, activeLang);
    } catch {
      // 保留气泡内按需翻译兜底
    }
  }

  const finalSuggestions =
    finalParsed.suggested_replies && finalParsed.suggested_replies.length > 0
      ? finalParsed.suggested_replies.slice(0, 3)
      : buildFallbackSuggestions(allVodCards, allReceipts, activeLang);

  return {
    id: `ag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    role: "assistant",
    content: mainContent,
    replyZh: zhTranslation.trim(),
    userQuestionRecast: finalRecast,
    targetLang: activeLang,
    vodCards: allVodCards.length > 0 ? allVodCards : undefined,
    suggestedReplies: finalSuggestions,
    receipts: allReceipts,
    correction: finalParsed.correction || null,
    speakText: finalParsed.speak_text || finalParsed.reply || finalParsed.correction?.improved || "",
    speakLang: finalParsed.speak_lang || finalParsed.correction?.lang || activeLang,
    createdAt: Date.now(),
  };
}
