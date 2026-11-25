/**
 * EchoDeck v9.5 多对话页会话管理引擎（Multi-Session AI Workspace）：
 * - 默认开箱保留 3 个高频专属对话页，互不串上下文，随时一键切换：
 *   1) 🎬 追剧搜片 & 操控（影厅搜片/直播/截屏收藏台词/控播）
 *   2) 🗣️ 日常口语实战（沉浸式角色扮演/纠错/自动朗读练口语）
 *   3) 📚 词卡语法私教（查词/批量存卡/薄弱卡抽测/语法拆解）
 * - 支持「+ 新建对话」最多保留 10 个独立对话页，支持自动按首句起标题、手动重命名、清空单页与删除多余对话页
 * - 自动无损迁移旧版单页聊天记录（echodeck_copilot_history_v85）
 */
import type { AgentTurnMessage } from "./aiAgentEngine";
import { getStudyLangMeta } from "./appAgentBridge";

export type CopilotSessionMode = "cinema" | "oral" | "study" | "general";

export interface CopilotSession {
  id: string;
  title: string;
  icon: string;
  mode: CopilotSessionMode;
  studyLang: string;
  pinned?: boolean;
  autoTitlePending?: boolean;
  messages: AgentTurnMessage[];
  updatedAt: number;
}

const SESSIONS_STORAGE_KEY = "echodeck_copilot_sessions_v95";
const ACTIVE_SESSION_KEY = "echodeck_copilot_active_session_v95";
const LEGACY_HISTORY_KEY = "echodeck_copilot_history_v85";
const AUTO_SPEAK_KEY = "echodeck_copilot_auto_speak_v95";
const MAX_SESSIONS = 10;
const MAX_MESSAGES_PER_SESSION = 40;

