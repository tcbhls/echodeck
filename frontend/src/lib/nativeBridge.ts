/**
 * Capacitor Android 原生能力桥接层：
 * - 在独立 Android APK 内直接调用原生 Java 插件（EchoDeckNative）：
 *   1) 无 CORS 限制直下 B站音视频+CC/AI字幕、小宇宙播客 MP3、任意媒体直链
 *   2) 调用 Android 系统原生离线 TTS（支持 en-US / zh-HK 港粤语音）
 *   3) 接收其他 App（B站/抖音/小宇宙/相册）「分享到 EchoDeck」传来的链接或文件
 * - 在普通手机浏览器/PWA 下自动回退 Web 标准能力，100% 脱离电脑运行。
 */

import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  isSupertonicCached,
  isSupertonicLoaded,
  mapLangToSupertonicTag,
  speakWithSupertonic,
  stopSupertonicAudio,
} from "./localSupertonicTts";
import {
  getCustomTtsConfig,
  getSelectedVoiceId,
  getVoicePresetById,
  setSelectedVoiceId,
} from "./voiceCatalog";

export interface NativeDownloadResult {
  title: string;
  sourceType: string;
  mimeType: string;
  /** 写入私有目录后的文件 URI，可直接用 Capacitor.convertFileSrc 转为本地可读 Blob/URL */
  filePath: string;
  subtitleText?: string;
  subtitleFormat?: string;
}

export type AiMessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface AiChatMessage {
  role: string;
  content: string | AiMessageContentPart[];
}

interface EchoDeckNativePlugin {
  downloadMedia(options: {
    url: string;
    audioOnly?: boolean;
    cobaltEndpoint?: string;
  }): Promise<NativeDownloadResult>;
  speak(options: {
    text: string;
    language: string;
    rate?: number;
    voiceGender?: "female" | "male";
    voiceId?: string;
    customTtsUrl?: string;
    customTtsKey?: string;
    customTtsModel?: string;
    customTtsVoice?: string;
  }): Promise<{ ok: boolean; engine?: string; voice?: string; reason?: string }>;
  stopSpeak(): Promise<void>;
  aiChat(options: {
    freeMode: boolean;
    url?: string;
    apiKey?: string;
    model?: string;
    messages: AiChatMessage[];
    temperature?: number;
    jsonMode?: boolean;
  }): Promise<{ content: string; provider?: string }>;
  httpGet(options: { url: string; referer?: string }): Promise<{ text: string }>;
  setFullscreenMode(options: { enabled: boolean; landscape?: boolean }): Promise<void>;
  setSystemTheme(options: { dark: boolean }): Promise<void>;
  minimizeApp(): Promise<void>;
  getSharedIntent(): Promise<{ text?: string; url?: string }>;
  clearSharedIntent(): Promise<void>;
}

const EchoDeckNative = registerPlugin<EchoDeckNativePlugin>("EchoDeckNative");

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function nativeDownloadMedia(
  url: string,
  options: { audioOnly?: boolean; cobaltEndpoint?: string } = {}
): Promise<{
  title: string;
  sourceType: string;
  blob: Blob;
  subtitleText?: string;
  subtitleFormat?: string;
}> {
  if (isNativeAndroid()) {
    const res = await EchoDeckNative.downloadMedia({
      url,
      audioOnly: Boolean(options.audioOnly),
      cobaltEndpoint: options.cobaltEndpoint || "",
    });
    const fetchUrl = Capacitor.convertFileSrc(res.filePath);
    const resp = await fetch(fetchUrl);
    if (!resp.ok) throw new Error("读取手机本地下载文件失败");
    const blob = await resp.blob();
    return {
      title: res.title,
      sourceType: res.sourceType,
      blob,
      subtitleText: res.subtitleText,
      subtitleFormat: res.subtitleFormat,
    };
  }

  // 非原生环境（如 iPhone Safari / 桌面浏览器）：支持直链或自定义 Cobalt API
  const trimmed = url.trim();
  if (/\.(mp4|m4a|mp3|wav|webm|ogg)(\?.*)?$/i.test(trimmed)) {
    const resp = await fetch(trimmed);
    if (!resp.ok) throw new Error(`直链拉取失败 (HTTP ${resp.status})`);
    const blob = await resp.blob();
    const fname = trimmed.split("/").pop()?.split("?")[0] || "媒体音频";
    return { title: decodeURIComponent(fname), sourceType: "direct", blob };
  }

  if (options.cobaltEndpoint?.trim()) {
    const endpoint = options.cobaltEndpoint.trim().replace(/\/$/, "");
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        url: trimmed,
        downloadMode: options.audioOnly ? "audio" : "auto",
        audioFormat: "mp3",
      }),
    });
    const data = await resp.json();
    const mediaUrl = data?.url;
    if (!mediaUrl) throw new Error(data?.error?.code || "解析节点未返回可下载媒体地址");
    const mediaResp = await fetch(mediaUrl);
    const blob = await mediaResp.blob();
    return { title: data.filename || "在线采集素材", sourceType: "web", blob };
  }

  throw new Error(
    "当前在普通浏览器中运行，受浏览器跨域限制无法直接抓 B站/小宇宙页面。请安装 EchoDeck Android APK（原生内置无限制解析），或在下方导入本地录屏/音视频文件。"
  );
}

