import { useEffect, useRef, useState } from "react";
import { Mic, Play, Repeat, Square } from "lucide-react";

interface ShadowRecorderProps {
  onPlayOriginal?: () => Promise<void> | void;
  compact?: boolean;
}

export function ShadowRecorder({ onPlayOriginal, compact = false }: ShadowRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState<string>("");
  const [playingMine, setPlayingMine] = useState(false);
  const [error, setError] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, [recordedUrl]);

  const startRecording = async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("需在手机 App 或 HTTPS 下开启麦克风");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (recordedUrl) URL.revokeObjectURL(recordedUrl);
        setRecordedUrl(URL.createObjectURL(blob));
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      setError("请在系统弹窗中允许麦克风权限");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  };

  const playMine = () => {
    if (!recordedUrl) return;
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.onended = () => setPlayingMine(false);
    }
    audioRef.current.src = recordedUrl;
    setPlayingMine(true);
    audioRef.current.play().catch(() => setPlayingMine(false));
  };

  const playCompare = async () => {
    if (onPlayOriginal) await onPlayOriginal();
    if (recordedUrl) setTimeout(() => playMine(), 250);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition active:scale-95 ${
            recording
              ? "bg-rose-500 text-white shadow-sm"
              : "bg-[var(--bg-subtle)] text-[var(--text-primary)] hover:opacity-85"
          }`}
        >
          {recording ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-3.5 w-3.5 text-[var(--accent-text)]" />}
          {recording ? "停止录音" : compact ? "录音跟读" : "录下我的跟读"}
        </button>

        {recordedUrl && !recording && (
          <>
            <button
              type="button"
              onClick={playMine}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition ${
                playingMine
                  ? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
                  : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
              }`}
            >
              <Play className="h-3.5 w-3.5" />
              听我的
            </button>
            {onPlayOriginal && (
              <button
                type="button"
                onClick={playCompare}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-subtle)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent-text)]"
              >
                <Repeat className="h-3.5 w-3.5" />
                对比原声
              </button>
            )}
          </>
        )}
      </div>
      {error && <p className="text-[11px] text-rose-500">{error}</p>}
    </div>
  );
}
