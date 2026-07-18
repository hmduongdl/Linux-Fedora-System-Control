import { useEffect, useRef, useState, memo } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { useSystemStore } from "../../store/useSystemStore";
import { MetricBar } from "../ui/MetricBar";

interface GpuPoint { time: number; usage: number; }

export const GpuWidget = memo(function GpuWidget() {
  const telemetry = useSystemStore((s) => s.telemetry);
  const gpus = telemetry?.gpus;
  const [history, setHistory] = useState<Record<string, GpuPoint[]>>({});
  const lastTs = useRef(0);

  useEffect(() => {
    if (!telemetry || telemetry.timestamp_ms === lastTs.current) return;
    lastTs.current = telemetry.timestamp_ms;
    setHistory((prev) => {
      const next = { ...prev };
      telemetry.gpus.forEach((gpu) => { next[gpu.name] = [...(next[gpu.name] ?? []), { time: telemetry.timestamp_ms, usage: gpu.usage_percent }].slice(-30); });
      return next;
    });
  }, [telemetry]);

  if (!gpus || gpus.length === 0) return null;
  return <section className="glass-panel h-full p-2">
    <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[#A855F7] mb-2">GPU / GRAPHICS</h2>
    <div className="space-y-2">{gpus.map((gpu) => {
      const points = history[gpu.name]?.length ? history[gpu.name] : [{ time: 0, usage: gpu.usage_percent }];
      return <div key={gpu.name} className="rounded-md border border-[#292A3C] bg-[#0E0F16] p-2">
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate text-[11px] text-[#C5C5DA]">{gpu.name}</div><div className="mt-1 text-[24px] font-medium leading-none text-[#E9D5FF]">{gpu.usage_percent.toFixed(0)}<span className="text-sm text-[#A855F7]">%</span></div></div><div className="text-right text-[10px] text-[#777797]">Temp<br /><span className="font-mono text-[#D9D9EA]">{gpu.temperature_celsius == null ? "—" : `${gpu.temperature_celsius.toFixed(0)}°C`}</span></div></div>
        <div className="mt-2 space-y-1.5"><MetricBar label="GPU" value={gpu.usage_percent} max={100} unit="%" colorClass="bg-[#8B5CF6]" /><MetricBar label="VRAM" value={gpu.memory_used_mb} max={gpu.memory_total_mb} unit=" MB" colorClass="bg-[#EC4899]" /></div>
        <div className="mt-2 border-t border-[#292A3C] pt-1"><ResponsiveContainer width="100%" height={40}><AreaChart data={points} margin={{ top: 3, right: 0, bottom: 2, left: 0 }}><defs><linearGradient id={`gpuGrad-${gpu.name.replace(/[^a-zA-Z0-9]/g, "")}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.4} /><stop offset="100%" stopColor="#8B5CF6" stopOpacity={0.02} /></linearGradient></defs><Area type="monotone" dataKey="usage" stroke="#8B5CF6" strokeWidth={1.5} fill={`url(#gpuGrad-${gpu.name.replace(/[^a-zA-Z0-9]/g, "")})`} isAnimationActive={false} dot={false} /></AreaChart></ResponsiveContainer></div>
      </div>;
    })}</div>
  </section>;
});