let webFallbackAudio: HTMLAudioElement | null = null;
let customWebAudio: HTMLAudioElement | null = null;
let customWebAudioObjectUrl: string | null = null;

function revokeCustomAudioUrl(): void {
  if (customWebAudioObjectUrl) {
    try {
      URL.revokeObjectURL(customWebAudioObjectUrl);
    } catch {
      // ignore
    }
    customWebAudioObjectUrl = null;
  }
}

export function getVoiceGenderPref(): "female" | "male" {
  return getVoicePresetById(getSelectedVoiceId()).gender;
}

export function setVoiceGenderPref(g: "female" | "male"): void {
  setSelectedVoiceId(g === "male" ? "edge_andrew" : "edge_ava");
}

export function stopAllSpeech(): void {
  stopSupertonicAudio();
  if (webFallbackAudio) {
    try {
      webFallbackAudio.pause();
    } catch {
      // ignore
    }
  }
  if (customWebAudio) {
    try {
      customWebAudio.pause();
    } catch {
      // ignore
    }
  }
  if ("speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
  if (isNativeAndroid()) {
    EchoDeckNative.stopSpeak().catch(() => undefined);
  }
}

/** 手机多引擎真人发声系统（保留原有默认音色 + 新增 8 款新一代多口音音色 + GitHub 44.1kHz 端侧 Supertonic-2 + 可选专业云端 TTS）：
 * 0) 若启用了自定义专业云端 TTS（OpenAI gpt-4o-mini-tts / 硅基流动 CosyVoice2 / FishAudio）且未指定内置试听音色 -> 优先直出高清 MP3
 * 1) 若选中 GitHub 开源 Supertonic-2 44.1kHz 真人棚录端侧音色（且当前语种支持且已装入）-> 100% 手机本地 44.1kHz 离线发声
 * 2) Microsoft Edge 神经网络真人语音（完整保留原 Ava/晓佳 与 Andrew/云龙，新增 Emma/Brian/Aria/Sonia/Ryan/Natasha/William/晓曼，自动本地缓存）
 * 3) Android 系统原生离线 TTS / Web SpeechSynthesis / 百度语音兜底
 */
export async function speakOffline(
  text: string,
  language: string,
  rate = 1.0,
  overrideVoiceId?: string
): Promise<boolean> {
  const clean = text.trim();
  if (!clean) return false;

  stopSupertonicAudio();
  if (customWebAudio) {
    try {
      customWebAudio.pause();
    } catch {
      // ignore
    }
  }

  const activeVoiceId = overrideVoiceId || getSelectedVoiceId();
  const preset = getVoicePresetById(activeVoiceId);
  const customCfg = overrideVoiceId ? null : getCustomTtsConfig();
  const useCustomCloud = Boolean(customCfg?.enabled && customCfg.url && customCfg.voice);

  // 1. 若在非原生浏览器启用自定义云端 TTS，直接 POST /v1/audio/speech 播放
  if (useCustomCloud && !isNativeAndroid() && customCfg) {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (customCfg.apiKey) headers.Authorization = `Bearer ${customCfg.apiKey}`;
      const resp = await fetch(customCfg.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: customCfg.model || "gpt-4o-mini-tts",
          input: clean.slice(0, 360),
          voice: customCfg.voice,
          response_format: "mp3",
          speed: 1.0,
        }),
      });
      if (resp.ok) {
        const blob = await resp.blob();
        revokeCustomAudioUrl();
        const url = URL.createObjectURL(blob);
        customWebAudioObjectUrl = url;
        if (!customWebAudio) customWebAudio = new Audio();
        customWebAudio.src = url;
        customWebAudio.playbackRate = Math.min(Math.max(rate, 0.55), 1.5);
        await customWebAudio.play();
        return true;
      }
    } catch {
      // fall through
    }
  }

  // 2. 若选中 GitHub 开源 44.1kHz 端侧 Supertonic-2 且已装入本地（并支持当前语种），优先使用 44.1kHz 真人棚录语音！
  if (
    !useCustomCloud &&
    preset.engine === "supertonic" &&
    preset.supertonicVoiceCode &&
    mapLangToSupertonicTag(language) &&
    (isSupertonicLoaded() || isSupertonicCached())
  ) {
    try {
      if (isNativeAndroid()) {
        EchoDeckNative.stopSpeak().catch(() => undefined);
      }
      const ok = await speakWithSupertonic(clean, language, preset.supertonicVoiceCode, rate);
      if (ok) return true;
    } catch {
      // 若端侧合成异常自动降级到 Edge 真人音色，绝不静音
    }
  }

  // 3. Android 原生桥接：支持自定义云端 TTS + 全量 Edge 多音色真人神经网络 + 系统离线 TTS 兜底
  if (isNativeAndroid()) {
    try {
      const res = await EchoDeckNative.speak({
        text: clean,
        language,
        rate,
        voiceGender: preset.gender,
        voiceId: preset.id,
        customTtsUrl: useCustomCloud && customCfg ? customCfg.url : "",
        customTtsKey: useCustomCloud && customCfg ? customCfg.apiKey : "",
        customTtsModel: useCustomCloud && customCfg ? customCfg.model : "",
        customTtsVoice: useCustomCloud && customCfg ? customCfg.voice : "",
      });
      if (res?.ok) return true;
    } catch {
      // fall through
    }
  }

  if ("speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined") {
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(clean);
      const resolvedLang =
        language === "yue"
          ? "zh-HK"
          : language === "zh"
            ? "zh-CN"
            : language === "en"
              ? "en-US"
              : language.includes("-")
                ? language
                : `${language}-${language.toUpperCase()}`;
      utter.lang = resolvedLang;
      utter.rate = Math.min(Math.max(rate, 0.5), 1.5);
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find((v) =>
        utter.lang === "zh-HK"
          ? /zh[-_]HK|yue|cantonese/i.test(v.lang + " " + v.name)
          : v.lang.toLowerCase().startsWith(utter.lang.toLowerCase().slice(0, 2))
      );
      if (preferred) utter.voice = preferred;
      window.speechSynthesis.speak(utter);
      // 某些精简 Android WebView 虽有 speechSynthesis 对象但 voices 为空，若非原生且有语音则直接成功
      if (!isNativeAndroid() || voices.length > 0) return true;
    } catch {
      // fall through to HTML5 audio fallback
    }
  }

  // 兜底：使用 HTML5 Audio 播放国内免翻墙语音接口
  try {
    const low = language.toLowerCase();
    const lan =
      low === "en" || low.startsWith("en-")
        ? "en"
        : low.startsWith("ja")
          ? "jp"
          : low.startsWith("ko")
            ? "kor"
            : low.startsWith("fr")
              ? "fra"
              : low.startsWith("es")
                ? "spa"
                : low.startsWith("de")
                  ? "de"
                  : "zh";
    const url = `https://fanyi.baidu.com/gettts?lan=${lan}&text=${encodeURIComponent(clean.slice(0, 150))}&spd=3&source=web`;
    if (!webFallbackAudio) webFallbackAudio = new Audio();
    webFallbackAudio.pause();
    webFallbackAudio.src = url;
    webFallbackAudio.playbackRate = Math.min(Math.max(rate, 0.5), 1.5);
    await webFallbackAudio.play();
    return true;
  } catch {
    return false;
  }
}

