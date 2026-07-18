import { Cpu } from "lucide-react";
import { useSystemStore } from "../../store/useSystemStore";
import { WidgetFactory } from "./factory";

export function HardwareStatsWidget() {
  const t = useSystemStore((s) => s.telemetry);

  const coreCount = t?.cpu.cores.length ?? 0;
  const freq      = t?.cpu.cores[0]?.frequency_mhz;
  const temp      = t?.cpu.cores[0]?.temperature_celsius;
  const cpuName   = t?.cpu.name ?? "—";

  const Tile = ({
    label,
    value,
    color,
  }: {
    label: string;
    value: string;
    color: string;
  }) => (
    <div className="rounded border border-white/5 bg-black/20 p-2.5 text-center">
      <p className="text-[8px] uppercase text-on-surface-variant mb-1">{label}</p>
      <p className={`text-xs font-bold font-mono ${color}`}>{value}</p>
    </div>
  );

  return (
    <WidgetFactory title="THÔNG SỐ PHẦN CỨNG">
      <div className="space-y-3">
        {/* CPU name */}
        <div className="flex items-center gap-2 rounded border border-white/5 bg-black/20 px-3 py-2">
          <Cpu size={12} className="shrink-0 text-on-surface-variant" />
          <p className="truncate text-[10px] text-on-surface-variant">{cpuName}</p>
        </div>

        {/* Clock / Temp / Cores — the ONLY place these appear */}
        <div className="grid grid-cols-3 gap-2">
          <Tile
            label="Clock"
            value={freq ? `${(freq / 1000).toFixed(1)} GHz` : "—"}
            color="text-cyan-accent"
          />
          <Tile
            label="Temp"
            value={temp != null ? `${temp.toFixed(0)} °C` : "—"}
            color="text-pink-accent"
          />
          <Tile
            label="Cores"
            value={coreCount ? `${coreCount}` : "—"}
            color="text-primary"
          />
        </div>
      </div>
    </WidgetFactory>
  );
}
