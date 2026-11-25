import { useEffect, useLayoutEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  DownloadCloud,
  Film,
  GraduationCap,
  Sparkles,
  X,
} from "lucide-react";
import type { TabKey } from "../types";

export interface TourStep {
  id: string;
  tab?: TabKey;
  openStarterLesson?: boolean;
  selector?: string; // 对应 DOM 上的 data-tour="..."；省略时居中展示导览卡
  badge: string;
  title: string;
  what: string;
  how: string;
  tip?: string;
}

export const FULL_TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    badge: "欢迎使用 EchoDeck",
    title: "60 秒上手：看电影追剧就能学外语的独立应用",
    what: "你不再需要装 7 个零碎软件，也不需要电脑传文件。无论是看电影、追美剧港剧、听播客、还是看喜欢的短视频，都能在这里一站完成精听、跟读、挖卡和科学复习。",
    how: "每天只需要 3 步闭环：① 把喜欢的影视/播客/视频片段导进来 → ② 在影听台跟读并点 ⚡ 把好台词切成卡片 → ③ 每天通勤花 5 分钟刷卡复习。",
    tip: "接下来我会用聚光灯在真实界面上一步步指给你看，点一下就能跟着练。",
  },
  {
    id: "review-header",
    tab: "review",
    selector: "review-progress",
    badge: "第 1 板块 · 今日复习",
    title: "每天打开先来这里：科学抗遗忘刷卡",
    what: "这是取代 Anki / AnkiDroid 的记忆中枢。内置 FSRS 算法会自动算准你快忘掉的时间点，把到期的台词和表达卡片推到你面前。",
    how: "顶部显示今天还剩几张到期卡，支持按语言或任意兴趣标签筛选，点右上角「+ 记一句」随时手记看片听到的地道表达。",
  },
  {
    id: "review-audio",
    tab: "review",
    selector: "review-audio-bar",
    badge: "第 1 板块 · 听读与录音",
    title: "先磨耳朵、再开口对比原声",
    what: "语言不是“看”会的，是“听和说”会的。每张卡片都自带原声切片（或离线语音朗读）。",
    how: "先点大号播放键盲听两遍 → 听不清连读就切「0.8x 慢速」→ 点「录音跟读」录下自己说的，再点「对比原声」立刻听出差距。",
  },
  {
    id: "review-reveal",
    tab: "review",
    selector: "review-action-area",
    badge: "第 1 板块 · 翻面打分",
    title: "翻面看重点词块与粤拼，诚实打分",
    what: "点击翻面后会展示地道中文释义、粤语声调粤拼、笔记，以及一键 AI 拆解。",
    how: "根据真实掌握程度点底部 4 个评分按钮：完全没听懂选「没听懂」（1 分钟后再考你），脱口而出选「脱口而出」（直接排到几天后）。",
  },
  {
    id: "lexicon-browse",
    tab: "lexicon",
    selector: "lexicon-actions",
    badge: "第 2 板块 · 5万+多语种词库",
    title: "离线刷词、收藏生词与一键「过单词」",
    what: "内置 26,000+ 全分级英语词库（牛津/四六级/考研/雅思托福/GRE）和 24,000+ 粤语词库，还能点「+ 其他语种」随时扩展日语/韩语/法语等。",
    how: "认识的词直接点绿色「认识 · 过！」永久划掉；生词点「⭐ 收藏」或「加进复习」直接送进抗遗忘刷卡队列，也可以切「词典」离线秒查 5 万词！",
  },
  {
    id: "studio-player",
    tab: "studio",
    openStarterLesson: true,
    selector: "studio-controls",
    badge: "第 3 板块 · 影听跟读",
    title: "已为你打开体验课：超越 VLC 的跟读神器",
    what: "这里合体了 VLC 复读机 + 离线 AI 字幕 + 一键制卡台。我们内置了 1 条美剧/电影高频口语体验课供你现在直接试。",
    how: "点下方任意一句字幕就能精准跳播；点「单句循环」无限磨连读；展开「更多工具 → 影子留白」每句播完自动暂停等你开口复述。",
  },
  {
    id: "studio-mine",
    tab: "studio",
    openStarterLesson: true,
    selector: "studio-mine-btn",
    badge: "第 2 板块 · 一键挖卡",
    title: "听到神仙台词？点 ⚡ 秒变复习卡",
    what: "不用自己剪音频、也不用截屏拼图。看电影、追剧或听播客遇到喜欢的表达，点一下这个闪电按钮即可。",
    how: "App 会在手机本地自动切出这一句的原声片段 + 当前画面截图 + 双语字幕，直接送进你的「今日复习」队列里！",
  },
  {
    id: "ingest-main",
    tab: "ingest",
    selector: "ingest-url-box",
    badge: "第 3 板块 · 导入素材",
    title: "把电影、剧集、播客和短视频装进手机",
    what: "这里是你的自由素材入口，不限任何题材：电影片段、美剧/港剧、播客、访谈、纪录片、体育或游戏视频全都支持。",
    how: "刷 B站 / 小宇宙直接点系统「分享 → EchoDeck」，或复制链接粘到这里下载；其他平台视频或剧集片段直接从相册/本地文件导入即可。",
    tip: "导入后如果视频没字幕，进「影听跟读」点一键生成，手机本地离线 AI 也能跑出时间轴字幕。",
  },
  {
    id: "tools-cantonese",
    tab: "sync",
    selector: "tools-tabs",
    badge: "第 4 板块 · 粤语与 AI 教练",
    title: "2 万字离线粤拼纠懒音 + 自由话题 AI 陪练",
    what: "把「正字粤拼查词」和「口语私教」融在了一起：粤拼页断网可逐字查声调读音；AI 语伴支持围绕你刚背的词块聊任何你喜欢的话题。",
    how: "看港片港剧随时在这里查粤拼正字；在「备份与设置」选填 DeepSeek Key，就能和 AI 聊刚看的电影、追的剧或日常趣事并实时润色。",
    tip: "任何时候忘了怎么用，点右上角「🎓 教学」都可以随时重看本页指引！",
  },
];

