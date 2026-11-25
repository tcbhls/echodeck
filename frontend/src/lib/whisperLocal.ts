/**
 * 手机端独立 AI 字幕生成引擎（完全不需要电脑！）：
 * 模式 1：纯手机本地离线 Whisper（@huggingface/transformers + ONNX WASM，支持 hf-mirror.com 国内直连下载并永久缓存，之后断网离线跑）
 * 模式 2：极速云端高精度 ASR（兼容 Groq 免费 whisper-large-v3-turbo / 硅基流动 SenseVoice / OpenAI Whisper API，5 秒出长视频/粤语高精度字幕）
 */

import type { SubtitleItem } from "../types";
import { annotateJyutpingOffline } from "./cantoneseLocal";
import { encodeMonoWav, extractPcm16k } from "./mediaEngine";

let cachedPipeKey = "";
let cachedPipeline: any = null;

export interface TranscribeOptions {
  mediaId: string;
  blob: Blob;
  language: string; // "auto" | "en" | "yue" | "zh"
  mode: "local" | "cloud";
  localModel?: string; // "Xenova/whisper-tiny" | "Xenova/whisper-tiny.en" | "Xenova/whisper-base"
  hfMirror?: boolean;
  cloudBaseUrl?: string;
  cloudApiKey?: string;
  cloudModel?: string;
  onProgress?: (pct: number, message: string) => void;
}

export async function transcribeInPhone(opts: TranscribeOptions): Promise<SubtitleItem[]> {
  if (opts.mode === "cloud") {
    return transcribeViaCloudAsr(opts);
  }
  return transcribeViaLocalWhisper(opts);
}

async function transcribeViaLocalWhisper(opts: TranscribeOptions): Promise<SubtitleItem[]> {
  const { mediaId, blob, language, localModel = "Xenova/whisper-tiny", hfMirror = true, onProgress } = opts;

  onProgress?.(5, "正在手机本地抽取 16kHz 音轨...");
  const pcm = await extractPcm16k(mediaId, blob);

  onProgress?.(15, `正在加载手机本地离线模型 (${localModel})... 首次需缓存约 40~75MB`);
  const transformers = await import("@huggingface/transformers");
  const env = transformers.env as any;
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  if (hfMirror) {
    env.remoteHost = "https://hf-mirror.com/";
  } else {
    env.remoteHost = "https://huggingface.co/";
  }

  const key = `${localModel}:${hfMirror}`;
  if (!cachedPipeline || cachedPipeKey !== key) {
    cachedPipeline = await transformers.pipeline("automatic-speech-recognition", localModel, {
      dtype: "q8",
      device: "wasm",
      progress_callback: (info: any) => {
        if (info?.status === "progress" && typeof info.progress === "number") {
          const pct = Math.min(55, 15 + info.progress * 0.4);
          onProgress?.(Math.round(pct), `首次下载离线模型 (${info.file || ""}): ${Math.round(info.progress)}%`);
        }
      },
    });
    cachedPipeKey = key;
  }

  onProgress?.(60, "模型已就绪，正在手机本地离线逐句转写...");
  const isEnglishOnly = localModel.endsWith(".en");
  const langMap: Record<string, string> = {
    en: "english",
    zh: "chinese",
    yue: "cantonese",
  };

  const runOpts: Record<string, any> = {
    return_timestamps: true,
    chunk_length_s: 28,
    stride_length_s: 4,
  };
  if (!isEnglishOnly) {
    runOpts.task = "transcribe";
    if (language && language !== "auto" && langMap[language]) {
      runOpts.language = langMap[language];
    }
  }

  const output = await cachedPipeline(pcm, runOpts);
  onProgress?.(94, "转写完成，正在整理时间轴与粤拼...");

  const chunks: Array<{ text: string; timestamp: [number, number | null] }> = Array.isArray(output?.chunks)
    ? output.chunks
    : [{ text: String(output?.text || ""), timestamp: [0, pcm.length / 16000] }];

  const totalSec = pcm.length / 16000;
  const subs: SubtitleItem[] = [];
  chunks.forEach((c, idx) => {
    const txt = (c.text || "").trim();
    if (!txt) return;
    const startSec = Number(c.timestamp?.[0] ?? 0);
    const endSec = Number(c.timestamp?.[1] ?? Math.min(totalSec, startSec + 3.5));
    const startMs = Math.max(0, Math.round(startSec * 1000));
    const endMs = Math.max(startMs + 400, Math.round(endSec * 1000));
    const jp = language === "yue" ? annotateJyutpingOffline(txt).jyutping : "";
    subs.push({
      id: `sub_${mediaId}_${idx}`,
      media_id: mediaId,
      idx,
      start_ms: startMs,
      end_ms: endMs,
      text: txt,
      translation: "",
      jyutping: jp,
    });
  });

  onProgress?.(100, `手机离线字幕生成完毕，共 ${subs.length} 句`);
  return subs;
}

