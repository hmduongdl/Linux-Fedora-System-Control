import { useSystemStore } from "../../store/useSystemStore";
import { WidgetFactory } from "./factory";

const COLOR_ORDER = ["bg-cyan-accent", "bg-primary", "bg-primary", "bg-primary", "bg-pink-accent", "bg-primary", "bg-primary", "bg-primary"];

export function TopProcessesWidget() {
  const processes = useSystemStore((s) => s.processes);

  return (
    <WidgetFactory title="TIẾN TRÌNH HÀNG ĐẦU">
      <div className="space-y-2.5">
        {processes.length === 0 ? (
          // Skeleton while loading
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton h-4 w-full rounded" />
          ))
        ) : (
          processes.map(({ name, mem_mb, mem_percent }, idx) => {
            const barWidth = Math.min(100, mem_percent);
            return (
              <div key={name + idx} className="flex items-center justify-between text-[10px]">
                <span className="w-28 truncate font-medium">{name}</span>
                <div className="flex flex-1 items-center justify-end gap-2">
                  <div className="w-20 flex-none">
                    <div className="h-1 overflow-hidden rounded-full bg-black/30">
                      <div
                        className={`h-full ${COLOR_ORDER[idx] ?? "bg-primary"}`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                  <span className="w-10 text-right font-mono">{mem_percent.toFixed(1)}%</span>
                  <span className="w-14 text-right font-mono text-on-surface-variant/60">
                    {mem_mb >= 1024
                      ? `${(mem_mb / 1024).toFixed(1)}G`
                      : `${mem_mb.toFixed(0)}M`}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </WidgetFactory>
  );
}
