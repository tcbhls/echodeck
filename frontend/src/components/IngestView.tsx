import { useEffect, useRef, useState } from "react";
import { Download, FileAudio, Link2, Loader2, Plus, Share2, UploadCloud } from "lucide-react";
import { isNativeAndroid, nativeDownloadMedia } from "../lib/nativeBridge";
import { getSettingsLocal, importMediaBlobLocal } from "../lib/standaloneStore";
import { SectionCoachBanner } from "./SectionCoachBanner";

interface IngestViewProps {
  initialSharedUrl?: string;
  showCoachTips: boolean;
  onDismissCoachTips: () => void;
  onStartPageTour: () => void;
  onConsumeSharedUrl?: () => void;
  onOpenMedia: (mediaId: string) => void;
}

const CUSTOM_TAGS_KEY = "echodeck_user_tags_v31";
const DEFAULT_TAGS = ["美剧电影", "港剧粤语", "播客", "日常口语", "访谈纪录片"];

export function IngestView({
  initialSharedUrl = "",
  showCoachTips,
  onDismissCoachTips,
  onStartPageTour,
  onConsumeSharedUrl,
  onOpenMedia,
}: IngestViewProps) {
  const [urlInput, setUrlInput] = useState(initialSharedUrl);
  const [language, setLanguage] = useState("en");
  const [audioOnly, setAudioOnly] = useState(false);
  const [availableTags, setAvailableTags] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CUSTOM_TAGS_KEY) || "[]");
      if (Array.isArray(saved) && saved.length > 0) return Array.from(new Set([...DEFAULT_TAGS, ...saved]));
    } catch {
      // ignore
    }
    return DEFAULT_TAGS;
  });
  const [selectedTags, setSelectedTags] = useState<string[]>(["美剧电影"]);
  const [customTagInput, setCustomTagInput] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState("");

  const [selectedMediaFile, setSelectedMediaFile] = useState<File | null>(null);
  const [selectedSubFile, setSelectedSubFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const srtInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((c) => (c === msg ? "" : c)), 3200);
  };

  useEffect(() => {
    if (initialSharedUrl) {
      setUrlInput(initialSharedUrl);
      onConsumeSharedUrl?.();
    }
  }, [initialSharedUrl, onConsumeSharedUrl]);

  const toggleTag = (t: string) => {
    setSelectedTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const addCustomTag = () => {
    const clean = customTagInput.trim().replace(/^#/, "");
    if (!clean) return;
    if (!availableTags.includes(clean)) {
      const next = [...availableTags, clean];
      setAvailableTags(next);
      localStorage.setItem(CUSTOM_TAGS_KEY, JSON.stringify(next));
    }
    if (!selectedTags.includes(clean)) {
      setSelectedTags((prev) => [...prev, clean]);
    }
    setCustomTagInput("");
  };

  const handleUrlDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim() || downloading) return;
    setDownloading(true);
    setDownloadMsg("正在解析链接并下载至手机本地...");
    try {
      const cfg = await getSettingsLocal();
      const res = await nativeDownloadMedia(urlInput.trim(), {
        audioOnly,
        cobaltEndpoint: cfg.cobalt_endpoint,
      });
      setDownloadMsg("下载完毕，正在写入影听库...");
      const media = await importMediaBlobLocal({
        blob: res.blob,
        title: res.title,
        sourceType: res.sourceType,
        sourceUrl: urlInput.trim(),
        language,
        tags: selectedTags,
        subtitleRawText: res.subtitleText,
        subtitleFilename: res.subtitleFormat === "json" ? "sub.json" : "sub.srt",
      });
      setUrlInput("");
      setDownloadMsg("");
      showToast(`已下载《${media.title}》`);
      onOpenMedia(media.id);
    } catch (err: any) {
      setDownloadMsg("");
      showToast(err.message || "下载失败");
    } finally {
      setDownloading(false);
    }
  };

  const handleLocalImport = async () => {
    if (!selectedMediaFile || importing) return;
    setImporting(true);
    try {
      const subText = selectedSubFile ? await selectedSubFile.text() : "";
      const title = selectedMediaFile.name.replace(/\.[^/.]+$/, "");
      const media = await importMediaBlobLocal({
        blob: selectedMediaFile,
        title,
        sourceType: "手机本地",
        language,
        tags: selectedTags,
        subtitleRawText: subText,
        subtitleFilename: selectedSubFile?.name || "sub.srt",
      });
      setSelectedMediaFile(null);
      setSelectedSubFile(null);
      showToast(`已导入《${media.title}》`);
      onOpenMedia(media.id);
    } catch (err: any) {
      showToast(`导入失败：${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  const native = isNativeAndroid();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {toast && (
        <div className="fixed left-1/2 top-16 z-50 max-w-sm -translate-x-1/2 rounded-2xl bg-[var(--text-primary)] px-4 py-2.5 text-xs font-medium text-[var(--bg-surface)] shadow-xl">
          {toast}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-28 pt-3 sm:px-6">
        <div className="mx-auto max-w-2xl space-y-5">
          <SectionCoachBanner
            visible={showCoachTips}
            title="导入素材 · 把你爱看的视频和播客变成精听课"
            stepsText="① 刷 B站/小宇宙直接点系统「分享 → EchoDeck」或把链接贴在下面；② 刷抖音看到好切片直接录屏，点下面「选相册视频导入」；③ 导入后自动进影听台生成字幕和跟读。"
            onStartPageTour={onStartPageTour}
            onDismiss={onDismissCoachTips}
          />

          {/* 卡片 1：粘贴链接直下 */}
          <section className="surface-card rounded-[28px] p-5 sm:p-6">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-base font-bold text-[var(--text-primary)]">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]">
                  <Link2 className="h-4 w-4" />
                </span>
                粘贴链接直接下载
              </h2>
              <span className="rounded-full bg-emerald-500/12 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                {native ? "原生免电脑" : "直链可用"}
              </span>
            </div>
            <p className="mb-4 text-xs leading-relaxed text-[var(--text-secondary)]">
              支持 <strong>B站</strong>（自动拿视频 + CC 字幕）、<strong>小宇宙播客</strong>（自动拿音频）及直链 MP4/MP3。也可以直接在 B站 / 小宇宙里点 <Share2 className="inline h-3 w-3" /> 分享到 EchoDeck。
            </p>

            <form onSubmit={handleUrlDownload} className="space-y-3.5">
              <div data-tour="ingest-url-box" className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="粘贴 B站链接 / BV号 / 小宇宙播客链接..."
                  className="flex-1 rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-subtle)]/60 px-4 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
                <button
                  type="submit"
                  disabled={downloading || !urlInput.trim()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-[var(--accent)] px-5 py-3 text-xs font-semibold text-[var(--accent-fg)] shadow-sm transition active:scale-95 disabled:opacity-50"
                >
                  {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {downloading ? "下载中..." : "立即下载"}
                </button>
              </div>

              {downloadMsg && (
                <div className="rounded-2xl bg-[var(--accent-soft)] px-3.5 py-2.5 text-xs font-medium text-[var(--accent-text)]">
                  {downloadMsg}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2.5 text-xs">
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="rounded-full border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-3 py-1.5 font-medium text-[var(--text-primary)] outline-none"
                >
                  <option value="en">素材语言：英语</option>
                  <option value="yue">素材语言：粤语</option>
                  <option value="zh">素材语言：普通话</option>
                </select>

                <label className="inline-flex cursor-pointer items-center gap-1.5 text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={audioOnly}
                    onChange={(e) => setAudioOnly(e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  仅存音轨省空间
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {availableTags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTag(t)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      selectedTags.includes(t)
                        ? "bg-[var(--text-primary)] text-[var(--bg-surface)]"
                        : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                    }`}
                  >
                    #{t}
                  </button>
                ))}
                <div className="inline-flex items-center rounded-full border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/70 pl-2.5 pr-1 py-0.5">
                  <input
                    value={customTagInput}
                    onChange={(e) => setCustomTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustomTag();
                      }
                    }}
                    placeholder="自建标签（如 科幻/动漫）"
                    className="w-28 bg-transparent text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                  />
                  <button
                    type="button"
                    onClick={addCustomTag}
                    className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-white"
                    title="添加自定义兴趣标签"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </form>
          </section>

          {/* 卡片 2：手机本地影视 / 录屏 / 播客导入 */}
          <section className="surface-card rounded-[28px] p-5 sm:p-6">
            <h2 className="mb-1 flex items-center gap-2 text-base font-bold text-[var(--text-primary)]">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]">
                <UploadCloud className="h-4 w-4" />
              </span>
              从手机相册 / 本地视频与电影切片导入
            </h2>
            <p className="mb-4 text-xs leading-relaxed text-[var(--text-secondary)]">
              看电影、追美剧港剧或刷短视频看到喜欢的片段？把视频、录屏或音频从手机本地导进来，进影听台后支持直接配 `.srt` 字幕或让手机离线 AI 自动生成字幕！
            </p>

            <div className="flex flex-col gap-2.5 sm:flex-row">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--border-strong)] bg-[var(--bg-subtle)]/40 px-4 py-7 text-xs font-medium text-[var(--text-primary)] transition hover:border-[var(--accent)]"
              >
                <FileAudio className="h-7 w-7 text-[var(--accent-text)]" />
                <span>{selectedMediaFile ? selectedMediaFile.name : "点这里挑选视频、录屏或播客音频"}</span>
                <span className="text-[11px] text-[var(--text-muted)]">支持 MP4 / MOV / MP3 / M4A / WAV</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,audio/*,.mp4,.mov,.mkv,.mp3,.m4a,.wav,.ogg"
                className="hidden"
                onChange={(e) => setSelectedMediaFile(e.target.files?.[0] || null)}
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => srtInputRef.current?.click()}
                className="rounded-full bg-[var(--bg-subtle)] px-3.5 py-2 text-xs font-medium text-[var(--text-secondary)]"
              >
                {selectedSubFile ? `已选字幕：${selectedSubFile.name}` : "+ 可选：同时附带 .srt 字幕"}
              </button>
              <input
                ref={srtInputRef}
                type="file"
                accept=".srt,.vtt,.json"
                className="hidden"
                onChange={(e) => setSelectedSubFile(e.target.files?.[0] || null)}
              />

              {selectedMediaFile && (
                <button
                  type="button"
                  disabled={importing}
                  onClick={handleLocalImport}
                  className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-xs font-semibold text-[var(--accent-fg)] shadow-sm disabled:opacity-50"
                >
                  {importing ? "正在导入..." : "导入并立刻开始跟读"}
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
