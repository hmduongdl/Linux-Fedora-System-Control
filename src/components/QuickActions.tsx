import { memo, useState } from "react";
import { Gamepad2, Trash2 } from "lucide-react";
import { useSystemStore } from "../store/useSystemStore";
import { WidgetFactory } from "./widgets/factory";

const QuickActions = memo(function QuickActions() {
  const active = useSystemStore((s) => s.controls.is_gamemode_active);
  const toggle = useSystemStore((s) => s.toggleGamemode);
  const clear  = useSystemStore((s) => s.clearRamCache);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const handleClear = async () => {
    setClearing(true);
    setClearError(null);
    try {
      await clear();
    } catch (error) {
      setClearError(String(error));
    } finally {
      setClearing(false);
    }
  };

  return (
    <WidgetFactory title="QUICK ACTIONS">
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => void toggle()}
          className={`flex items-center justify-center gap-2 rounded border p-3 text-[11px] font-bold transition-colors ${
            active
              ? "border-cyan-accent/50 bg-cyan-accent/10 text-cyan-accent"
              : "border-white/10 bg-black/20 text-slate-400 hover:border-cyan-accent/30"
          }`}
        >
          <Gamepad2 size={15} />
          GameMode
        </button>
        <button
          onClick={() => void handleClear()}
          disabled={clearing}
          className="flex items-center justify-center gap-2 rounded border border-white/10 bg-black/20 p-3 text-[11px] font-bold text-slate-400 hover:border-primary/30 transition-colors disabled:cursor-wait disabled:opacity-50"
        >
          <Trash2 size={15} />
          {clearing ? "Clearing…" : "Drop Cache"}
        </button>
      </div>
      {clearError && <p className="mt-2 break-words text-[9px] text-red-400">{clearError}</p>}
    </WidgetFactory>
  );
});

export default QuickActions;
