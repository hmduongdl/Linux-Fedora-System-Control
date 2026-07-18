import { Gamepad2, Monitor } from "lucide-react";
import { useSystemStore } from "../../store/useSystemStore";
import { WidgetFactory } from "./factory";

export function GameStatusWidget() {
  const session    = useSystemStore((s) => s.telemetry?.session);
  const runningGame = useSystemStore((s) => s.runningGame);

  const activeOutput = session?.active_output ?? "—";

  return (
    <WidgetFactory title="TRẠNG THÁI GAME">
      <div className="flex flex-col gap-[clamp(6px,0.8vh,8px)] text-[clamp(10px,1.1vh,11px)]">
        {/* Active display output — real from wlr-randr / xrandr */}
        <div className="flex items-center justify-between rounded border border-white/5 bg-black/20 p-[clamp(6px,0.8vh,10px)]">
          <div className="flex items-center gap-2 text-on-surface-variant">
            <Monitor size={12} />
            <span>Màn hình hiển thị</span>
          </div>
          <b className="text-primary truncate max-w-[120px] text-right">{activeOutput}</b>
        </div>

        {/* Current game or idle */}
        <div className={`flex items-center justify-between rounded border p-[clamp(6px,0.8vh,10px)] ${
          runningGame
            ? "border-emerald-400/30 bg-emerald-400/5"
            : "border-white/5 bg-black/20"
        }`}>
          <div className="flex items-center gap-2 text-on-surface-variant">
            <Gamepad2 size={12} className={runningGame ? "text-emerald-400" : "text-slate-600"} />
            <span>{runningGame ? "Game đang chạy" : "Cửa sổ hiện tại"}</span>
          </div>
          <b className={`truncate max-w-[120px] text-right ${runningGame ? "text-emerald-400" : "text-primary"}`}>
            {runningGame ? runningGame.name : "Desktop"}
          </b>
        </div>

        {/* Mic controls */}
        <div className="grid grid-cols-2 gap-[clamp(6px,0.8vh,8px)] pt-[clamp(2px,0.4vh,4px)]">
          <button className="rounded border border-primary/20 bg-primary/10 py-[clamp(6px,0.8vh,8px)] text-[clamp(9px,1.1vh,10px)] font-bold uppercase tracking-wider text-primary hover:bg-primary/20 transition-colors">
            BẬT MIC
          </button>
          <button className="rounded border border-white/10 bg-white/5 py-[clamp(6px,0.8vh,8px)] text-[clamp(9px,1.1vh,10px)] font-bold uppercase tracking-wider text-slate-400 hover:border-white/20 transition-colors">
            MUTE
          </button>
        </div>
      </div>
    </WidgetFactory>
  );
}
