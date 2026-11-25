/**
 * EchoDeck v9.1 多引擎 AI 真人音色试听馆（设置页独立模块）：
 * - 完整保留原有默认音色（Ava / 晓佳、Andrew / 云龙），绝不删除
 * - 扩展 8 款微软新一代自然口语/英音/澳音/柔声港粤 Neural 音色（0 下载国内秒播）
 * - 集成 GitHub 热门 44.1kHz 真人棚录端侧离线引擎 Supertone Supertonic-2（6 款零机械感棚录人声，断网可用）
 * - 可选接入 OpenAI gpt-4o-mini-tts / 硅基流动 CosyVoice2 等专业云端 TTS 接口
 */
import { useEffect, useState } from "react";
import { Check, Cloud, Download, Headphones, Sparkles, Trash2, Volume2 } from "lucide-react";
import {
  clearSupertonicCache,
  ensureSupertonicLoaded,
  isSupertonicCached,
  SUPERTONIC_MODEL_ID,
  type SupertonicProgress,
} from "../lib/localSupertonicTts";
import { speakOffline } from "../lib/nativeBridge";
import {
  EDGE_VOICE_PRESETS,
  getCustomTtsConfig,
  getSelectedVoiceId,
  getVoicePresetById,
  saveCustomTtsConfig,
  setSelectedVoiceId,
  subscribeSelectedVoice,
  SUPERTONIC_VOICE_PRESETS,
  type CustomTtsConfig,
  type VoicePreset,
} from "../lib/voiceCatalog";

interface VoiceStudioPanelProps {
  onToast: (msg: string) => void;
}

