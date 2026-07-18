import { memo, useMemo } from "react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { useSystemStore } from "../../store/useSystemStore";
import { WidgetFactory } from "./factory";

/* ── Extracted sub-components (stable references for reconciliation) ── */

const StatTile = ({
  label,
  value,
  unit,
  color,
  strokeColor,
  data,
}: {
  label: string;
  value: string;
  unit: string;
  color: string;
  strokeColor: string;
  data: { v: number }[];
}) => (
  <div className="rounded-lg border border-white/5 bg-black/20 p-[clamp(8px,1vh,12px)] flex flex-col justify-between min-w-0 min-h-0">
    <p className="text-[clamp(8px,1vh,9px)] uppercase text-on-surface-variant leading-none">{label}</p>
    <div className="mt-[clamp(2px,0.4vh,6px)] flex items-baseline gap-1 min-h-[1.2em] overflow-hidden">
      <span className={`big-number ${color} leading-none`} style={{ fontSize: "clamp(1.1rem, 2.2vh, 1.5rem)" }}>
        {value || "—"}
      </span>
      <span className={`opacity-60 ${color} leading-none`} style={{ fontSize: "clamp(8px, 1.1vh, 10px)" }}>
        {unit}
      </span>
    </div>
    <div className="h-[clamp(16px,2vh,24px)] relative w-full mt-[clamp(4px,0.6vh,8px)]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data.length ? data : [{ v: 0 }]} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <Area
            dataKey="v"
            stroke={strokeColor}
            fill="none"
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  </div>
);

const ProgressBar = ({
  label,
  value,
  colorClass,
  textColor,
  extra,
}: {
  label: string;
  value: number;
  colorClass: string;
  textColor: string;
  extra?: string;
}) => (
  <div>
    <div className="flex justify-between text-[10px] font-bold">
      <span className={textColor}>{label}</span>
      <span>
        {value.toFixed(0)}%
        {extra && (
          <span className="ml-1 text-[9px] font-normal text-on-surface-variant">
            {extra}
          </span>
        )}
      </span>
    </div>
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/30">
      <div
        className={`h-full ${colorClass}`}
        style={{ width: `${Math.min(100, value)}%` }}
      />
    </div>
  </div>
);

/* ── Main widget ── */

export const SystemMetricsWidget = memo(function SystemMetricsWidget() {
  const t = useSystemStore((s) => s.telemetry);
  const h = useSystemStore((s) => s.performanceHistory);

  const cpu  = t?.cpu.total_usage_percent ?? 0;
  const ram  = t?.ram.usage_percent ?? 0;
  const ping = t?.network.latency_ms ?? 0;

  const avgTemp = useMemo(() => {
    const cpuTemps = (t?.cpu.cores ?? [])
      .map((c) => c.temperature_celsius)
      .filter((temp): temp is number => temp != null);
    const gpuTemps = (t?.gpus ?? [])
      .map((g) => g.temperature_celsius)
      .filter((temp): temp is number => temp != null);
    const allTemps = [...cpuTemps, ...gpuTemps];
    return allTemps.length
      ? allTemps.reduce((a, b) => a + b, 0) / allTemps.length
      : null;
  }, [t]);

  const pingData = useMemo(() => h.map((x) => ({ v: x.latency_ms ?? 0 })), [h]);
  const tempData = useMemo(() => h.map((x) => ({ v: x.avg_temp ?? 0 })), [h]);


  const ramExtra = t
    ? `(${t.ram.used_gb.toFixed(1)} / ${t.ram.total_gb.toFixed(1)} GB)`
    : undefined;
  const storageMounts = t?.storage_mounts?.length
    ? t.storage_mounts
    : t?.storage
      ? [t.storage]
      : [];

  return (
    <WidgetFactory title="CHỈ SỐ HỆ THỐNG">
      <div className="flex flex-col gap-[clamp(10px,1.2vh,16px)]">
        {/* 2 stat tiles */}
        <div className="grid grid-cols-2 gap-[clamp(8px,1vh,12px)]">
          <StatTile
            label="NHIỆT ĐỘ TRUNG BÌNH"
            value={avgTemp != null ? avgTemp.toFixed(0) : "—"}
            unit="°C"
            color="glow-pink text-pink-accent"
            strokeColor="#ec4899"
            data={tempData}
          />
          <StatTile
            label="ĐỘ TRỄ MẠNG"
            value={ping > 0 ? ping.toFixed(0) : "—"}
            unit="MS"
            color="glow-purple text-primary"
            strokeColor="#8b5cf6"
            data={pingData}
          />
        </div>

        {/* Per-GPU bars, followed by CPU and RAM */}
        <div className="flex flex-col gap-[clamp(8px,1vh,12px)]">
          {t?.gpus.map((gpu, index) => (
            <ProgressBar
              key={`${gpu.name}-${index}`}
              label={`GPU ${index}`}
              value={gpu.usage_percent}
              colorClass={index === 0 ? "progress-cyan" : "progress-purple"}
              textColor={index === 0 ? "text-cyan-accent" : "text-primary"}
              extra={gpu.name}
            />
          ))}
          <ProgressBar
            label="CPU"
            value={cpu}
            colorClass="progress-purple"
            textColor="text-primary"
          />
          <ProgressBar
            label="RAM"
            value={ram}
            colorClass="progress-pink"
            textColor="text-pink-accent"
            extra={ramExtra}
          />
          {storageMounts.map((mount, index) => (
            <ProgressBar
              key={`${mount.mount_point}-${index}`}
              label={`DISK ${mount.mount_point}`}
              value={mount.usage_percent}
              colorClass={index % 2 === 0 ? "progress-cyan" : "progress-purple"}
              textColor={index % 2 === 0 ? "text-cyan-accent" : "text-primary"}
              extra={`(${mount.used_gb.toFixed(1)} / ${mount.total_gb.toFixed(1)} GB)`}
            />
          ))}
        </div>
      </div>
    </WidgetFactory>
  );
});
