import { useEffect, useState } from "react";
import { Film } from "lucide-react";

interface PosterImageProps {
  src?: string;
  alt: string;
  className?: string;
  compact?: boolean;
}

const PALETTES = [
  "from-orange-500/80 via-amber-500/70 to-rose-500/80",
  "from-sky-500/80 via-indigo-500/70 to-violet-500/80",
  "from-emerald-500/80 via-teal-500/70 to-cyan-500/80",
  "from-fuchsia-500/80 via-purple-500/70 to-indigo-500/80",
  "from-slate-600/85 via-zinc-700/80 to-stone-800/85",
];

function pickPalette(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

/**
 * 零破图海报组件：
 * - 默认启用 referrerPolicy="no-referrer"（直接绕过 80% 国内资源站防盗链！）+ loading="lazy"
 * - 任一图片超时或跨域失败时优雅切换为高质感渐变电影封面，绝不出现丑陋裂图图标
 */
export function PosterImage({ src, alt, className = "", compact = false }: PosterImageProps) {
  const [failed, setFailed] = useState(!src);

  useEffect(() => {
    setFailed(!src);
  }, [src]);

  if (!src || failed) {
    const grad = pickPalette(alt || "EchoDeck");
    const label = (alt || "影听").replace(/[《》「」]/g, "").trim().slice(0, compact ? 2 : 6);
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br ${grad} text-white select-none ${className}`}
      >
        <Film className={compact ? "h-3.5 w-3.5 opacity-85" : "h-5 w-5 opacity-85"} />
        {!compact && label && (
          <span className="mt-1 max-w-[85%] truncate px-1 text-center text-[10px] font-bold tracking-tight opacity-95">
            {label}
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