export function getAutoSpeakPref(): boolean {
  try {
    return localStorage.getItem(AUTO_SPEAK_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAutoSpeakPref(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_SPEAK_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
}

export function getSessionModePromptHint(mode: CopilotSessionMode): string {
  switch (mode) {
    case "cinema":
      return "【当前对话页模式：🎬 追剧搜片 & 影厅操控】优先处理找片/直播、控播/调速/纯英遮中文、截屏收藏台词、俚语剧情讲解。搜到片源后主动建议「生成词包」或「演一段剧里对白」。";
    case "oral":
      return "【当前对话页模式：🗣️ 日常口语实战】像热情、机智的母语朋友一样主动抛话题互动，每轮自然接话 + 1 个轻快追问，积极发现并升级用户的中式腔，并给出 3 个可直接点选回复的地道口语快捷选项！";
    case "study":
      return "【当前对话页模式：📚 词卡语法私教】擅长结合用户的待复习薄弱卡与收藏生词做针对性拆解、出微测验、批量生成并存入复习卡（可用 batch_create_review_cards），讲透核心词块与避坑点。";
    default:
      return "【当前对话页模式：✨ 全能智能助教】灵活结合 App 全部 21 项权限与用户长期记忆，主动规划多步骤完成任务并给出下一步快捷建议。";
  }
}

export function buildWelcomeMessageForSession(langCode: string, mode: CopilotSessionMode): AgentTurnMessage {
  const meta = getStudyLangMeta(langCode);
  const isYue = meta.code === "yue";
  const isJa = meta.code === "ja";
  const isKo = meta.code === "ko";

  if (mode === "cinema") {
    return {
      id: "ag_welcome",
      role: "assistant",
      targetLang: meta.code,
      speakLang: meta.code,
      content: isYue
        ? "歡迎入嚟「🎬 追劇搜片專區」！想睇咩港劇、美劇或者電影直接講中文名就得，我即刻幫你跨源搵片源仲可以直接開播～"
        : isJa
          ? "「🎬 シネマ検索＆操作」ルームへようこそ！観たい映画やドラマの名前を教えてくれれば、すぐ検索して再生カードを出しますよ。"
          : "Welcome to your Cinema Hub! Tell me any movie or show—even in Chinese—and I'll pull up playable streams right here, control playback, or save lines straight to your deck.",
      replyZh:
        "欢迎来到「🎬 追剧搜片与操控」专属对话页！想看什么电影/美剧/港剧直接说中文名，我立刻跨源搜片出「▶ 立即播放」卡片，还能控播、遮中文字幕、截屏存词卡。",
      speakText: isYue
        ? "歡迎入嚟追劇搜片專區，想睇咩戲直接講名就得！"
        : "Welcome to your Cinema Hub! Tell me any movie or show and I'll pull it right up.",
      suggestedReplies: [
        { label: "🎬 搜《新闻女王 粤语》", prompt: "帮我去在线影厅搜一下《新闻女王 粤语》" },
        { label: "🧟 搜《生化危机 爆发夜》", prompt: "帮我找找生化危机 爆发夜" },
        { label: "🍿 推荐适合练口语的美剧", prompt: "结合我现在的水平，推荐 3 部适合练地道口语的美剧，并帮我搜其中一部的片源" },
      ],
      createdAt: Date.now(),
    };
  }

  if (mode === "oral") {
    return {
      id: "ag_welcome",
      role: "assistant",
      targetLang: meta.code,
      speakLang: meta.code,
      content: isYue
        ? "哈囉！呢頁係你嘅「🗣️ 日常口語實戰房」～唔怕講錯，你講普通話或者試講粵語都得，我會幫你執靚句式仲陪你傾落去！今日想練邊個場景？"
        : isJa
          ? "「🗣️ 英会話・スピーキング実践」へようこそ！間違えても大丈夫。自然な表現に直しながら楽しく会話しましょう！今日はどんな場面で練習したいですか？"
          : isKo
            ? "「🗣️ 실전 회화방」에 오신 걸 환영해요! 틀려도 괜찮아요. 자연스러운 표현으로 고쳐 드리면서 같이 대화해요. 오늘 어떤 상황으로 연습해 볼까요?"
            : `Hey! Welcome to your Oral Practice room (${meta.label})! Jump right in—whether you reply in Chinese or ${meta.label}, I'll recast your questions, polish your phrasing, and keep a real conversation going. What scenario should we roleplay today?`,
      replyZh:
        `欢迎来到「🗣️ 日常口语实战」专属对话页！放心开口（发中文或${meta.label}都可以），我会先帮你转地道问法、实时纠正中式表达并给出自然回复选项。今天想演哪个场景？`,
      speakText: isYue
        ? "哈囉！呢頁係日常口語實戰房，今日想練邊個場景？"
        : "Hey! Welcome to your Oral Practice room. What scenario should we roleplay today?",
      suggestedReplies: [
        { label: "☕ 咖啡店点单实战", prompt: "我们来模拟在纽约咖啡店点单，你当咖啡师先开口问我", zhHint: "情景角色扮演" },
        { label: "💼 轻松聊今天的生活", prompt: "用轻松的日常口语和我聊今天发生了什么，顺便帮我纠正表达", zhHint: "自由闲聊纠错" },
        { label: "✈️ 机场过关/酒店入住", prompt: "模拟我在国外酒店办理入住，你当前台先向我打招呼", zhHint: "旅行口语模拟" },
      ],
      createdAt: Date.now(),
    };
  }

  if (mode === "study") {
    return {
      id: "ag_welcome",
      role: "assistant",
      targetLang: meta.code,
      speakLang: meta.code,
      content: isYue
        ? "呢頁係你嘅「📚 詞卡語法私教房」！我可以讀取你今日待複習嘅卡片同收藏生詞，即場出微測驗、批量幫你建詞卡，仲會記低你嘅薄弱位長期跟進！"
        : `Welcome to your Study & Deck Tutor room! I can inspect your due cards and saved vocabulary, quiz you on weak spots, batch-create flashcards in one shot, and remember your learning goals long-term.`,
      replyZh:
        "欢迎来到「📚 词卡语法私教」专属对话页！我可以读取你今天的待复习卡片与收藏生词，针对薄弱点出互动小测验、一键批量生成并存入复习卡，还会长期记住你的学习目标。",
      speakText: isYue
        ? "呢頁係詞卡語法私教房，隨時可以抽查你嘅生詞同複習卡！"
        : "Welcome to your Study and Deck Tutor room! Ready to drill your weak cards or build new ones?",
      suggestedReplies: [
        { label: "🎯 查我待复习卡并考我", prompt: "查一下我今天待复习的卡片和最近收藏的词，挑 2 个重点出互动小测验考考我" },
        { label: "📦 批量存 4 个高频口语卡", prompt: "教我 4 个美剧里最常用、最地道的日常衔接词块，并帮我一次性全部存进复习卡" },
        { label: "📊 帮我做今日学习复盘", prompt: "读取我今天的学习统计、待复习卡片和最近看过的剧，给我定制一条 10 分钟学习计划" },
      ],
      createdAt: Date.now(),
    };
  }

  return {
    id: "ag_welcome",
    role: "assistant",
    targetLang: meta.code,
    speakLang: meta.code,
    content: isYue
      ? "開咗個全新對話頁！隨時問我任何嘢、搵戲睇、練口語或者幫你記筆記，點氣泡即刻睇中文翻譯！"
      : `Fresh chat ready! Ask me anything in Chinese or ${meta.label}—I can search shows, coach your speaking, build flashcards, and remember your preferences. Tap any bubble for Chinese translation!`,
    replyZh: `新对话页已就绪！随时发中文或${meta.label}提问，支持多步调用 App 全部能力、长期记忆与点击气泡秒看中文翻译。`,
    suggestedReplies: [
      { label: "🗣️ 教我一句地道表达", prompt: "我想表达「顺其自然，走一步看一步」，用我学的语言怎么说最地道？" },
      { label: "🧠 记住我的学习偏好", prompt: "记住我平时喜欢看美剧和港剧练口语，回复保持简洁实用" },
      { label: "📊 查今日学习状态", prompt: "查一下我今天的学习进度和待复习卡片" },
    ],
    createdAt: Date.now(),
  };
}

function createDefaultSessions(langCode: string, migratedLegacy?: AgentTurnMessage[]): CopilotSession[] {
  const now = Date.now();
  const s1: CopilotSession = {
    id: "sess_cinema",
    title: "追剧搜片",
    icon: "🎬",
    mode: "cinema",
    studyLang: langCode,
    pinned: true,
    messages:
      migratedLegacy && migratedLegacy.length > 1
        ? migratedLegacy.slice(-MAX_MESSAGES_PER_SESSION)
        : [buildWelcomeMessageForSession(langCode, "cinema")],
    updatedAt: now,
  };
  const s2: CopilotSession = {
    id: "sess_oral",
    title: "口语实战",
    icon: "🗣️",
    mode: "oral",
    studyLang: langCode,
    pinned: true,
    messages: [buildWelcomeMessageForSession(langCode, "oral")],
    updatedAt: now - 1000,
  };
  const s3: CopilotSession = {
    id: "sess_study",
    title: "词卡私教",
    icon: "📚",
    mode: "study",
    studyLang: langCode,
    pinned: true,
    messages: [buildWelcomeMessageForSession(langCode, "study")],
    updatedAt: now - 2000,
  };
  return [s1, s2, s3];
}

export function loadCopilotSessions(defaultLang: string): {
  sessions: CopilotSession[];
  activeId: string;
} {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const clean: CopilotSession[] = parsed
          .filter((s: any) => s && typeof s.id === "string" && Array.isArray(s.messages))
          .slice(0, MAX_SESSIONS)
          .map((s: any) => ({
            id: s.id,
            title: String(s.title || "新对话").slice(0, 16),
            icon: String(s.icon || "💬"),
            mode: (["cinema", "oral", "study", "general"].includes(s.mode) ? s.mode : "general") as CopilotSessionMode,
            studyLang: String(s.studyLang || defaultLang || "en"),
            pinned: Boolean(s.pinned),
            autoTitlePending: Boolean(s.autoTitlePending),
            messages: s.messages.length > 0 ? s.messages.slice(-MAX_MESSAGES_PER_SESSION) : [buildWelcomeMessageForSession(s.studyLang || defaultLang, s.mode || "general")],
            updatedAt: Number(s.updatedAt || Date.now()),
          }));
        if (clean.length > 0) {
          const savedActive = localStorage.getItem(ACTIVE_SESSION_KEY) || "";
          const activeId = clean.some((s) => s.id === savedActive) ? savedActive : clean[0].id;
          return { sessions: clean, activeId };
        }
      }
    }
  } catch {
    // ignore corrupt cache
  }

  // 兼容旧版单页记录：自动迁移进第 1 个对话页，不丢历史
  let legacyMsgs: AgentTurnMessage[] | undefined;
  try {
    const legacyRaw = localStorage.getItem(LEGACY_HISTORY_KEY);
    if (legacyRaw) {
      const arr = JSON.parse(legacyRaw);
      if (Array.isArray(arr) && arr.length > 0) legacyMsgs = arr;
    }
  } catch {
    // ignore
  }

  const defaults = createDefaultSessions(defaultLang, legacyMsgs);
  saveCopilotSessions(defaults, defaults[0].id);
  return { sessions: defaults, activeId: defaults[0].id };
}

