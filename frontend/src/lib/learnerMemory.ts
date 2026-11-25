/**
 * EchoDeck v9.5 长期学习记忆档案（Persistent Learner Memory）：
 * - 跨会话、跨天持久记住用户的语言水平、兴趣偏好、常见语法盲区与学习目标
 * - 每次 AI 对话自动注入精简版「用户学习画像 + 长期记忆」，让 AI 真正认识你、记住你、主动定制练习
 * - 用户可随时在 AI 助教顶栏点击「🧠 记忆」查看、手动添加或删除任何一条记忆；AI 也能自主调用工具记录新发现
 */

export interface LearnerMemoryItem {
  id: string;
  category: "goal" | "level" | "interest" | "weakness" | "preference";
  text: string;
  createdAt: number;
}

const MEMORY_STORAGE_KEY = "echodeck_learner_memory_v95";

const CATEGORY_META: Record<LearnerMemoryItem["category"], { label: string; icon: string }> = {
  goal: { label: "学习目标", icon: "🎯" },
  level: { label: "当前水平", icon: "📈" },
  interest: { label: "影视/兴趣", icon: "🎬" },
  weakness: { label: "薄弱易错点", icon: "⚠️" },
  preference: { label: "对话偏好", icon: "⚙️" },
};

export function getMemoryCategoryMeta(cat: LearnerMemoryItem["category"]) {
  return CATEGORY_META[cat] || CATEGORY_META.preference;
}

export function listLearnerMemories(): LearnerMemoryItem[] {
  try {
    const raw = localStorage.getItem(MEMORY_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x: any) => x && typeof x.text === "string" && x.text.trim())
      .slice(0, 24);
  } catch {
    return [];
  }
}

function writeLearnerMemories(items: LearnerMemoryItem[]): void {
  try {
    localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(items.slice(0, 24)));
  } catch {
    // ignore quota error
  }
}

export function addLearnerMemory(
  text: string,
  category: LearnerMemoryItem["category"] = "preference"
): LearnerMemoryItem {
  const clean = text.trim().slice(0, 140);
  const existing = listLearnerMemories();
  // 去重：若已存在高度相似条目则直接更新覆盖
  const dupIdx = existing.findIndex(
    (m) => m.text.toLowerCase() === clean.toLowerCase() || (clean.length >= 6 && m.text.includes(clean))
  );
  const item: LearnerMemoryItem = {
    id: dupIdx >= 0 ? existing[dupIdx].id : `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    category,
    text: clean,
    createdAt: Date.now(),
  };
  if (dupIdx >= 0) {
    existing[dupIdx] = item;
    writeLearnerMemories(existing);
  } else {
    writeLearnerMemories([item, ...existing]);
  }
  return item;
}

export function removeLearnerMemory(idOrKeyword: string): boolean {
  const key = idOrKeyword.trim().toLowerCase();
  if (!key) return false;
  const existing = listLearnerMemories();
  const next = existing.filter(
    (m) => m.id.toLowerCase() !== key && !m.text.toLowerCase().includes(key)
  );
  if (next.length === existing.length) return false;
  writeLearnerMemories(next);
  return true;
}

export function buildLearnerMemoryPromptBlock(): string {
  const items = listLearnerMemories();
  if (items.length === 0) {
    return "（暂无手动记忆；若用户在对话中透露自己的英语/粤语水平、喜欢看的剧类型、常犯语法错误或希望的陪练风格，可主动调用 save_learner_memory 帮他记住！）";
  }
  return items
    .slice(0, 12)
    .map((m) => `- [${getMemoryCategoryMeta(m.category).label}] ${m.text}`)
    .join("\n");
}
