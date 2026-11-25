/**
 * EchoDeck v7.5 FongMi/TV 同款智能 M3U8 切片去广告引擎：
 * 针对国内 MacCMS / 创享 / 量子 / 非凡 / 红牛 / 如意等直连片源中插播的赌博/澳门切片广告，
 * 在 hls.js 拉取 .m3u8 播放列表时实时拦截并做 4 层外科手术级精准切除（绝不误伤正常剧集）：
 * 1) 显式广告标记与 FongMi rules 正则规则切除（如 # ppvod-ad-injected、cdn.ryplay 规则、/ad/、1o*.ts）
 * 2) 异构目录前缀 / 异域名切片检测（如量子主片为相对路径 *.ts，插播广告为 /2026xxxx/.../751808xxx.ts）
 * 3) 孤立中插短广告段检测（如非凡在两个长正片区块之间夹入 3~45 秒的 #EXT-X-DISCONTINUITY 广告块）
 * 4) 自动剔除孤立残留的 #EXT-X-DISCONTINUITY 标记，保证无缝跳切不卡顿黑屏
 */
import Hls, { type LoaderCallbacks, type LoaderConfiguration, type LoaderContext } from "hls.js";

export interface M3u8CleanStats {
  removedSegments: number;
  removedBlocks: number;
  removedSeconds: number;
}

interface SegmentBlock {
  hasExplicitAdTag: boolean;
  lines: string[];
  segCount: number;
  durationSec: number;
  pathSignatures: string[];
}

/** 内置 FongMi/TVBox 同款已知切片广告正则（含 fongmi-direct.json rules） */
const FONGMI_AD_REGEXES: RegExp[] = [
  /#\s*ppvod-ad-injected[\s\S]*?#EXT-X-DISCONTINUITY[\s\S]*?#EXT-X-DISCONTINUITY/gi,
  /#EXT-X-DISCONTINUITY\r?\n#EXTINF:5\.480000,[\s\S]*?#EXT-X-DISCONTINUITY/gi,
  /#EXT-X-DISCONTINUITY\s*\r?\n#EXTINF:5\.320000,\s*\r?\n.+\.ts\s*\r?\n(?:#EXTINF:[\d.]+,\s*\r?\n.+\.ts\s*\r?\n)*?#EXTINF:3\.360000,\s*\r?\n.+\.ts\s*\r?\n#EXT-X-DISCONTINUITY/gi,
  /#EXT-X-DISCONTINUITY\s*\r?\n#EXTINF:4\.000000,\s*\r?\n.+\.ts\s*\r?\n(?:#EXTINF:[\d.]+,\s*\r?\n.+\.ts\s*\r?\n)*?#EXTINF:0\.560000,\s*\r?\n.+\.ts\s*\r?\n#EXT-X-DISCONTINUITY/gi,
];

const AD_SEGMENT_URL_PATTERNS: RegExp[] = [
  /(?:^|[/_-])(?:ad|ads|advert|guanggao|gg|promo|sponsor)[/_-]/i,
  /\/adjump\//i,
  /1o[a-z0-9_-]*\.ts(?:\?|$)/i,
];

function getPathSignature(segUrl: string): string {
  const clean = segUrl.trim().split("?")[0];
  try {
    if (/^https?:\/\//i.test(clean)) {
      const u = new URL(clean);
      const dir = u.pathname.slice(0, u.pathname.lastIndexOf("/") + 1);
      return `${u.host}${dir}`;
    }
  } catch {
    // fallback below
  }
  const slash = clean.lastIndexOf("/");
  if (slash >= 0) {
    return `path:${clean.slice(0, slash + 1)}`;
  }
  return "rel:root";
}

