/**
 * 跨板块离线点词速查弹窗（用于「影听」字幕点词即查 & 「复习」卡片点击查词）：
 * - 毫秒级查出 5 万词离线释义、音标/粤拼、词形变化与真人双语例句
 * - 一键离线发音、⭐ 收藏进词库、✅ 标为已过、⚡ 连同当前语境原句直接制卡进 FSRS 复习
 */
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BookMarked, Check, Star, Volume2, X } from "lucide-react";
import {
  buildUsagePatterns,
  getSingleWordMark,
  lookupWordOffline,
  parseWordForms,
  setWordMark,
} from "../lib/lexiconStore";
import { annotateJyutpingOffline } from "../lib/cantoneseLocal";
import { speakOffline } from "../lib/nativeBridge";
import { createCardLocal } from "../lib/standaloneStore";
import type { LexiconEntry, WordMarkStatus } from "../types";

/** 将英文句子或粤语/中文句子渲染为「点词即查」可点击文本：
 * - 英文：点击任意单词立即查词（自动还原过去式/复数/进行时）
 * - 粤语/中文：点击任意汉字自动向后贪心匹配 4→3→2→1 字词组（如点「睇」命中「睇戲」、点「冇」命中「冇得彈」）
 */
export function ClickableWordsText({
  text,
  lang = "en",
  onWordClick,
  enabled = true,
}: {
  text: string;
  lang?: string;
  onWordClick: (word: string) => void;
  enabled?: boolean;
}) {
  if (!enabled || !text) return <>{text}</>;

  // 英文优先按单词切分
  const hasLatin = /[A-Za-z]{2,}/.test(text);
  const hasCjk = /[\u4e00-\u9fff]/.test(text);

  if (hasLatin && (!hasCjk || lang === "en")) {
    const parts = text.split(/([A-Za-z][A-Za-z'-]*)/g);
    return (
      <>
        {parts.map((part, idx) =>
          /^[A-Za-z][A-Za-z'-]+$/.test(part) ? (
            <span
              key={idx}
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onWordClick(part);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onWordClick(part);
                }
              }}
              className="cursor-pointer rounded px-0.5 transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-text)] active:bg-[var(--accent-soft)]"
            >
              {part}
            </span>
          ) : (
            <span key={idx}>{part}</span>
          )
        )}
      </>
    );
  }

  // 粤语 / 中文逐字可点，点击自动向后取最长 4 字窗口交给离线词典贪心匹配
  const chars = Array.from(text);
  return (
    <>
      {chars.map((ch, idx) =>
        /[\u4e00-\u9fff]/.test(ch) ? (
          <span
            key={idx}
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onWordClick(chars.slice(idx, idx + 4).join(""));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onWordClick(chars.slice(idx, idx + 4).join(""));
              }
            }}
            className="cursor-pointer rounded-[3px] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-text)]"
          >
            {ch}
          </span>
        ) : (
          <span key={idx}>{ch}</span>
        )
      )}
    </>
  );
}

interface WordQuickLookupModalProps {
  query: string | null;
  langHint?: string;
  contextSentence?: string;
  contextTranslation?: string;
  onClose: () => void;
  onCardCreated?: (msg: string) => void;
}

