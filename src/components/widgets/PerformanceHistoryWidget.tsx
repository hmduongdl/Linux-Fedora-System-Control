import { memo, useMemo } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { useSystemStore, type PerformanceHistoryPoint } from "../../store/useSystemStore";
import { WidgetFactory } from "./factory";

interface MetricSummary {
  label: string;
  color: string;
  current: string;
  max: string;
  average: string;
}

function summarize(
  history: PerformanceHistoryPoint[],
  key: "cpu_percent" | "ram_percent" | "latency_ms",
  label: string,
  color: string,
  unit: string,
): MetricSummary {
  const values = history.flatMap((point) => {
    const value = point[key];
    return value == null ? [] : [value];
  });
  const format = (value: number) => `${value.toFixed(0)}${unit}`;

  if (!values.length) {
    return { label, color, current: "—", max: "—", average: "—" };
  }

  const current = values.at(-1) ?? 0;
  const max = Math.max(...values);
  const average = values.reduce((total, value) => total + value, 0) / values.length;
  return { label, color, current: format(current), max: format(max), average: format(average) };
}

export const PerformanceHistoryWidget = memo(function PerformanceHistoryWidget() {
  const history = useSystemStore((state) => state.performanceHistory);
  const summaries = useMemo(() => [
    summarize(history, "cpu_percent", "CPU", "text-[#A855F7]", "%"),
    summarize(history, "ram_percent", "RAM", "text-[#EC4899]", "%"),
    summarize(history, "latency_ms", "Ping", "text-[#22D3EE]", " ms"),
  ], [history]);

  return (
    <WidgetFactory title="PERFORMANCE / HISTORY" className="flex-1 min-h-0 max-h-[280px]">
      {history.length ? (
        <div className="flex flex-col gap-3 md:flex-row flex-1 min-h-0">
          <div className="flex flex-col flex-1 min-h-0 min-w-0 rounded-md border border-[#292A3C] bg-[#0E0F16] px-1.5 py-1">
            <div className="flex items-center justify-between px-0.5 text-[10px] text-[#777797]">
              <span>CPU · RAM · PING</span>
              <span>Last {history.length}s</span>
            </div>
            <div className="flex-1 min-h-0 relative w-full h-[clamp(80px,12vh,128px)] mt-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 6, right: 4, bottom: 2, left: 0 }}>
                  <YAxis yAxisId="percent" domain={[0, 100]} hide />
                  <YAxis yAxisId="latency" hide />
                  <Tooltip
                    cursor={false}
                    contentStyle={{ background: "#12131C", border: "1px solid #3A3B4C", borderRadius: 6, fontSize: 10 }}
                    labelFormatter={() => ""}
                    formatter={(value, name) => {
                      const numericValue = Array.isArray(value) ? value[0] : value;
                      return [`${Number(numericValue ?? 0).toFixed(0)}${name === "Ping" ? " ms" : "%"}`, name];
                    }}
                  />
                  <Line yAxisId="percent" type="monotone" dataKey="cpu_percent" name="CPU" stroke="#A855F7" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line yAxisId="percent" type="monotone" dataKey="ram_percent" name="RAM" stroke="#EC4899" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line yAxisId="latency" type="monotone" dataKey="latency_ms" name="Ping" stroke="#22D3EE" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-[#292A3C] bg-[#0E0F16] text-[10px] md:w-[190px] shrink-0">
            <div className="grid grid-cols-[1fr_repeat(3,auto)] gap-x-2 border-b border-[#292A3C] px-2 py-1 uppercase tracking-wide text-[#777797]">
              <span>Metric</span><span>Now</span><span>Max</span><span>Avg</span>
            </div>
            {summaries.map((metric) => (
              <div key={metric.label} className="grid grid-cols-[1fr_repeat(3,auto)] gap-x-2 border-b border-[#292A3C] px-2 py-1.5 font-mono last:border-b-0">
                <span className={`font-sans font-medium ${metric.color}`}>{metric.label}</span>
                <span className="text-[#E5E7EB]">{metric.current}</span>
                <span className="text-[#AAAACC]">{metric.max}</span>
                <span className="text-[#777797]">{metric.average}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="skeleton h-36 w-full" />
      )}
    </WidgetFactory>
  );
});
