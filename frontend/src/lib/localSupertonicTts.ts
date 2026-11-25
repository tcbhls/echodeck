/**
 * EchoDeck v9.1 GitHub 开源 44.1kHz 真人棚录级端侧离线语音引擎：
 * - 基于 GitHub 热门项目 supertone-inc/supertonic（onnx-community/Supertonic-TTS-2-ONNX）
 * - 复用 App 已内置的 @huggingface/transformers v4（零增加 APK 安装包体积）
 * - 44.1kHz CD 级流匹配神经语音，彻底告别机械腔；167 倍实时极速，装入手机缓存一次后断网/飞行模式照常朗读
 * - 原生支持英(en)/韩(ko)/西(es)/法(fr)/葡(pt)；粤语/日语等未支持语种自动无缝回退至微软 Edge 真人音色
 */

export const SUPERTONIC_MODEL_ID = "onnx-community/Supertonic-TTS-2-ONNX";
const READY_FLAG_KEY = "echodeck_supertonic2_ready_v91";
const VOICE_EMBED_CACHE_NAME = "echodeck-supertonic-voices-v1";

export interface SupertonicProgress {
  status: "idle" | "downloading" | "ready" | "error";
  progress: number;
  message: string;
}

let cachedTtsPipeline: any = null;
let loadingPromise: Promise<any> | null = null;
let activeRemoteHost = "https://hf-mirror.com/";
const embeddingCache = new Map<string, Float32Array>();
const wavBlobCache = new Map<string, string>();
let activeSupertonicAudio: HTMLAudioElement | null = null;

