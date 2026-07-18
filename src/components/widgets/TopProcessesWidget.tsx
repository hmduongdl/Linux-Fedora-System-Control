import { useSystemStore } from "../../store/useSystemStore";
import { WidgetFactory } from "./factory";

const COLOR_ORDER = ["bg-cyan-accent", "bg-primary", "bg-primary", "bg-primary", "bg-pink-accent", "bg-primary", "bg-primary", "bg-primary"];

export function TopProcessesWidget() {
  const processes = useSystemStore((s) => s.processes);
  return (
    <WidgetFactory title="ỨNG DỤNG DÙNG RAM">
      <div className="space-y-2.5">
        {processes.length === 0 ? (
          // Skeleton while loading
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton h-4 w-full rounded" />
          ))
        ) : (
          processes.map(({ pid, name, process_count, mem_mb, mem_percent }, idx) => {
            const largestUsage = processes[0]?.mem_percent || 1;
            const barWidth = Math.min(100, (mem_percent / largestUsage) * 100);
            return (
              <div key={`${name}-${pid}`} className="flex items-center justify-between text-[10px]">
                <span className="flex w-32 min-w-0 items-center gap-1.5 font-medium">
                  <span className="truncate">{name}</span>
                  {process_count > 1 && (
                    <span className="flex-none rounded bg-primary/10 px-1 text-[8px] text-primary">
                      ×{process_count}
                    </span>
                  )}
                </span>
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
                  <span
                    className="w-16 text-right font-mono text-on-surface-variant/60"
                    title="RAM ước tính, đã loại phần bộ nhớ chia sẻ bị đếm lặp"
                  >
                    {mem_mb >= 1024
                      ? `${(mem_mb / 1024).toFixed(1)} GiB`
                      : `${mem_mb.toFixed(0)} MiB`}
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
