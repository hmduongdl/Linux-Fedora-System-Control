import { useState } from "react";
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  ShieldAlert,
  Loader2,
  Lock,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { useHardwareHealthStore } from "../../store/useHardwareHealthStore";

function timeAgo(epochSecs: number) {
  if (epochSecs === 0) return "Không xác định";
  const s = Math.floor(Date.now() / 1000 - epochSecs);
  if (s < 60) return "vừa xong";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  return `${Math.floor(h / 24)} ngày trước`;
}

export function FirmwareUpdateList() {
  const {
    firmwareStatus,
    missingFirmware,
    isLoading,
    installFirmware,
    fetchHardwareHealth,
  } = useHardwareHealthStore();

  const [updatingIds, setUpdatingIds] = useState<string[]>([]);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "running" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showKernelLogs, setShowKernelLogs] = useState(false);

  const updatableDevices = firmwareStatus?.devices.filter((d) => d.update_version) ?? [];

  const handleUpdate = async (ids: string[]) => {
    if (ids.length === 0) return;
    setUpdatingIds(ids);
    setUpdateStatus("running");
    setErrorMessage(null);
    try {
      await installFirmware(ids);
      setUpdateStatus("success");
      setUpdatingIds([]);
    } catch (err: any) {
      setUpdateStatus("error");
      setErrorMessage(err?.message || String(err) || "Lỗi cập nhật firmware");
      setUpdatingIds([]);
    }
  };

  const isFlashing = updateStatus === "running";

  return (
    <div className="adaptive-card glass-panel flex flex-col p-3 gap-2.5 relative overflow-hidden">
      {/* Header section */}
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <h3 className="header-small-caps flex items-center gap-2 text-[13px] md:text-[14px] text-primary font-bold">
          <ShieldAlert size={15} strokeWidth={2} />
          CẬP NHẬT FIRMWARE HỆ THỐNG
        </h3>

        {/* Rescan and Update All Actions */}
        <div className="flex items-center gap-2">
          {updatableDevices.length > 0 && (
            <button
              onClick={() => void handleUpdate(updatableDevices.map((d) => d.device_id))}
              disabled={isFlashing || isLoading}
              className="flex items-center gap-1.5 rounded-md bg-primary/15 border border-primary/30 hover:bg-primary/25 px-2.5 py-0.5 text-[12px] font-bold text-[#c4b5fd] transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isFlashing && updatingIds.length > 1 ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Lock size={11} />
              )}
              Cập nhật tất cả ({updatableDevices.length})
            </button>
          )}

          <button
            onClick={() => void fetchHardwareHealth()}
            disabled={isFlashing || isLoading}
            className="text-slate-500 hover:text-slate-300 transition-colors p-1 disabled:opacity-50"
            title="Quét lại"
          >
            <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Main Flash Status Feedback */}
      {isFlashing && (
        <div className="rounded-lg border border-white/5 border-l-2 border-l-cyan-500 bg-[#0E0F16]/60 p-2.5 flex items-start gap-2 text-[12.5px] text-cyan-300 animate-pulse">
          <Loader2 size={14} className="animate-spin shrink-0 mt-0.5" />
          <div>
            <strong>Đang cài đặt bản cập nhật...</strong> Vui lòng nhập mật khẩu quản trị khi được yêu cầu bởi Polkit.
          </div>
        </div>
      )}

      {updateStatus === "success" && (
        <div className="rounded-lg border border-emerald-500/10 bg-emerald-500/5 p-2 flex items-center gap-2 text-[12.5px] text-emerald-400">
          <CheckCircle2 size={14} className="shrink-0" />
          <div>Cập nhật hoàn tất! Thiết bị sẽ áp dụng phiên bản mới sau khi khởi động lại.</div>
        </div>
      )}

      {updateStatus === "error" && errorMessage && (
        <div className="rounded-lg border border-white/5 border-l-2 border-l-red-500 bg-[#0E0F16]/60 p-2 text-[12.5px] text-pink-400">
          <AlertTriangle size={14} className="shrink-0 mt-0.5 inline mr-1" />
          <span>Lỗi cập nhật: {errorMessage}</span>
        </div>
      )}

      {/* Device List content */}
      {!firmwareStatus?.available ? (
        <div className="rounded-lg border border-white/5 border-l-2 border-l-pink-500 bg-[#0E0F16]/60 p-3 text-[12.5px] text-slate-400">
          <p className="font-bold text-[#c4b5fd] flex items-center gap-1.5 mb-1">
            <AlertTriangle size={13} /> Chưa cài đặt trình quản lý firmware (fwupd)
          </p>
          <p className="leading-relaxed">
            Dịch vụ quản lý firmware LVFS/fwupd chưa sẵn sàng. Vui lòng cài đặt gói <code className="bg-white/5 px-1 py-0.5 rounded text-[#c4b5fd] font-mono text-[12px]">fwupd</code>.
          </p>
        </div>
      ) : !firmwareStatus?.daemon_running ? (
        <div className="rounded-lg border border-white/5 border-l-2 border-l-amber-500 bg-[#0E0F16]/60 p-3 text-[12.5px] text-slate-400">
          <p className="font-bold text-amber-400 flex items-center gap-1.5 mb-1">
            <AlertTriangle size={13} /> Dịch vụ fwupd chưa được khởi động
          </p>
          <p className="leading-relaxed">
            Dịch vụ fwupd chưa được khởi động. Hãy chạy lệnh <code className="bg-white/5 px-1 py-0.5 rounded text-amber-400 font-mono text-[12px]">sudo systemctl start fwupd</code>.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Available Updates Block */}
          {updatableDevices.length === 0 ? (
            <div className="rounded-lg border border-emerald-500/10 bg-emerald-500/5 p-2.5 flex items-center gap-2.5">
              <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
              <div className="text-[12.5px]">
                <div className="font-bold text-slate-200 uppercase tracking-wide text-[12px]">Firmware đã cập nhật</div>
                <div className="text-slate-400 text-[12px]">Không có bản cập nhật firmware nào.</div>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="text-[12px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                Bản cập nhật có sẵn ({updatableDevices.length})
              </div>
              <div className="max-h-[300px] overflow-y-auto custom-scrollbar pr-1 space-y-1.5">
                {updatableDevices.map((dev) => {
                  const isDeviceUpdating = updatingIds.includes(dev.device_id);
                  return (
                    <div
                      key={dev.device_id}
                      className="h-[44px] rounded-lg border border-white/5 bg-[#0E0F16]/60 px-2.5 py-1.5 flex items-center justify-between gap-2.5 hover:border-primary/30 transition-all"
                    >
                      <div className="min-w-0 flex-1 truncate">
                        <div className="text-[13.5px] font-bold text-slate-200 truncate">
                          {dev.name}
                          <span className="text-[12px] text-slate-400 font-normal ml-1.5">· {dev.vendor}</span>
                        </div>
                      </div>

                      {dev.update_urgent && (
                        <span className="flex shrink-0 items-center gap-1 rounded bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-red-400 animate-pulse">
                          <ShieldAlert size={9} /> Khẩn cấp
                        </span>
                      )}

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center gap-1 text-[12px] font-mono text-slate-300 bg-black/30 px-1.5 py-0.5 rounded border border-white/5">
                          <span>v{dev.current_version}</span>
                          <ArrowRight size={9} className="text-slate-500" />
                          <span className="font-bold text-emerald-400">v{dev.update_version}</span>
                        </div>

                        <button
                          onClick={() => void handleUpdate([dev.device_id])}
                          disabled={isFlashing || isLoading}
                          className="flex items-center gap-1 rounded bg-primary/15 border border-primary/30 hover:bg-primary/25 px-2 py-1 text-[11.5px] font-bold text-[#c4b5fd] transition-all active:scale-95 disabled:opacity-50"
                        >
                          {isDeviceUpdating ? <Loader2 size={10} className="animate-spin" /> : <Lock size={10} />}
                          Update
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      )}

      {/* Missing Firmware Kernel Logs — collapsed by default */}
      {missingFirmware.length > 0 && (
        <div className="border-t border-white/5 pt-2">
          <button
            onClick={() => setShowKernelLogs(!showKernelLogs)}
            className="w-full flex items-center justify-between text-[12px] font-bold text-amber-400/90 uppercase tracking-wider py-0.5 hover:text-amber-300 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <ShieldAlert size={12} />
              Cảnh báo nhật ký kernel ({missingFirmware.length})
            </span>
            {showKernelLogs ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {showKernelLogs && (
            <div className="mt-1.5 space-y-1.5 max-h-[160px] overflow-y-auto custom-scrollbar pr-1">
              <p className="text-[11.5px] text-slate-400 mb-1">
                Firmware bị kernel báo lỗi khi tải trong 24 giờ qua — cài gói <code className="text-[#C4B5FD] font-mono">linux-firmware</code> để khắc phục.
              </p>
              {missingFirmware.map((fw, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-white/5 border-l-2 border-l-amber-500/60 bg-[#0E0F16]/60 px-2.5 py-1.5 flex items-center justify-between gap-2 text-[12px]"
                >
                  <span className="text-slate-200 font-mono break-all font-semibold select-all">
                    {fw.firmware_path}
                    {fw.kernel_module && (
                      <span className="ml-1 text-[11px] text-amber-400/75">[{fw.kernel_module}]</span>
                    )}
                  </span>
                  <span className="shrink-0 text-slate-400 font-mono text-[11px]">
                    {timeAgo(fw.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}