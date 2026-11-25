import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  BookOpen,
  DownloadCloud,
  Film,
  GraduationCap,
  Library,
  Moon,
  Sparkles,
  Sun,
} from "lucide-react";
import { FULL_TOUR_STEPS, GuidedTour, PAGE_TOUR_MAP, type TourStep } from "./components/GuidedTour";
import { ReviewView } from "./components/ReviewView";
import { echoAgentBridge } from "./lib/appAgentBridge";
import {
  consumeSharedIntent,
  isNativeAndroid,
  nativeMinimizeApp,
  nativeSetSystemTheme,
  stopAllSpeech,
  triggerHaptic,
} from "./lib/nativeBridge";
import { getAppStats } from "./lib/standaloneStore";
import type { TabKey, VodCardRef } from "./types";

// 路由级按需代码拆分：冷启动只加载首屏复习舱，其余重型模块首次点击时按需载入并由 Keep-Alive 常驻
const LexiconView = lazy(() => import("./components/LexiconView").then((m) => ({ default: m.LexiconView })));
const StudioView = lazy(() => import("./components/StudioView").then((m) => ({ default: m.StudioView })));
const IngestView = lazy(() => import("./components/IngestView").then((m) => ({ default: m.IngestView })));
const SyncLabView = lazy(() => import("./components/SyncLabView").then((m) => ({ default: m.SyncLabView })));
const GlobalAiCopilot = lazy(() =>
  import("./components/GlobalAiCopilot").then((m) => ({ default: m.GlobalAiCopilot }))
);

function TabLoadingFallback() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <div className="surface-card space-y-3 rounded-[28px] p-6">
        <div className="skeleton-shimmer h-5 w-32 rounded-full" />
        <div className="skeleton-shimmer h-10 w-full rounded-2xl" />
        <div className="skeleton-shimmer h-28 w-full rounded-2xl" />
      </div>
    </div>
  );
}

const TOUR_DONE_KEY = "echodeck_tour_done_v3";
const TIPS_VISIBLE_KEY = "echodeck_coach_tips_v10";
const THEME_KEY = "echodeck_theme_v3";