export const PAGE_TOUR_MAP: Record<TabKey, TourStep[]> = {
  review: FULL_TOUR_STEPS.filter((s) => s.tab === "review"),
  lexicon: FULL_TOUR_STEPS.filter((s) => s.tab === "lexicon"),
  studio: FULL_TOUR_STEPS.filter((s) => s.tab === "studio"),
  ingest: FULL_TOUR_STEPS.filter((s) => s.tab === "ingest"),
  sync: FULL_TOUR_STEPS.filter((s) => s.tab === "sync"),
};

interface GuidedTourProps {
  steps: TourStep[];
  active: boolean;
  onStepEnter: (step: TourStep) => void;
  onClose: (completed: boolean) => void;
}

export function GuidedTour({ steps, active, onStepEnter, onClose }: GuidedTourProps) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const current = steps[index];

  useEffect(() => {
    if (active) setIndex(0);
  }, [active, steps]);

  useEffect(() => {
    if (!active || !current) return;
    onStepEnter(current);
  }, [active, index, current, onStepEnter]);

  // 动态追踪目标元素位置（切换页面/滚动/视口变化均自动重算）
  useLayoutEffect(() => {
    if (!active || !current) return;
    if (!current.selector) {
      setRect(null);
      return;
    }

    const measure = () => {
      const el = document.querySelector(`[data-tour="${current.selector}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "auto", block: "center" });
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          setRect(r);
          return;
        }
      }
      setRect(null);
    };

    const t1 = window.setTimeout(measure, 80);
    const t2 = window.setTimeout(measure, 320);
    const t3 = window.setTimeout(measure, 650);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [active, current]);

  if (!active || !current) return null;

  const isLast = index === steps.length - 1;
  const isWelcome = current.id === "welcome";
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const vw = typeof window !== "undefined" ? window.innerWidth : 400;

  // 终极移动端自适应定位：目标在上半区则气泡优雅贴底（永不掉出屏幕），目标在下半区则气泡优雅贴顶
  const targetInUpperHalf = rect ? rect.top + rect.height / 2 < vh * 0.54 : true;
  const cardWidth = Math.min(392, vw - 24);
  const cardLeft = Math.round((vw - cardWidth) / 2);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[80] overflow-hidden">
        {/* 无目标元素时使用柔和毛玻璃暗幕 */}
        {!rect && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/65 backdrop-blur-[3px]"
          />
        )}

        {/* 聚光灯高亮框（带呼吸光环与四面遮罩） */}
        {rect && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{
              opacity: 1,
              scale: 1,
              top: Math.max(4, rect.top - 8),
              left: Math.max(4, rect.left - 8),
              width: Math.min(vw - 8, rect.width + 16),
              height: rect.height + 16,
            }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="tour-spotlight pointer-events-none fixed rounded-2xl border-2 border-orange-500"
          />
        )}

        {/* 教学提示卡片 */}
        <motion.div
          key={current.id}
          initial={{ opacity: 0, y: 14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ type: "spring", stiffness: 360, damping: 28 }}
          style={
            rect
              ? targetInUpperHalf
                ? { position: "fixed", bottom: 18, left: cardLeft, width: cardWidth }
                : { position: "fixed", top: 18, left: cardLeft, width: cardWidth }
              : undefined
          }
          className={
            rect
              ? "z-[90] max-h-[54vh] overflow-y-auto rounded-3xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 shadow-2xl"
              : "fixed left-1/2 top-1/2 z-[90] max-h-[85vh] w-[min(440px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-6 shadow-2xl"
          }
        >
          {/* 顶部进度与关闭 */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--accent-text)]">
              <GraduationCap className="h-3.5 w-3.5" />
              {current.badge} · {index + 1}/{steps.length}
            </span>
            <button
              type="button"
              onClick={() => onClose(false)}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-[var(--text-muted)] transition hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
            >
              跳过
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <h3 className="text-lg font-bold tracking-tight text-[var(--text-primary)]">{current.title}</h3>

          {/* 欢迎步特有：3 步视觉闭环卡片 */}
          {isWelcome && (
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                { icon: DownloadCloud, step: "1. 导素材", desc: "影视/播客/视频" },
                { icon: Film, step: "2. 听读挖卡", desc: "复读+一键切句" },
                { icon: BookOpen, step: "3. 每天刷卡", desc: "抗遗忘+自由聊" },
              ].map((it) => {
                const Icon = it.icon;
                return (
                  <div
                    key={it.step}
                    className="flex flex-col items-center rounded-2xl bg-[var(--bg-subtle)] p-3 text-center"
                  >
                    <div className="mb-1.5 flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="text-xs font-semibold text-[var(--text-primary)]">{it.step}</div>
                    <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">{it.desc}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 清晰分层：干什么 + 怎么用 */}
          <div className="mt-3.5 space-y-2.5 text-[13px] leading-relaxed">
            <div className="rounded-2xl bg-[var(--bg-subtle)] px-3.5 py-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                这个板块干什么用
              </div>
              <p className="mt-1 text-[var(--text-primary)]">{current.what}</p>
            </div>

            <div className="rounded-2xl border border-[var(--accent-ring)] bg-[var(--accent-soft)] px-3.5 py-2.5">
              <div className="flex items-center gap-1 text-[11px] font-semibold text-[var(--accent-text)]">
                <Sparkles className="h-3 w-3" />
                推荐你怎么用
              </div>
              <p className="mt-1 text-[var(--text-primary)]">{current.how}</p>
            </div>

            {current.tip && (
              <p className="px-1 text-xs text-[var(--text-secondary)]">💡 {current.tip}</p>
            )}
          </div>

          {/* 步骤点与上下步操作 */}
          <div className="mt-5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {steps.map((s, i) => (
                <span
                  key={s.id}
                  className={`h-1.5 rounded-full transition-all ${
                    i === index ? "w-5 bg-[var(--accent)]" : "w-1.5 bg-[var(--border-strong)]"
                  }`}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              {index > 0 && (
                <button
                  type="button"
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  className="inline-flex items-center gap-1 rounded-xl border border-[var(--border-strong)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)]"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  上一步
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (isLast) onClose(true);
                  else setIndex((i) => i + 1);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-fg)] shadow-sm transition active:scale-95"
              >
                {isLast ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    懂了，开始练
                  </>
                ) : isWelcome ? (
                  <>
                    开始 1 分钟导览
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                ) : (
                  <>
                    下一步
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
