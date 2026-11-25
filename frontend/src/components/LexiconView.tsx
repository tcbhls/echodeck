import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookMarked,
  BookOpenText,
  Check,
  CheckCircle2,
  Ear,
  Eye,
  Film,
  Flame,
  Globe,
  Headphones,
  List,
  Pause,
  PenLine,
  Play,
  Plus,
  RotateCcw,
  Search,
  SkipForward,
  Sparkles,
  Star,
  Target,
  Trash2,
  Upload,
  Volume2,
  Wand2,
  X,
} from "lucide-react";
import { echoAgentBridge } from "../lib/appAgentBridge";
import { annotateJyutpingOffline } from "../lib/cantoneseLocal";
import {
  addCustomLanguage,
  addCustomWord,
  buildUsagePatterns,
  deleteCustomWord,
  deleteUserSentence,
  EN_BOOK_FILTERS,
  FUTURE_LANGUAGE_PRESETS,
  getAllLanguages,
  getUserSentences,
  getWordMarksMap,
  importCustomLexiconFile,
  loadLexiconForLanguage,
  parseWordForms,
  saveUserSentence,
  setWordMark,
  YUE_BOOK_FILTERS,
  type LanguageMeta,
} from "../lib/lexiconStore";
import { speakOffline } from "../lib/nativeBridge";
import {
  aiWordCoachDirect,
  createCardLocal,
  findSubtitlesContainingWord,
} from "../lib/standaloneStore";
import type {
  LexiconEntry,
  MediaSentenceHit,
  UserWordSentence,
  WordMarkStatus,
} from "../types";
import { SectionCoachBanner } from "./SectionCoachBanner";

interface LexiconViewProps {
  showCoachTips: boolean;
  onDismissCoachTips: () => void;
  onStartPageTour: () => void;
  onCardsChanged?: () => void;
  onJumpToMedia?: (mediaId: string, startMs: number) => void;
}

const TAG_BADGE_MAP: Record<string, string> = {
  ox: "牛津3000",
  hot: "柯林斯高频",
  zk: "中考",
  gk: "高考",
  cet4: "四级",
  cet6: "六级",
  ky: "考研",
  ielts: "雅思",
  toefl: "托福",
  gre: "GRE",
  freq: "高频词",
  daily: "日常高频",
  drama: "港剧常用",
  slang: "地道口语",
  adv: "进阶",
  自建: "自建",
  导入: "导入",
};

/** 高亮例句中命中的目标词（含过去式/复数等词形变化） */
function renderHighlightedSentence(sentence: string, entry: LexiconEntry) {
  if (!sentence) return null;
  if (entry.lang === "en") {
    const tokens = new Set<string>([entry.word.toLowerCase()]);
    if (entry.exchange) {
      for (const seg of entry.exchange.split("/")) {
        const [, v] = seg.split(":");
        if (v && v.length >= 2) tokens.add(v.toLowerCase());
      }
    }
    const escaped = Array.from(tokens)
      .sort((a, b) => b.length - a.length)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    if (!escaped) return sentence;
    const rx = new RegExp(`(\\b(?:${escaped})\\b)`, "gi");
    const parts = sentence.split(rx);
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <mark
          key={i}
          className="rounded bg-[var(--accent-soft)] px-1 font-bold text-[var(--accent-text)]"
        >
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  }

  // 粤语及其他语言按子串高亮
  const key = entry.word;
  if (!key || !sentence.includes(key)) return sentence;
  const parts = sentence.split(key);
  return parts.map((p, i) => (
    <span key={i}>
      {p}
      {i < parts.length - 1 && (
        <mark className="rounded bg-[var(--accent-soft)] px-0.5 font-bold text-[var(--accent-text)]">
          {key}
        </mark>
      )}
    </span>
  ));
}

interface QuizQuestion {
  target: LexiconEntry;
  options: LexiconEntry[];
}