export function isSupertonicCached(): boolean {
  try {
    return localStorage.getItem(READY_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function isSupertonicLoaded(): boolean {
  return Boolean(cachedTtsPipeline);
}

/** Supertonic-2 原生支持语种映射（不支持的语种返回 null，交由上层自动切 Edge 真人音色） */
export function mapLangToSupertonicTag(language: string): "en" | "ko" | "es" | "fr" | "pt" | null {
  const low = (language || "en").toLowerCase().trim();
  if (low === "en" || low.startsWith("en-")) return "en";
  if (low === "ko" || low.startsWith("ko-")) return "ko";
  if (low === "es" || low.startsWith("es-")) return "es";
  if (low === "fr" || low.startsWith("fr-")) return "fr";
  if (low === "pt" || low.startsWith("pt-")) return "pt";
  return null;
}

export function stopSupertonicAudio(): void {
  if (activeSupertonicAudio) {
    try {
      activeSupertonicAudio.pause();
      activeSupertonicAudio.currentTime = 0;
    } catch {
      // ignore
    }
  }
}

async function hasWorkingWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as any)?.gpu;
    if (!gpu || typeof gpu.requestAdapter !== "function") return false;
    const adapter = await gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

/** 按需下载并初始化手机 App 内置的 Supertonic-2 44.1kHz 真人语音模型（~250MB，国内镜像优先） */
export async function ensureSupertonicLoaded(
  onProgress?: (p: SupertonicProgress) => void,
  useMirror = true
): Promise<any> {
  if (cachedTtsPipeline) {
    onProgress?.({ status: "ready", progress: 100, message: "Supertonic-2 44.1kHz 真人音色引擎已就绪" });
    return cachedTtsPipeline;
  }
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const canWebGpu = await hasWorkingWebGpu();
      const device: "webgpu" | "wasm" = canWebGpu ? "webgpu" : "wasm";
      onProgress?.({
        status: "downloading",
        progress: 4,
        message: `正在连接开源镜像，加载 Supertonic-2 44.1kHz 引擎（${device.toUpperCase()}）...`,
      });

      const transformers = await import("@huggingface/transformers");
      const env = transformers.env as any;
      env.allowLocalModels = false;
      env.useBrowserCache = true;

      const hosts = useMirror
        ? ["https://hf-mirror.com/", "https://huggingface.co/"]
        : ["https://huggingface.co/", "https://hf-mirror.com/"];

      let lastErr: any = null;
      for (const host of hosts) {
        try {
          env.remoteHost = host;
          const pipe = await transformers.pipeline("text-to-speech", SUPERTONIC_MODEL_ID, {
            device,
            progress_callback: (info: any) => {
              if (info?.status === "progress" && typeof info.progress === "number") {
                const pct = Math.max(5, Math.min(98, Math.round(info.progress)));
                onProgress?.({
                  status: "downloading",
                  progress: pct,
                  message: `下载 Supertonic-2 (${info.file || "声学权重"}) ${pct}%`,
                });
              }
            },
          });
          cachedTtsPipeline = pipe;
          activeRemoteHost = host;
          try {
            localStorage.setItem(READY_FLAG_KEY, "1");
          } catch {
            // ignore
          }
          onProgress?.({
            status: "ready",
            progress: 100,
            message: "Supertonic-2 已装入手机本地（44.1kHz 真人级·断网可用）！",
          });
          return pipe;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr || new Error("Supertonic-2 模型加载失败");
    } catch (e: any) {
      cachedTtsPipeline = null;
      onProgress?.({
        status: "error",
        progress: 0,
        message: `下载失败：${e?.message || "请检查网络后重试"}`,
      });
      throw e;
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

/** 加载并持久缓存 50KB 声纹风格向量（F1~F5 / M1~M5），确保断网离线可复播 */
async function loadVoiceEmbedding(voiceCode: string): Promise<Float32Array> {
  const existing = embeddingCache.get(voiceCode);
  if (existing) return existing;

  const relPath = `${SUPERTONIC_MODEL_ID}/resolve/main/voices/${voiceCode}.bin`;
  const hosts = activeRemoteHost.includes("hf-mirror")
    ? ["https://hf-mirror.com/", "https://huggingface.co/"]
    : ["https://huggingface.co/", "https://hf-mirror.com/"];

  // 先查浏览器持久 Cache
  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open(VOICE_EMBED_CACHE_NAME);
      for (const h of hosts) {
        const hit = await cache.match(`${h}${relPath}`);
        if (hit && hit.ok) {
          const buf = await hit.arrayBuffer();
          const vec = new Float32Array(buf);
          embeddingCache.set(voiceCode, vec);
          return vec;
        }
      }
    } catch {
      // ignore
    }
  }

  let lastErr: any = null;
  for (const h of hosts) {
    const url = `${h}${relPath}`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const clone = resp.clone();
      const buf = await resp.arrayBuffer();
      const vec = new Float32Array(buf);
      embeddingCache.set(voiceCode, vec);
      if (typeof caches !== "undefined") {
        caches
          .open(VOICE_EMBED_CACHE_NAME)
          .then((c) => c.put(url, clone))
          .catch(() => undefined);
      }
      return vec;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`声纹文件 ${voiceCode}.bin 获取失败`);
}

/** 使用 Supertonic-2 44.1kHz 端侧引擎朗读指定句子（支持缓存秒播与倍速） */
export async function speakWithSupertonic(
  text: string,
  language: string,
  voiceCode: string,
  rate = 1.0
): Promise<boolean> {
  const langTag = mapLangToSupertonicTag(language);
  if (!langTag) return false;
  const clean = text.trim().slice(0, 260);
  if (!clean) return false;

  const cacheKey = `${voiceCode}|${langTag}|${clean}`;
  let blobUrl = wavBlobCache.get(cacheKey);
  if (!blobUrl) {
    const pipe = await ensureSupertonicLoaded();
    const speakerVec = await loadVoiceEmbedding(voiceCode);
    const tagged = `<${langTag}>${clean}</${langTag}>`;
    const audio = await pipe(tagged, {
      speaker_embeddings: speakerVec,
      num_inference_steps: 5,
      speed: 1.0,
    });
    const blob: Blob = typeof audio?.toBlob === "function" ? audio.toBlob() : encodePcmToWavBlob(audio?.audio, audio?.sampling_rate || 44100);
    blobUrl = URL.createObjectURL(blob);
    // 限制内存缓存最多 40 条，避免长期占用
    if (wavBlobCache.size >= 40) {
      const oldest = wavBlobCache.keys().next().value;
      if (oldest) {
        const oldUrl = wavBlobCache.get(oldest);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        wavBlobCache.delete(oldest);
      }
    }
    wavBlobCache.set(cacheKey, blobUrl);
  }

  stopSupertonicAudio();
  if (!activeSupertonicAudio) activeSupertonicAudio = new Audio();
  activeSupertonicAudio.src = blobUrl;
  activeSupertonicAudio.playbackRate = Math.max(0.6, Math.min(1.5, rate));
  await activeSupertonicAudio.play();
  return true;
}

/** 兜底 WAV 编码（以防 RawAudio.toBlob 不可用） */
function encodePcmToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const numSamples = samples?.length || 0;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, numSamples * 2, true);
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** 释放 Supertonic-2 本地模型与声纹缓存 */
export async function clearSupertonicCache(): Promise<void> {
  stopSupertonicAudio();
  cachedTtsPipeline = null;
  embeddingCache.clear();
  for (const url of wavBlobCache.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }
  wavBlobCache.clear();
  try {
    localStorage.removeItem(READY_FLAG_KEY);
  } catch {
    // ignore
  }
  if (typeof caches !== "undefined") {
    await caches.delete(VOICE_EMBED_CACHE_NAME).catch(() => undefined);
    const keys = await caches.keys().catch(() => []);
    for (const k of keys) {
      if (/transformers|huggingface/i.test(k)) {
        // 仅清理与 Supertonic 相关的缓存条目，避免误删用户下载的 Qwen3/HY-MT 端侧大脑！
        try {
          const c = await caches.open(k);
          const reqs = await c.keys();
          for (const r of reqs) {
            if (/supertonic/i.test(r.url)) {
              await c.delete(r);
            }
          }
        } catch {
          // ignore
        }
      }
    }
  }
}
