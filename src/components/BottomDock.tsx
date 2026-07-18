import {
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  Folder,
  Gamepad2,
  Globe,
  Home,
  Maximize2,
  MessageCircle,
  Minimize2,
  Settings2,
  Terminal,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSystemStore } from "../store/useSystemStore";

const NAV_BUTTONS = [
  { icon: Home,          label: "Home",       page: "dashboard" as const },
  { icon: Settings2,    label: "MSI Center", page: "msi" as const },
  { icon: Gamepad2,      label: "Game Mode",  page: "game" as const },
  { icon: Globe,         label: "Browser" },
  { icon: Terminal,      label: "Terminal" },
  { icon: MessageCircle, label: "Chat" },
  { icon: Folder,        label: "Files" },
];

function BatteryIcon({ percent, charging }: { percent: number; charging: boolean }) {
  if (charging) return <BatteryCharging size={14} className="text-emerald-400" />;
  if (percent >= 70) return <BatteryFull size={14} className="text-pink-accent" />;
  if (percent >= 30) return <BatteryMedium size={14} className="text-yellow-400" />;
  return <BatteryLow size={14} className="text-red-400" />;
}

export function BottomDock({
  activePage,
  onNavigate,
}: {
  activePage: "dashboard" | "game" | "msi";
  onNavigate: (page: "dashboard" | "game" | "msi") => void;
}) {
  const dockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const updateHeight = () => document.documentElement.style.setProperty("--dock-height", `${dock.getBoundingClientRect().height}px`);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(dock);
    return () => observer.disconnect();
  }, []);
  const active  = useSystemStore((s) => s.controls.is_gamemode_active);
  const toggle  = useSystemStore((s) => s.toggleGamemode);
  const latency = useSystemStore(
    (s) => s.telemetry?.network.latency_ms?.toFixed(0) ?? "—"
  );
  const battery = useSystemStore((s) => s.battery);

  const gameFps = useSystemStore((s) => s.gameFps);

  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const appWindow = getCurrentWindow();
    appWindow.isFullscreen().then(setIsFullscreen);
    const unlisten = appWindow.onResized(() => {
      appWindow.isFullscreen().then(setIsFullscreen);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const toggleFullscreen = async () => {
    const appWindow = getCurrentWindow();
    const next = !(await appWindow.isFullscreen());
    await appWindow.setFullscreen(next);
    setIsFullscreen(next);
  };

  return (
    <div ref={dockRef} className="fixed inset-x-4 bottom-4 z-[100] mx-auto w-auto max-w-[1200px] overflow-hidden">
      <div className="glass-panel flex min-w-0 items-center justify-between bg-black/60 backdrop-blur-2xl rounded-2xl p-2.5 border-white/10 shadow-2xl">
        {/* Nav icon buttons */}
        <div className="flex min-w-0 items-center gap-1">
          {NAV_BUTTONS.map(({ icon: Icon, label, page }) => {
            const isActive = page === activePage;
            return (
            <button
              key={label}
              title={label}
              onClick={page ? () => onNavigate(page) : undefined}
              aria-current={isActive ? "page" : undefined}
              className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-all ${
                isActive
                  ? page === "msi"
                    ? "border border-pink-accent/50 bg-pink-accent/10 text-pink-accent"
                    : page === "game"
                      ? "border border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                      : "border border-primary/30 bg-primary/10 text-primary"
                  : "text-on-surface-variant hover:bg-white/5"
              }`}
            >
              <Icon size={18} />
              {isActive && <span className="absolute -bottom-1 h-0.5 w-3 rounded-full bg-current" />}
            </button>
            );
          })}
        </div>

        {/* Status badges */}
        <div className="flex items-center gap-4 h-10 rounded-xl border border-white/5 bg-black/40 px-4">
          {/* Game Mode toggle */}
          <button
            onClick={() => void toggle()}
            className={`flex items-center gap-1.5 transition-colors ${
              active ? "text-emerald-400" : "text-slate-500"
            }`}
            title="Toggle GameMode"
          >
            <Gamepad2 size={14} />
            <span className="text-[10px] font-bold uppercase tracking-tight">
              Game Mode
            </span>
          </button>

          <div className="h-4 w-px bg-white/10" />

          {/* FPS */}
          {gameFps && gameFps.fps !== null ? (
            <div className="flex items-center gap-2">
              <div className="flex items-baseline gap-0.5">
                <Zap size={12} className="text-cyan-accent" />
                <span className="font-mono text-xs font-bold text-cyan-accent">
                  {gameFps.fps.toFixed(0)}
                </span>
                <span className="text-[8px] uppercase text-on-surface-variant">FPS</span>
              </div>
              <div className="h-3 w-px bg-white/10" />
              <div className="flex items-baseline gap-0.5">
                <span className="font-mono text-[9px] text-primary">
                  {gameFps.frametime_ms != null ? gameFps.frametime_ms.toFixed(1) : "—"}
                </span>
                <span className="text-[7px] uppercase text-on-surface-variant">ms</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-slate-500" title="No active MangoHud logging detected">
              <Zap size={12} className="text-slate-600" />
              <span className="text-[9px] font-bold uppercase tracking-tight">No game running</span>
            </div>
          )}

          {/* Latency */}
          <div className="flex items-baseline gap-0.5">
            <span className="font-mono text-xs font-bold text-primary">{latency}</span>
            <span className="text-[8px] uppercase text-on-surface-variant">MS</span>
          </div>

          {/* Fullscreen toggle */}
          <button
            onClick={() => void toggleFullscreen()}
            className="text-slate-400 hover:text-pink-accent transition-colors"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>

          {/* Battery — real from /sys/class/power_supply */}
          {battery?.present ? (
            <div className="flex items-center gap-1">
              <BatteryIcon percent={battery.percent} charging={battery.charging} />
              <span className={`font-mono text-[10px] font-bold ${
                battery.charging ? "text-emerald-400" :
                battery.percent < 20 ? "text-red-400" :
                "text-pink-accent"
              }`}>
                {battery.percent}%
              </span>
            </div>
          ) : (
            <span className="text-[10px] text-slate-600">No battery</span>
          )}
        </div>
      </div>
    </div>
  );
}