export default function App() {
  const [tab, setTab] = useState<TabKey>("review");
  // Keep-Alive 懒挂载集合：每个页面首次访问后常驻内存，切页 0ms 秒切且完整保留影厅进度/词库检索/滚动位置
  const [mountedTabs, setMountedTabs] = useState<Set<TabKey>>(() => new Set<TabKey>(["review"]));
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "dark" ? "dark" : "light";
  });

  const [stats, setStats] = useState({ totalCards: 0, dueCards: 0, reviewedToday: 0, mediaCount: 0 });
  const [studioMediaId, setStudioMediaId] = useState("");
  const [studioSeekMs, setStudioSeekMs] = useState<number | undefined>(undefined);
  const [studioVodRef, setStudioVodRef] = useState<VodCardRef | null>(null);
  const [sharedUrl, setSharedUrl] = useState("");
  const [toolSubTab, setToolSubTab] = useState<"cantonese" | "coach" | "settings">("cantonese");
  const [coachPresetChunks, setCoachPresetChunks] = useState<string[]>([]);
  const [coachPresetLang, setCoachPresetLang] = useState("");
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotPreset, setCopilotPreset] = useState("");
  const [systemToast, setSystemToast] = useState("");

  // 教学模式：首次进入自动弹出 60 秒交互导览；常驻行动提示条默认收起以保持首屏清爽通透（随时点顶栏「教学」唤起）
  const [tourActive, setTourActive] = useState<boolean>(() => !localStorage.getItem(TOUR_DONE_KEY));
  const [tourSteps, setTourSteps] = useState<TourStep[]>(FULL_TOUR_STEPS);
  const [showCoachTips, setShowCoachTips] = useState<boolean>(() => localStorage.getItem(TIPS_VISIBLE_KEY) === "true");

  const lastBackPressRef = useRef<number>(0);

  const showSysToast = useCallback((msg: string) => {
    setSystemToast(msg);
    setTimeout(() => setSystemToast((cur) => (cur === msg ? "" : cur)), 2200);
  }, []);

  const switchTab = useCallback((nextTab: TabKey) => {
    setTab((prev) => {
      if (prev !== nextTab) {
        // 切换页面时停止残留朗读与音频，离开影听时温和暂停视频防止声音串音，切回即可续播
        stopAllSpeech();
        try {
          document.querySelectorAll<HTMLAudioElement>("audio").forEach((a) => {
            if (!a.paused) a.pause();
          });
          if (prev === "studio") {
            document.querySelectorAll<HTMLVideoElement>("video").forEach((v) => {
              if (!v.paused) v.pause();
            });
          }
        } catch {
          // ignore
        }
      }
      return nextTab;
    });
    setMountedTabs((prev) => {
      if (prev.has(nextTab)) return prev;
      const next = new Set(prev);
      next.add(nextTab);
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0B0C10" : "#F7F7F9");
    nativeSetSystemTheme(theme === "dark");
  }, [theme]);

  const refreshStats = useCallback(async () => {
    const s = await getAppStats();
    setStats(s);
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // 旗舰级 Android 返回手势/返回键统一调度栈（导览 -> AI助教 -> 影厅播放页 -> 回首页 -> 双击退后台）
  useEffect(() => {
    const onHardwareBack = () => {
      if (tourActive) {
        setTourActive(false);
        localStorage.setItem(TOUR_DONE_KEY, "1");
        return;
      }
      if (copilotOpen) {
        setCopilotOpen(false);
        return;
      }
      // 先询问当前页是否有打开的子视图（如影厅播放器 / 查词弹窗）需要关闭
      const evt = new CustomEvent("echodeck:close-overlay", { cancelable: true });
      window.dispatchEvent(evt);
      if (evt.defaultPrevented) {
        return;
      }
      if (tab !== "review") {
        switchTab("review");
        return;
      }
      const now = Date.now();
      if (now - lastBackPressRef.current < 2000) {
        nativeMinimizeApp();
      } else {
        lastBackPressRef.current = now;
        showSysToast("再按一次返回退至后台");
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const tag = (document.activeElement?.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      onHardwareBack();
    };
    window.addEventListener("echodeck:hardware-back", onHardwareBack);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("echodeck:hardware-back", onHardwareBack);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [tourActive, copilotOpen, tab, switchTab, showSysToast]);

  // 向全局全权限 AI 总线注册 App 导航、主题、跳影厅、刷新与唤起能力
  useEffect(() => {
    echoAgentBridge.registerApp({
      getActiveTab: () => tab,
      getTheme: () => theme,
      navigate: (nextTab, subTab) => {
        if (subTab) setToolSubTab(subTab);
        switchTab(nextTab);
      },
      setTheme: (nextTheme) => setTheme(nextTheme),
      jumpToVodRef: (ref) => {
        setStudioMediaId("");
        setStudioVodRef(ref);
        switchTab("studio");
      },
      refreshStats: () => {
        refreshStats();
      },
      openCopilot: (presetPrompt) => {
        if (presetPrompt) setCopilotPreset(presetPrompt);
        setCopilotOpen(true);
      },
    });
    return () => echoAgentBridge.registerApp(null);
  }, [tab, theme, refreshStats, switchTab]);

  // 接收 Android B站/小宇宙「分享 -> EchoDeck」
  useEffect(() => {
    if (!isNativeAndroid()) return;
    const checkShare = async () => {
      const incoming = await consumeSharedIntent();
      if (incoming) {
        setSharedUrl(incoming);
        switchTab("ingest");
      }
    };
    checkShare();
    document.addEventListener("visibilitychange", checkShare);
    return () => document.removeEventListener("visibilitychange", checkShare);
  }, [switchTab]);

  const handleTourStepEnter = useCallback(
    (step: TourStep) => {
      if (step.tab) switchTab(step.tab);
      if (step.openStarterLesson) {
        setStudioMediaId("med_starter_demo");
      }
    },
    [switchTab]
  );

  const startFullTour = () => {
    setTourSteps(FULL_TOUR_STEPS);
    setTourActive(true);
  };

  const startCurrentPageTour = () => {
    const pageSteps = PAGE_TOUR_MAP[tab];
    setTourSteps(pageSteps.length > 0 ? pageSteps : FULL_TOUR_STEPS);
    setTourActive(true);
  };

  const handleCloseTour = () => {
    setTourActive(false);
    localStorage.setItem(TOUR_DONE_KEY, "1");
  };

  const toggleCoachTips = () => {
    setShowCoachTips((v) => {
      const next = !v;
      localStorage.setItem(TIPS_VISIBLE_KEY, String(next));
      return next;
    });
  };

  const navItems: Array<{ id: TabKey; label: string; icon: typeof BookOpen; badge?: number }> = [
    { id: "review", label: "复习", icon: BookOpen, badge: stats.dueCards },
    { id: "lexicon", label: "词库", icon: Library },
    { id: "studio", label: "影听", icon: Film },
    { id: "ingest", label: "导入", icon: DownloadCloud },
    { id: "sync", label: "工具", icon: Sparkles },
  ];

  const tabTitles: Record<TabKey, string> = {
    review: "今日复习",
    lexicon: "多语种词库",
    studio: "影听跟读",
    ingest: "导入素材",
    sync: "粤语与工具",
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      {systemToast && (
        <div className="pointer-events-none fixed bottom-24 left-1/2 z-[98] -translate-x-1/2 rounded-full bg-[var(--text-primary)]/92 px-4 py-2 text-xs font-medium text-[var(--bg-surface)] shadow-xl backdrop-blur-md">
          {systemToast}
        </div>
      )}

      {/* 极简通透的单行玻璃顶栏 */}
      <header className="surface-glass safe-top sticky top-0 z-30 flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-hairline)] px-3.5 pb-2.5 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <img
            src="./icon.png"
            alt="EchoDeck"
            className="h-8 w-8 shrink-0 rounded-[10px] object-cover shadow-xs sm:h-9 sm:w-9"
          />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[14px] font-bold tracking-tight text-[var(--text-primary)] sm:text-[15px]">
              {tabTitles[tab]}
            </div>
            <div className="truncate text-[10px] font-medium text-[var(--text-muted)]">EchoDeck · 自由精听舱</div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* 全局多对话页 AI 助教入口 */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic(8);
              setCopilotOpen(true);
            }}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[var(--accent)] px-2.5 py-1.5 text-[11px] font-bold text-[var(--accent-fg)] shadow-xs transition active:scale-95 sm:px-3 sm:text-xs"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            AI 助教
          </button>

          {/* 教学向导按钮 */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic(6);
              startCurrentPageTour();
            }}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[var(--accent-soft)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--accent-text)] transition active:scale-95 sm:text-xs"
          >
            <GraduationCap className="h-3.5 w-3.5 shrink-0" />
            教学
          </button>

          {/* 浅色 / 深色一键切换（同步原生状态栏配色） */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic(8);
              setTheme((t) => (t === "light" ? "dark" : "light"));
            }}
            title="切换浅色/深色外观"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-subtle)] text-[var(--text-secondary)] transition active:scale-95"
          >
            {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Keep-Alive 主内容区域：首次进入懒挂载，后续切页 0ms 瞬切且完整保留影厅进度/词库检索/滚动状态 */}
      <main className="min-h-0 flex-1 overflow-hidden">
        {mountedTabs.has("review") && (
          <div className={tab === "review" ? "h-full" : "hidden"}>
            <ReviewView
              showCoachTips={showCoachTips}
              onDismissCoachTips={toggleCoachTips}
              onStartPageTour={startCurrentPageTour}
              onOpenCoachWithChunks={(chunks, lang) => {
                setCoachPresetChunks(chunks);
                setCoachPresetLang(lang);
                setToolSubTab("coach");
                switchTab("sync");
              }}
              onJumpToVodRef={(ref) => {
                setStudioMediaId("");
                setStudioVodRef(ref);
                switchTab("studio");
              }}
              onCardsChanged={refreshStats}
            />
          </div>
        )}
        {mountedTabs.has("lexicon") && (
          <div className={tab === "lexicon" ? "h-full" : "hidden"}>
            <Suspense fallback={<TabLoadingFallback />}>
              <LexiconView
                showCoachTips={showCoachTips}
                onDismissCoachTips={toggleCoachTips}
                onStartPageTour={startCurrentPageTour}
                onCardsChanged={refreshStats}
                onJumpToMedia={(mediaId, startMs) => {
                  setStudioMediaId(mediaId);
                  setStudioSeekMs(startMs);
                  switchTab("studio");
                }}
              />
            </Suspense>
          </div>
        )}
        {mountedTabs.has("studio") && (
          <div className={tab === "studio" ? "h-full" : "hidden"}>
            <Suspense fallback={<TabLoadingFallback />}>
              <StudioView
                initialMediaId={studioMediaId}
                initialSeekMs={studioSeekMs}
                initialVodRef={studioVodRef}
                onConsumedSeek={() => setStudioSeekMs(undefined)}
                onConsumedVodRef={() => setStudioVodRef(null)}
                onOpenCoachWithChunks={(chunks, lang) => {
                  setCoachPresetChunks(chunks);
                  setCoachPresetLang(lang);
                  setToolSubTab("coach");
                  switchTab("sync");
                }}
                showCoachTips={showCoachTips}
                onDismissCoachTips={toggleCoachTips}
                onStartPageTour={startCurrentPageTour}
                onGoIngest={() => switchTab("ingest")}
                onCardsChanged={refreshStats}
              />
            </Suspense>
          </div>
        )}
        {mountedTabs.has("ingest") && (
          <div className={tab === "ingest" ? "h-full" : "hidden"}>
            <Suspense fallback={<TabLoadingFallback />}>
              <IngestView
                initialSharedUrl={sharedUrl}
                showCoachTips={showCoachTips}
                onDismissCoachTips={toggleCoachTips}
                onStartPageTour={startCurrentPageTour}
                onConsumeSharedUrl={() => setSharedUrl("")}
                onOpenMedia={(id) => {
                  setStudioMediaId(id);
                  switchTab("studio");
                  refreshStats();
                }}
              />
            </Suspense>
          </div>
        )}
        {mountedTabs.has("sync") && (
          <div className={tab === "sync" ? "h-full" : "hidden"}>
            <Suspense fallback={<TabLoadingFallback />}>
              <SyncLabView
                initialSubTab={toolSubTab}
                coachPresetChunks={coachPresetChunks}
                coachPresetLang={coachPresetLang}
                showCoachTips={showCoachTips}
                onDismissCoachTips={toggleCoachTips}
                onStartPageTour={startCurrentPageTour}
                onStartFullTour={startFullTour}
                onDataChanged={refreshStats}
              />
            </Suspense>
          </div>
        )}
      </main>

      {/* 悬浮毛玻璃胶囊底栏（Floating Glass Dock） */}
      <div className="safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4">
        <nav className="floating-dock pointer-events-auto grid w-full max-w-md grid-cols-5 rounded-full p-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (tab !== item.id) triggerHaptic(8);
                  switchTab(item.id);
                }}
                className={`relative flex flex-col items-center justify-center gap-0.5 rounded-full py-2 text-[11px] font-semibold transition ${
                  active ? "text-[var(--accent-fg)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="dock-active-pill"
                    transition={{ type: "spring", stiffness: 420, damping: 32 }}
                    className="absolute inset-0 rounded-full bg-[var(--accent)]"
                  />
                )}
                <span className="relative z-10 flex items-center justify-center">
                  <Icon className="h-[18px] w-[18px]" />
                  {typeof item.badge === "number" && item.badge > 0 && item.id === "review" && !active && (
                    <span className="absolute -right-3 -top-1 rounded-full bg-[var(--accent)] px-1.5 font-mono-code text-[9px] font-bold text-white">
                      {item.badge}
                    </span>
                  )}
                </span>
                <span className="relative z-10">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* 全链路聚光灯手把手交互教学引擎 */}
      <GuidedTour
        steps={tourSteps}
        active={tourActive}
        onStepEnter={handleTourStepEnter}
        onClose={handleCloseTour}
      />

      {/* 全局多对话页全权限 AI 助教工作台（按需加载，首次打开后常驻） */}
      {copilotOpen && (
        <Suspense fallback={null}>
          <GlobalAiCopilot
            open={copilotOpen}
            activeTab={tab}
            presetPrompt={copilotPreset}
            onConsumePreset={() => setCopilotPreset("")}
            onClose={() => setCopilotOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