export function VoiceStudioPanel({ onToast }: VoiceStudioPanelProps) {
  const [selectedId, setSelectedId] = useState<string>(() => getSelectedVoiceId());
  const [panelTab, setPanelTab] = useState<"edge" | "supertonic" | "custom">(() => {
    const cur = getVoicePresetById(getSelectedVoiceId());
    return cur.engine === "supertonic" ? "supertonic" : "edge";
  });
  const [supertonicCached, setSupertonicCached] = useState<boolean>(() => isSupertonicCached());
  const [stProg, setStProg] = useState<SupertonicProgress>({ status: "idle", progress: 0, message: "" });
  const [previewingId, setPreviewingId] = useState<string>("");
  const [customCfg, setCustomCfg] = useState<CustomTtsConfig>(() => getCustomTtsConfig());

  useEffect(() => {
    return subscribeSelectedVoice((nextId) => {
      setSelectedId(nextId);
    });
  }, []);

  const activePreset = getVoicePresetById(selectedId);

  const handleSelectVoice = (preset: VoicePreset) => {
    setSelectedVoiceId(preset.id);
    setSelectedId(preset.id);
    if (customCfg.enabled) {
      const next = { ...customCfg, enabled: false };
      setCustomCfg(next);
      saveCustomTtsConfig(next);
    }
    if (preset.engine === "supertonic" && !supertonicCached) {
      onToast(`已选中「${preset.shortName}」，点下方一键装入 44.1kHz 引擎即可生效（装入前自动用微软真人声兜底）`);
    } else {
      onToast(`已切换 AI 声音为「${preset.shortName}」`);
    }
  };

  const handlePreviewVoice = async (preset: VoicePreset) => {
    if (preset.engine === "supertonic" && !supertonicCached) {
      onToast("请先点下方按钮装入 Supertonic-2 引擎（~250MB），即可离线试听 44.1kHz 真人棚录声");
      return;
    }
    setPreviewingId(preset.id);
    try {
      const ok = await speakOffline(preset.sampleText, preset.sampleLang, 0.98, preset.id);
      if (!ok) onToast("试听启动失败，请检查网络连接或音量");
    } catch {
      onToast("试听失败，请重试");
    } finally {
      setTimeout(() => setPreviewingId((c) => (c === preset.id ? "" : c)), 900);
    }
  };

  const handleDownloadSupertonic = async () => {
    try {
      await ensureSupertonicLoaded(setStProg, true);
      setSupertonicCached(true);
      onToast("Supertonic-2 44.1kHz 真人棚录引擎已装入，断网也能离线朗读！");
    } catch {
      // error already shown in stProg
    }
  };

  const handleClearSupertonic = async () => {
    await clearSupertonicCache();
    setSupertonicCached(false);
    setStProg({ status: "idle", progress: 0, message: "" });
    onToast("已清理 Supertonic-2 本地缓存");
  };

  const handleSaveCustomTts = () => {
    saveCustomTtsConfig(customCfg);
    onToast(customCfg.enabled ? "已启用自定义云端真人 TTS" : "已保存配置（当前使用内置音色）");
  };

  const handlePreviewCustomTts = async () => {
    saveCustomTtsConfig({ ...customCfg, enabled: true });
    setCustomCfg((prev) => ({ ...prev, enabled: true }));
    setPreviewingId("custom_cloud");
    try {
      const ok = await speakOffline(
        "Hello! This is your custom studio cloud voice speaking naturally on EchoDeck.",
        "en",
        1.0
      );
      if (!ok) onToast("自定义云端 TTS 试听失败，请核对 URL / Key / Voice");
    } finally {
      setTimeout(() => setPreviewingId((c) => (c === "custom_cloud" ? "" : c)), 1000);
    }
  };

  return (
    <section className="surface-card space-y-3.5 rounded-[26px] p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-[var(--text-primary)]">
            <Headphones className="h-4 w-4 text-[var(--accent-text)]" />
            AI 真人音色试听馆（16 款内置 + 可选云端）
          </h2>
          <p className="mt-0.5 text-[var(--text-muted)]">
            完整保留原默认音色；新增 8 款更自然不念稿的对话/英音/澳音/柔声港粤 + GitHub 开源 44.1kHz 棚录离线人声
          </p>
        </div>
        <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--accent-text)]">
          当前：{customCfg.enabled ? `云端 ${customCfg.voice || "自定义"}` : `${activePreset.flag} ${activePreset.shortName}`}
        </span>
      </div>

      {/* 三引擎分类标签 */}
      <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-[var(--bg-subtle)] p-1">
        {[
          { id: "edge" as const, label: "⚡ 即时 (10)" },
          { id: "supertonic" as const, label: "🎧 棚录 (6)" },
          { id: "custom" as const, label: "☁️ 云端接口" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setPanelTab(t.id)}
            className={`whitespace-nowrap rounded-xl px-1.5 py-2 text-[11px] font-bold transition ${
              panelTab === t.id
                ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs"
                : "text-[var(--text-secondary)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 1: 10 款微软即时真人音色（前 2 款完整保留原默认音色） */}
      {panelTab === "edge" && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {EDGE_VOICE_PRESETS.map((v) => {
              const active = !customCfg.enabled && selectedId === v.id;
              return (
                <div
                  key={v.id}
                  className={`flex flex-col justify-between rounded-2xl border p-3 transition ${
                    active
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]/70"
                      : "border-[var(--border-hairline)] bg-[var(--bg-subtle)]/55"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectVoice(v)}
                    className="w-full text-left"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="text-xs font-bold text-[var(--text-primary)]">
                        {v.flag} {v.name}
                      </span>
                      {active ? (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-bold text-[var(--accent-fg)]">
                          <Check className="h-2.5 w-2.5" /> 使用中
                        </span>
                      ) : (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            v.isOriginalDefault
                              ? "bg-[var(--bg-surface)] text-[var(--text-secondary)]"
                              : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                          }`}
                        >
                          {v.badge}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">{v.desc}</p>
                  </button>

                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--border-hairline)]/60 pt-2">
                    <span className="truncate font-mono-code text-[10px] text-[var(--text-muted)]">{v.sourceTag}</span>
                    <button
                      type="button"
                      onClick={() => handlePreviewVoice(v)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-primary)] shadow-2xs active:scale-95"
                    >
                      <Volume2 className={`h-3 w-3 text-[var(--accent-text)] ${previewingId === v.id ? "animate-pulse" : ""}`} />
                      {previewingId === v.id ? "播放中..." : "试听"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => speakOffline("今晚得唔得閒一齊去睇戲食飯？聽講呢套片真係冇得彈！", "yue", 0.96)}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-subtle)] px-3.5 py-1.5 text-[11px] font-semibold text-[var(--text-primary)]"
            >
              <Volume2 className="h-3.5 w-3.5 text-[var(--accent-text)]" />
              用当前音色试听粤语
            </button>
            <button
              type="button"
              onClick={() => speakOffline("Let's play it by ear this weekend and see what we're in the mood for.", "en", 0.96)}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-subtle)] px-3.5 py-1.5 text-[11px] font-semibold text-[var(--text-primary)]"
            >
              <Volume2 className="h-3.5 w-3.5 text-[var(--accent-text)]" />
              用当前音色试听英语
            </button>
          </div>
        </div>
      )}

      {/* Tab 2: GitHub 开源 44.1kHz 真人棚录端侧离线语音（Supertone Supertonic-2） */}
      {panelTab === "supertonic" && (
        <div className="space-y-3">
          <div className="space-y-2 rounded-2xl border border-violet-500/25 bg-violet-500/8 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-violet-700 dark:text-violet-300">
                <Sparkles className="h-3.5 w-3.5" />
                GitHub 开源 44.1kHz 真人棚录引擎（Supertonic-2）
              </div>
              <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                {supertonicCached ? "已装入手机 ✓ 断网可用" : "按需下载 ~250MB"}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
              来自 GitHub 热门项目 <code className="font-mono-code">supertone-inc/supertonic</code>（ONNX: <code className="font-mono-code">{SUPERTONIC_MODEL_ID}</code>）。采用 44.1kHz 流匹配神经语音技术，气声与停顿高度拟人、彻底摆脱传统 TTS 机械腔；原生支持英语/韩语/西语/法语/葡语（播粤语/日语时自动无缝切回微软真人音色）。
            </p>

            {stProg.status === "downloading" && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-violet-700 dark:text-violet-300">
                  <span>{stProg.message}</span>
                  <span className="font-mono-code font-bold">{stProg.progress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-violet-500/20">
                  <div
                    className="h-full rounded-full bg-violet-600 transition-all"
                    style={{ width: `${stProg.progress}%` }}
                  />
                </div>
              </div>
            )}
            {stProg.status === "error" && (
              <div className="text-[11px] text-rose-600 dark:text-rose-400">{stProg.message}</div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={stProg.status === "downloading"}
                onClick={handleDownloadSupertonic}
                className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                {stProg.status === "downloading"
                  ? `装入中 ${stProg.progress}%...`
                  : supertonicCached
                    ? "预热 / 校验 Supertonic-2 引擎 ✓"
                    : "一键装入 Supertonic-2 真人音色库 (~250MB)"}
              </button>
              {supertonicCached && (
                <button
                  type="button"
                  onClick={handleClearSupertonic}
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-surface)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  清理语音缓存
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SUPERTONIC_VOICE_PRESETS.map((v) => {
              const active = !customCfg.enabled && selectedId === v.id;
              return (
                <div
                  key={v.id}
                  className={`flex flex-col justify-between rounded-2xl border p-3 transition ${
                    active
                      ? "border-violet-500 bg-violet-500/10"
                      : "border-[var(--border-hairline)] bg-[var(--bg-subtle)]/55"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectVoice(v)}
                    className="w-full text-left"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="text-xs font-bold text-[var(--text-primary)]">
                        {v.flag} {v.name}
                      </span>
                      {active ? (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white">
                          <Check className="h-2.5 w-2.5" /> 使用中
                        </span>
                      ) : (
                        <span className="rounded-full bg-violet-500/12 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                          {v.badge}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">{v.desc}</p>
                  </button>
                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--border-hairline)]/60 pt-2">
                    <span className="font-mono-code text-[10px] text-[var(--text-muted)]">
                      44.1kHz · {v.supertonicVoiceCode}.bin (50KB)
                    </span>
                    <button
                      type="button"
                      onClick={() => handlePreviewVoice(v)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-primary)] shadow-2xs"
                    >
                      <Volume2 className={`h-3 w-3 text-violet-600 ${previewingId === v.id ? "animate-pulse" : ""}`} />
                      {previewingId === v.id ? "合成中..." : "试听"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 3: 可选专业云端真人 TTS 接口（硅基流动 CosyVoice2 / OpenAI gpt-4o-mini-tts / 自建 Kokoro） */}
      {panelTab === "custom" && (
        <div className="space-y-2.5 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)]/50 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-primary)]">
              <Cloud className="h-3.5 w-3.5 text-[var(--accent-text)]" />
              专业云端真人 TTS（OpenAI 兼容 `/v1/audio/speech`）
            </div>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={customCfg.enabled}
                onChange={(e) => setCustomCfg({ ...customCfg, enabled: e.target.checked })}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              启用此云端音色
            </label>
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
            可选接入 <strong>硅基流动 CosyVoice2（国内高拟人中英粤）</strong>、<strong>OpenAI gpt-4o-mini-tts（coral / sage / shimmer / onyx）</strong> 或自建 Kokoro/FishSpeech 服务；关闭开关或网络失败时自动回退上方内置音色。
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() =>
                setCustomCfg({
                  ...customCfg,
                  url: "https://api.siliconflow.cn/v1/audio/speech",
                  model: "FunAudioLLM/CosyVoice2-0.5B",
                  voice: "FunAudioLLM/CosyVoice2-0.5B:anna",
                })
              }
              className="rounded-full bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-primary)]"
            >
              预设：硅基流动 CosyVoice2
            </button>
            <button
              type="button"
              onClick={() =>
                setCustomCfg({
                  ...customCfg,
                  url: "https://api.openai.com/v1/audio/speech",
                  model: "gpt-4o-mini-tts",
                  voice: "coral",
                })
              }
              className="rounded-full bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-primary)]"
            >
              预设：OpenAI gpt-4o-mini-tts (coral)
            </button>
          </div>
          <input
            value={customCfg.url}
            onChange={(e) => setCustomCfg({ ...customCfg, url: e.target.value })}
            placeholder="TTS 接口地址（如 https://api.siliconflow.cn/v1/audio/speech）"
            className="w-full rounded-xl bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
          />
          <input
            type="password"
            value={customCfg.apiKey}
            onChange={(e) => setCustomCfg({ ...customCfg, apiKey: e.target.value })}
            placeholder="API Key（仅保存在手机本地，不会上传）"
            className="w-full rounded-xl bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              value={customCfg.model}
              onChange={(e) => setCustomCfg({ ...customCfg, model: e.target.value })}
              placeholder="模型名（如 FunAudioLLM/CosyVoice2-0.5B）"
              className="w-full rounded-xl bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
            />
            <input
              value={customCfg.voice}
              onChange={(e) => setCustomCfg({ ...customCfg, voice: e.target.value })}
              placeholder="音色名（如 coral / sage / FunAudioLLM/CosyVoice2-0.5B:anna）"
              className="w-full rounded-xl bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSaveCustomTts}
              className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-xs font-bold text-[var(--accent-fg)]"
            >
              保存云端音色配置
            </button>
            <button
              type="button"
              onClick={handlePreviewCustomTts}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-surface)] px-3.5 py-1.5 text-xs font-semibold text-[var(--text-primary)]"
            >
              <Volume2 className="h-3.5 w-3.5 text-[var(--accent-text)]" />
              保存并试听
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
