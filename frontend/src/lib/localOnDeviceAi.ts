/**
 * EchoDeck 原生端侧离线 AI 引擎（Android ARM64 llama.cpp + 共享目录 Download/LocalAI）：
 * - 使用标准 GGUF 格式并支持读写手机公共目录 Download/LocalAI（零拷贝 mmap，方便与其他本地 AI 应用共用权重）
 * - 支持 Qwen3-8B / Qwen3-4B / Qwen3-1.7B / Qwen3-0.6B 一键高速下载、HTTP Range 断点续传与 GGUF 魔数头校验
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type OnDeviceModelKey = "qwen3-8b" | "qwen3-4b" | "qwen3-1.7b" | "qwen3-0.6b";

export interface OnDeviceModelSpec {
  key: OnDeviceModelKey;
  fileName: string;
  githubRepo: string;
  name: string;
  badge: string;
  sizeLabel: string;
  ramHint: string;
  desc: string;
  primaryUrl: string;
  fallbackUrl: string;
  isQwen3?: boolean;
}

export interface NativeDownloadedModelFile {
  fileName: string;
  sizeBytes: number;
  shared?: boolean;
}

export interface NativeLocalLlmStatus {
  supported: boolean;
  loaded: boolean;
  loadedFileName: string;
  downloading: boolean;
  sharedStorageGranted: boolean;
  sharedDirPath: string;
  modelsDir: string;
  systemInfo: string;
  downloadedFiles: NativeDownloadedModelFile[];
}

export interface OnDeviceProgress {
  status: "idle" | "downloading" | "ready" | "error";
  progress: number;
  message: string;
  speedMBps?: number;
  downloadedBytes?: number;
  totalBytes?: number;
}

interface EchoDeckLocalLlmNativePlugin {
  getStatus(): Promise<NativeLocalLlmStatus>;
  requestSharedStoragePermission(): Promise<{ granted: boolean; openedSettings: boolean }>;
  downloadModel(options: {
    url: string;
    fallbackUrl?: string;
    fileName: string;
  }): Promise<{ fileName: string; sizeBytes: number; alreadyExisted: boolean; shared?: boolean }>;
  cancelDownload(): Promise<{ cancelled: boolean }>;
  deleteModel(options: { fileName: string }): Promise<{ deleted: boolean }>;
  loadModel(options: {
    fileName: string;
    contextSize?: number;
    threads?: number;
  }): Promise<{ loaded: boolean; fileName: string; loadTimeMs?: number; cached?: boolean; shared?: boolean }>;
  unloadModel(): Promise<{ unloaded: boolean }>;
  complete(options: {
    prompt: string;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<{
    text: string;
    tokensGenerated: number;
    tokensPerSecond: number;
    promptEvalTimeMs: number;
    generateTimeMs: number;
    modelFileName: string;
  }>;
  addListener(
    eventName: "downloadProgress",
    listenerFunc: (event: {
      fileName: string;
      downloadedBytes: number;
      totalBytes: number;
      percent: number;
      speedMBps: number;
    }) => void
  ): Promise<PluginListenerHandle>;
}

const NativeLocalLlm = registerPlugin<EchoDeckLocalLlmNativePlugin>("EchoDeckLocalLlm");

export const ONDEVICE_MODELS: OnDeviceModelSpec[] = [
  {
    key: "qwen3-8b",
    fileName: "Qwen3-8B-Q4_K_M.gguf",
    githubRepo: "QwenLM/Qwen3",
    name: "通义千问 Qwen3-8B（Q4_K_M 旗舰）",
    badge: "👑 16GB 满血 · 旗舰推荐",
    sizeLabel: "~4.80 GB",
    ramHint: "推荐 12GB/16GB 旗舰机",
    desc: "端侧智商天花板，粤语/英语地道口语纠错、剧集俚语翻译、多步工具调用一模全能，支持放入 Download/LocalAI 跨应用复用。",
    primaryUrl:
      "https://www.modelscope.cn/api/v1/models/Qwen/Qwen3-8B-GGUF/repo?Revision=master&FilePath=Qwen3-8B-Q4_K_M.gguf",
    fallbackUrl:
      "https://www.modelscope.cn/api/v1/models/unsloth/Qwen3-8B-GGUF/repo?Revision=master&FilePath=Qwen3-8B-Q4_K_M.gguf",
    isQwen3: true,
  },
  {
    key: "qwen3-4b",
    fileName: "Qwen3-4B-Q4_K_M.gguf",
    githubRepo: "QwenLM/Qwen3",
    name: "通义千问 Qwen3-4B（Q4_K_M 全能甜点）",
    badge: "🏆 速度智商双优 · 推荐",
    sizeLabel: "~2.38 GB",
    ramHint: "推荐 8GB+ 运存手机",
    desc: "体积减半、响应极快发热低，同时具备扎实的中英粤三语翻译、外语复述与语法精讲能力。",
    primaryUrl:
      "https://www.modelscope.cn/api/v1/models/Qwen/Qwen3-4B-GGUF/repo?Revision=master&FilePath=Qwen3-4B-Q4_K_M.gguf",
    fallbackUrl:
      "https://www.modelscope.cn/api/v1/models/unsloth/Qwen3-4B-GGUF/repo?Revision=master&FilePath=Qwen3-4B-Q4_K_M.gguf",
    isQwen3: true,
  },
  {
    key: "qwen3-1.7b",
    fileName: "Qwen3-1.7B-Q4_K_M.gguf",
    githubRepo: "QwenLM/Qwen3",
    name: "通义千问 Qwen3-1.7B（轻快省电）",
    badge: "⚡ 流畅均衡 · 1GB 轻量",
    sizeLabel: "~1.06 GB",
    ramHint: "6GB+ 运存流畅运行",
    desc: "低功耗秒级响应，支持 119 语种含粤英日韩日常对话与翻译。",
    primaryUrl:
      "https://www.modelscope.cn/api/v1/models/unsloth/Qwen3-1.7B-GGUF/repo?Revision=master&FilePath=Qwen3-1.7B-Q4_K_M.gguf",
    fallbackUrl: "https://hf-mirror.com/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf",
    isQwen3: true,
  },
  {
    key: "qwen3-0.6b",
    fileName: "Qwen3-0.6B-Q4_K_M.gguf",
    githubRepo: "QwenLM/Qwen3",
    name: "通义千问 Qwen3-0.6B（极速兜底）",
    badge: "🪶 378 MB · 极速体验",
    sizeLabel: "~378 MB",
    ramHint: "4GB+ 机型兼容",
    desc: "占用空间最小，普通 Wi-Fi 十余秒下完，适合存储空间紧张时离线备用。",
    primaryUrl:
      "https://www.modelscope.cn/api/v1/models/unsloth/Qwen3-0.6B-GGUF/repo?Revision=master&FilePath=Qwen3-0.6B-Q4_K_M.gguf",
    fallbackUrl: "https://hf-mirror.com/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf",
    isQwen3: true,
  },
];

export const DEFAULT_ONDEVICE_MODEL_KEY: OnDeviceModelKey = "qwen3-8b";
const SELECTED_MODEL_KEY = "echodeck_ondevice_selected_model_v97";
const READY_PREFIX = "echodeck_ondevice_ready_v97_";

export function isNativeLlamaSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export function getOnDeviceModelSpec(key?: OnDeviceModelKey | string): OnDeviceModelSpec {
  return (
    ONDEVICE_MODELS.find((m) => m.key === key || m.fileName === key) || ONDEVICE_MODELS[0]
  );
}

export function getSelectedOnDeviceModelKey(): OnDeviceModelKey {
  try {
    const raw = localStorage.getItem(SELECTED_MODEL_KEY) as OnDeviceModelKey | null;
    if (raw && ONDEVICE_MODELS.some((m) => m.key === raw)) return raw;
  } catch {
    // ignore
  }
  return DEFAULT_ONDEVICE_MODEL_KEY;
}

export function setSelectedOnDeviceModelKey(key: OnDeviceModelKey): void {
  try {
    localStorage.setItem(SELECTED_MODEL_KEY, key);
  } catch {
    // ignore
  }
}

export function isOnDeviceAiCached(key?: OnDeviceModelKey): boolean {
  const target = key || getSelectedOnDeviceModelKey();
  try {
    return localStorage.getItem(`${READY_PREFIX}${target}`) === "1";
  } catch {
    return false;
  }
}

export async function getNativeLocalLlmStatus(): Promise<NativeLocalLlmStatus> {
  if (!isNativeLlamaSupported()) {
    return {
      supported: false,
      loaded: false,
      loadedFileName: "",
      downloading: false,
      sharedStorageGranted: false,
      sharedDirPath: "/storage/emulated/0/Download/LocalAI",
      modelsDir: "",
      systemInfo: "当前为网页预览模式；安装 Android APK 后将自动启用原生 ARM64 llama.cpp 端侧离线推理引擎",
      downloadedFiles: [],
    };
  }
  const st = await NativeLocalLlm.getStatus();
  // 同步刷新本地缓存标记，确保从其他 App 下载到共享目录的模型立即显示为已就绪
  try {
    for (const m of ONDEVICE_MODELS) {
      const exists = st.downloadedFiles.some((f) => f.fileName === m.fileName);
      if (exists) {
        localStorage.setItem(`${READY_PREFIX}${m.key}`, "1");
      } else {
        localStorage.removeItem(`${READY_PREFIX}${m.key}`);
      }
    }
  } catch {
    // ignore
  }
  return st;
}

export async function requestSharedModelDirPermission(): Promise<{ granted: boolean; openedSettings: boolean }> {
  if (!isNativeLlamaSupported()) {
    return { granted: false, openedSettings: false };
  }
  return NativeLocalLlm.requestSharedStoragePermission();
}

export async function cancelNativeModelDownload(): Promise<void> {
  if (!isNativeLlamaSupported()) return;
  await NativeLocalLlm.cancelDownload();
}

export async function deleteNativeModel(fileName: string): Promise<void> {
  if (!isNativeLlamaSupported()) return;
  await NativeLocalLlm.deleteModel({ fileName });
  const spec = ONDEVICE_MODELS.find((m) => m.fileName === fileName);
  if (spec) {
    try {
      localStorage.removeItem(`${READY_PREFIX}${spec.key}`);
    } catch {
      // ignore
    }
  }
}

export async function unloadNativeModel(): Promise<void> {
  if (!isNativeLlamaSupported()) return;
  await NativeLocalLlm.unloadModel();
}

/** 清理 Qwen3 可能附带的 <think>...</think> 思考标签，只返回干净对话/译文/JSON */
function cleanOnDeviceOutput(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^<think>[\s\S]*/i, "")
    .trim();
}