export function WordQuickLookupModal({
  query,
  langHint = "en",
  contextSentence = "",
  contextTranslation = "",
  onClose,
  onCardCreated,
}: WordQuickLookupModalProps) {
  const [entry, setEntry] = useState<LexiconEntry | null>(null);
  const [mark, setMark] = useState<WordMarkStatus>("none");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query) {
      setEntry(null);
      return;
    }
    let alive = true;
    setLoading(true);
    lookupWordOffline(query, langHint)
      .then(async (hit) => {
        if (!alive) return;
        setEntry(hit);
        if (hit) {
          const st = await getSingleWordMark(hit.id);
          if (alive) setMark(st);
        } else {
          setMark("none");
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [query, langHint]);

  useEffect(() => {
    if (!query) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [query, onClose]);

  if (!query) return null;

  const forms = parseWordForms(entry?.exchange);
  const usageTips = entry ? buildUsagePatterns(entry) : [];
  const effectiveLang = entry?.lang || langHint;

  const toggleFav = async () => {
    if (!entry) return;
    const next: WordMarkStatus = mark === "favorite" ? "none" : "favorite";
    await setWordMark(entry.id, entry.lang, next);
    setMark(next);
    onCardCreated?.(next === "favorite" ? `⭐ 已收藏「${entry.word}」到词库` : `已取消收藏「${entry.word}」`);
  };

  const togglePass = async () => {
    if (!entry) return;
    const next: WordMarkStatus = mark === "passed" ? "none" : "passed";
    await setWordMark(entry.id, entry.lang, next);
    setMark(next);
    onCardCreated?.(next === "passed" ? `✅ 已将「${entry.word}」标为认识` : `已恢复「${entry.word}」到待背`);
  };

  const sendWithContext = async () => {
    const wordText = entry?.word || query;
    const front = contextSentence ? `${wordText} — ${contextSentence}` : wordText;
    const trans = entry?.meaning
      ? contextTranslation
        ? `${entry.meaning}｜原句：${contextTranslation}`
        : entry.meaning
      : contextTranslation;
    await createCardLocal({
      front_text: front,
      translation: trans,
      jyutping: effectiveLang === "yue" ? entry?.phonetic || annotateJyutpingOffline(wordText).jyutping : "",
      focus_chunk: wordText,
      note: entry?.examples?.[0]
        ? `词库例句：${entry.examples[0].text}（${entry.examples[0].translation}）`
        : "",
      language: effectiveLang,
      tags: ["点词速查", effectiveLang === "yue" ? "粤语" : "英语"],
    });
    if (entry && mark !== "favorite") {
      await setWordMark(entry.id, entry.lang, "favorite");
      setMark("favorite");
    }
    onCardCreated?.(`已将「${wordText}」连同语境送入今日复习`);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/55 p-3 backdrop-blur-xs sm:items-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[82vh] w-full max-w-md overflow-y-auto rounded-[28px] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-xl font-extrabold text-[var(--text-primary)]">{entry?.word || query}</h3>
              {entry?.alt && <span className="text-xs text-[var(--text-muted)]">({entry.alt})</span>}
            </div>
            {(entry?.phonetic || effectiveLang === "yue") && (
              <p className="mt-0.5 font-mono-code text-xs font-medium text-[var(--accent-text)]">
                {effectiveLang === "en"
                  ? `/${entry?.phonetic}/`
                  : entry?.phonetic || annotateJyutpingOffline(query).jyutping}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 发音按钮 */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => speakOffline(entry?.word || query, effectiveLang, 0.95)}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-3.5 py-1.5 text-xs font-semibold text-[var(--accent-text)]"
          >
            <Volume2 className="h-3.5 w-3.5" />
            发音
          </button>
          <button
            type="button"
            onClick={() => speakOffline(entry?.word || query, effectiveLang, 0.72)}
            className="rounded-full bg-[var(--bg-subtle)] px-3 py-1.5 font-mono-code text-xs text-[var(--text-secondary)]"
          >
            0.7x 慢读
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-xs text-[var(--text-muted)]">正在离线检索 5 万词库...</div>
        ) : !entry ? (
          <div className="mt-4 rounded-2xl bg-[var(--bg-subtle)] p-4 text-xs text-[var(--text-secondary)]">
            未在离线词典中找到「{query}」的独立词条，但你仍可直接将它连同当前原句一键送入复习卡。
          </div>
        ) : (
          <div className="mt-4 space-y-3 text-xs">
            <div className="rounded-2xl bg-[var(--bg-subtle)]/85 p-3.5">
              <p className="text-sm font-semibold leading-relaxed text-[var(--text-primary)]">{entry.meaning}</p>
            </div>

            {forms.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {forms.map((f) => (
                  <span
                    key={`${f.label}-${f.value}`}
                    className="rounded-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]"
                  >
                    <span className="text-[var(--text-muted)]">{f.label}</span>{" "}
                    <strong className="font-mono-code text-[var(--text-primary)]">{f.value}</strong>
                  </span>
                ))}
              </div>
            )}

            {entry.examples && entry.examples.length > 0 ? (
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-[var(--text-muted)]">地道例句（点句朗读）</div>
                {entry.examples.map((ex, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => speakOffline(ex.text, entry.lang, 0.92)}
                    className="block w-full rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3 text-left transition hover:border-[var(--accent)]"
                  >
                    <p className="text-xs font-semibold leading-relaxed text-[var(--text-primary)]">{ex.text}</p>
                    {entry.lang === "yue" && (
                      <p className="mt-0.5 font-mono-code text-[10px] text-[var(--accent-text)]">
                        {annotateJyutpingOffline(ex.text).jyutping}
                      </p>
                    )}
                    {ex.translation && <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{ex.translation}</p>}
                  </button>
                ))}
              </div>
            ) : (
              usageTips[0] && (
                <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3">
                  <div className="text-[11px] font-bold text-[var(--accent-text)]">{usageTips[0].title}</div>
                  <div className="mt-1 font-mono-code text-[11px] text-[var(--text-primary)]">{usageTips[0].formula}</div>
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">{usageTips[0].hint}</p>
                </div>
              )
            )}
          </div>
        )}

        {/* 底部一键操作 */}
        <div className="mt-5 grid grid-cols-3 gap-2 text-xs">
          {entry && (
            <>
              <button
                type="button"
                onClick={toggleFav}
                className={`flex items-center justify-center gap-1 rounded-2xl py-2.5 font-semibold ${
                  mark === "favorite"
                    ? "bg-amber-500/15 text-amber-500"
                    : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                }`}
              >
                <Star className={`h-3.5 w-3.5 ${mark === "favorite" ? "fill-current" : ""}`} />
                {mark === "favorite" ? "已收藏" : "收藏"}
              </button>
              <button
                type="button"
                onClick={togglePass}
                className={`flex items-center justify-center gap-1 rounded-2xl py-2.5 font-semibold ${
                  mark === "passed"
                    ? "bg-emerald-500 text-white"
                    : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                }`}
              >
                <Check className="h-3.5 w-3.5" />
                {mark === "passed" ? "已过" : "认识·过"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={sendWithContext}
            className={`flex items-center justify-center gap-1 rounded-2xl bg-[var(--accent)] py-2.5 font-semibold text-[var(--accent-fg)] ${
              entry ? "" : "col-span-3"
            }`}
          >
            <BookMarked className="h-3.5 w-3.5" />
            进复习卡
          </button>
        </div>
      </motion.div>
    </div>
  );
}
