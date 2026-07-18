import { useState } from "react";
import { Shield, Trash2 } from "lucide-react";
import { useSystemStore } from "../../store/useSystemStore";
import { WidgetFactory } from "./factory";

export function SystemOptimizationWidget() {
  const clearRam = useSystemStore((s) => s.clearRamCache);
  const cleanDisk = useSystemStore((s) => s.cleanDiskCache);
  const [busy, setBusy] = useState<"ram" | "disk" | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const runAction = async (kind: "ram" | "disk") => {
    setBusy(kind);
    setStatus(null);
    try {
      if (kind === "ram") await clearRam();
      else await cleanDisk();
      setStatus({ ok: true, message: kind === "ram" ? "Bộ nhớ đệm RAM đã được giải phóng." : "Bộ nhớ đệm ổ đĩa đã được dọn dẹp." });
    } catch (error) {
      setStatus({ ok: false, message: `Không thể hoàn tất thao tác: ${String(error)}` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <WidgetFactory title="TỐI ƯU HỆ THỐNG">
      <p className="text-[9px] leading-relaxed text-on-surface-variant">
        Dọn dẹp tài nguyên tạm thời khi cần thiết. Thao tác không ảnh hưởng đến tệp cá nhân.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={() => void runAction("ram")} disabled={busy !== null} className="flex items-center justify-center gap-1.5 rounded border border-white/10 bg-black/20 p-2 text-[9px] font-bold text-slate-400 transition-colors hover:border-cyan-accent/30 hover:text-cyan-accent disabled:cursor-wait disabled:opacity-50">
          <Trash2 size={12} /> {busy === "ram" ? "Đang xử lý…" : "Giải phóng RAM"}
        </button>
        <button onClick={() => void runAction("disk")} disabled={busy !== null} className="flex items-center justify-center gap-1.5 rounded border border-white/10 bg-black/20 p-2 text-[9px] font-bold text-slate-400 transition-colors hover:border-pink-accent/30 hover:text-pink-accent disabled:cursor-wait disabled:opacity-50">
          <Shield size={12} /> {busy === "disk" ? "Đang xử lý…" : "Dọn dẹp ổ đĩa"}
        </button>
      </div>
      {status && <div className={`mt-2 rounded border px-2 py-1.5 text-[8px] leading-normal break-words ${status.ok ? "border-emerald-500/15 bg-emerald-500/5 text-emerald-400" : "border-red-500/15 bg-red-500/5 text-red-400"}`}>{status.message}</div>}
    </WidgetFactory>
  );
}