function parseExtinfDuration(line: string): number {
  const m = line.match(/#EXTINF:\s*([\d.]+)/i);
  return m ? parseFloat(m[1]) || 0 : 0;
}

/** 净化单份 Media Playlist (.m3u8)，返回去广告后的清单文本与切除统计 */
export function cleanM3u8Manifest(rawText: string, playlistUrl = ""): {
  cleaned: string;
  stats: M3u8CleanStats;
} {
  // Master playlist（只含清晰度子清单）直接放行不改写
  if (!rawText || !rawText.includes("#EXTINF") || rawText.includes("#EXT-X-STREAM-INF")) {
    return { cleaned: rawText, stats: { removedSegments: 0, removedBlocks: 0, removedSeconds: 0 } };
  }

  let working = rawText;
  let removedSegments = 0;
  let removedBlocks = 0;
  let removedSeconds = 0;

  // 第一层：直接切除 FongMi rules 显式正则广告段（保留单个 #EXT-X-DISCONTINUITY 防止拖动进度条后 PTS 时间戳错位）
  for (const rx of FONGMI_AD_REGEXES) {
    working = working.replace(rx, (match) => {
      const durMatches = match.match(/#EXTINF:\s*([\d.]+)/gi) || [];
      if (durMatches.length > 0 && durMatches.length <= 30) {
        removedBlocks += 1;
        removedSegments += durMatches.length;
        for (const dm of durMatches) removedSeconds += parseExtinfDuration(dm);
        return "\n#EXT-X-DISCONTINUITY\n";
      }
      return match;
    });
  }

  const lines = working.split(/\r?\n/);
  const headerLines: string[] = [];
  const footerLines: string[] = [];
  const blocks: SegmentBlock[] = [];

  let inBody = false;
  let pendingAdTag = false;
  let curBlock: SegmentBlock = {
    hasExplicitAdTag: false,
    lines: [],
    segCount: 0,
    durationSec: 0,
    pathSignatures: [],
  };

  const flushBlock = () => {
    if (curBlock.lines.length > 0) {
      blocks.push(curBlock);
      curBlock = {
        hasExplicitAdTag: false,
        lines: [],
        segCount: 0,
        durationSec: 0,
        pathSignatures: [],
      };
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXT-X-ENDLIST")) {
      flushBlock();
      footerLines.push(line);
      continue;
    }

    if (!inBody) {
      if (
        line.startsWith("#EXTINF") ||
        line.startsWith("#EXT-X-DISCONTINUITY") ||
        /ppvod-ad|ad-inject/i.test(line)
      ) {
        inBody = true;
      } else {
        headerLines.push(line);
        continue;
      }
    }

    if (/ppvod-ad|ad-inject/i.test(line)) {
      pendingAdTag = true;
      continue;
    }

    if (line === "#EXT-X-DISCONTINUITY") {
      flushBlock();
      if (pendingAdTag) {
        curBlock.hasExplicitAdTag = true;
        pendingAdTag = false;
      }
      continue;
    }

    if (line.startsWith("#EXTINF")) {
      const dur = parseExtinfDuration(line);
      // 向后找紧邻的切片 URL
      let segLine = "";
      let j = i + 1;
      const midTags: string[] = [];
      while (j < lines.length) {
        const nextTrim = lines[j].trim();
        if (!nextTrim) {
          j++;
          continue;
        }
        if (nextTrim.startsWith("#")) {
          midTags.push(nextTrim);
          j++;
          continue;
        }
        segLine = nextTrim;
        break;
      }

      if (segLine) {
        // 单片显式广告 URL 过滤
        if (AD_SEGMENT_URL_PATTERNS.some((p) => p.test(segLine))) {
          removedSegments += 1;
          removedSeconds += dur;
          i = j;
          continue;
        }
        curBlock.lines.push(line, ...midTags, segLine);
        curBlock.segCount += 1;
        curBlock.durationSec += dur;
        curBlock.pathSignatures.push(getPathSignature(segLine));
        i = j;
        continue;
      }
    }

    curBlock.lines.push(line);
  }
  flushBlock();

  // 统计整部视频的主导路径签名（占比 >= 65% 即视为正片主路径）
  const sigCount = new Map<string, number>();
  let totalSegs = 0;
  for (const b of blocks) {
    for (const sig of b.pathSignatures) {
      sigCount.set(sig, (sigCount.get(sig) || 0) + 1);
      totalSegs += 1;
    }
  }
  let dominantSig = "";
  let dominantCount = 0;
  sigCount.forEach((cnt, sig) => {
    if (cnt > dominantCount) {
      dominantCount = cnt;
      dominantSig = sig;
    }
  });
  const hasStrongDominant = totalSegs >= 15 && dominantCount / totalSegs >= 0.65;

  const nonEmptyBlocks = blocks.filter((b) => b.segCount > 0);
  const discCount = Math.max(0, nonEmptyBlocks.length - 1);

  // 逐块判定并切除广告块
  const keptBlocks: SegmentBlock[] = [];
  for (let idx = 0; idx < blocks.length; idx++) {
    const b = blocks[idx];
    if (b.segCount === 0) {
      // 保留含密钥定义 #EXT-X-KEY 的元信息行
      if (b.lines.some((l) => l.startsWith("#EXT-X-KEY") || l.startsWith("#EXT-X-MAP"))) {
        keptBlocks.push(b);
      }
      continue;
    }

    let isAdBlock = false;

    // 规则 A：带显式广告注释标记且时长 <= 90 秒
    if (b.hasExplicitAdTag && b.durationSec <= 90) {
      isAdBlock = true;
    }

    // 规则 B：异构路径/域名插播广告（如量子主片 rel:root，广告为 /20261003/...，且时长 <= 65 秒）
    if (!isAdBlock && hasStrongDominant && b.durationSec <= 65 && b.segCount <= 22) {
      const sameAsDominant = b.pathSignatures.filter((s) => s === dominantSig).length;
      if (sameAsDominant === 0) {
        isAdBlock = true;
      }
    }

    // 规则 C：孤立中插短广告块（如非凡在 2 个正片长区块之间插播 3~45 秒短广告；跳过闪电/WS 等 80+ 频繁跳变源）
    if (!isAdBlock && discCount >= 1 && discCount <= 12 && b.durationSec >= 3 && b.durationSec <= 45 && b.segCount <= 16) {
      const prevDur = idx > 0 ? blocks[idx - 1].durationSec : 0;
      const nextDur = idx < blocks.length - 1 ? blocks[idx + 1].durationSec : 0;
      // 夹在两个较长正片段中间，或片头极短贴片（< 22s 且后续正片 > 120s）
      if ((prevDur >= 50 && nextDur >= 50) || (idx === 0 && b.durationSec <= 22 && nextDur >= 120)) {
        isAdBlock = true;
      }
    }

    if (isAdBlock) {
      removedBlocks += 1;
      removedSegments += b.segCount;
      removedSeconds += b.durationSec;
      continue;
    }
    keptBlocks.push(b);
  }

  // 如果全部被误切（安全兜底）则回退原清单
  if (keptBlocks.filter((b) => b.segCount > 0).length === 0) {
    return { cleaned: rawText, stats: { removedSegments: 0, removedBlocks: 0, removedSeconds: 0 } };
  }

  const outLines: string[] = [...headerLines];
  let emittedMediaBlock = false;
  keptBlocks.forEach((b) => {
    if (b.segCount > 0) {
      // 只要跨过了被切除的广告段或原本存在的分段边界，必须保留一个 #EXT-X-DISCONTINUITY，
      // 这样 hls.js 在用户拖动进度条跨过广告切口时才能正确重锚 MPEG-TS PTS，不发生音画/字幕偏移！
      if (emittedMediaBlock) {
        outLines.push("#EXT-X-DISCONTINUITY");
      }
      emittedMediaBlock = true;
    }
    outLines.push(...b.lines);
  });
  outLines.push(...footerLines);

  if (playlistUrl && removedBlocks > 0) {
    // stats already recorded
  }

  return {
    cleaned: outLines.join("\n") + "\n",
    stats: {
      removedSegments,
      removedBlocks,
      removedSeconds: Math.round(removedSeconds),
    },
  };
}

/** 创建带 FongMi 同款智能去广告能力的 hls.js 自定义 Playlist Loader */
export function createAdCleanHlsLoader(
  enabled: boolean,
  onCleaned?: (stats: M3u8CleanStats) => void
) {
  const BaseLoader = (Hls as any).DefaultConfig.loader;

  return class AdCleanPlaylistLoader extends BaseLoader {
    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>
    ) {
      const origOnSuccess = callbacks.onSuccess;
      const wrappedCallbacks: LoaderCallbacks<LoaderContext> = {
        ...callbacks,
        onSuccess: (response, stats, ctx, networkDetails) => {
          if (enabled && typeof response?.data === "string" && response.data.includes("#EXTINF")) {
            const res = cleanM3u8Manifest(response.data, ctx.url);
            if (res.stats.removedSegments > 0) {
              response.data = res.cleaned;
              onCleaned?.(res.stats);
            }
          }
          origOnSuccess(response, stats, ctx, networkDetails);
        },
      };
      super.load(context, config, wrappedCallbacks);
    }
  };
}
