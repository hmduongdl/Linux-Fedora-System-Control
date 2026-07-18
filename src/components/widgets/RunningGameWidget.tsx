import { Flame } from "lucide-react";
import { useSystemStore } from "../../store/useSystemStore";
import { WidgetFactory } from "./factory";

export function RunningGameWidget() {
  const game = useSystemStore((s) => s.runningGame);
  const gpu  = useSystemStore((s) => s.telemetry?.gpus[0]);

  const vramUsedGb  = gpu ? (gpu.memory_used_mb / 1024).toFixed(1) : "—";
  const vramTotalGb = gpu ? (gpu.memory_total_mb / 1024).toFixed(1) : "—";
  const vram        = gpu ? `${vramUsedGb}/${vramTotalGb} GB` : "—";
  const gpuTemp     = gpu?.temperature_celsius != null
    ? `${gpu.temperature_celsius.toFixed(0)} °C`
    : "—";

  return (
    <WidgetFactory title="TRÒ CHƠI ĐANG CHẠY">
      {game ? (
        <div className="flex gap-4">
          {/* Game icon placeholder */}
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-pink-accent/20 bg-black/30">
            <Flame size={22} className="text-pink-accent" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate">{game.name}</p>
            <p className="font-mono text-[10px] text-on-surface-variant">
              PID {game.pid} · CPU {game.cpu_percent.toFixed(1)}%
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded border border-white/5 bg-black/30 p-2">
                <p className="text-[8px] uppercase text-on-surface-variant">GPU Temp</p>
                <p className="font-mono text-[10px] font-bold">{gpuTemp}</p>
              </div>
              <div className="rounded border border-white/5 bg-black/30 p-2">
                <p className="text-[8px] uppercase text-on-surface-variant">VRAM</p>
                <p className="font-mono text-[10px] font-bold">{vram}</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded border border-white/5 bg-black/20 p-3">
          <Flame size={20} className="shrink-0 text-pink-accent/30" />
          <div>
            <p className="text-xs font-bold text-on-surface-variant">Không phát hiện game</p>
            <p className="text-[9px] text-slate-500">
              GPU: {gpu ? `${(gpu.usage_percent ?? 0).toFixed(0)}%` : "—"} ·
              VRAM: {vram}
            </p>
          </div>
        </div>
      )}
    </WidgetFactory>
  );
}