export function saveCopilotSessions(sessions: CopilotSession[], activeId: string): void {
  try {
    const trimmed = sessions.slice(0, MAX_SESSIONS).map((s) => ({
      ...s,
      messages: s.messages.slice(-MAX_MESSAGES_PER_SESSION),
    }));
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(trimmed));
    localStorage.setItem(ACTIVE_SESSION_KEY, activeId);
  } catch {
    // ignore quota error
  }
}

export function createNewCopilotSession(langCode: string, indexHint: number): CopilotSession {
  return {
    id: `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    title: `新对话 ${indexHint}`,
    icon: "💬",
    mode: "general",
    studyLang: langCode,
    pinned: false,
    autoTitlePending: true,
    messages: [buildWelcomeMessageForSession(langCode, "general")],
    updatedAt: Date.now(),
  };
}

/** 从用户第一条真实消息自动提炼 2~8 字对话标题 */
export function deriveAutoSessionTitle(userInput: string): string {
  const cleaned = userInput
    .replace(/^(请|麻烦|帮我|给我|我想|想|能不能|可以|去在线影厅|在线影厅)/g, "")
    .replace(/[《》「」"'?？!！。，,\s]+/g, " ")
    .trim();
  if (!cleaned) return "新对话";
  return cleaned.length > 8 ? `${cleaned.slice(0, 8)}` : cleaned;
}
