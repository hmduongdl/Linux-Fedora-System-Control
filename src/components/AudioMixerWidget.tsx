import { memo, useEffect, useState, type CSSProperties } from "react";
import { Check, ChevronDown, Headphones, Volume1, Volume2, VolumeX } from "lucide-react";
import { useSystemStore } from "../store/useSystemStore";
import { useDebounce } from "../hooks/useDebounce";
import { StatusPill } from "./widgets/factory";

export const AudioMixerWidget = memo(function AudioMixerWidget() {
  const audio = useSystemStore((state) => state.audio);
  const setVolume = useSystemStore((state) => state.setVolume);
  const toggleMute = useSystemStore((state) => state.toggleMute);
  const setAudioOutput = useSystemStore((state) => state.setAudioOutput);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isDraggingVolume, setIsDraggingVolume] = useState(false);
  const debouncedSetVolume = useDebounce(setVolume, 50);
  const sink = audio?.default_sink;
  const [localVolume, setLocalVolume] = useState(sink?.volume_percent ?? 0);

  useEffect(() => {
    if (!isDraggingVolume) setLocalVolume(sink?.volume_percent ?? 0);
  }, [sink?.id, sink?.volume_percent]);

  return (
    <div className="glass-panel flex min-h-0 flex-col gap-3 p-[clamp(10px,1.2vh,16px)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Headphones size={14} className="text-cyan-accent" />
          <h3 className="header-small-caps text-[10px] text-cyan-accent md:text-[11px]">
            AUDIO / MIXER
          </h3>
        </div>
        {sink ? (
          <StatusPill tone={sink.is_muted ? "amber" : "green"}>
            {sink.is_muted ? "Muted" : "Output live"}
          </StatusPill>
        ) : (
          <div className="skeleton h-5 w-16 rounded-full" />
        )}
      </div>

      {sink ? (
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-3">
          <label className="group relative block">
            <span className="mb-1 block text-[8px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Output device
            </span>
            <div className="relative flex items-center rounded-lg border border-white/[0.07] bg-black/20 transition-colors group-focus-within:border-cyan-accent/40 group-focus-within:bg-cyan-accent/[0.04]">
              <div className="ml-2.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-cyan-accent/10 text-cyan-accent">
                <Headphones size={13} />
              </div>
              <select
                value={sink.id}
                disabled={isSelecting}
                onChange={async (event) => {
                  setIsSelecting(true);
                  try {
                    await setAudioOutput(Number(event.target.value));
                  } finally {
                    setIsSelecting(false);
                  }
                }}
                className="h-10 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent px-2.5 pr-8 text-[10px] font-semibold text-slate-200 outline-none disabled:cursor-wait disabled:opacity-60"
                aria-label="Chọn thiết bị phát âm thanh"
              >
                {audio.outputs.map((device) => (
                  <option key={device.id} value={device.id} className="bg-[#151621] text-slate-100">
                    {device.description || device.name}
                  </option>
                ))}
              </select>
              {isSelecting ? (
                <span className="absolute right-3 h-3 w-3 animate-spin rounded-full border border-cyan-accent/30 border-t-cyan-accent" />
              ) : (
                <ChevronDown size={13} className="pointer-events-none absolute right-3 text-slate-500" />
              )}
            </div>
          </label>

          <div className="rounded-lg border border-white/[0.06] bg-black/15 px-3 py-2.5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void toggleMute(sink.id)}
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                  sink.is_muted
                    ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                    : "border-cyan-accent/20 bg-cyan-accent/10 text-cyan-accent hover:bg-cyan-accent/15"
                }`}
                aria-label={sink.is_muted ? "Bật âm thanh" : "Tắt âm thanh"}
              >
                {sink.is_muted ? <VolumeX size={15} /> : sink.volume_percent < 50 ? <Volume1 size={15} /> : <Volume2 size={15} />}
              </button>

              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[9px] font-medium text-slate-400">Volume</span>
                  <span className="font-mono text-[10px] font-semibold text-slate-200">
                    {Math.round(localVolume)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={localVolume}
                  onPointerDown={() => setIsDraggingVolume(true)}
                  onPointerUp={(event) => {
                    setIsDraggingVolume(false);
                    void setVolume(sink.id, Number(event.currentTarget.value));
                  }}
                  onPointerCancel={() => setIsDraggingVolume(false)}
                  onChange={(event) => {
                    const volume = Number(event.target.value);
                    setLocalVolume(volume);
                    debouncedSetVolume(sink.id, volume);
                  }}
                  style={{ "--volume": `${localVolume}%` } as CSSProperties}
                  className="volume-slider h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10"
                  aria-label="Âm lượng"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-[8px] uppercase tracking-[0.12em] text-slate-500">
            <span>{audio.outputs.length} output{audio.outputs.length === 1 ? "" : "s"} available</span>
            <span className="flex items-center gap-1 text-emerald-400/80">
              <Check size={10} /> Active
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-3">
          <div className="skeleton h-12 w-full rounded-lg" />
          <div className="skeleton h-14 w-full rounded-lg" />
        </div>
      )}
    </div>
  );
});
