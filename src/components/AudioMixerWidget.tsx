import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown, Headphones, LoaderCircle, Volume1, Volume2, VolumeX } from "lucide-react";
import { useSystemStore } from "../store/useSystemStore";
import { useDebounce } from "../hooks/useDebounce";
import { StatusPill } from "./widgets/factory";

export const AudioMixerWidget = memo(function AudioMixerWidget() {
  const audio = useSystemStore((state) => state.audio);
  const setVolume = useSystemStore((state) => state.setVolume);
  const toggleMute = useSystemStore((state) => state.toggleMute);
  const setAudioOutput = useSystemStore((state) => state.setAudioOutput);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isOutputMenuOpen, setIsOutputMenuOpen] = useState(false);
  const [isMuting, setIsMuting] = useState(false);
  const outputMenuRef = useRef<HTMLDivElement>(null);
  const [isDraggingVolume, setIsDraggingVolume] = useState(false);
  const debouncedSetVolume = useDebounce(setVolume, 50);
  const sink = audio?.default_sink;
  const [localVolume, setLocalVolume] = useState(sink?.volume_percent ?? 0);

  useEffect(() => {
    if (!isDraggingVolume) setLocalVolume(sink?.volume_percent ?? 0);
  }, [sink?.id, sink?.volume_percent]);

  useEffect(() => {
    if (!isOutputMenuOpen) return;
    const closeMenu = (event: PointerEvent) => {
      if (!outputMenuRef.current?.contains(event.target as Node)) setIsOutputMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOutputMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOutputMenuOpen]);

  const selectOutput = async (deviceId: number) => {
    if (deviceId === sink?.id) {
      setIsOutputMenuOpen(false);
      return;
    }
    setIsSelecting(true);
    setIsOutputMenuOpen(false);
    try {
      await setAudioOutput(deviceId);
    } finally {
      setIsSelecting(false);
    }
  };

  const handleMute = async () => {
    if (!sink || isMuting) return;
    setIsMuting(true);
    try {
      await toggleMute(sink.id);
    } finally {
      setIsMuting(false);
    }
  };

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
          <div className="relative block" ref={outputMenuRef}>
            <span className="mb-1 block text-[8px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Output device
            </span>
            <button
              type="button"
              onClick={() => !isSelecting && setIsOutputMenuOpen((open) => !open)}
              disabled={isSelecting}
              aria-haspopup="listbox"
              aria-expanded={isOutputMenuOpen}
              className={`group relative flex h-10 w-full items-center rounded-lg border bg-black/20 text-left transition-all duration-200 ${isOutputMenuOpen ? "border-cyan-accent/40 bg-cyan-accent/[0.04] shadow-[0_0_20px_rgba(34,211,238,.07)]" : "border-white/[0.07] hover:border-white/15"}`}
            >
              <div className="ml-2.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-cyan-accent/10 text-cyan-accent">
                <Headphones size={13} />
              </div>
              <span className="min-w-0 flex-1 truncate px-2.5 pr-8 text-[10px] font-semibold text-slate-200">
                {sink.description || sink.name}
              </span>
              {isSelecting ? (
                <span className="absolute right-3 h-3 w-3 animate-spin rounded-full border border-cyan-accent/30 border-t-cyan-accent" />
              ) : (
                <ChevronDown size={13} className={`pointer-events-none absolute right-3 text-slate-500 transition-transform duration-200 ${isOutputMenuOpen ? "rotate-180 text-cyan-accent" : ""}`} />
              )}
            </button>

            {isOutputMenuOpen && (
              <div className="audio-output-menu absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-lg border border-cyan-accent/20 bg-[#11131d]/95 p-1 shadow-[0_18px_45px_rgba(0,0,0,.55)] backdrop-blur-xl" role="listbox">
                <div className="max-h-40 space-y-0.5 overflow-y-auto p-0.5 custom-scrollbar">
                  {audio.outputs.map((device) => {
                    const active = device.id === sink.id;
                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        key={device.id}
                        onClick={() => void selectOutput(device.id)}
                        className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors ${active ? "bg-cyan-accent/10 text-cyan-accent" : "text-slate-300 hover:bg-white/[0.05]"}`}
                      >
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${active ? "bg-cyan-accent/15" : "bg-white/[0.04] text-slate-500"}`}>
                          <Headphones size={12} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[10px] font-medium">{device.description || device.name}</span>
                        {active && <Check size={12} className="shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-white/[0.06] bg-black/15 px-3 py-2.5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleMute()}
                disabled={isMuting}
                className={`audio-mute-button flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all duration-300 ${
                  sink.is_muted
                    ? "is-muted border-amber-400/30 bg-amber-400/10 text-amber-300"
                    : "is-live border-cyan-accent/20 bg-cyan-accent/10 text-cyan-accent hover:bg-cyan-accent/15"
                }`}
                aria-label={sink.is_muted ? "Bật âm thanh" : "Tắt âm thanh"}
              >
                {isMuting ? <LoaderCircle size={15} className="animate-spin" /> : sink.is_muted ? <VolumeX key="muted" size={15} /> : sink.volume_percent < 50 ? <Volume1 key="low" size={15} /> : <Volume2 key="high" size={15} />}
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
                    setLocalVolume(Number(event.currentTarget.value));
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
