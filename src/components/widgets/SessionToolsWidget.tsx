import { useState } from "react";
import { BellOff, Coffee, Power, Timer } from "lucide-react";
import { useSystemStore } from "../../store/useSystemStore";
import { WidgetFactory } from "./factory";

const SHUTDOWN_OPTIONS = [
  { label: "1H", minutes: 60 },
  { label: "2H", minutes: 120 },
  { label: "4H", minutes: 240 },
  { label: "6H", minutes: 360 },
];

function formatUptime(seconds: number | undefined) {
  if (seconds === undefined || seconds === null) return "00:00:00";
  const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function SessionToolsWidget() {
  const controls     = useSystemStore((s) => s.controls);
  const toggleDnd    = useSystemStore((s) => s.toggleDoNotDisturb);
  const toggleAwake  = useSystemStore((s) => s.toggleKeepAwake);
  const setTimer     = useSystemStore((s) => s.setShutdownTimer);
  const profile      = useSystemStore((s) => s.settings.active_profile.name);
  const setPowerProfile = useSystemStore((s) => s.setPowerProfile);

  const [selectedMinutes, setSelectedMinutes] = useState<number | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  
  const systemUptime = useSystemStore((s) => s.telemetry?.session.system_uptime_seconds);
  const uptime = formatUptime(systemUptime);

  const handleShutdown = async () => {
    if (selectedMinutes == null) return;
    await setTimer(selectedMinutes);
  };

  const handleProfile = async (p: "powersave" | "balanced" | "performance") => {
    setProfileError(null);
    try {
      await setPowerProfile(p === "powersave" ? "power-saver" : p);
    } catch {
      setProfileError("Không thể đổi chế độ nguồn");
    }
  };

  return (
    <WidgetFactory title="CÔNG CỤ PHIÊN">
      <div className="space-y-3 text-[11px]">
        {/* Session timer display */}
        <div className="flex items-center justify-between">
          <div className="rounded-lg border border-primary/20 bg-primary/10 px-4 py-1.5">
            <p className="text-[9px] font-bold uppercase text-primary/60">Tổng thời gian</p>
            <p className="big-number glow-purple text-xl text-primary">{uptime}</p>
          </div>
          <button className="rounded bg-primary px-4 py-2 text-[10px] font-bold uppercase text-black hover:bg-primary/80 transition-all">
            FOCUS
          </button>
        </div>

        {/* Performance profile pills */}
        <div className="flex gap-1">
          {(["powersave", "balanced", "performance"] as const).map((p) => (
            <button
              key={p}
              onClick={() => void handleProfile(p)}
              disabled={profile === p}
              className={`flex-1 rounded border px-1 py-1.5 capitalize transition-colors ${
                profile === p
                  ? "border-primary bg-primary/20 text-primary"
                  : "border-white/10 bg-black/20 text-slate-400 hover:border-primary/40"
              }`}
            >
              {p === "powersave" ? "Power saver" : p}
            </button>
          ))}
        </div>
        {profileError && <p className="text-[9px] text-red-400">{profileError}</p>}

        {/* DND & Keep Awake toggles */}
        <div className="space-y-2">
          <button
            onClick={() => void toggleDnd()}
            className={`flex w-full items-center gap-3 rounded border p-2 text-left transition-colors ${
              controls.is_do_not_disturb_active
                ? "border-pink-accent/50 bg-pink-accent/5 text-pink-accent"
                : "border-white/5 bg-black/20 text-slate-400 hover:border-white/15"
            }`}
          >
            <BellOff size={15} />
            <div>
              <p className="text-[10px] font-bold">Không làm phiền</p>
              <p className="text-[8px] text-on-surface-variant">Ẩn tất cả thông báo hệ thống</p>
            </div>
          </button>
          <button
            onClick={() => void toggleAwake()}
            className={`flex w-full items-center gap-3 rounded border p-2 text-left transition-colors ${
              controls.is_keep_awake_active
                ? "border-cyan-accent/50 bg-cyan-accent/5 text-cyan-accent"
                : "border-white/5 bg-black/20 text-slate-400 hover:border-white/15"
            }`}
          >
            <Coffee size={15} />
            <div>
              <p className="text-[10px] font-bold">Chống ngủ</p>
              <p className="text-[8px] text-on-surface-variant">Giữ màn hình luôn bật</p>
            </div>
          </button>
        </div>

        {/* Shutdown timer — pill buttons 1H/2H/4H/6H */}
        <div className="border-t border-white/5 pt-2">
          <div className="mb-2 flex items-center gap-1.5">
            <Timer size={12} className="text-primary" />
            <span className="text-[9px] uppercase tracking-wider text-slate-400">Tắt máy sau</span>
          </div>
          <div className="flex gap-2">
            <div className="grid flex-1 grid-cols-4 gap-1.5">
              {SHUTDOWN_OPTIONS.map(({ label, minutes }) => (
                <button
                  key={label}
                  onClick={() =>
                    setSelectedMinutes((prev) => (prev === minutes ? null : minutes))
                  }
                  className={`rounded py-2 text-[10px] font-bold transition-colors ${
                    selectedMinutes === minutes
                      ? "border border-primary/50 bg-primary/20 text-primary"
                      : "border border-white/10 bg-white/5 text-slate-400 hover:border-primary/40"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => void handleShutdown()}
              disabled={selectedMinutes == null}
              className="rounded bg-primary/20 px-2 text-primary disabled:opacity-30 hover:bg-primary/30 transition-colors"
            >
              <Power size={14} />
            </button>
          </div>
        </div>
      </div>
    </WidgetFactory>
  );
}
