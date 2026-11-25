/**
 * EchoDeck v8.5 沉浸式目标语 AI 对话气泡（全应用 3 处 AI 统一复用）：
 * 1. 中文提问自动外语复述卡（userQuestionRecast）：显示地道目标语问法 + 微软真人朗读 + 一键存进今日复习
 * 2. AI 回答默认严格使用用户当前正在学习的语种；点击气泡任意空白处（或「译 看中文」按钮）立即展开/收起自然中文翻译
 * 3. 缺省译文时支持点一下按需秒翻并缓存；粤语回答额外支持一键展开离线粤拼注音
 * 4. 完整保留 App 全权限执行回执胶囊与表达纠错升级卡片
 */
import { useState } from "react";
import { Check, CheckCircle2, Copy, Languages, Play, Volume2, Wand2, Zap } from "lucide-react";
import type { AgentCorrection, AgentTurnMessage, AgentVodHitCard } from "../lib/aiAgentEngine";
import { echoAgentBridge, getStudyLangMeta } from "../lib/appAgentBridge";
import { annotateJyutpingOffline } from "../lib/cantoneseLocal";
import { recordDailyActivity } from "../lib/lexiconStore";
import { speakOffline, triggerHaptic } from "../lib/nativeBridge";
import { createCardLocal, translateTextToZhDirect } from "../lib/standaloneStore";
import { PosterImage } from "./PosterImage";

interface AiAssistantBubbleProps {
  message: AgentTurnMessage;
  /** 对应的上一条用户原话（用于把「外语复述问句」一键存卡时带上中文原意） */
  prevUserText?: string;
  compact?: boolean;
  onSavedCard?: (toastMsg: string) => void;
  onSaveCorrection?: (corr: AgentCorrection) => Promise<void> | void;
  onMarkRecastSaved?: () => void;
  onMarkCorrectionSaved?: () => void;
  onPlayVodCard?: (card: AgentVodHitCard) => void;
  onPickSuggestion?: (prompt: string) => void;
  correctionSaved?: boolean;
}

