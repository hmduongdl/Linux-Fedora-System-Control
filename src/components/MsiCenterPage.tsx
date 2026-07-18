import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Activity, BatteryCharging, BriefcaseBusiness, Cpu, Eraser, Gamepad2, Gauge, HardDrive, Keyboard, LoaderCircle, MemoryStick, Timer, VolumeX, Wind, X, Zap } from "lucide-react";
import { useSystemStore } from "../store/useSystemStore";
import { useAutoResize } from "../hooks/useAutoResize";

const PINK = "#ec1c6f";
const CYAN = "#22d3ee";

function MiniChart({ values, color }: { values: number[]; color: string }) {
  const points = useMemo(() => {
    const data = values.length ? values : [0, 0, 0, 0];
    const min = Math.min(...data);
    const span = Math.max(1, Math.max(...data) - min);
    return data.map((value, index) =>
      `${(index / Math.max(1, data.length - 1)) * 100},${27 - ((value - min) / span) * 22}`
    ).join(" ");
  }, [values]);

  return (
    <div className="min-h-0 flex-1 pt-1.5">
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="block h-full w-full">
        <polyline points={points} fill="none" stroke={color} strokeWidth="1.7" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function MetricCard({ title, value, unit, accent, icon, history }: {
  title: string; value: string; unit: string; accent: string; icon: ReactNode; history: number[];
}) {
  return (
    <article className="msi-card flex min-h-0 min-w-0 flex-col p-4">
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[.16em]" style={{ color: accent }}>
        {title}<span className="text-slate-500">{icon}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="msi-number" style={{ color: accent }}>{value}</span>
        <span className="text-sm text-slate-400">{unit}</span>
      </div>
      <MiniChart values={history} color={accent} />
    </article>
  );
}

function Toggle({ enabled, onClick, label }: { enabled: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={enabled} aria-label={label}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${enabled ? "bg-pink-accent" : "bg-white/10"}`}>
      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${enabled ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  );
}

function formatUptime(seconds: number | undefined) {
  if (seconds == null) return "Unavailable";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`;
}

function formatRuntime(minutes: number | null | undefined) {
  if (minutes == null || minutes <= 0) return "Unavailable";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function HardwareControl() {
  const state = useSystemStore((s) => s.msiEcState);
  const setShift = useSystemStore((s) => s.setMsiEcShiftMode);
  const setFan = useSystemStore((s) => s.setMsiEcFanMode);
  const setBoost = useSystemStore((s) => s.setMsiEcCoolerBoost);
  const unsupported = !state?.is_supported;
  const modes = state?.available_shift_modes ?? ["eco", "comfort", "turbo"];
  const fans = state?.available_fan_modes ?? ["auto", "silent", "advanced"];
  const [fanModalOpen, setFanModalOpen] = useState(false);
  const [autoFan, setAutoFan] = useState(() => localStorage.getItem("purrdora_auto_fan") === "true");
  const autoBoosted = useRef(false);

  useEffect(() => {
    if (!autoFan || unsupported) return;
    const checkTemperature = () => {
      const currentEcState = useSystemStore.getState().msiEcState;
      const temperature = currentEcState?.acpi_thermal_temp ?? 0;
      if (temperature >= 78 && !autoBoosted.current && !currentEcState?.cooler_boost) {
        autoBoosted.current = true;
        void setBoost(true);
      } else if (temperature <= 72 && autoBoosted.current) {
        autoBoosted.current = false;
        void setBoost(false);
        void setFan("auto");
      }
    };
    checkTemperature();
    const timer = window.setInterval(checkTemperature, 3000);
    return () => window.clearInterval(timer);
  }, [autoFan, setBoost, setFan, unsupported]);

  return (
    <article className="msi-card msi-hardware-control min-w-0 p-5">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h2 className="msi-section-title">MSI Hardware Control</h2>
        <span className="shrink-0 rounded-md border border-white/10 bg-black/20 px-2 py-1 font-mono text-[9px] uppercase text-slate-400">EC {state?.fw_version ?? "offline"}</span>
      </div>
      {unsupported && <p className="mt-2 text-[10px] text-amber-400">msi-ec driver not detected</p>}

      <div className="mt-4">
        <p className="msi-label">Shift mode</p>
        <div className="grid grid-cols-3 gap-2">
          {modes.slice(0, 3).map((mode) => (
            <button disabled={unsupported} key={mode} onClick={() => void setShift(mode)}
              className={`msi-option msi-option-compact ${state?.shift_mode === mode ? "active-pink" : ""}`}>
              <Zap size={12} />{mode}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <p className="msi-label msi-label-cyan">Fan profile</p>
        <div className="grid grid-cols-3 gap-2">
          {fans.slice(0, 3).map((mode) => (
            <button disabled={unsupported} key={mode} onClick={() => {
              if (mode === "advanced") {
                void setBoost(false);
                void setFan(mode);
                setFanModalOpen(true);
              } else { void setBoost(false); void setFan(mode); }
            }}
              className={`msi-option msi-option-compact ${state?.fan_mode === mode && !state.cooler_boost ? "active-cyan" : ""}`}>
              <Wind size={12} />{mode}
            </button>
          ))}
        </div>
      </div>

      <button disabled={unsupported} onClick={() => void setBoost(!state?.cooler_boost)}
        className={`mt-4 flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-[10px] font-bold uppercase ${state?.cooler_boost ? "border-pink-accent bg-pink-accent/10 text-pink-accent" : "border-white/10 text-slate-400"}`}>
        <span className="flex items-center gap-2"><Wind size={13} />Cooler boost</span><span>{state?.cooler_boost ? "ON" : "OFF"}</span>
      </button>
      <div className="mt-2 flex items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-[10px]">
        <span className="text-slate-400">Auto fan ≥ 78°C <span className="text-slate-600">({state?.acpi_thermal_temp ?? 0}°C ACPI)</span></span>
        <Toggle enabled={autoFan} onClick={() => { const next = !autoFan; setAutoFan(next); localStorage.setItem("purrdora_auto_fan", String(next)); }} label="Automatic fan boost" />
      </div>

      <HardwareMonitoring />
      {fanModalOpen && <FanControlModal onClose={() => setFanModalOpen(false)} />}
    </article>
  );
}

function FanControlModal({ onClose }: { onClose: () => void }) {
  const state = useSystemStore((s) => s.msiEcState);
  const setFan = useSystemStore((s) => s.setMsiEcFanMode);
  const setBoost = useSystemStore((s) => s.setMsiEcCoolerBoost);
  const refresh = useSystemStore((s) => s.fetchMsiEcState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = state?.available_fan_modes ?? [];
  const presets = [
    { id: "silent", label: "Silent", detail: "Lowest-noise EC curve", enabled: available.includes("silent") },
    { id: "auto", label: "Automatic", detail: "Firmware-managed balance", enabled: available.includes("auto") },
    { id: "advanced", label: "Advanced", detail: "MSI custom curve stored in EC", enabled: available.includes("advanced") },
    { id: "boost", label: "Cooler Boost", detail: "Maximum cooling", enabled: true },
  ];

  const apply = async (id: string) => {
    setBusy(true); setError(null);
    try {
      if (id === "boost") await setBoost(true);
      else { await setBoost(false); await setFan(id); }
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="fan-control-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#12131a] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div><h2 id="fan-control-title" className="text-sm font-bold uppercase tracking-wider">Fan Control</h2><p className="mt-1 text-[10px] text-slate-500">MSI Cyborg 15 · EC {state?.fw_version}</p></div>
          <button onClick={onClose} className="rounded-lg border border-white/10 p-2 text-slate-400 hover:text-white" aria-label="Close fan control"><X size={15} /></button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3"><span className="text-[9px] uppercase text-slate-500">CPU fan</span><p className="mt-1 font-mono text-xl text-pink-accent">{state?.cpu_fan_speed ?? 0}%</p></div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3"><span className="text-[9px] uppercase text-slate-500">GPU fan</span><p className="mt-1 font-mono text-xl text-cyan-accent">{state?.gpu_fan_speed ?? 0}%</p></div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {presets.map((preset) => {
            const active = preset.id === "boost" ? state?.cooler_boost : !state?.cooler_boost && state?.fan_mode === preset.id;
            return <button key={preset.id} disabled={busy || !preset.enabled} onClick={() => void apply(preset.id)} className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-35 ${active ? "border-pink-accent bg-pink-accent/10" : "border-white/10 hover:border-white/20"}`}><span className={`text-[10px] font-bold uppercase ${active ? "text-pink-accent" : "text-slate-200"}`}>{preset.label}</span><p className="mt-1 text-[8px] text-slate-500">{preset.detail}</p></button>;
          })}
        </div>
        <p className="mt-4 rounded-lg border border-amber-400/15 bg-amber-400/5 p-3 text-[9px] leading-relaxed text-amber-200/80">Firmware 15K1IMS1.113 exposes fan presets and realtime speed only. It does not expose temperature/speed curve points, so direct percentage sliders would be unsafe and misleading.</p>
        {error && <p role="alert" className="mt-3 text-[9px] text-red-400">{error}</p>}
      </div>
    </div>
  );
}

function UsageRing({ label, value, color }: { label: string; value: number; color: string }) {
  const safeValue = Math.max(0, Math.min(100, value));
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="usage-ring" style={{ "--usage": `${safeValue}%`, "--ring-color": color } as CSSProperties}>
        <strong>{Math.round(safeValue)}</strong><span>%</span>
      </div>
      <p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
    </div>
  );
}

function HardwareMonitoring() {
  const telemetry = useSystemStore((s) => s.telemetry);
  const clearRam = useSystemStore((s) => s.clearRamCache);
  const cleanDisk = useSystemStore((s) => s.cleanDiskCache);
  const [busy, setBusy] = useState<"disk" | "ram" | null>(null);
  const [animationKey, setAnimationKey] = useState(0);
  const cpuUsage = telemetry?.cpu.total_usage_percent ?? 0;
  const gpuUsage = telemetry?.gpus.reduce((maximum, gpu) => Math.max(maximum, gpu.usage_percent), 0) ?? 0;
  const diskUsage = telemetry?.storage.usage_percent ?? 0;
  const memoryUsage = telemetry?.ram.usage_percent ?? 0;

  const runCleanup = async (kind: "disk" | "ram") => {
    setBusy(kind);
    setAnimationKey((key) => key + 1);
    try {
      if (kind === "disk") await cleanDisk();
      else await clearRam();
    } catch (error) {
      // Privileged cleanup can be cancelled by the user; keep the monitor usable.
      console.error(`[${kind} cleanup]`, error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 border-t border-white/10 pt-3">
      <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.16em] text-slate-300"><Activity size={13} className="text-cyan-accent" />Hardware Monitoring</p>
      <div className="grid grid-cols-[150px_1fr] items-center gap-4">
        <div className="grid grid-cols-2 gap-2">
          <UsageRing label="CPU Usage" value={cpuUsage} color={PINK} />
          <UsageRing label="GPU Usage" value={gpuUsage} color={CYAN} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ResourceUsage label="Disk" value={diskUsage} detail={`${telemetry?.storage.available_gb.toFixed(1) ?? "—"} GB free`} icon={<HardDrive size={12} />} busy={busy === "disk"} animationKey={animationKey} onClean={() => void runCleanup("disk")} />
          <ResourceUsage label="Memory" value={memoryUsage} detail={`${telemetry?.ram.free_gb.toFixed(1) ?? "—"} GB free`} icon={<MemoryStick size={12} />} busy={busy === "ram"} animationKey={animationKey} onClean={() => void runCleanup("ram")} />
        </div>
      </div>
    </div>
  );
}

function ResourceUsage({ label, value, detail, icon, busy, animationKey, onClean }: { label: string; value: number; detail: string; icon: ReactNode; busy: boolean; animationKey: number; onClean: () => void }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/[.07] bg-black/15 p-2.5">
      <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-[9px] font-bold uppercase text-slate-300">{icon}{label}</span><strong className="font-mono text-sm text-slate-100">{Math.round(value)}%</strong></div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div key={`${label}-${animationKey}`} className="resource-progress h-full rounded-full bg-pink-accent" style={{ "--target-width": `${Math.max(0, Math.min(100, value))}%` } as CSSProperties} /></div>
      <div className="mt-2 flex items-center justify-between gap-2"><span className="truncate text-[8px] text-slate-500">{detail}</span><button onClick={onClean} disabled={busy} className="flex shrink-0 items-center gap-1 rounded-full bg-primary px-2 py-1 text-[8px] font-bold text-white transition-transform active:scale-95 disabled:cursor-wait disabled:opacity-50"><span className={busy ? "animate-spin" : ""}>{busy ? <LoaderCircle size={9} /> : <Eraser size={9} />}</span>{busy ? "Working" : "Free"}</button></div>
    </div>
  );
}

function BatteryMaster() {
  const battery = useSystemStore((s) => s.battery);
  const setHealthMode = useSystemStore((s) => s.setBatteryLimiter);
  const percent = battery?.present ? battery.percent : 0;
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const toggleHealth = async () => {
    setHealthBusy(true); setHealthError(null);
    try { await setHealthMode(!battery?.health_mode); }
    catch (error) { setHealthError(String(error)); }
    finally { setHealthBusy(false); }
  };

  return (
    <article className="msi-card msi-battery-master flex min-h-0 min-w-0 flex-col items-center p-4">
      <div className="flex w-full items-center justify-between">
        <h2 className="msi-section-title">Battery Master</h2>
        <BatteryCharging size={16} className="text-pink-accent" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-2">
        <div className="battery-ring msi-battery-ring" style={{ "--battery": `${percent}%`, "--battery-value": percent } as CSSProperties}>
          <svg viewBox="0 0 100 100" role="img" aria-label={`${battery?.present ? battery.percent : "—"}% ${battery?.charging ? "charging" : "discharging"}`}>
            <circle className="battery-ring-track" cx="50" cy="50" r="46" />
            <circle className="battery-ring-progress" cx="50" cy="50" r="46" pathLength="100" />
            <text className="battery-ring-percent" x="50" y="48">{battery?.present ? battery.percent : "—"}%</text>
            <text className="battery-ring-status" x="50" y="61">{battery?.charging ? "CHARGING" : "DISCHARGING"}</text>
          </svg>
        </div>
      </div>
      <div className="w-full rounded-lg border border-white/10 bg-white/[.03] px-3 py-2.5 text-center">
        <p className="flex items-center justify-center gap-1.5 text-[8px] uppercase tracking-widest text-slate-500"><Timer size={10} />Estimated runtime</p>
        <p className="mt-1 text-sm font-bold text-slate-200">{battery?.charging ? "AC connected" : formatRuntime(battery?.estimated_runtime_minutes)}</p>
      </div>
      <div className="mt-2 flex w-full items-center justify-between rounded-lg border border-white/10 px-3 py-2">
        <div className="min-w-0"><p className="text-[10px] font-bold">Health Mode</p><p className="text-[8px] text-slate-500">Optimal longevity · 80% cap</p></div>
        <div className={healthBusy ? "pointer-events-none opacity-50" : ""}><Toggle enabled={Boolean(battery?.health_mode)} onClick={() => void toggleHealth()} label="Health Mode" /></div>
      </div>
      {healthError && <p role="alert" className="mt-2 w-full text-[8px] leading-relaxed text-red-400">{healthError}</p>}
      <div className="mt-2 flex w-full items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-[10px]">
        <span className="text-slate-500">Battery health</span>
        <span className="font-mono text-slate-200">{battery?.health_percent == null ? "Unavailable" : `${battery.health_percent}%`}</span>
      </div>
    </article>
  );
}

function KeyboardBacklight() {
  const state = useSystemStore((s) => s.msiEcState);
  const setBacklight = useSystemStore((s) => s.setMsiEcKbdBacklight);
  const level = state?.kbd_backlight ?? 0;
  const max = state?.kbd_backlight_max ?? 0;
  const [draftLevel, setDraftLevel] = useState(level);
  useEffect(() => setDraftLevel(level), [level]);
  const supported = Boolean(state?.is_supported && max > 0);
  const enabled = supported && level > 0;

  const toggle = () => {
    if (!supported) return;
    void setBacklight(enabled ? 0 : max);
  };

  return (
    <article className="msi-card msi-keyboard-card flex min-w-0 flex-col justify-center p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Keyboard size={15} className="shrink-0 text-pink-accent" />
          <div className="min-w-0">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-200">Keyboard Backlight</h2>
            <p className="mt-0.5 text-[8px] text-slate-500">{supported ? `Brightness ${level} / ${max}` : "Not supported"}</p>
          </div>
        </div>
        <Toggle enabled={enabled} onClick={toggle} label="Keyboard Backlight" />
      </div>
      {supported && (
        <input type="range" min="0" max={max} step="1" value={draftLevel}
          onChange={(event) => setDraftLevel(Number(event.target.value))}
          onPointerUp={() => void setBacklight(draftLevel)}
          onKeyUp={() => void setBacklight(draftLevel)}
          className="keyboard-brightness-slider mt-3 w-full" aria-label="Keyboard brightness" />
      )}
    </article>
  );
}

function formatRate(bytesPerSecond: number) {
  if (bytesPerSecond >= 1_000_000) return `${(bytesPerSecond / 1_000_000).toFixed(1)} MB/s`;
  if (bytesPerSecond >= 1_000) return `${(bytesPerSecond / 1_000).toFixed(1)} KB/s`;
  return `${Math.round(bytesPerSecond)} B/s`;
}

function SystemSnapshot() {
  const telemetry = useSystemStore((s) => s.telemetry);
  const state = useSystemStore((s) => s.msiEcState);
  const profile = useSystemStore((s) => s.settings.active_profile.name);
  const cpuClock = telemetry?.cpu.cores.length
    ? telemetry.cpu.cores.reduce((sum, core) => sum + core.frequency_mhz, 0) / telemetry.cpu.cores.length
    : null;
  const gpu = telemetry?.gpus.find((item) => item.vendor === "NVIDIA") ?? telemetry?.gpus[0];
  const networkRate = telemetry?.network.interfaces
    .filter((item) => item.name !== "lo")
    .reduce((sum, item) => sum + item.rx_bytes_per_sec + item.tx_bytes_per_sec, 0) ?? 0;
  const rows = [
    ["CPU", telemetry?.cpu.name ?? "Unavailable"],
    ["GPU", gpu?.name ?? "Unavailable"],
    ["RAM", telemetry ? `${telemetry.ram.used_gb.toFixed(1)} / ${telemetry.ram.total_gb.toFixed(1)} GB` : "Unavailable"],
    ["CPU Fan", state?.is_supported ? `${state.cpu_fan_speed}%` : "Unavailable"],
    ["GPU Fan", state?.is_supported ? `${state.gpu_fan_speed}%` : "Unavailable"],
    ["SSD", telemetry ? `${telemetry.storage.available_gb.toFixed(1)} GB available · ${Math.round(telemetry.storage.usage_percent)}% used` : "Unavailable"],
    ["Network", formatRate(networkRate)],
    ["Power Plan", profile],
    ["CPU Temperature", state?.is_supported ? `${state.cpu_temp}°C` : "Unavailable"],
    ["GPU Temperature", state?.is_supported ? `${state.gpu_temp}°C` : "Unavailable"],
    ["CPU Clock", cpuClock == null ? "Unavailable" : `${Math.round(cpuClock)} MHz`],
    ["Kernel", telemetry?.session.kernel_version ?? "Unavailable"],
    ["Uptime", formatUptime(telemetry?.session.system_uptime_seconds)],
  ];

  return (
    <article className="msi-card msi-operating-card flex min-h-0 min-w-0 flex-col p-4">
      <h2 className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.16em] text-slate-200"><Cpu size={13} className="text-pink-accent" />System Snapshot</h2>
      <div className="snapshot-list custom-scrollbar">
        {rows.map(([label, itemValue], index) => (
          <div key={label} className={`flex min-w-0 items-center justify-between gap-3 px-2 py-1.5 text-[9px] ${index % 2 ? "bg-white/[.025]" : ""}`}>
            <span className="shrink-0 text-slate-500">{label}</span>
            <span className="truncate text-right font-medium capitalize text-slate-200" title={itemValue}>{itemValue}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

type OperatingMode = "work" | "game" | "silent";

function OperatingModeCard() {
  const [mode, setMode] = useState<OperatingMode>("work");
  const [pending, setPending] = useState<OperatingMode | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const refreshEc = useSystemStore((state) => state.fetchMsiEcState);
  const refreshBattery = useSystemStore((state) => state.fetchBattery);
  const modes: { id: OperatingMode; label: string; icon: ReactNode; description: string }[] = [
    { id: "work", label: "Work", icon: <BriefcaseBusiness size={14} />, description: "Balanced daily profile" },
    { id: "game", label: "Game", icon: <Gamepad2 size={14} />, description: "Maximum performance" },
    { id: "silent", label: "Silent", icon: <VolumeX size={14} />, description: "Quiet operation" },
  ];

  const activate = async (nextMode: OperatingMode) => {
    setPending(nextMode);
    setMessage(null);
    try {
      const result = await invoke<{ mode: OperatingMode; warnings: string[] }>("set_operating_mode", { mode: nextMode });
      setMode(result.mode);
      setMessage(result.warnings.length ? result.warnings.join(" · ") : `${nextMode} mode enabled`);
      await Promise.all([refreshEc(), refreshBattery()]);
    } catch (error) {
      setMessage(`Mode switch failed: ${String(error)}`);
    } finally {
      setPending(null);
    }
  };

  return (
    <article className="msi-card min-w-0 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-200">Operating Mode</h2>
          <p className="mt-0.5 text-[8px] text-slate-500">Hardware, power and notification profile</p>
        </div>
        <Zap size={15} className="shrink-0 text-pink-accent" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-2">
        {modes.map((item) => (
          <button key={item.id} type="button" onClick={() => void activate(item.id)} disabled={pending != null} aria-pressed={mode === item.id}
            className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2.5 transition-colors ${mode === item.id ? "border-pink-accent bg-pink-accent/10 text-pink-accent" : "border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200"}`}>
            {item.icon}
            <span className="text-[9px] font-bold uppercase tracking-wider">{item.label}</span>
            <span className="hidden max-w-full truncate text-[7px] text-slate-500 xl:block">{item.description}</span>
          </button>
        ))}
      </div>
      {message && <p role="status" className="mt-2 line-clamp-2 text-[8px] leading-relaxed text-amber-300">{message}</p>}
    </article>
  );
}

export function MsiCenterPage() {
  const mainRef = useRef<HTMLElement>(null);
  useAutoResize(mainRef, true);
  const state = useSystemStore((s) => s.msiEcState);
  const telemetry = useSystemStore((s) => s.telemetry);
  const cpu = telemetry?.cpu.cores.find((core) => core.temperature_celsius != null)?.temperature_celsius ?? state?.cpu_temp;
  const gpu = telemetry?.gpus.find((item) => item.temperature_celsius != null)?.temperature_celsius ?? state?.gpu_temp;
  const ram = telemetry?.ram.usage_percent;
  const clock = telemetry?.cpu.cores.length
    ? telemetry.cpu.cores.reduce((sum, core) => sum + core.frequency_mhz, 0) / telemetry.cpu.cores.length / 1000
    : undefined;
  const value = (number: number | undefined) => number == null || Number.isNaN(number) ? "—" : String(Math.round(number));

  return (
    <main ref={mainRef} className="msi-page">
      <div className="msi-monitor-layout mx-auto w-full max-w-[1700px]">
        <section className="msi-metrics-row">
          <MetricCard title="CPU Temp" value={value(cpu)} unit="°C" accent={PINK} icon={<Activity size={15} />} history={cpu ? [cpu - 5, cpu - 2, cpu + 1, cpu - 3, cpu] : []} />
          <MetricCard title="GPU Temp" value={value(gpu)} unit="°C" accent={CYAN} icon={<Gauge size={15} />} history={gpu ? [gpu - 4, gpu - 1, gpu + 2, gpu - 2, gpu] : []} />
          <MetricCard title="CPU Clock" value={clock == null ? "—" : clock.toFixed(1)} unit="GHz" accent={PINK} icon={<Zap size={15} />} history={clock ? [clock - .4, clock - .1, clock + .2, clock, clock] : []} />
          <MetricCard title="RAM Usage" value={value(ram)} unit="%" accent={CYAN} icon={<Activity size={15} />} history={ram ? [ram - 4, ram - 2, ram + 1, ram - 1, ram] : []} />
        </section>
        <section className="msi-details-row">
          <HardwareControl />
          <SystemSnapshot />
          <div className="msi-utility-row">
            <BatteryMaster />
            <div className="msi-utility-stack">
              <KeyboardBacklight />
              <OperatingModeCard />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
