/**
 * 100% 纯前端字幕解析与导出：支持 SRT、WebVTT、LRC、B站 JSON 字幕。
 */

import type { SubtitleItem } from "../types";

const TIME_RE =
  /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;

function toMs(h: string | undefined, m: string, s: string, ms: string): number {
  const hours = h ? Number(h) : 0;
  const millis = Number(ms.padEnd(3, "0").slice(0, 3));
  return ((hours * 3600 + Number(m) * 60 + Number(s)) * 1000) + millis;
}

function cleanLine(str: string): string {
  return str
    .replace(/<[^>]+>/g, "")
    .replace(/\{\\[^}]+\}/g, "")
    .trim();
}

export function parseSubtitleText(
  raw: string,
  mediaId: string,
  filename = "sub.srt"
): SubtitleItem[] {
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (!text) return [];

  // 支持 B站官方 JSON 字幕格式
  if (filename.toLowerCase().endsWith(".json") || text.startsWith("{")) {
    try {
      const data = JSON.parse(text);
      const body = Array.isArray(data?.body) ? data.body : Array.isArray(data) ? data : [];
      return body
        .map((entry: any, idx: number) => {
          const content = String(entry.content || entry.text || "").trim();
          if (!content) return null;
          const startMs = Math.round(Number(entry.from ?? entry.start ?? 0) * 1000);
          const endMs = Math.max(startMs + 400, Math.round(Number(entry.to ?? entry.end ?? 0) * 1000));
          return {
            id: `sub_${mediaId}_${idx}`,
            media_id: mediaId,
            idx,
            start_ms: startMs,
            end_ms: endMs,
            text: content,
            translation: String(entry.translation || ""),
            jyutping: "",
          };
        })
        .filter(Boolean) as SubtitleItem[];
    } catch {
      // fall through
    }
  }

  // 解析标准 SRT / VTT
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n{2,}/);
  const items: SubtitleItem[] = [];
  let idx = 0;

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    let timeIdx = -1;
    let m: RegExpExecArray | null = null;
    for (let i = 0; i < lines.length; i++) {
      const hit = TIME_RE.exec(lines[i]);
      if (hit) {
        timeIdx = i;
        m = hit;
        break;
      }
    }
    if (!m || timeIdx < 0) continue;

    const startMs = toMs(m[1], m[2], m[3], m[4]);
    const endMs = Math.max(startMs + 350, toMs(m[5], m[6], m[7], m[8]));
    const bodyLines = lines.slice(timeIdx + 1).map(cleanLine).filter(Boolean);
    if (bodyLines.length === 0) continue;

    let mainText = bodyLines.join(" ");
    let translation = "";
    if (bodyLines.length >= 2) {
      const first = bodyLines[0];
      const second = bodyLines.slice(1).join(" ");
      if (/[A-Za-z]{2,}/.test(first) && /[\u4e00-\u9fff]/.test(second)) {
        mainText = first;
        translation = second;
      }
    }

    items.push({
      id: `sub_${mediaId}_${idx}`,
      media_id: mediaId,
      idx,
      start_ms: startMs,
      end_ms: endMs,
      text: mainText,
      translation,
      jyutping: "",
    });
    idx += 1;
  }

  return items;
}

export function formatSrtTime(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const h = Math.floor(safe / 3_600_000);
  const m = Math.floor((safe % 3_600_000) / 60_000);
  const s = Math.floor((safe % 60_000) / 1000);
  const mm = safe % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(mm).padStart(3, "0")}`;
}

export function exportSubtitlesToSrt(subs: SubtitleItem[]): string {
  return subs
    .map((s, i) => {
      const body = s.translation ? `${s.text}\n${s.translation}` : s.text;
      return `${i + 1}\n${formatSrtTime(s.start_ms)} --> ${formatSrtTime(s.end_ms)}\n${body}\n`;
    })
    .join("\n");
}
