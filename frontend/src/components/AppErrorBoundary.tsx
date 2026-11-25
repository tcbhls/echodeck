import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMsg: string;
}

/** 全局崩溃防护盾：任何组件偶发异常绝不白屏卡死，提供一键无损恢复 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMsg: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMsg: error?.message || "页面渲染遇到小波动" };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // 已由边界捕获并展示恢复入口
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center bg-[var(--bg-canvas)] px-6 text-center text-[var(--text-primary)]">
          <div className="surface-card w-full max-w-sm rounded-[28px] p-6">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-xl">
              🛡️
            </div>
            <h2 className="text-base font-bold">刚才页面出了点小状况</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
              你的所有复习词卡、长期记忆与本地数据都完好无损。点下方按钮即可立刻恢复：
            </p>
            {this.state.errorMsg && (
              <div className="mt-3 rounded-xl bg-[var(--bg-subtle)] px-3 py-2 font-mono-code text-[10px] text-[var(--text-muted)]">
                {this.state.errorMsg.slice(0, 120)}
              </div>
            )}
            <div className="mt-5 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, errorMsg: "" })}
                className="rounded-full bg-[var(--accent)] px-5 py-2 text-xs font-bold text-[var(--accent-fg)] shadow-xs"
              >
                立即恢复页面
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-full bg-[var(--bg-subtle)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)]"
              >
                重新载入
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