export function AiAssistantBubble({
  message,
  prevUserText = "",
  compact = false,
  onSavedCard,
  onSaveCorrection,
  onMarkRecastSaved,
  onMarkCorrectionSaved,
  onPlayVodCard,
  onPickSuggestion,
  correctionSaved = false,
}: AiAssistantBubbleProps) {
  const targetLang = (message.targetLang || message.speakLang || echoAgentBridge.getActiveStudyLang() || "en").toLowerCase();
  const meta = getStudyLangMeta(targetLang);

  const [showZh, setShowZh] = useState(false);
  const [zhCache, setZhCache] = useState(message.replyZh || "");
  const [translatingZh, setTranslatingZh] = useState(false);
  const [showJyutping, setShowJyutping] = useState(false);
  const [savedRecast, setSavedRecast] = useState(Boolean(message.savedRecast));
  const [localCorrSaved, setLocalCorrSaved] = useState(Boolean(message.savedCorrection));
  const [copiedReply, setCopiedReply] = useState(false);

  const handleCopyReply = async () => {
    const txt = (message.content || "").trim();
    if (!txt) return;
    try {
      await navigator.clipboard?.writeText(txt);
      triggerHaptic(8);
      setCopiedReply(true);
      setTimeout(() => setCopiedReply(false), 1800);
      onSavedCard?.("已复制地道回复内容");
    } catch {
      // ignore clipboard fallback
    }
  };

  const isCorrSaved = correctionSaved || localCorrSaved;

  const toggleChineseTranslation = async () => {
    if (showZh) {
      setShowZh(false);
      return;
    }
    setShowZh(true);
    if (!zhCache.trim() && message.content.trim()) {
      setTranslatingZh(true);
      try {
        const translated = await translateTextToZhDirect(message.content, targetLang);
        setZhCache(translated || "（暂无可翻译内容）");
      } catch {
        setZhCache("翻译通道暂时繁忙，请稍后再点一次重试");
      } finally {
        setTranslatingZh(false);
      }
    }
  };

  const handleSaveRecastCard = async () => {
    const recast = (message.userQuestionRecast || "").trim();
    if (!recast || savedRecast) return;
    await createCardLocal({
      front_text: recast,
      translation: prevUserText.trim() || "中文提问地道外语复述",
      jyutping: targetLang === "yue" ? annotateJyutpingOffline(recast).jyutping : "",
      focus_chunk: "",
      note: `AI 将你的中文提问转换为地道${meta.label}复述`,
      language: targetLang,
      tags: ["AI提问复述", meta.label],
    });
    recordDailyActivity("review");
    echoAgentBridge.notifyDataChanged();
    setSavedRecast(true);
    onMarkRecastSaved?.();
    onSavedCard?.(`已将地道${meta.shortLabel}问法存入「今日复习」`);
  };

  const handleDefaultSaveCorrection = async (corr: AgentCorrection) => {
    if (isCorrSaved) return;
    if (onSaveCorrection) {
      await onSaveCorrection(corr);
      setLocalCorrSaved(true);
      onMarkCorrectionSaved?.();
      return;
    }
    await createCardLocal({
      front_text: corr.improved,
      translation: corr.original ? `升级自：${corr.original}` : corr.reason,
      jyutping: corr.lang === "yue" ? annotateJyutpingOffline(corr.improved).jyutping : "",
      focus_chunk: corr.focus_chunk || "",
      note: `AI 纠错升级：${corr.reason}${corr.original ? `\n原表达：${corr.original}` : ""}`,
      language: corr.lang || targetLang,
      tags: ["AI纠错升级", getStudyLangMeta(corr.lang || targetLang).label],
    });
    recordDailyActivity("review");
    echoAgentBridge.notifyDataChanged();
    setLocalCorrSaved(true);
    onMarkCorrectionSaved?.();
    onSavedCard?.("已将地道升级句存入「今日复习」");
  };

  const speakTarget = (message.speakText || message.content || "").trim();

  return (
    <div className="flex w-full flex-col items-start">
      {/* 1. App 全权限执行回执胶囊 */}
      {message.receipts && message.receipts.length > 0 && (
        <div className="mb-1.5 flex max-w-[94%] flex-wrap gap-1">
          {message.receipts.map((rc, i) => (
            <div
              key={`${message.id}_rc_${i}`}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                rc.ok
                  ? "bg-emerald-500/14 text-emerald-700 dark:text-emerald-300"
                  : "bg-amber-500/14 text-amber-700 dark:text-amber-300"
              }`}
            >
              <Wand2 className="h-3 w-3 shrink-0" />
              <span>{rc.label}</span>
              {rc.detail && <span className="max-w-[130px] truncate font-normal opacity-80">· {rc.detail}</span>}
            </div>
          ))}
        </div>
      )}

      {/* 2. 🗣️ 中文提问自动转换地道目标语复述卡 */}
      {message.userQuestionRecast && (
        <div className="mb-1.5 w-full max-w-[94%] space-y-1.5 rounded-2xl border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold text-sky-700 dark:text-sky-300">
              🗣️ 你的问题 · 地道{meta.shortLabel}这样问
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => speakOffline(message.userQuestionRecast!, targetLang, 0.94)}
                className="inline-flex items-center gap-0.5 rounded-full bg-[var(--bg-surface)] px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300 active:scale-95"
              >
                <Volume2 className="h-3 w-3" />
                朗读
              </button>
              <button
                type="button"
                disabled={savedRecast}
                onClick={handleSaveRecastCard}
                className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold active:scale-95 ${
                  savedRecast
                    ? "bg-emerald-500/18 text-emerald-700 dark:text-emerald-300"
                    : "bg-sky-600 text-white"
                }`}
              >
                {savedRecast ? "已存卡 ✓" : "+ 存复习卡"}
              </button>
            </div>
          </div>
          <div className="text-[13px] font-bold leading-snug text-[var(--text-primary)]">
            {message.userQuestionRecast}
          </div>
          {targetLang === "yue" && (
            <div className="font-mono-code text-[10px] text-sky-700/80 dark:text-sky-300/80">
              {annotateJyutpingOffline(message.userQuestionRecast).jyutping}
            </div>
          )}
        </div>
      )}

      {/* 3. ✍️ 实时外语表达纠错与地道升级卡片 */}
      {message.correction && (
        <div className="mb-1.5 w-full max-w-[94%] space-y-1.5 rounded-2xl border border-[var(--accent-ring)] bg-[var(--accent-soft)] p-3 text-xs">
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[11px] font-bold text-[var(--accent-text)]">
              ✍️ 表达纠错与地道升级（{getStudyLangMeta(message.correction.lang || targetLang).shortLabel}）
            </span>
            {message.correction.focus_chunk && (
              <span className="rounded-full bg-[var(--bg-surface)] px-2 py-0.5 text-[10px] font-bold text-[var(--text-primary)]">
                {message.correction.focus_chunk}
              </span>
            )}
          </div>
          {message.correction.original && (
            <div className="text-[11px] text-[var(--text-muted)] line-through">{message.correction.original}</div>
          )}
          <div className="text-sm font-bold leading-snug text-[var(--text-primary)]">
            {message.correction.improved}
          </div>
          {(message.correction.lang || targetLang) === "yue" && (
            <div className="font-mono-code text-[10px] text-[var(--accent-text)]">
              {annotateJyutpingOffline(message.correction.improved).jyutping}
            </div>
          )}
          {message.correction.reason && (
            <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">💡 {message.correction.reason}</p>
          )}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={() => speakOffline(message.correction!.improved, message.correction!.lang || targetLang, 0.94)}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-primary)]"
            >
              <Volume2 className="h-3 w-3 text-[var(--accent-text)]" />
              真人朗读
            </button>
            <button
              type="button"
              disabled={isCorrSaved}
              onClick={() => handleDefaultSaveCorrection(message.correction!)}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                isCorrSaved
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-[var(--accent)] text-[var(--accent-fg)]"
              }`}
            >
              {isCorrSaved ? (
                <>
                  <CheckCircle2 className="h-3 w-3" />
                  已存今日复习
                </>
              ) : (
                <>
                  <Zap className="h-3 w-3" />
                  一键存复习卡
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* 4. 💬 主回复气泡（目标语沉浸回答，点一下立即展开/收起完整中文翻译！） */}
      <div
        role="button"
        tabIndex={0}
        onClick={toggleChineseTranslation}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleChineseTranslation();
          }
        }}
        title="点击展开或收起中文翻译"
        className={`max-w-[92%] cursor-pointer rounded-2xl border border-transparent bg-[var(--bg-subtle)] text-[var(--text-primary)] transition hover:border-[var(--border-strong)] active:scale-[0.995] ${
          compact ? "px-3.5 py-2.5 text-xs leading-relaxed" : "px-4 py-3 text-sm leading-relaxed"
        }`}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>

        {/* 粤语一键粤拼展开 */}
        {targetLang === "yue" && showJyutping && (
          <div className="mt-1.5 rounded-xl bg-[var(--bg-surface)]/80 px-2.5 py-1.5 font-mono-code text-[10px] leading-relaxed text-[var(--accent-text)]">
            {annotateJyutpingOffline(message.content).jyutping}
          </div>
        )}

        {/* 点击气泡展开的自然中文翻译对照 */}
        {showZh && (
          <div className="mt-2 border-t border-[var(--border-hairline)] pt-2 text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
            <span className="mr-1 inline-block rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[9.5px] font-bold text-[var(--accent-text)]">
              中文
            </span>
            {translatingZh ? "正在翻译成中文..." : zhCache || "（点击重试翻译）"}
          </div>
        )}

        {/* 底部操作微栏 */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="mt-2 flex flex-wrap items-center gap-1.5"
        >
          <button
            type="button"
            onClick={toggleChineseTranslation}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition active:scale-95 ${
              showZh
                ? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
                : "bg-[var(--bg-surface)] text-[var(--text-secondary)]"
            }`}
          >
            <Languages className="h-3 w-3" />
            {showZh ? "收起中文" : "点我看中文翻译"}
          </button>

          {speakTarget && (
            <button
              type="button"
              onClick={() => speakOffline(speakTarget, targetLang, 0.94)}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-surface)] px-2.5 py-0.5 text-[10px] font-semibold text-[var(--accent-text)] active:scale-95"
            >
              <Volume2 className="h-3 w-3" />
              {meta.shortLabel}朗读
            </button>
          )}

          <button
            type="button"
            onClick={handleCopyReply}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-surface)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)] transition hover:text-[var(--text-primary)] active:scale-95"
          >
            {copiedReply ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            {copiedReply ? "已复制" : "复制"}
          </button>

          {targetLang === "yue" && (
            <button
              type="button"
              onClick={() => setShowJyutping((v) => !v)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold active:scale-95 ${
                showJyutping
                  ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                  : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
              }`}
            >
              {showJyutping ? "隐藏粤拼" : "标粤拼"}
            </button>
          )}
        </div>
      </div>

      {/* 5. 🎬 搜片直达播片卡片（在 AI 对话里直接点「立即播放」秒进影厅开播！） */}
      {message.vodCards && message.vodCards.length > 0 && (
        <div className="mt-2 w-full max-w-[94%] space-y-1.5">
          {message.vodCards.slice(0, 5).map((vc) => (
            <div
              key={`${vc.sourceKey}_${vc.vodId}`}
              className="flex items-center gap-2.5 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-2 shadow-2xs"
            >
              <PosterImage
                src={vc.pic}
                alt={vc.title}
                compact
                className="h-12 w-9 shrink-0 rounded-lg bg-[var(--bg-subtle)] object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold text-[var(--text-primary)]">{vc.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-[var(--text-muted)]">
                  {vc.remarks && (
                    <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 font-medium text-[var(--text-secondary)]">
                      {vc.remarks}
                    </span>
                  )}
                  <span>{vc.sourceName}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (onPlayVodCard) {
                    onPlayVodCard(vc);
                  } else {
                    echoAgentBridge.getApp()?.jumpToVodRef({
                      sourceKey: vc.sourceKey,
                      sourceApi: vc.sourceApi,
                      vodId: vc.vodId,
                      title: vc.title,
                      routeName: "",
                      episodeName: "",
                      timeSec: 0,
                    });
                  }
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--accent)] px-3 py-1.5 text-[11px] font-bold text-[var(--accent-fg)] shadow-xs active:scale-95"
              >
                <Play className="h-3 w-3 fill-current" />
                立即播放
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 6. ✨ 智能上下文快捷跟进/跟练建议胶囊（点一下直接接话或执行下一步） */}
      {onPickSuggestion && message.suggestedReplies && message.suggestedReplies.length > 0 && (
        <div className="mt-2 flex max-w-[94%] flex-wrap gap-1.5">
          {message.suggestedReplies.slice(0, 3).map((sug, i) => (
            <button
              key={`${message.id}_sug_${i}`}
              type="button"
              onClick={() => onPickSuggestion(sug.prompt)}
              className="group inline-flex flex-col items-start rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-left transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]/50 active:scale-95"
            >
              <span className="text-[11px] font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-text)]">
                {sug.label}
              </span>
              {sug.zhHint && (
                <span className="text-[9.5px] text-[var(--text-muted)]">{sug.zhHint}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