async function transcribeViaCloudAsr(opts: TranscribeOptions): Promise<SubtitleItem[]> {
  const {
    mediaId,
    blob,
    language,
    cloudBaseUrl = "https://api.groq.com/openai/v1",
    cloudApiKey = "",
    cloudModel = "whisper-large-v3-turbo",
    onProgress,
  } = opts;

  if (!cloudApiKey.trim()) {
    throw new Error("请先在「设置」中填入云端 ASR Key（推荐 Groq 免费额度或硅基流动），或切回「手机纯本地离线模式」");
  }

  onProgress?.(15, "正在抽取轻量 16kHz 音轨准备极速识别...");
  const pcm = await extractPcm16k(mediaId, blob);
  // 若音频超过 8 分钟自动分段（每段 6 分钟约 11MB WAV，稳定控制在各大免费 API 25MB 限制内）
  const chunkSamples = 360 * 16000;
  const totalChunks = Math.max(1, Math.ceil(pcm.length / chunkSamples));
  const subs: SubtitleItem[] = [];

  for (let cIdx = 0; cIdx < totalChunks; cIdx++) {
    const startSample = cIdx * chunkSamples;
    const endSample = Math.min(pcm.length, startSample + chunkSamples);
    const slice = pcm.slice(startSample, endSample);
    const wavBlob = encodeMonoWav(slice, 16000);
    const offsetMs = Math.round((startSample / 16000) * 1000);

    onProgress?.(
      Math.round(25 + (cIdx / totalChunks) * 65),
      `正在调用高精度云端 ASR (${cIdx + 1}/${totalChunks})...`
    );

    const fd = new FormData();
    fd.append("file", wavBlob, `chunk_${cIdx}.wav`);
    fd.append("model", cloudModel || "whisper-large-v3-turbo");
    fd.append("response_format", "verbose_json");
    if (language && language !== "auto") {
      fd.append("language", language === "yue" ? "zh" : language);
    }
    if (language === "yue") {
      fd.append("prompt", "以下係香港粵語日常對話、電影電視劇對白、播客或者影片解說，請輸出地道粵語正字：");
    }

    const endpoint = cloudBaseUrl.replace(/\/$/, "") + "/audio/transcriptions";
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${cloudApiKey.trim()}` },
      body: fd,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`云端 ASR 请求失败 (${resp.status}): ${errText.slice(0, 160)}`);
    }
    const data = await resp.json();
    const segments = Array.isArray(data?.segments) ? data.segments : [];
    if (segments.length > 0) {
      for (const seg of segments) {
        const txt = String(seg.text || "").trim();
        if (!txt) continue;
        const sMs = offsetMs + Math.round(Number(seg.start || 0) * 1000);
        const eMs = Math.max(sMs + 400, offsetMs + Math.round(Number(seg.end || 0) * 1000));
        subs.push({
          id: `sub_${mediaId}_${subs.length}`,
          media_id: mediaId,
          idx: subs.length,
          start_ms: sMs,
          end_ms: eMs,
          text: txt,
          translation: "",
          jyutping: language === "yue" ? annotateJyutpingOffline(txt).jyutping : "",
        });
      }
    } else if (data?.text) {
      const txt = String(data.text).trim();
      subs.push({
        id: `sub_${mediaId}_${subs.length}`,
        media_id: mediaId,
        idx: subs.length,
        start_ms: offsetMs,
        end_ms: offsetMs + Math.round((slice.length / 16000) * 1000),
        text: txt,
        translation: "",
        jyutping: language === "yue" ? annotateJyutpingOffline(txt).jyutping : "",
      });
    }
  }

  onProgress?.(100, `极速高精度字幕生成完成，共 ${subs.length} 句`);
  return subs;
}
