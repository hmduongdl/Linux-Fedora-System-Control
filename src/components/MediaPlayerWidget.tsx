import { memo, useEffect, useState } from "react";
import { SkipBack, SkipForward, Play, Pause, Music2 } from "lucide-react";
import { useSystemStore } from "../store/useSystemStore";

function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function MediaSkeleton() {
  return (
    <div
      className="glass-panel flex flex-col justify-between"
      style={{
        padding: "clamp(10px, 1.2vh, 16px)",
        gap: "clamp(8px, 1vh, 12px)",
      }}
    >
      <div className="flex items-center gap-2">
        <Music2 size={14} className="text-primary" />
        <h3 className="header-small-caps text-[10px] md:text-[11px] text-primary">ĐANG PHÁT</h3>
      </div>
      <div className="flex gap-[clamp(10px,1.2vw,16px)]">
        <div className="skeleton h-[clamp(48px,6vh,64px)] w-[clamp(48px,6vh,64px)] shrink-0 rounded overflow-hidden" />
        <div className="flex-1 space-y-2 min-w-0">
          <div className="skeleton h-3 w-3/4" />
          <div className="skeleton h-2 w-1/2" />
          <div className="skeleton mt-3 h-1 w-full" />
        </div>
      </div>
      <div className="flex justify-center gap-[clamp(16px,2vh,24px)] pt-0.5">
        <div className="skeleton h-7 w-7 rounded-full" />
        <div className="skeleton h-8 w-8 rounded-full" />
        <div className="skeleton h-7 w-7 rounded-full" />
      </div>
    </div>
  );
}

const MediaPlayerWidget = memo(function MediaPlayerWidget() {
  const media         = useSystemStore((s) => s.media);
  const isTelemetryConnected = useSystemStore((s) => s.isTelemetryConnected);
  const mediaPlayPause = useSystemStore((s) => s.mediaPlayPause);
  const mediaNext     = useSystemStore((s) => s.mediaNext);
  const mediaPrevious = useSystemStore((s) => s.mediaPrevious);
  const seekMedia     = useSystemStore((s) => s.seekMedia);
  const [position, setPosition] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging) {
      setPosition(media?.position_seconds ?? 0);
    }
  }, [media?.position_seconds, media?.title, isDragging]);

  useEffect(() => {
    if (!media || media.playback_status !== "Playing" || media.length_seconds <= 0 || isDragging) return;
    const timer = window.setInterval(
      () => setPosition((cur) => Math.min(cur + 1, media.length_seconds)),
      1000
    );
    return () => window.clearInterval(timer);
  }, [media?.playback_status, media?.length_seconds, isDragging]);

  if (!media) {
    if (!isTelemetryConnected) {
      return <MediaSkeleton />;
    }
    return (
      <div
        className="glass-panel flex flex-col justify-between"
        style={{
          padding: "clamp(10px, 1.2vh, 16px)",
          gap: "clamp(8px, 1vh, 12px)",
        }}
      >
        <div className="flex items-center gap-2">
          <Music2 size={14} className="text-slate-500" />
          <h3 className="header-small-caps text-[10px] md:text-[11px] text-slate-500 font-bold">ĐANG PHÁT</h3>
        </div>
        <div className="flex flex-col items-center justify-center py-2 text-center">
          <Music2 size={20} className="text-slate-600 mb-1" />
          <p className="text-[10px] text-slate-400 font-medium">Không có trình phát hoạt động</p>
          <p className="text-[9px] text-slate-500 leading-normal mt-0.5">
            Bật nhạc từ Spotify, trình duyệt, v.v.
          </p>
        </div>
        <div className="flex justify-center items-center gap-[clamp(16px,2vh,24px)] pt-0.5 opacity-25 pointer-events-none">
          <button className="text-on-surface-variant">
            <SkipBack size={18} />
          </button>
          <button className="flex h-[clamp(28px,3.8vh,34px)] w-[clamp(28px,3.8vh,34px)] items-center justify-center rounded-full border border-white/10 bg-white/5">
            <Play size={16} />
          </button>
          <button className="text-on-surface-variant">
            <SkipForward size={18} />
          </button>
        </div>
      </div>
    );
  }

  const isPlaying = media.playback_status === "Playing";
  const canSeek   = media.length_seconds > 0;
  const safePos   = Math.min(position, media.length_seconds || position);

  return (
    <div
      className="glass-panel flex flex-col justify-between"
      style={{
        padding: "clamp(10px, 1.2vh, 16px)",
        gap: "clamp(8px, 1vh, 12px)",
      }}
    >
      <div className="flex items-center gap-2">
        <Music2 size={14} className="text-primary" />
        <h3 className="header-small-caps text-[10px] md:text-[11px] text-primary">ĐANG PHÁT</h3>
      </div>

      {/* Album art + track info */}
      <div className="flex gap-[clamp(10px,1.2vw,16px)]">
        <div className="h-[clamp(48px,6vh,64px)] w-[clamp(48px,6vh,64px)] shrink-0 overflow-hidden rounded border border-white/5 shadow-lg">
          {media.art_url ? (
            <img src={media.art_url} alt={media.title || "Album art"} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[#1A1B2C] text-xl text-slate-600">
              ♫
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 flex flex-col justify-between">
          <div>
            <p className="truncate text-[12px] md:text-[13px] font-bold leading-tight">{media.title || "Unknown Title"}</p>
            <p className="truncate text-[10px] text-on-surface-variant leading-normal mt-0.5">
              {media.artist || "Unknown Artist"}
            </p>
          </div>

          {/* Progress bar */}
          <div className="mt-[clamp(4px,0.6vh,8px)]">
            <input
              type="range"
              min={0}
              max={media.length_seconds || 1}
              step={1}
              value={safePos}
              disabled={!canSeek}
              onPointerDown={() => setIsDragging(true)}
              onChange={(e) => setPosition(Number(e.currentTarget.value))}
              onPointerUp={(e) => {
                setIsDragging(false);
                void seekMedia(Number(e.currentTarget.value));
              }}
              className="media-progress w-full disabled:cursor-default"
              aria-label="Song progress"
            />
            <div className="flex justify-between font-mono text-[9px] text-on-surface-variant mt-0.5">
              <span>{formatTime(safePos)}</span>
              <span>{canSeek ? formatTime(media.length_seconds) : "LIVE"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex justify-center items-center gap-[clamp(16px,2vh,24px)] pt-0.5">
        <button
          onClick={() => {
            if (position > 10) {
              void seekMedia(0);
            } else {
              void mediaPrevious();
            }
          }}
          className="text-on-surface-variant transition hover:text-on-surface"
        >
          <SkipBack size={18} />
        </button>
        <button
          onClick={mediaPlayPause}
          className="flex h-[clamp(28px,3.8vh,34px)] w-[clamp(28px,3.8vh,34px)] items-center justify-center rounded-full border border-white/10 bg-white/5 transition hover:bg-primary/20"
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          onClick={mediaNext}
          className="text-on-surface-variant transition hover:text-on-surface"
        >
          <SkipForward size={18} />
        </button>
      </div>
    </div>
  );
});

export default MediaPlayerWidget;
