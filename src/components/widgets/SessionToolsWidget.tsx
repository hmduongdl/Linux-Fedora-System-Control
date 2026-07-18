import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BatteryCharging, BellOff, BriefcaseBusiness, Coffee, Gamepad2, Gauge, LoaderCircle, Power, RotateCcw, Timer, VolumeX, Zap } from "lucide-react";
import { useSystemStore } from "../../store/useSystemStore";
import { WidgetFactory } from "./factory";

const SHUTDOWN_OPTIONS = [
  { label: "1H", minutes: 60 },
  { label: "2H", minutes: 120 },
  { label: "4H", minutes: 240 },
  { label: "6H", minutes: 360 },
];

const POWER_PROFILES = [
  { id: "powersave", command: "power-saver", label: "Tiết kiệm", icon: BatteryCharging },
  { id: "balanced", command: "balanced", label: "Cân bằng", icon: Gauge },
  { id: "performance", command: "performance", label: "Hiệu năng", icon: Zap },
] as const;

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
  const operatingMode = useSystemStore((s) => s.operatingMode);

  const [selectedMinutes, setSelectedMinutes] = useState<number | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [pendingProfile, setPendingProfile] = useState<(typeof POWER_PROFILES)[number]["id"] | null>(null);
  const [pendingTimer, setPendingTimer] = useState(false);
  const [timerError, setTimerError] = useState<string | null>(null);
  const [pendingPower, setPendingPower] = useState<"poweroff" | "reboot" | null>(null);
  const [powerError, setPowerError] = useState<string | null>(null);
  
  const systemUptime = useSystemStore((s) => s.telemetry?.session.system_uptime_seconds);
  const uptime = formatUptime(systemUptime);

  const handleShutdown = async () => {
    if (selectedMinutes == null) return;
    setTimerError(null);
    setPendingTimer(true);
    try {
      await setTimer(selectedMinutes);
    } catch (error) {
      setTimerError(`Không thể hẹn giờ tắt máy: ${String(error)}`);
    } finally {
      setPendingTimer(false);
    }
  };

  const handleProfile = async (p: "powersave" | "balanced" | "performance") => {
    setProfileError(null);
    setPendingProfile(p);
    try {
      await setPowerProfile(p === "powersave" ? "power-saver" : p);
    } catch {
      setProfileError("Không thể đổi chế độ nguồn");
    } finally {
      setPendingProfile(null);
    }
  };

  const activeProfileIndex = Math.max(0, POWER_PROFILES.findIndex(({ id }) => id === profile));
  const modeDisplay = {
    work: { label: "WORK", icon: BriefcaseBusiness, color: "text-cyan-300" },
    game: { label: "GAME", icon: Gamepad2, color: "text-emerald-400" },
    silent: { label: "SILENT", icon: VolumeX, color: "text-violet-300" },
  }[operatingMode];
  const ModeIcon = modeDisplay.icon;

  const handlePowerAction = async (action: "poweroff" | "reboot") => {
    const verb = action === "poweroff" ? "tắt máy" : "khởi động lại máy";
    if (!window.confirm(`Bạn có chắc muốn ${verb} ngay bây giờ?`)) return;
    setPowerError(null);
    setPendingPower(action);
    try {
      await invoke("system_power_action", { action });
    } catch (error) {
      setPowerError(`Không thể ${verb}: ${String(error)}`);
      setPendingPower(null);
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
          <div className="flex items-stretch gap-1.5">
            <div className={`flex min-w-[86px] items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-3 py-1.5 ${modeDisplay.color}`} title={`Chế độ máy: ${modeDisplay.label}`}>
              <ModeIcon size={14} />
              <div>
                <p className="text-[8px] uppercase text-slate-500">Chế độ máy</p>
                <p className="text-[10px] font-bold leading-tight">{modeDisplay.label}</p>
              </div>
            </div>
            <button type="button" onClick={() => void handlePowerAction("poweroff")} disabled={pendingPower !== null} aria-label="Tắt máy" title="Tắt máy" className="grid w-9 place-items-center rounded-lg border border-red-500/25 bg-red-500/10 text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-40">
              {pendingPower === "poweroff" ? <LoaderCircle size={14} className="animate-spin" /> : <Power size={14} />}
            </button>
            <button type="button" onClick={() => void handlePowerAction("reboot")} disabled={pendingPower !== null} aria-label="Khởi động lại" title="Khởi động lại" className="grid w-9 place-items-center rounded-lg border border-amber-400/25 bg-amber-400/10 text-amber-300 transition-colors hover:bg-amber-400/20 disabled:opacity-40">
              {pendingPower === "reboot" ? <LoaderCircle size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            </button>
          </div>
        </div>
        {powerError && <p role="alert" className="text-[9px] text-red-400">{powerError}</p>}

        {/* Performance profile pills */}
        <div
          className="power-profile-switch relative grid grid-cols-3 rounded-lg border border-white/[0.07] bg-black/25 p-1"
          aria-label="Chế độ nguồn"
        >
          <span
            className="power-profile-indicator pointer-events-none absolute bottom-1 top-1 rounded-md border border-primary/35 bg-primary/15 shadow-[0_0_18px_rgba(139,92,246,.16)]"
            style={{ transform: `translateX(${activeProfileIndex * 100}%)` }}
          />
          {POWER_PROFILES.map(({ id, label, icon: ProfileIcon }) => (
            <button
              key={id}
              onClick={() => void handleProfile(id)}
              disabled={pendingProfile !== null || profile === id}
              aria-pressed={profile === id}
              className={`relative z-10 flex min-w-0 items-center justify-center gap-1 rounded-md px-1 py-2 text-[9px] font-semibold transition-[color,transform,opacity] duration-300 ${
                profile === id
                  ? "text-primary"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {pendingProfile === id ? (
                <LoaderCircle size={12} className="animate-spin" />
              ) : (
                <ProfileIcon size={12} className={profile === id ? "power-profile-icon" : ""} />
              )}
              <span className="truncate">{label}</span>
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
                  type="button"
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
              type="button"
              onClick={() => void handleShutdown()}
              disabled={selectedMinutes == null || pendingTimer}
              aria-label={pendingTimer ? "Đang đặt lịch tắt máy" : "Đặt lịch tắt máy"}
              className="grid min-w-9 place-items-center rounded bg-primary/20 px-2 text-primary transition-colors hover:bg-primary/30 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {pendingTimer ? <LoaderCircle size={14} className="animate-spin" /> : <Power size={14} />}
            </button>
          </div>
          {timerError && <p role="alert" className="mt-1 text-[9px] text-red-400">{timerError}</p>}
        </div>
      </div>
    </WidgetFactory>
  );
}
