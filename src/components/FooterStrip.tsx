import { useSystemStore } from "../store/useSystemStore";

export function FooterStrip() {
  const t = useSystemStore((s) => s.telemetry);

  const uptime = t
    ? `${Math.floor(t.session.system_uptime_seconds / 3600)}h ${Math.floor(
        (t.session.system_uptime_seconds % 3600) / 60
      )}m`
    : "—";

  const temp   = t?.cpu.cores[0]?.temperature_celsius;
  const cpuName = t?.cpu.name ?? "—";

  return (
    <footer className="mt-4 flex flex-wrap items-center gap-6 border-t border-white/5 pt-3 font-mono text-[10px] text-slate-500">
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
        <span className="text-on-surface-variant/60 uppercase tracking-wider">
          {cpuName}
        </span>
      </span>
      <span>
        RAM{" "}
        {t
          ? `${t.ram.used_gb.toFixed(1)} / ${t.ram.total_gb.toFixed(1)} GB`
          : "—"}
      </span>
      <span>UPTIME {uptime}</span>
      {temp != null && (
        <span>
          <span className="text-pink-accent/80">TEMP:</span> {temp.toFixed(0)}°C
        </span>
      )}
      <span className="ml-auto text-on-surface-variant/40">localhost:1420</span>
    </footer>
  );
}