export function LexiconView({
  showCoachTips,
  onDismissCoachTips,
  onStartPageTour,
  onCardsChanged,
  onJumpToMedia,
}: LexiconViewProps) {
  const [languages, setLanguages] = useState<LanguageMeta[]>([]);
  const [lang, setLang] = useState<string>(() => echoAgentBridge.getActiveStudyLang() || "en");
  const [viewMode, setViewMode] = useState<"flash" | "list" | "quiz">("flash");
  const [bookFilter, setBookFilter] = useState<string>("");
  const [listFilter, setListFilter] = useState<"todo" | "favorite" | "passed" | "all">("todo");
  const [searchText, setSearchText] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(60);

  const [words, setWords] = useState<LexiconEntry[]>([]);
  const [marks, setMarks] = useState<Map<string, WordMarkStatus>>(new Map());
  const [loading, setLoading] = useState(true);

  // 过词闪卡状态
  const [revealed, setRevealed] = useState(false);
  const [lastPassedUndo, setLastPassedUndo] = useState<{ entry: LexiconEntry; prev: WordMarkStatus } | null>(null);
  const [flashCursor, setFlashCursor] = useState(0);

  // 🎧 随身磨耳朵自动连播状态
  const [commuteActive, setCommuteActive] = useState(false);
  const [commuteOnlyFav, setCommuteOnlyFav] = useState(false);
  const [commuteIndex, setCommuteIndex] = useState(0);
  const [commuteStage, setCommuteStage] = useState<"word" | "example">("word");
  const commuteTimerRef = useRef<number | null>(null);

  // 🎯 听音辨义测验状态
  const [quizOnlyFav, setQuizOnlyFav] = useState(false);
  const [quizBlindAudio, setQuizBlindAudio] = useState(false);
  const [quizQ, setQuizQ] = useState<QuizQuestion | null>(null);
  const [quizPickedId, setQuizPickedId] = useState<string | null>(null);
  const [quizStreak, setQuizStreak] = useState(0);
  const [quizTotal, setQuizTotal] = useState(0);
  const [quizCorrect, setQuizCorrect] = useState(0);

  // ✍️ 单词详情 · 用法与造句工坊抽屉状态
  const [detailWord, setDetailWord] = useState<LexiconEntry | null>(null);
  const [mediaHits, setMediaHits] = useState<MediaSentenceHit[]>([]);
  const [userSents, setUserSents] = useState<UserWordSentence[]>([]);
  const [draftSent, setDraftSent] = useState("");
  const [draftTrans, setDraftTrans] = useState("");
  const [aiCoachBusy, setAiCoachBusy] = useState(false);
  const [aiCoachResult, setAiCoachResult] = useState("");

  // 弹窗：添加新语种 / 手动添词 / 导入外部词书
  const [showAddLang, setShowAddLang] = useState(false);
  const [customLangName, setCustomLangName] = useState("");
  const [customLangCode, setCustomLangCode] = useState("");
  const [customLangTts, setCustomLangTts] = useState("ja-JP");

  const [showAddWord, setShowAddWord] = useState(false);
  const [newWordText, setNewWordText] = useState("");
  const [newWordPhonetic, setNewWordPhonetic] = useState("");
  const [newWordMeaning, setNewWordMeaning] = useState("");
  const [newWordExample, setNewWordExample] = useState("");
  const [newWordExampleTrans, setNewWordExampleTrans] = useState("");
  const [toast, setToast] = useState("");

  const importRef = useRef<HTMLInputElement | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((c) => (c === msg ? "" : c)), 2600);
  };

  useEffect(() => {
    getAllLanguages().then(setLanguages);
  }, []);

  const loadLangData = useCallback(async (targetLang: string) => {
    setLoading(true);
    setRevealed(false);
    setFlashCursor(0);
    setVisibleLimit(60);
    setCommuteActive(false);
    try {
      const [list, markMap] = await Promise.all([
        loadLexiconForLanguage(targetLang),
        getWordMarksMap(targetLang),
      ]);
      setWords(list);
      setMarks(markMap);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setBookFilter("");
    echoAgentBridge.setActiveStudyLang(lang);
    loadLangData(lang);
  }, [lang, loadLangData]);

  // 订阅 AI 全权限助教对词库收藏/过词/自建词的实时改动
  useEffect(() => {
    return echoAgentBridge.subscribeDataChange(() => {
      loadLangData(lang);
    });
  }, [lang, loadLangData]);

  const currentLangMeta = useMemo(
    () => languages.find((l) => l.code === lang) || { code: lang, name: lang, ttsLang: "en-US" },
    [languages, lang]
  );

  const speakText = useCallback(
    (text: string, rate = 0.95) => {
      if (!text.trim()) return;
      const targetLang =
        currentLangMeta.code === "en" || currentLangMeta.code === "yue"
          ? currentLangMeta.code
          : currentLangMeta.ttsLang;
      speakOffline(text, targetLang, rate);
    },
    [currentLangMeta]
  );

  // 统计
  const stats = useMemo(() => {
    let fav = 0;
    let passed = 0;
    marks.forEach((v) => {
      if (v === "favorite") fav += 1;
      else if (v === "passed") passed += 1;
    });
    return { total: words.length, fav, passed };
  }, [words.length, marks]);

  const bookWords = useMemo(() => {
    if (!bookFilter) return words;
    return words.filter((w) => w.tags.includes(bookFilter));
  }, [words, bookFilter]);

  const flashQueue = useMemo(() => {
    return bookWords.filter((w) => marks.get(w.id) !== "passed");
  }, [bookWords, marks]);

  const currentWord = flashQueue.length > 0 ? flashQueue[flashCursor % flashQueue.length] : null;

  useEffect(() => {
    setRevealed(false);
  }, [currentWord?.id]);

  const deferredSearchText = useDeferredValue(searchText);

  // Android 返回手势分层关闭词库详情抽屉与弹窗
  useEffect(() => {
    const onCloseOverlay = (ev: Event) => {
      if (detailWord) {
        ev.preventDefault();
        setDetailWord(null);
        return;
      }
      if (showAddWord) {
        ev.preventDefault();
        setShowAddWord(false);
        return;
      }
      if (showAddLang) {
        ev.preventDefault();
        setShowAddLang(false);
      }
    };
    window.addEventListener("echodeck:close-overlay", onCloseOverlay);
    return () => window.removeEventListener("echodeck:close-overlay", onCloseOverlay);
  }, [detailWord, showAddWord, showAddLang]);

  // 词典检索（支持词形、音标/粤拼、释义、内置例句全文离线秒搜，经 useDeferredValue 保持 5 万词输入 60fps 顺滑）
  const filteredList = useMemo(() => {
    const q = deferredSearchText.trim().toLowerCase();
    return bookWords.filter((w) => {
      const st = marks.get(w.id) || "none";
      if (listFilter === "todo" && st === "passed") return false;
      if (listFilter === "favorite" && st !== "favorite") return false;
      if (listFilter === "passed" && st !== "passed") return false;
      if (!q) return true;
      return (
        w.word.toLowerCase().includes(q) ||
        (w.alt && w.alt.toLowerCase().includes(q)) ||
        w.phonetic.toLowerCase().includes(q) ||
        w.meaning.toLowerCase().includes(q) ||
        Boolean(w.examples?.some((ex) => ex.text.toLowerCase().includes(q) || ex.translation.toLowerCase().includes(q)))
      );
    });
  }, [bookWords, marks, listFilter, deferredSearchText]);

  // ---------------- 🎧 随身磨耳朵连播引擎 ----------------
  const commutePool = useMemo(() => {
    if (commuteOnlyFav) {
      const favs = words.filter((w) => marks.get(w.id) === "favorite");
      if (favs.length > 0) return favs;
    }
    return flashQueue.length > 0 ? flashQueue : bookWords;
  }, [commuteOnlyFav, words, marks, flashQueue, bookWords]);

  const commuteWord = commutePool.length > 0 ? commutePool[commuteIndex % commutePool.length] : null;

  useEffect(() => {
    if (!commuteActive || !commuteWord) {
      if (commuteTimerRef.current) {
        window.clearTimeout(commuteTimerRef.current);
        commuteTimerRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const ex = commuteWord.examples?.[0];
    setCommuteStage("word");
    speakText(commuteWord.word, 0.9);

    commuteTimerRef.current = window.setTimeout(() => {
      if (cancelled) return;
      if (ex?.text) {
        setCommuteStage("example");
        speakText(ex.text, 0.88);
        const holdMs = Math.min(Math.max(ex.text.length * 85, 3200), 6500);
        commuteTimerRef.current = window.setTimeout(() => {
          if (!cancelled) setCommuteIndex((i) => i + 1);
        }, holdMs);
      } else {
        // 无例句时慢读第二遍后自动换下一个
        speakText(commuteWord.word, 0.72);
        commuteTimerRef.current = window.setTimeout(() => {
          if (!cancelled) setCommuteIndex((i) => i + 1);
        }, 2600);
      }
    }, 2000);

    return () => {
      cancelled = true;
      if (commuteTimerRef.current) {
        window.clearTimeout(commuteTimerRef.current);
        commuteTimerRef.current = null;
      }
    };
  }, [commuteActive, commuteWord, speakText]);

  // ---------------- 🎯 听音辨义快速测验引擎 ----------------
  const generateQuizQuestion = useCallback(
    (preferFav = quizOnlyFav) => {
      let pool = preferFav
        ? words.filter((w) => marks.get(w.id) === "favorite")
        : flashQueue.slice(0, 600);
      if (pool.length < 4) pool = bookWords.slice(0, 600);
      if (pool.length < 4) {
        setQuizQ(null);
        return;
      }
      const target = pool[Math.floor(Math.random() * pool.length)];
      const distractors: LexiconEntry[] = [];
      const used = new Set<string>([target.id]);
      const source = bookWords.length >= 20 ? bookWords.slice(0, 1200) : words;
      let guard = 0;
      while (distractors.length < 3 && guard < 80) {
        guard += 1;
        const cand = source[Math.floor(Math.random() * source.length)];
        if (cand && !used.has(cand.id) && cand.meaning !== target.meaning) {
          used.add(cand.id);
          distractors.push(cand);
        }
      }
      const options = [target, ...distractors].sort(() => Math.random() - 0.5);
      setQuizQ({ target, options });
      setQuizPickedId(null);
      speakText(target.word, 0.92);
    },
    [quizOnlyFav, words, marks, flashQueue, bookWords, speakText]
  );

  useEffect(() => {
    if (viewMode === "quiz" && !loading && words.length >= 4 && !quizQ) {
      generateQuizQuestion(quizOnlyFav);
    }
  }, [viewMode, loading, words.length, quizQ, quizOnlyFav, generateQuizQuestion]);

  // ---------------- ✍️ 单词详情与造句工坊加载 ----------------
  const openWordDetail = useCallback(async (entry: LexiconEntry) => {
    setDetailWord(entry);
    setDraftSent("");
    setDraftTrans("");
    setAiCoachResult("");
    setMediaHits([]);
    setUserSents([]);
    const [hits, savedSents] = await Promise.all([
      findSubtitlesContainingWord(entry.word, entry.exchange, entry.lang).catch(() => []),
      getUserSentences(entry.id).catch(() => []),
    ]);
    setMediaHits(hits);
    setUserSents(savedSents);
  }, []);

  // ---------------- 词条标记 & 送进 FSRS ----------------
  const handleToggleFavorite = async (entry: LexiconEntry) => {
    const cur = marks.get(entry.id) || "none";
    const next: WordMarkStatus = cur === "favorite" ? "none" : "favorite";
    await setWordMark(entry.id, entry.lang, next);
    setMarks((prev) => {
      const copy = new Map(prev);
      if (next === "none") copy.delete(entry.id);
      else copy.set(entry.id, next);
      return copy;
    });
    showToast(next === "favorite" ? `⭐ 已收藏「${entry.word}」` : `已取消收藏「${entry.word}」`);
  };

  const handleMarkPassed = async (entry: LexiconEntry, toggle = false) => {
    const cur = marks.get(entry.id) || "none";
    const next: WordMarkStatus = toggle && cur === "passed" ? "none" : "passed";
    await setWordMark(entry.id, entry.lang, next);
    setMarks((prev) => {
      const copy = new Map(prev);
      if (next === "none") copy.delete(entry.id);
      else copy.set(entry.id, next);
      return copy;
    });
    if (next === "passed") {
      setLastPassedUndo({ entry, prev: cur });
      onCardsChanged?.();
    }
  };

  const handleUndoPass = async () => {
    if (!lastPassedUndo) return;
    const { entry, prev } = lastPassedUndo;
    await setWordMark(entry.id, entry.lang, prev);
    setMarks((m) => {
      const copy = new Map(m);
      if (prev === "none") copy.delete(entry.id);
      else copy.set(entry.id, prev);
      return copy;
    });
    setLastPassedUndo(null);
    showToast(`已恢复「${entry.word}」到待背队列`);
  };

  const handleSendToReview = async (
    entry: LexiconEntry,
    exampleOverride?: { text: string; translation?: string }
  ) => {
    const ex = exampleOverride || entry.examples?.[0];
    const front = ex?.text ? `${entry.word} — ${ex.text}` : entry.word;
    const translation = ex?.translation
      ? `${entry.meaning}｜例句：${ex.translation}`
      : entry.meaning;
    const jyutping =
      entry.lang === "yue"
        ? ex?.text
          ? `${entry.phonetic} ｜ ${annotateJyutpingOffline(ex.text).jyutping}`
          : entry.phonetic
        : "";
    const formsText = parseWordForms(entry.exchange)
      .map((f) => `${f.label}:${f.value}`)
      .join(" / ");

    await createCardLocal({
      front_text: front,
      translation,
      jyutping,
      focus_chunk: entry.phonetic && entry.lang !== "yue" ? `${entry.word} /${entry.phonetic}/` : entry.word,
      note: [entry.alt ? `简体：${entry.alt}` : "", formsText ? `词形：${formsText}` : ""]
        .filter(Boolean)
        .join(" · "),
      language: entry.lang,
      tags: ["词库", currentLangMeta.name],
    });
    if (marks.get(entry.id) !== "favorite") {
      await setWordMark(entry.id, entry.lang, "favorite");
      setMarks((prev) => new Map(prev).set(entry.id, "favorite"));
    }
    onCardsChanged?.();
    showToast(ex?.text ? `已带例句将「${entry.word}」送入今日复习` : `已将「${entry.word}」送入今日复习`);
  };

  const handleBatchFavToReview = async () => {
    const favs = words.filter((w) => marks.get(w.id) === "favorite");
    if (favs.length === 0) return;
    const batch = favs.slice(0, 30);
    for (const w of batch) {
      const ex = w.examples?.[0];
      await createCardLocal({
        front_text: ex?.text ? `${w.word} — ${ex.text}` : w.word,
        translation: ex?.translation ? `${w.meaning}｜例句：${ex.translation}` : w.meaning,
        jyutping: w.lang === "yue" ? w.phonetic : "",
        focus_chunk: w.phonetic && w.lang !== "yue" ? `${w.word} /${w.phonetic}/` : w.word,
        note: w.alt ? `简体对照：${w.alt}` : "",
        language: w.lang,
        tags: ["词库收藏", currentLangMeta.name],
      });
    }
    onCardsChanged?.();
    showToast(`已将 ${batch.length} 个收藏词（含例句）送入「今日复习」`);
  };

  const handleSaveMySentence = async (alsoSendReview = false) => {
    if (!detailWord || !draftSent.trim()) return;
    const saved = await saveUserSentence({
      wordId: detailWord.id,
      lang: detailWord.lang,
      sentence: draftSent,
      translation: draftTrans,
      aiFeedback: aiCoachResult || undefined,
    });
    setUserSents((prev) => [saved, ...prev]);
    if (alsoSendReview) {
      await handleSendToReview(detailWord, { text: saved.sentence, translation: saved.translation });
    } else {
      showToast("已保存你的造句到该词例句本");
    }
    setDraftSent("");
    setDraftTrans("");
  };

  const handleRunAiWordCoach = async (mode: "examples" | "check") => {
    if (!detailWord || aiCoachBusy) return;
    if (mode === "check" && !draftSent.trim()) {
      showToast("先在输入框写一句你的造句，再让 AI 批改");
      return;
    }
    setAiCoachBusy(true);
    try {
      const text = await aiWordCoachDirect({
        word: detailWord.word,
        meaning: detailWord.meaning,
        lang: detailWord.lang,
        langName: currentLangMeta.name,
        userSentence: mode === "check" ? draftSent.trim() : undefined,
      });
      setAiCoachResult(text);
    } catch (e: any) {
      setAiCoachResult(e.message || "AI 教练暂未配置：请前往「工具 → 设置」填入免费 DeepSeek Key 即可启用。");
    } finally {
      setAiCoachBusy(false);
    }
  };

  const handleAddPresetLang = async (preset: { code: string; name: string; ttsLang: string }) => {
    const next = await addCustomLanguage(preset);
    setLanguages(next);
    setLang(preset.code);
    setShowAddLang(false);
    showToast(`已开通「${preset.name}」词库，可随时添词或导入词表`);
  };

  const handleAddWord = async () => {
    if (!newWordText.trim() || !newWordMeaning.trim()) return;
    const created = await addCustomWord({
      word: newWordText,
      phonetic: newWordPhonetic,
      meaning: newWordMeaning,
      lang,
      exampleText: newWordExample,
      exampleTrans: newWordExampleTrans,
    });
    setWords((prev) => [created, ...prev]);
    setNewWordText("");
    setNewWordPhonetic("");
    setNewWordMeaning("");
    setNewWordExample("");
    setNewWordExampleTrans("");
    setShowAddWord(false);
    showToast(`已加入「${created.word}」到${currentLangMeta.name}词库`);
  };

  const handleImportLexicon = async (file: File) => {
    try {
      const n = await importCustomLexiconFile(file, lang);
      await loadLangData(lang);
      showToast(`成功导入 ${n} 个${currentLangMeta.name}词条`);
    } catch (e: any) {
      showToast(`导入失败：${e.message}`);
    }
  };

  const bookFilters = lang === "en" ? EN_BOOK_FILTERS : lang === "yue" ? YUE_BOOK_FILTERS : [];
  const passedInBook = useMemo(
    () => bookWords.filter((w) => marks.get(w.id) === "passed").length,
    [bookWords, marks]
  );
  const progressPct = bookWords.length > 0 ? Math.round((passedInBook / bookWords.length) * 100) : 0;

  const currentForms = useMemo(() => parseWordForms(currentWord?.exchange), [currentWord?.exchange]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {toast && (
        <div className="fixed left-1/2 top-16 z-50 max-w-sm -translate-x-1/2 rounded-full bg-[var(--text-primary)] px-4 py-2 text-xs font-medium text-[var(--bg-surface)] shadow-xl">
          {toast}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-28 pt-3 sm:px-6">
        <div className="mx-auto max-w-2xl">
          <SectionCoachBanner
            visible={showCoachTips}
            title="离线全量词库 · 真人例句 · 造句练笔 · 听词测验"
            stepsText="预装 50,300+ 英语/粤语词汇与 13,500+ 真人双语例句。过词时可展开看词形变化与地道造句，点「用法/造句」还能反查你看过的电影原句、亲手造句练笔，或点「磨耳朵」闭眼连播！"
            onStartPageTour={onStartPageTour}
            onDismiss={onDismissCoachTips}
          />

          {/* 顶部：多语种横滑 + 3 模式切换 + 磨耳朵/添词/导入 */}
          <div data-tour="lexicon-top" className="mb-3 space-y-2.5">
            {/* 第 1 行：全宽多语种胶囊横滑 */}
            <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {languages.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => {
                    setLang(l.code);
                    setQuizQ(null);
                  }}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                    lang === l.code
                      ? "bg-[var(--text-primary)] text-[var(--bg-surface)]"
                      : "border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)]"
                  }`}
                >
                  {l.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowAddLang(true)}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-[var(--border-strong)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent-text)]"
              >
                <Globe className="h-3.5 w-3.5" />
                + 其他语种
              </button>
            </div>

            {/* 第 2 行：过词 / 词典 / 测验 + 磨耳朵 / 添词 / 导入 */}
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--bg-subtle)] p-0.5 text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => setViewMode("flash")}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 transition ${
                    viewMode === "flash" ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs" : "text-[var(--text-secondary)]"
                  }`}
                >
                  <Sparkles className="h-3 w-3" />
                  过词
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 transition ${
                    viewMode === "list" ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs" : "text-[var(--text-secondary)]"
                  }`}
                >
                  <List className="h-3 w-3" />
                  词典
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewMode("quiz");
                    setQuizQ(null);
                  }}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 transition ${
                    viewMode === "quiz" ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs" : "text-[var(--text-secondary)]"
                  }`}
                >
                  <Target className="h-3 w-3" />
                  测验
                </button>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCommuteActive((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition ${
                    commuteActive
                      ? "bg-[var(--accent)] text-[var(--accent-fg)] shadow-xs"
                      : "bg-[var(--bg-subtle)] text-[var(--text-primary)]"
                  }`}
                  title="自动连播单词和例句，走路通勤随身磨耳朵"
                >
                  <Headphones className="h-3 w-3" />
                  磨耳朵
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddWord(true)}
                  className="inline-flex items-center gap-0.5 rounded-full bg-[var(--bg-subtle)] px-2 py-1.5 text-[11px] font-semibold text-[var(--text-primary)]"
                  title="手添新词与例句"
                >
                  <Plus className="h-3 w-3" />
                  添词
                </button>
                <button
                  type="button"
                  onClick={() => importRef.current?.click()}
                  className="inline-flex items-center rounded-full bg-[var(--bg-subtle)] p-1.5 text-[var(--text-secondary)]"
                  title="导入外部 CSV / TSV / JSON 词库"
                >
                  <Upload className="h-3.5 w-3.5" />
                </button>
                <input
                  ref={importRef}
                  type="file"
                  accept=".csv,.tsv,.txt,.json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleImportLexicon(f);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>

            {/* 🎧 随身磨耳朵连播控制条（开启时展开） */}
            {commuteActive && commuteWord && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-[var(--accent-ring)] bg-[var(--accent-soft)] p-3 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-bold text-[var(--accent-text)]">
                      <Headphones className="h-3.5 w-3.5 animate-pulse" />
                      <span>磨耳朵连播中 · {commuteStage === "word" ? "正在读词" : "正在读例句"}</span>
                    </div>
                    <div className="mt-1 truncate text-sm font-extrabold text-[var(--text-primary)]">
                      {commuteWord.word}{" "}
                      <span className="text-xs font-normal text-[var(--text-secondary)]">
                        {commuteWord.meaning}
                      </span>
                    </div>
                    {commuteWord.examples?.[0] && (
                      <p className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">
                        “{commuteWord.examples[0].text}”
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setCommuteOnlyFav((v) => !v)}
                      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                        commuteOnlyFav
                          ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                          : "bg-[var(--bg-surface)] text-[var(--text-secondary)]"
                      }`}
                    >
                      {commuteOnlyFav ? "仅收藏" : "当前词书"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCommuteIndex((i) => i + 1)}
                      className="rounded-full bg-[var(--bg-surface)] p-1.5 text-[var(--text-primary)]"
                      title="下一词"
                    >
                      <SkipForward className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setCommuteActive(false)}
                      className="rounded-full bg-[var(--text-primary)] p-1.5 text-[var(--bg-surface)]"
                      title="停止连播"
                    >
                      <Pause className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {/* 词书难度分级横滑条 */}
            {bookFilters.length > 0 && (
              <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {bookFilters.map((bf) => (
                  <button
                    key={bf.id}
                    type="button"
                    onClick={() => {
                      setBookFilter(bf.id);
                      setFlashCursor(0);
                      setVisibleLimit(60);
                      setQuizQ(null);
                    }}
                    className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-medium transition ${
                      bookFilter === bf.id
                        ? "bg-[var(--accent)] text-[var(--accent-fg)] font-semibold"
                        : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {bf.label}
                  </button>
                ))}
              </div>
            )}

            {/* 统计与进度条 */}
            <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs">
              <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
                <span className="truncate whitespace-nowrap">
                  {currentLangMeta.name} {bookWords.length.toLocaleString()} 词 · 已过{" "}
                  <strong className="text-[var(--text-primary)]">{passedInBook}</strong> · ⭐{" "}
                  <strong className="text-[var(--accent-text)]">{stats.fav}</strong>
                </span>
                <span className="shrink-0 font-mono-code">{progressPct}%</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${Math.max(passedInBook > 0 ? 3 : 0, progressPct)}%` }}
                />
              </div>
            </div>
          </div>

          {loading ? (
            <div className="py-24 text-center text-xs text-[var(--text-muted)]">正在加载离线全量词库与例句库...</div>
          ) : viewMode === "flash" ? (
            /* ==================== 模式 A：极速过词卡片流（含词形 + 实战例句 + 用法造句入口） ==================== */
            !currentWord ? (
              <div className="surface-card rounded-[28px] px-6 py-14 text-center">
                <CheckCircle2 className="mx-auto mb-3 h-11 w-11 text-emerald-500" />
                <h3 className="text-lg font-bold text-[var(--text-primary)]">
                  {bookWords.length === 0 ? `「${currentLangMeta.name}」词库还没有词条` : "当前词书已全部过完！"}
                </h3>
                <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                  {bookWords.length === 0
                    ? "点击右上角「+ 添词」手动记录，或点上传图标批量导入 CSV / TSV / JSON 词表。"
                    : "太强了！可以切换其他分级词书，或切到「测验」巩固收藏生词。"}
                </p>
                <div className="mt-5 flex justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddWord(true)}
                    className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-xs font-semibold text-[var(--accent-fg)]"
                  >
                    + 添加词汇
                  </button>
                  <button
                    type="button"
                    onClick={() => importRef.current?.click()}
                    className="rounded-full bg-[var(--bg-subtle)] px-4 py-2.5 text-xs font-medium text-[var(--text-primary)]"
                  >
                    导入词表文件
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentWord.id}
                    initial={{ opacity: 0, x: 24, scale: 0.985 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: -24, scale: 0.98 }}
                    transition={{ type: "spring", stiffness: 360, damping: 30 }}
                    className="surface-card rounded-[28px] p-5 sm:p-7"
                  >
                    {/* 顶部标签 + 用法造句 + 收藏星标 */}
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1.5">
                        {currentWord.tags.slice(0, 3).map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-[var(--bg-subtle)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]"
                          >
                            {TAG_BADGE_MAP[t] || t}
                          </span>
                        ))}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openWordDetail(currentWord)}
                          className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--accent-text)] transition active:scale-95"
                        >
                          <PenLine className="h-3.5 w-3.5" />
                          用法/造句
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleFavorite(currentWord)}
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition active:scale-95 ${
                            marks.get(currentWord.id) === "favorite"
                              ? "bg-amber-500/15 text-amber-500"
                              : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                          }`}
                        >
                          <Star
                            className={`h-3.5 w-3.5 ${marks.get(currentWord.id) === "favorite" ? "fill-current" : ""}`}
                          />
                          {marks.get(currentWord.id) === "favorite" ? "已藏" : "收藏"}
                        </button>
                      </div>
                    </div>

                    {/* 核心大词与音标/粤拼 */}
                    <div className="py-2 text-center">
                      <h2 className="break-words text-3xl font-extrabold tracking-tight text-[var(--text-primary)] sm:text-4xl">
                        {currentWord.word}
                      </h2>
                      {currentWord.alt && (
                        <p className="mt-1 text-sm text-[var(--text-muted)]">简体：{currentWord.alt}</p>
                      )}
                      {currentWord.phonetic && (
                        <p className="mt-1.5 font-mono-code text-sm font-medium text-[var(--accent-text)]">
                          {currentWord.lang === "en" ? `/${currentWord.phonetic}/` : currentWord.phonetic}
                        </p>
                      )}

                      <div className="mt-3.5 flex justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => speakText(currentWord.word, 0.95)}
                          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-4 py-1.5 text-xs font-semibold text-[var(--accent-text)] transition active:scale-95"
                        >
                          <Volume2 className="h-4 w-4" />
                          离线发音
                        </button>
                        <button
                          type="button"
                          onClick={() => speakText(currentWord.word, 0.72)}
                          className="rounded-full bg-[var(--bg-subtle)] px-3.5 py-1.5 font-mono-code text-xs font-medium text-[var(--text-secondary)]"
                        >
                          慢读
                        </button>
                      </div>
                    </div>

                    {/* 释义 + 词形变化 + 实战例句展开区 */}
                    <div className="mt-3">
                      {!revealed ? (
                        <button
                          type="button"
                          onClick={() => setRevealed(true)}
                          className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-[var(--bg-subtle)]/80 py-3 text-xs font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
                        >
                          <Eye className="h-4 w-4" />
                          查看释义 · 词形 · 地道例句
                        </button>
                      ) : (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="space-y-2.5"
                        >
                          <div className="rounded-2xl bg-[var(--bg-subtle)]/85 p-3.5 text-center">
                            <p className="text-sm font-semibold leading-relaxed text-[var(--text-primary)] sm:text-base">
                              {currentWord.meaning}
                            </p>
                            {currentForms.length > 0 && (
                              <div className="mt-2 flex flex-wrap justify-center gap-1">
                                {currentForms.slice(0, 4).map((f) => (
                                  <span
                                    key={`${f.label}-${f.value}`}
                                    className="rounded-full bg-[var(--bg-surface)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]"
                                  >
                                    {f.label} <strong className="font-mono-code text-[var(--text-primary)]">{f.value}</strong>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* 内置真人双语例句预览（点击即朗读） */}
                          {currentWord.examples && currentWord.examples.length > 0 ? (
                            <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3 text-left">
                              <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-[var(--text-muted)]">
                                <span className="inline-flex items-center gap-1">
                                  <BookOpenText className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                                  地道例句（点句朗读）
                                </span>
                                <button
                                  type="button"
                                  onClick={() => openWordDetail(currentWord)}
                                  className="text-[var(--accent-text)] hover:underline"
                                >
                                  更多用法 / 自己造句 →
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() => speakText(currentWord.examples![0].text, 0.9)}
                                className="block w-full text-left"
                              >
                                <p className="text-xs font-semibold leading-relaxed text-[var(--text-primary)]">
                                  {renderHighlightedSentence(currentWord.examples[0].text, currentWord)}
                                </p>
                                {currentWord.lang === "yue" && (
                                  <p className="mt-0.5 font-mono-code text-[10px] text-[var(--accent-text)]">
                                    {annotateJyutpingOffline(currentWord.examples[0].text).jyutping}
                                  </p>
                                )}
                                <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                                  {currentWord.examples[0].translation}
                                </p>
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openWordDetail(currentWord)}
                              className="flex w-full items-center justify-between rounded-2xl border border-dashed border-[var(--border-strong)] px-3.5 py-2.5 text-left text-xs text-[var(--text-secondary)] hover:border-[var(--accent)]"
                            >
                              <span className="inline-flex items-center gap-1.5">
                                <PenLine className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                                看造句公式 · 反查电影原句 · 亲手造一句
                              </span>
                              <span className="font-semibold text-[var(--accent-text)]">打开 →</span>
                            </button>
                          )}
                        </motion.div>
                      )}
                    </div>

                    {/* 底部单手 3 大操作：不认识进复习 / 认识直接过 / 换下一个 */}
                    <div data-tour="lexicon-actions" className="mt-4 grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          await handleSendToReview(currentWord);
                          setFlashCursor((c) => c + 1);
                        }}
                        className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-[var(--accent-ring)] bg-[var(--accent-soft)] py-2.5 text-xs font-semibold text-[var(--accent-text)] transition active:scale-95"
                      >
                        <BookMarked className="h-4 w-4" />
                        <span>加进复习</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleMarkPassed(currentWord)}
                        className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-emerald-500 py-2.5 text-xs font-bold text-white shadow-sm transition active:scale-95"
                      >
                        <Check className="h-4 w-4 stroke-[2.8]" />
                        <span>认识 · 过！</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setFlashCursor((c) => c + 1)}
                        className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-[var(--bg-subtle)] py-2.5 text-xs font-semibold text-[var(--text-primary)] transition active:scale-95"
                      >
                        <Sparkles className="h-4 w-4" />
                        <span>先跳过</span>
                      </button>
                    </div>
                  </motion.div>
                </AnimatePresence>

                {/* 防误触：一键撤销上个过词 */}
                {lastPassedUndo && (
                  <div className="flex items-center justify-between rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-4 py-2.5 text-xs">
                    <span className="text-[var(--text-secondary)]">
                      已过掉 <strong className="text-[var(--text-primary)]">{lastPassedUndo.entry.word}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={handleUndoPass}
                      className="inline-flex items-center gap-1 font-semibold text-[var(--accent-text)]"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      撤销
                    </button>
                  </div>
                )}
              </div>
            )
          ) : viewMode === "quiz" ? (
            /* ==================== 模式 C：🎯 听音辨义 · 快速测验 ==================== */
            !quizQ ? (
              <div className="surface-card rounded-[28px] px-6 py-12 text-center text-xs text-[var(--text-secondary)]">
                当前语种词条不足 4 个，暂无法出题，请先添加或导入词条。
              </div>
            ) : (
              <div className="space-y-3">
                {/* 测验设置与连胜条 */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 font-bold text-[var(--accent-text)]">
                      <Flame className="h-4 w-4" />
                      连对 {quizStreak}
                    </span>
                    <span className="text-[var(--text-muted)]">
                      正确率 {quizTotal > 0 ? Math.round((quizCorrect / quizTotal) * 100) : 0}% ({quizCorrect}/{quizTotal})
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const next = !quizOnlyFav;
                        setQuizOnlyFav(next);
                        generateQuizQuestion(next);
                      }}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        quizOnlyFav ? "bg-amber-500/15 text-amber-600" : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                      }`}
                    >
                      {quizOnlyFav ? "⭐ 仅测收藏" : "测当前词书"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuizBlindAudio((v) => !v)}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        quizBlindAudio ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                      }`}
                    >
                      <Ear className="h-3 w-3" />
                      盲听
                    </button>
                  </div>
                </div>

                {/* 题目卡 */}
                <div className="surface-card rounded-[28px] p-5 sm:p-6">
                  <div className="py-2 text-center">
                    {quizBlindAudio && !quizPickedId ? (
                      <div className="py-3">
                        <div className="text-xs font-semibold text-[var(--text-muted)]">盲听辨词：先听发音选出释义</div>
                        <button
                          type="button"
                          onClick={() => speakText(quizQ.target.word, 0.9)}
                          className="mt-3 inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-bold text-[var(--accent-fg)] shadow-sm active:scale-95"
                        >
                          <Volume2 className="h-4 w-4" />
                          再听一遍发音
                        </button>
                      </div>
                    ) : (
                      <>
                        <h2 className="text-3xl font-extrabold text-[var(--text-primary)]">{quizQ.target.word}</h2>
                        {quizQ.target.phonetic && (
                          <p className="mt-1 font-mono-code text-xs text-[var(--accent-text)]">
                            {quizQ.target.lang === "en" ? `/${quizQ.target.phonetic}/` : quizQ.target.phonetic}
                          </p>
                        )}
                        <div className="mt-3 flex justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => speakText(quizQ.target.word, 0.92)}
                            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-3.5 py-1.5 text-xs font-semibold text-[var(--accent-text)]"
                          >
                            <Volume2 className="h-3.5 w-3.5" />
                            朗读
                          </button>
                          <button
                            type="button"
                            onClick={() => speakText(quizQ.target.word, 0.72)}
                            className="rounded-full bg-[var(--bg-subtle)] px-3 py-1.5 font-mono-code text-xs text-[var(--text-secondary)]"
                          >
                            慢读
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* 4 选 1 释义选项 */}
                  <div className="mt-4 space-y-2">
                    {quizQ.options.map((opt) => {
                      const answered = quizPickedId !== null;
                      const isCorrect = opt.id === quizQ.target.id;
                      const isPicked = opt.id === quizPickedId;
                      let cls =
                        "border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-primary)] hover:border-[var(--accent)]";
                      if (answered && isCorrect) {
                        cls = "border-emerald-500 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 font-bold";
                      } else if (answered && isPicked && !isCorrect) {
                        cls = "border-rose-500 bg-rose-500/12 text-rose-600 dark:text-rose-300";
                      }
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={answered}
                          onClick={() => {
                            setQuizPickedId(opt.id);
                            setQuizTotal((t) => t + 1);
                            if (isCorrect) {
                              setQuizCorrect((c) => c + 1);
                              setQuizStreak((s) => s + 1);
                            } else {
                              setQuizStreak(0);
                            }
                          }}
                          className={`w-full rounded-2xl border px-4 py-3 text-left text-xs leading-relaxed transition ${cls}`}
                        >
                          {opt.meaning}
                        </button>
                      );
                    })}
                  </div>

                  {/* 答题后即刻展示真实例句与快捷操作 */}
                  {quizPickedId && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-4 space-y-3 border-t border-[var(--border-hairline)] pt-3.5"
                    >
                      {quizQ.target.examples?.[0] && (
                        <button
                          type="button"
                          onClick={() => speakText(quizQ.target.examples![0].text, 0.9)}
                          className="block w-full rounded-2xl bg-[var(--bg-subtle)]/80 p-3 text-left"
                        >
                          <p className="text-xs font-semibold text-[var(--text-primary)]">
                            {renderHighlightedSentence(quizQ.target.examples[0].text, quizQ.target)}
                          </p>
                          <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                            {quizQ.target.examples[0].translation}
                          </p>
                        </button>
                      )}
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleToggleFavorite(quizQ.target)}
                            className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-subtle)] px-3 py-2 font-semibold text-[var(--text-secondary)]"
                          >
                            <Star className={`h-3.5 w-3.5 ${marks.get(quizQ.target.id) === "favorite" ? "fill-amber-500 text-amber-500" : ""}`} />
                            收藏
                          </button>
                          <button
                            type="button"
                            onClick={() => openWordDetail(quizQ.target)}
                            className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-subtle)] px-3 py-2 font-semibold text-[var(--text-secondary)]"
                          >
                            <PenLine className="h-3.5 w-3.5" />
                            看用法
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => generateQuizQuestion(quizOnlyFav)}
                          className="rounded-full bg-[var(--accent)] px-5 py-2 font-bold text-[var(--accent-fg)]"
                        >
                          下一题 →
                        </button>
                      </div>
                    </motion.div>
                  )}
                </div>
              </div>
            )
          ) : (
            /* ==================== 模式 B：5 万词极速检索与生词本/已过词管理 ==================== */
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  value={searchText}
                  onChange={(e) => {
                    setSearchText(e.target.value);
                    setVisibleLimit(60);
                  }}
                  placeholder={`离线秒搜 ${currentLangMeta.name} 单词、音标/粤拼、释义或例句...`}
                  className="w-full rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] py-3 pl-10 pr-4 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-1 rounded-2xl bg-[var(--bg-subtle)] p-1 text-xs font-semibold">
                  {[
                    { id: "todo" as const, label: "待背" },
                    { id: "favorite" as const, label: `⭐ 收藏 (${stats.fav})` },
                    { id: "passed" as const, label: `✅ 已过 (${stats.passed})` },
                    { id: "all" as const, label: "全部" },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setListFilter(t.id);
                        setVisibleLimit(60);
                      }}
                      className={`rounded-xl px-3 py-1.5 transition ${
                        listFilter === t.id ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs" : "text-[var(--text-secondary)]"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {listFilter === "favorite" && stats.fav > 0 && (
                  <button
                    type="button"
                    onClick={handleBatchFavToReview}
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-xs font-semibold text-[var(--accent-fg)]"
                  >
                    <BookMarked className="h-3.5 w-3.5" />
                    收藏词全送复习舱
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {filteredList.length === 0 ? (
                  <div className="surface-card rounded-2xl py-12 text-center text-xs text-[var(--text-muted)]">
                    没有匹配的词条
                  </div>
                ) : (
                  <>
                    {filteredList.slice(0, visibleLimit).map((item) => {
                      const st = marks.get(item.id) || "none";
                      const hasEx = Boolean(item.examples && item.examples.length > 0);
                      return (
                        <div
                          key={item.id}
                          className="surface-card flex items-start justify-between gap-2.5 rounded-2xl p-3.5"
                        >
                          <button
                            type="button"
                            onClick={() => openWordDetail(item)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex flex-wrap items-baseline gap-2">
                              <span
                                className={`text-base font-bold ${
                                  st === "passed" ? "line-through text-[var(--text-muted)]" : "text-[var(--text-primary)]"
                                }`}
                              >
                                {item.word}
                              </span>
                              {item.alt && <span className="text-xs text-[var(--text-muted)]">({item.alt})</span>}
                              {item.phonetic && (
                                <span className="font-mono-code text-xs text-[var(--accent-text)]">
                                  {item.lang === "en" ? `/${item.phonetic}/` : item.phonetic}
                                </span>
                              )}
                              {hasEx && (
                                <span className="rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-text)]">
                                  含例句
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{item.meaning}</p>
                            {hasEx && (
                              <p className="mt-1 truncate text-[11px] text-[var(--text-muted)]">
                                例：{item.examples![0].text}
                              </p>
                            )}
                          </button>

                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => speakText(item.word)}
                              className="rounded-full p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                              title="发音"
                            >
                              <Volume2 className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openWordDetail(item)}
                              className="rounded-full p-2 text-[var(--accent-text)] hover:bg-[var(--accent-soft)]"
                              title="用法 / 例句 / 造句"
                            >
                              <PenLine className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleFavorite(item)}
                              className={`rounded-full p-2 ${
                                st === "favorite" ? "bg-amber-500/12 text-amber-500" : "text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]"
                              }`}
                              title="收藏"
                            >
                              <Star className={`h-4 w-4 ${st === "favorite" ? "fill-current" : ""}`} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMarkPassed(item, true)}
                              className={`rounded-full p-2 ${
                                st === "passed" ? "bg-emerald-500/12 text-emerald-500" : "text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]"
                              }`}
                              title={st === "passed" ? "取消已过" : "标为已过"}
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            {item.isCustom && (
                              <button
                                type="button"
                                onClick={async () => {
                                  await deleteCustomWord(item.id);
                                  setWords((prev) => prev.filter((x) => x.id !== item.id));
                                }}
                                className="rounded-full p-2 text-[var(--text-muted)] hover:text-rose-500"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {filteredList.length > visibleLimit && (
                      <button
                        type="button"
                        onClick={() => setVisibleLimit((v) => v + 80)}
                        className="w-full rounded-2xl bg-[var(--bg-subtle)] py-3 text-xs font-semibold text-[var(--text-secondary)]"
                      >
                        加载更多（还有 {(filteredList.length - visibleLimit).toLocaleString()} 条）
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ==================== ✍️ 单词用法与造句工坊抽屉 ==================== */}
      {detailWord && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-2.5 backdrop-blur-xs sm:items-center"
          onClick={() => setDetailWord(null)}
        >
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[86vh] w-full max-w-lg overflow-y-auto rounded-[28px] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 shadow-2xl"
          >
            {/* 头部 */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="text-2xl font-extrabold text-[var(--text-primary)]">{detailWord.word}</h3>
                  {detailWord.alt && <span className="text-xs text-[var(--text-muted)]">简体：{detailWord.alt}</span>}
                </div>
                {detailWord.phonetic && (
                  <p className="mt-0.5 font-mono-code text-xs font-medium text-[var(--accent-text)]">
                    {detailWord.lang === "en" ? `/${detailWord.phonetic}/` : detailWord.phonetic}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDetailWord(null)}
                className="rounded-full p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 发音 + 快捷状态 */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => speakText(detailWord.word, 0.95)}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-3 py-1.5 font-semibold text-[var(--accent-text)]"
              >
                <Volume2 className="h-3.5 w-3.5" />
                发音
              </button>
              <button
                type="button"
                onClick={() => speakText(detailWord.word, 0.72)}
                className="rounded-full bg-[var(--bg-subtle)] px-2.5 py-1.5 font-mono-code text-[var(--text-secondary)]"
              >
                慢读
              </button>
              <button
                type="button"
                onClick={() => handleToggleFavorite(detailWord)}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 font-semibold ${
                  marks.get(detailWord.id) === "favorite"
                    ? "bg-amber-500/15 text-amber-500"
                    : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                }`}
              >
                <Star className={`h-3.5 w-3.5 ${marks.get(detailWord.id) === "favorite" ? "fill-current" : ""}`} />
                {marks.get(detailWord.id) === "favorite" ? "已收藏" : "收藏"}
              </button>
              <button
                type="button"
                onClick={() => handleMarkPassed(detailWord, true)}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 font-semibold ${
                  marks.get(detailWord.id) === "passed"
                    ? "bg-emerald-500 text-white"
                    : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                }`}
              >
                <Check className="h-3.5 w-3.5" />
                {marks.get(detailWord.id) === "passed" ? "已过" : "认识·过"}
              </button>
            </div>

            {/* 核心释义 + 词形变化 */}
            <div className="mt-4 rounded-2xl bg-[var(--bg-subtle)]/85 p-3.5 text-xs">
              <p className="text-sm font-semibold leading-relaxed text-[var(--text-primary)]">{detailWord.meaning}</p>
              {parseWordForms(detailWord.exchange).length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {parseWordForms(detailWord.exchange).map((f) => (
                    <span
                      key={`${f.label}-${f.value}`}
                      className="rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-0.5 text-[11px] text-[var(--text-secondary)]"
                    >
                      {f.label} <strong className="font-mono-code text-[var(--text-primary)]">{f.value}</strong>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 1. 真人双语实战例句（离线内置） */}
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-[var(--text-primary)]">
                <span className="inline-flex items-center gap-1.5">
                  <BookOpenText className="h-4 w-4 text-[var(--accent-text)]" />
                  实战双语例句
                </span>
                <span className="text-[11px] font-normal text-[var(--text-muted)]">点句听发音</span>
              </div>

              {detailWord.examples && detailWord.examples.length > 0 ? (
                detailWord.examples.map((ex, i) => (
                  <div
                    key={i}
                    className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => speakText(ex.text, 0.9)}
                      className="block w-full text-left"
                    >
                      <p className="font-semibold leading-relaxed text-[var(--text-primary)]">
                        {renderHighlightedSentence(ex.text, detailWord)}
                      </p>
                      {detailWord.lang === "yue" && (
                        <p className="mt-0.5 font-mono-code text-[10px] text-[var(--accent-text)]">
                          {annotateJyutpingOffline(ex.text).jyutping}
                        </p>
                      )}
                      {ex.translation && (
                        <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{ex.translation}</p>
                      )}
                    </button>
                    <div className="mt-2 flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => speakText(ex.text, 0.72)}
                        className="rounded-full bg-[var(--bg-subtle)] px-2.5 py-1 text-[10px] font-medium text-[var(--text-secondary)]"
                      >
                        慢读例句
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSendToReview(detailWord, ex)}
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] font-semibold text-[var(--accent-text)]"
                      >
                        <BookMarked className="h-3 w-3" />
                        带句进复习
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-[var(--border-hairline)] p-3 text-[11px] text-[var(--text-muted)]">
                  该词条暂无预置例句：可参考下方「造句公式」自己造一句，或点「AI 生成 3 句场景例句」。
                </div>
              )}
            </div>

            {/* 2. 🎬 影听素材原声反查（看过的电影/播客里出现过这个词的原句！） */}
            {mediaHits.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-primary)]">
                  <Film className="h-4 w-4 text-emerald-500" />
                  你导入的影听素材原句 ({mediaHits.length})
                </div>
                {mediaHits.map((h) => (
                  <div
                    key={h.subtitleId}
                    className="rounded-2xl border border-emerald-500/25 bg-emerald-500/6 p-3 text-xs"
                  >
                    <p className="font-semibold text-[var(--text-primary)]">
                      {renderHighlightedSentence(h.text, detailWord)}
                    </p>
                    {h.translation && <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{h.translation}</p>}
                    <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                      <span className="truncate">{h.mediaTitle}</span>
                      {onJumpToMedia && (
                        <button
                          type="button"
                          onClick={() => {
                            setDetailWord(null);
                            onJumpToMedia(h.mediaId, h.startMs);
                          }}
                          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1 font-semibold text-white"
                        >
                          <Play className="h-3 w-3" />
                          去听原声
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 3. 💡 离线怎么用 / 造句公式 */}
            <div className="mt-4 space-y-2">
              <div className="text-xs font-bold text-[var(--text-primary)]">💡 怎么用 · 造句结构指南</div>
              {buildUsagePatterns(detailWord).map((tip, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3 text-xs"
                >
                  <div className="text-[11px] font-bold text-[var(--accent-text)]">{tip.title}</div>
                  <div className="mt-1 font-mono-code text-[11px] font-semibold text-[var(--text-primary)]">
                    {tip.formula}
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{tip.hint}</p>
                </div>
              ))}
            </div>

            {/* 4. ✍️ 自己造一句 & AI 用法拆解/批改 */}
            <div className="mt-4 space-y-2.5 rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-subtle)]/40 p-3.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-bold text-[var(--text-primary)]">
                  <PenLine className="h-4 w-4 text-[var(--accent-text)]" />
                  自己造一句（实战掌握）
                </span>
                <button
                  type="button"
                  disabled={aiCoachBusy}
                  onClick={() => handleRunAiWordCoach("examples")}
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-text)] disabled:opacity-50"
                >
                  <Wand2 className="h-3 w-3" />
                  {aiCoachBusy ? "思考中..." : "AI 给3句例句"}
                </button>
              </div>

              <textarea
                rows={2}
                value={draftSent}
                onChange={(e) => setDraftSent(e.target.value)}
                placeholder={`试着用「${detailWord.word}」造一句贴近你生活的话...`}
                className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
              <input
                value={draftTrans}
                onChange={(e) => setDraftTrans(e.target.value)}
                placeholder="这句你想表达的中文意思（可选）"
                className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
              />

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={!draftSent.trim()}
                  onClick={() => handleSaveMySentence(false)}
                  className="rounded-full bg-[var(--text-primary)] px-3.5 py-1.5 font-semibold text-[var(--bg-surface)] disabled:opacity-40"
                >
                  保存造句
                </button>
                <button
                  type="button"
                  disabled={!draftSent.trim()}
                  onClick={() => handleSaveMySentence(true)}
                  className="rounded-full bg-[var(--accent)] px-3.5 py-1.5 font-semibold text-[var(--accent-fg)] disabled:opacity-40"
                >
                  存并进复习
                </button>
                <button
                  type="button"
                  disabled={!draftSent.trim() || aiCoachBusy}
                  onClick={() => handleRunAiWordCoach("check")}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--accent-ring)] bg-[var(--bg-surface)] px-3 py-1.5 font-semibold text-[var(--accent-text)] disabled:opacity-40"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  AI 批改造句
                </button>
              </div>

              {aiCoachResult && (
                <div className="whitespace-pre-wrap rounded-xl bg-[var(--bg-surface)] p-3 text-xs leading-relaxed text-[var(--text-primary)]">
                  {aiCoachResult}
                </div>
              )}

              {/* 已保存的个人造句列表 */}
              {userSents.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="text-[11px] font-bold text-[var(--text-muted)]">
                    我的造句本 ({userSents.length})
                  </div>
                  {userSents.map((us) => (
                    <div
                      key={us.id}
                      className="flex items-start justify-between gap-2 rounded-xl bg-[var(--bg-surface)] p-2.5"
                    >
                      <button
                        type="button"
                        onClick={() => speakText(us.sentence, 0.92)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="font-semibold text-[var(--text-primary)]">{us.sentence}</p>
                        {us.translation && <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{us.translation}</p>}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await deleteUserSentence(us.id);
                          setUserSents((prev) => prev.filter((x) => x.id !== us.id));
                        }}
                        className="rounded-full p-1 text-[var(--text-muted)] hover:text-rose-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* 弹窗 1：扩展其他未来学习语种（日语 / 韩语 / 法语 / 西语 / 自定义） */}
      {showAddLang && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-3 backdrop-blur-xs sm:items-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md rounded-[28px] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-[var(--text-primary)]">开通新的学习语种</h3>
              <button type="button" onClick={() => setShowAddLang(false)} className="rounded-full p-1 text-[var(--text-muted)]">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-3 text-xs text-[var(--text-secondary)]">
              已内置最全英语与粤语离线词库。未来学其他语言时，一键开通专属词库，自动接入手机多语种离线发音并支持导入外部词表。
            </p>
            <div className="grid grid-cols-3 gap-2">
              {FUTURE_LANGUAGE_PRESETS.map((p) => {
                const exists = languages.some((l) => l.code === p.code);
                return (
                  <button
                    key={p.code}
                    type="button"
                    onClick={() => handleAddPresetLang(p)}
                    className={`rounded-2xl border px-3 py-2.5 text-xs font-semibold transition ${
                      exists
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                        : "border-[var(--border-hairline)] bg-[var(--bg-subtle)] text-[var(--text-primary)] hover:border-[var(--accent)]"
                    }`}
                  >
                    {p.name} {exists ? "✓" : "+"}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 space-y-2 border-t border-[var(--border-hairline)] pt-4 text-xs">
              <div className="font-semibold text-[var(--text-secondary)]">或自定义任意语种</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={customLangName}
                  onChange={(e) => setCustomLangName(e.target.value)}
                  placeholder="名称（如：泰语）"
                  className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/60 px-3 py-2 text-[var(--text-primary)] outline-none"
                />
                <input
                  value={customLangTts}
                  onChange={(e) => {
                    setCustomLangTts(e.target.value);
                    setCustomLangCode(e.target.value.split("-")[0] || "");
                  }}
                  placeholder="发音码（如：th-TH）"
                  className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/60 px-3 py-2 font-mono-code text-[var(--text-primary)] outline-none"
                />
              </div>
              <button
                type="button"
                disabled={!customLangName.trim()}
                onClick={() =>
                  handleAddPresetLang({
                    code: customLangCode || `lang_${Date.now().toString(36)}`,
                    name: customLangName.trim(),
                    ttsLang: customLangTts.trim() || "en-US",
                  })
                }
                className="w-full rounded-full bg-[var(--accent)] py-2.5 font-semibold text-[var(--accent-fg)] disabled:opacity-40"
              >
                添加自定义语种
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* 弹窗 2：手动添词到当前语种词库（支持附带例句） */}
      {showAddWord && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-3 backdrop-blur-xs sm:items-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md rounded-[28px] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-[var(--text-primary)]">
                添加新词到「{currentLangMeta.name}」词库
              </h3>
              <button type="button" onClick={() => setShowAddWord(false)} className="rounded-full p-1 text-[var(--text-muted)]">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-2.5 text-xs">
              <input
                value={newWordText}
                onChange={(e) => setNewWordText(e.target.value)}
                placeholder="单词 / 词块（如：serendipity / 搞掂 / 大丈夫）"
                className="w-full rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/60 px-3.5 py-2.5 text-[var(--text-primary)] outline-none"
              />
              <input
                value={newWordPhonetic}
                onChange={(e) => setNewWordPhonetic(e.target.value)}
                placeholder="音标 / 假名 / 读音（粤语留空将自动标注粤拼）"
                className="w-full rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/60 px-3.5 py-2.5 text-[var(--text-primary)] outline-none"
              />
              <input
                value={newWordMeaning}
                onChange={(e) => setNewWordMeaning(e.target.value)}
                placeholder="中文释义"
                className="w-full rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/60 px-3.5 py-2.5 text-[var(--text-primary)] outline-none"
              />
              <input
                value={newWordExample}
                onChange={(e) => setNewWordExample(e.target.value)}
                placeholder="搭配一句实战例句（可选）"
                className="w-full rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/60 px-3.5 py-2.5 text-[var(--text-primary)] outline-none"
              />
              <input
                value={newWordExampleTrans}
                onChange={(e) => setNewWordExampleTrans(e.target.value)}
                placeholder="例句中文翻译（可选）"
                className="w-full rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/60 px-3.5 py-2.5 text-[var(--text-primary)] outline-none"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowAddWord(false)} className="rounded-full px-4 py-2 text-[var(--text-secondary)]">
                  取消
                </button>
                <button
                  type="button"
                  disabled={!newWordText.trim() || !newWordMeaning.trim()}
                  onClick={handleAddWord}
                  className="rounded-full bg-[var(--accent)] px-5 py-2 font-semibold text-[var(--accent-fg)] disabled:opacity-40"
                >
                  加入词库
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