/** 下载（支持公共共享目录与断点续传）并载入原生 ARM64 llama.cpp 模型 */
export async function ensureOnDeviceAiLoaded(
  onProgress?: (p: OnDeviceProgress) => void,
  modelKey?: OnDeviceModelKey | string
): Promise<string> {
  if (!isNativeLlamaSupported()) {
    const msg = "原生 ARM64 端侧引擎需在 Android 手机 APK 中运行；浏览器预览请使用智谱免费 AI";
    onProgress?.({ status: "error", progress: 0, message: msg });
    throw new Error(msg);
  }

  const matchedSpec = ONDEVICE_MODELS.find((m) => m.key === modelKey || m.fileName === modelKey);
  const spec = matchedSpec || getOnDeviceModelSpec(getSelectedOnDeviceModelKey());
  const targetFileName =
    typeof modelKey === "string" && modelKey.toLowerCase().endsWith(".gguf") ? modelKey : spec.fileName;

  const status = await getNativeLocalLlmStatus();
  const alreadyExists = status.downloadedFiles.some((f) => f.fileName === targetFileName);

  if (!alreadyExists) {
    if (!matchedSpec && targetFileName !== spec.fileName) {
      throw new Error(`未找到自定义模型文件：${targetFileName}`);
    }
    onProgress?.({
      status: "downloading",
      progress: 2,
      message: `正在连接魔搭国内源下载 ${spec.name}（支持断点续传）...`,
    });

    let handle: PluginListenerHandle | null = null;
    try {
      if (onProgress) {
        handle = await NativeLocalLlm.addListener("downloadProgress", (ev) => {
          if (ev.fileName === spec.fileName) {
            const dlMb = (ev.downloadedBytes / (1024 * 1024)).toFixed(0);
            const totMb = ev.totalBytes > 0 ? ` / ${(ev.totalBytes / (1024 * 1024)).toFixed(0)} MB` : " MB";
            const sp = ev.speedMBps > 0 ? ` · ${ev.speedMBps} MB/s` : "";
            onProgress({
              status: "downloading",
              progress: Math.max(2, Math.min(99, ev.percent)),
              message: `下载 ${spec.name} (${dlMb}${totMb}${sp})`,
              speedMBps: ev.speedMBps,
              downloadedBytes: ev.downloadedBytes,
              totalBytes: ev.totalBytes,
            });
          }
        });
      }
      await NativeLocalLlm.downloadModel({
        url: spec.primaryUrl,
        fallbackUrl: spec.fallbackUrl,
        fileName: spec.fileName,
      });
    } catch (err: any) {
      const msg = err?.message || String(err);
      onProgress?.({ status: "error", progress: 0, message: msg });
      throw err;
    } finally {
      if (handle) await handle.remove();
    }
  }

  onProgress?.({
    status: "downloading",
    progress: 99,
    message: `正在将 ${targetFileName} 零拷贝载入原生 llama.cpp 引擎...`,
  });

  await NativeLocalLlm.loadModel({
    fileName: targetFileName,
    contextSize: 3072,
  });

  if (matchedSpec) {
    setSelectedOnDeviceModelKey(matchedSpec.key);
    try {
      localStorage.setItem(`${READY_PREFIX}${matchedSpec.key}`, "1");
    } catch {
      // ignore
    }
  }

  onProgress?.({
    status: "ready",
    progress: 100,
    message: `${targetFileName} 已就绪（原生 ARM64 · 断网可用）`,
  });
  return targetFileName;
}

