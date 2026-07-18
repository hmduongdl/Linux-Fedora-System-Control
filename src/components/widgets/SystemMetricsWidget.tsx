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

  const temperatureSensors = useMemo(() => {
    const sensors = t?.temperatures ?? [];
    if (sensors.length) return sensors;

    // Compatibility fallback while a backend update is being rolled out.
    return (t?.gpus ?? []).flatMap((gpu) => gpu.temperature_celsius == null
      ? []
      : [{ name: `GPU · ${gpu.name}`, temperature_celsius: gpu.temperature_celsius }]);
  }, [t]);

  const avgTemp = useMemo(() => {
    return temperatureSensors.length
      ? temperatureSensors.reduce((total, sensor) => total + sensor.temperature_celsius, 0) / temperatureSensors.length
      : null;
  }, [temperatureSensors]);

  const pingData = useMemo(() => h.map((x) => ({ v: x.latency_ms ?? 0 })), [h]);
  const tempData = useMemo(() => h.map((x) => ({ v: x.avg_temp ?? 0 })), [h]);


  const ramExtra = t
    ? `(${t.ram.used_gb.toFixed(1)} / ${t.ram.total_gb.toFixed(1)} GiB)`
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
          <div className="group relative min-w-0" tabIndex={0} aria-label="Nhiệt độ hệ thống; rê chuột để xem các cảm biến">
            <StatTile
              label="NHIỆT ĐỘ TRUNG BÌNH"
              value={avgTemp != null ? avgTemp.toFixed(0) : "—"}
              unit="°C"
              color="glow-pink text-pink-accent"
              strokeColor="#ec4899"
              data={tempData}
            />
            <div className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-pink-accent/30 bg-[#12131c]/[.98] shadow-[0_12px_30px_rgba(0,0,0,.45)] group-hover:block group-focus:block">
              <div className="border-b border-white/10 px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-pink-300">Nhiệt độ hệ thống</div>
              <div className="max-h-52 overflow-y-auto p-1.5">
                {temperatureSensors.length ? temperatureSensors.map((sensor, index) => (
                  <div key={`${sensor.name}-${index}`} className="flex items-center justify-between gap-3 rounded px-1.5 py-1 text-[10px] hover:bg-white/5">
                    <span className="min-w-0 truncate text-[#c5c5da]" title={sensor.name}>{sensor.name}</span>
                    <span className="shrink-0 font-mono text-pink-300">{sensor.temperature_celsius.toFixed(0)}°C</span>
                  </div>
                )) : <p className="px-1.5 py-2 text-[10px] text-on-surface-variant">Không tìm thấy cảm biến nhiệt độ.</p>}
              </div>
            </div>
          </div>
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
              extra={`(${mount.used_gb.toFixed(1)} / ${mount.total_gb.toFixed(1)} GiB)`}
            />
          ))}
        </div>
      </div>
    </WidgetFactory>
  );
});
