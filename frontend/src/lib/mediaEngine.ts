/**
 * 纯手机端音视频媒体处理引擎（零电脑 / 零 FFmpeg 服务器依赖）：
 * 1. 解析本地视频/音频时长并自动用 Canvas 截取缩略图封面
 * 2. 毫秒级精准截取视频当前帧为 JPEG Blob（替代 asbplayer 截图）
 * 3. 使用 Web Audio API 精准切出单句原声 WAV Blob（替代 FFmpeg 原声切片）
 * 4. 提取 16kHz 单声道 Float32Array 供手机端离线 Whisper 模型识别
 */

export async function probeMediaBlob(blob: Blob): Promise<{
  duration: number;
  hasVideo: boolean;
  posterBlob: Blob | null;
}> {
  const url = URL.createObjectURL(blob);
  const isAudioHint = blob.type.startsWith("audio/");

  return new Promise((resolve) => {
    const el = document.createElement(isAudioHint ? "audio" : "video");
    el.preload = "metadata";
    el.muted = true;
    (el as HTMLVideoElement).playsInline = true;
    el.src = url;

    let settled = false;
    const finish = (duration: number, hasVideo: boolean, posterBlob: Blob | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve({ duration: Number.isFinite(duration) ? Math.round(duration * 10) / 10 : 0, hasVideo, posterBlob });
    };

    const timer = window.setTimeout(() => finish(0, !isAudioHint, null), 7000);

    el.onerror = () => {
      window.clearTimeout(timer);
      finish(0, false, null);
    };

    el.onloadedmetadata = () => {
      const dur = el.duration || 0;
      const vid = el as HTMLVideoElement;
      const hasVideo = !isAudioHint && vid.videoWidth > 0 && vid.videoHeight > 0;
      if (!hasVideo) {
        window.clearTimeout(timer);
        finish(dur, false, null);
        return;
      }

      const seekTarget = dur > 2 ? Math.min(dur * 0.18, 8) : 0.2;
      vid.currentTime = seekTarget;
      vid.onseeked = () => {
        window.clearTimeout(timer);
        captureVideoFrameBlob(vid, 720)
          .then((poster) => finish(dur, true, poster))
          .catch(() => finish(dur, true, null));
      };
    };
  });
}

export async function captureVideoFrameBlob(
  video: HTMLVideoElement,
  maxWidth = 854
): Promise<Blob | null> {
  if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return null;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const w = Math.max(1, Math.round(video.videoWidth * scale));
  const h = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82);
  });
}

/** 专用于 AI 自动校准外挂字幕：只裁剪原视频画面最底部 34% 字幕区（自动排除顶部赌博飘字干扰、体积减半、识图速度提升 2 倍） */
export async function captureBottomSubtitleStripBlob(
  video: HTMLVideoElement,
  maxWidth = 800,
  bottomRatio = 0.34
): Promise<Blob | null> {
  if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return null;
  const srcY = Math.max(0, Math.round(video.videoHeight * (1 - bottomRatio)));
  const srcH = Math.max(1, video.videoHeight - srcY);
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const dstW = Math.max(1, Math.round(video.videoWidth * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, srcY, video.videoWidth, srcH, 0, 0, dstW, dstH);
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85);
  });
}

/** 将单声道 Float32Array 样本编码为极小体积标准 16kHz 16-bit WAV Blob */
export function encodeMonoWav(samples: Float32Array, sampleRate = 16000): Blob {
  const numSamples = samples.length;
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
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
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

function downsampleTo16k(buffer: AudioBuffer): Float32Array {
  const targetRate = 16000;
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  // 混音为单声道
  const mono = new Float32Array(length);
  for (let ch = 0; ch < numChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      mono[i] += data[i] / numChannels;
    }
  }

  if (buffer.sampleRate === targetRate) return mono;
  const ratio = buffer.sampleRate / targetRate;
  const outLen = Math.max(1, Math.floor(length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = Math.floor(i * ratio);
    out[i] = mono[Math.min(idx, length - 1)];
  }
  return out;
}

// 缓存最近一次解码后的 16kHz PCM，连续挖多张卡时毫秒级秒切无需重复解码
let cachedPcmMediaId = "";
let cachedPcmSamples: Float32Array | null = null;

export async function extractPcm16k(mediaId: string, blob: Blob): Promise<Float32Array> {
  if (cachedPcmMediaId === mediaId && cachedPcmSamples) {
    return cachedPcmSamples;
  }
  // 防止超大视频在低内存手机直接解码爆内存（上限 120MB）
  if (blob.size > 120 * 1024 * 1024) {
    throw new Error("媒体文件超过 120MB，建议使用音频文件或更短切片以节省手机内存");
  }
  const arrayBuf = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData(arrayBuf);
    const pcm = downsampleTo16k(decoded);
    cachedPcmMediaId = mediaId;
    cachedPcmSamples = pcm;
    return pcm;
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

export async function sliceAudioClipBlob(
  mediaId: string,
  blob: Blob,
  startMs: number,
  endMs: number,
  paddingMs = 180
): Promise<Blob | null> {
  try {
    const pcm = await extractPcm16k(mediaId, blob);
    const sIdx = Math.max(0, Math.floor(((startMs - paddingMs) / 1000) * 16000));
    const eIdx = Math.min(pcm.length, Math.ceil(((endMs + paddingMs) / 1000) * 16000));
    if (eIdx <= sIdx + 800) return null;
    const segment = pcm.slice(sIdx, eIdx);
    return encodeMonoWav(segment, 16000);
  } catch {
    return null;
  }
}