/** 使用原生 ARM64 llama.cpp 离线生成回复（自动识别共享目录中已下载的最强模型） */
export async function runOnDeviceChat(
  messages: Array<{ role: string; content: string }>,
  temperature = 0.45
): Promise<string> {
  if (!isNativeLlamaSupported()) {
    throw new Error("原生本地 AI 仅在 Android 手机 APK 中可用");
  }

  const st = await getNativeLocalLlmStatus();
  const preferredSpec = getOnDeviceModelSpec(getSelectedOnDeviceModelKey());

  let targetFile = st.loaded ? st.loadedFileName : "";
  if (!targetFile) {
    if (st.downloadedFiles.some((f) => f.fileName === preferredSpec.fileName)) {
      targetFile = preferredSpec.fileName;
    } else if (st.downloadedFiles.length > 0) {
      // 自动优先挑选体积最大（能力最强）的共享/本地模型（如 Qwen3-8B）
      const sorted = [...st.downloadedFiles].sort((a, b) => b.sizeBytes - a.sizeBytes);
      targetFile = sorted[0].fileName;
    } else {
      throw new Error("手机尚未下载本地 GGUF 模型（或尚未开启 Download/LocalAI 共享权限）");
    }
    await NativeLocalLlm.loadModel({ fileName: targetFile, contextSize: 3072 });
  }

  const systemParts: string[] = [];
  const dialogLines: string[] = [];
  // 本地 4B/8B 端侧只携带最近 3 条对话与精简系统指令，避免 2000+ token prefill 导致等待过久
  const recent = messages.slice(-3);
  for (const m of recent) {
    const content = String(m.content || "").trim();
    if (!content) continue;
    if (m.role === "system") {
      systemParts.push(content);
    } else if (m.role === "assistant") {
      dialogLines.push(`Assistant: ${content.slice(0, 420)}`);
    } else {
      dialogLines.push(`User: ${content.slice(0, 900)}`);
    }
  }

  const rawSys = systemParts.join("\n\n");
  const isQwen3 = targetFile.toLowerCase().includes("qwen3");
  let systemPrompt = rawSys;
  // 若传入的是云端长系统提示（> 650 字），自动压缩为高密度端侧指令，提速 5 倍且保持完整 JSON 输出协议
  if (rawSys.length > 650) {
    const langMatch = rawSys.match(/code="([a-z-]+)"/);
    const langCode = langMatch?.[1] || "en";
    const isJsonAgent = rawSys.includes('"user_recast"') && rawSys.includes('"reply_zh"');
    if (isJsonAgent) {
      systemPrompt =
        `你是 EchoDeck 本地离线 AI 外教（当前真实运行模型：${targetFile}）。当前目标语种 code="${langCode}"。` +
        `请只输出一个合法 JSON：{"actions":[],"need_followup":false,"user_recast":"若用户用中文则地道复述为目标语否则空字符串","correction":null,"reply":"用目标语自然回复(120词内)","reply_zh":"reply的简体中文翻译","speak_text":"1句朗读句","speak_lang":"${langCode}","suggested_replies":[]}。` +
        `常用工具：search_online_cinema({query,auto_play})、create_review_card({front_text,translation,focus_chunk,note,language})、search_lexicon({query,lang})、get_study_stats({})。`;
    } else {
      systemPrompt = `你是 EchoDeck 本地离线语言学习助手（当前运行模型：${targetFile}）。请简洁准确地回复用户。\n${rawSys.slice(0, 500)}`;
    }
  } else if (systemPrompt && !systemPrompt.includes(targetFile)) {
    systemPrompt = `${systemPrompt}\n（当前本机离线运行模型：${targetFile}）`;
  }
  if (isQwen3 && !systemPrompt.includes("/no_think")) {
    systemPrompt = systemPrompt ? `${systemPrompt}\n/no_think` : "/no_think";
  }

  let userPrompt =
    dialogLines.length === 1 && dialogLines[0].startsWith("User: ")
      ? dialogLines[0].slice(6)
      : dialogLines.join("\n\n");

  if (isQwen3 && !userPrompt.includes("/no_think")) {
    userPrompt = `${userPrompt}\n/no_think`;
  }

  const res = await NativeLocalLlm.complete({
    prompt: userPrompt,
    systemPrompt,
    maxTokens: 360,
    temperature: Math.max(0.1, Math.min(1.0, temperature)),
  });

  return cleanOnDeviceOutput(res.text) || res.text.trim();
}

/** 释放当前已卸载/删除的模型缓存 */
export async function clearOnDeviceAiCache(): Promise<void> {
  if (isNativeLlamaSupported()) {
    await NativeLocalLlm.unloadModel().catch(() => undefined);
  }
  try {
    for (const m of ONDEVICE_MODELS) {
      localStorage.removeItem(`${READY_PREFIX}${m.key}`);
    }
  } catch {
    // ignore
  }
}
