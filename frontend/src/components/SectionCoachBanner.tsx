import { GraduationCap, PlayCircle, X } from "lucide-react";

interface SectionCoachBannerProps {
  visible: boolean;
  title: string;
  stepsText: string;
  onStartPageTour: () => void;
  onDismiss: () => void;
}

/**
 * 教学模式常驻轻提示条：放在每个板块顶部，一句话讲清楚当前页面“按哪 3 步用”，
 * 并提供一键唤醒本页聚光灯手把手演示；熟悉后点右侧 × 即可隐藏。
 */
export function SectionCoachBanner({
  visible,
  title,
  stepsText,
  onStartPageTour,
  onDismiss,
}: SectionCoachBannerProps) {
  if (!visible) return null;

  return (
    <div className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-[var(--accent-ring)] bg-[var(--accent-soft)] px-4 py-3 text-xs">
      <div className="flex min-w-0 items-start gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-[var(--accent-fg)]">
          <GraduationCap className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-[var(--text-primary)]">{title}</div>
          <p className="mt-0.5 leading-relaxed text-[var(--text-secondary)]">{stepsText}</p>
          <button
            type="button"
            onClick={onStartPageTour}
            className="mt-2 inline-flex items-center gap-1 rounded-full bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-text)] shadow-xs transition hover:opacity-90"
          >
            <PlayCircle className="h-3.5 w-3.5" />
            点我演示本页每一步怎么操作
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={onDismiss}
        title="收起本页行动提示"
        className="shrink-0 rounded-full p-1 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)]"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