/** 可选构建期环境变量 VITE_ZHIPU_API_KEY（仅用于个人自编译场景；公开开源构建默认为空，大众用户可直接使用免 Key 公共免费通道、本地端侧 AI 或在设置页填写自己的 API Key） */
export const BUILTIN_ZHIPU_KEY: string = String((import.meta as any).env?.VITE_ZHIPU_API_KEY || "").trim();

export async function nativeHttpGet(url: string, referer = ""): Promise<string> {
  if (isNativeAndroid()) {
    const res = await EchoDeckNative.httpGet({ url, referer });
    return String(res?.text || "");
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

/** 切换 Android 原生横屏沉浸全屏（隐藏系统状态栏与虚拟键、保持屏幕常亮，同时 100% 保留前端学习浮层） */
export async function nativeSetFullscreenMode(enabled: boolean, landscape = true): Promise<void> {
  if (isNativeAndroid()) {
    try {
      await EchoDeckNative.setFullscreenMode({ enabled, landscape });
    } catch {
      // ignore
    }
    return;
  }
  // 桌面/移动浏览器：对根元素请求全屏，确保所有浮层与全局弹窗均处于 Top Layer 之上
  try {
    if (enabled && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    } else if (!enabled && document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  } catch {
    // 浏览器限制或用户手势不满足时自动退回 CSS 满屏铺满，不影响使用
  }
}

export async function nativeAiChat(options: {
  freeMode: boolean;
  url?: string;
  apiKey?: string;
  model?: string;
  messages: AiChatMessage[];
  temperature?: number;
  jsonMode?: boolean;
}): Promise<string> {
  if (isNativeAndroid()) {
    const res = await EchoDeckNative.aiChat(options);
    return String(res?.content || "").trim();
  }

  // 浏览器/PWA 环境直接请求
  if (options.freeMode || !options.apiKey?.trim()) {
    const routes = [
      { url: "https://ch.at/v1/chat/completions", model: "default", key: "" },
      { url: "https://text.pollinations.ai/openai/chat/completions", model: "openai", key: "no-key" },
    ];
    let lastErr: Error | null = null;
    for (const r of routes) {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (r.key) headers.Authorization = `Bearer ${r.key}`;
        const resp = await fetch(r.url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: r.model,
            messages: options.messages,
            temperature: options.temperature ?? 0.55,
          }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const content = String(data?.choices?.[0]?.message?.content || "").trim();
        if (content) return content;
      } catch (e: any) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("内置免费 AI 通道暂时繁忙，请稍后重试或在设置切自有 Key");
  }

  const reqBody: Record<string, any> = {
    model: options.model || "deepseek-chat",
    messages: options.messages,
    temperature: options.temperature ?? 0.55,
    max_tokens: 1800,
  };
  if (options.jsonMode) {
    reqBody.response_format = { type: "json_object" };
  }
  if (
    options.url?.includes("bigmodel.cn") &&
    options.model &&
    /(?:4\.5|4\.6|4\.7)/.test(options.model)
  ) {
    reqBody.thinking = { type: "disabled" };
  }
  const resp = await fetch(options.url!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey!.trim()}`,
    },
    body: JSON.stringify(reqBody),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`AI 请求失败 (${resp.status}): ${err.slice(0, 140)}`);
  }
  const data = await resp.json();
  return String(data?.choices?.[0]?.message?.content || "").trim();
}

/** 同步 Android 原生状态栏与导航栏明暗配色 */
export async function nativeSetSystemTheme(dark: boolean): Promise<void> {
  if (!isNativeAndroid()) return;
  try {
    await EchoDeckNative.setSystemTheme({ dark });
  } catch {
    // ignore
  }
}

/** 首页双击返回优雅退至后台 */
export async function nativeMinimizeApp(): Promise<void> {
  if (!isNativeAndroid()) return;
  try {
    await EchoDeckNative.minimizeApp();
  } catch {
    // ignore
  }
}

/** 轻量触感反馈（Android 震动马达极微震，提升点击质感；不支持设备自动静默） */
export function triggerHaptic(ms = 10): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(ms);
    }
  } catch {
    // ignore
  }
}

export async function consumeSharedIntent(): Promise<string> {
  if (!isNativeAndroid()) return "";
  try {
    const res = await EchoDeckNative.getSharedIntent();
    const text = (res?.url || res?.text || "").trim();
    if (text) {
      await EchoDeckNative.clearSharedIntent();
    }
    return text;
  } catch {
    return "";
  }
}
