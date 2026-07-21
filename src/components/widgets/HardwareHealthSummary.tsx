import { useHardwareHealthStore } from "../../store/useHardwareHealthStore";
import type { OrphanDevice } from "../../types/schema";

export function HardwareHealthSummary() {
  const { orphanDevices, missingFirmware, firmwareStatus } = useHardwareHealthStore();

  const isGpuOrNetworkOrphan = (dev: OrphanDevice) => {
    const name = (dev.device_name || "").toLowerCase();
    const vendor = (dev.vendor_name || "").toLowerCase();
    const classId = (dev.class_id || "").toLowerCase();

    const isGpu =
      name.includes("nvidia") ||
      name.includes("radeon") ||
      name.includes("vga") ||
      name.includes("graphics") ||
      name.includes("amd gpu") ||
      classId.includes("0300");

    const isNetwork =
      name.includes("wireless") ||
      name.includes("wifi") ||
      name.includes("802.11") ||
      name.includes("wlan") ||
      name.includes("network") ||
      name.includes("ethernet") ||
      vendor.includes("broadcom") ||
      (vendor.includes("realtek") && name.includes("wireless"));

    return isGpu || isNetwork;
  };

  // Determine Severity Level
  const hasGpuOrNetworkIssue = orphanDevices.some(isGpuOrNetworkOrphan);
  const updatableCount = firmwareStatus?.update_count ?? 0;
  const hasAnyIssue = orphanDevices.length > 0 || missingFirmware.length > 0 || updatableCount > 0;

  let severity: "optimal" | "warning" | "critical" = "optimal";
  if (hasGpuOrNetworkIssue) {
    severity = "critical";
  } else if (hasAnyIssue) {
    severity = "warning";
  }

  const severityConfig = {
    critical: {
      color: "bg-red-500",
      text: "Cảnh báo nghiêm trọng: Thiếu driver đồ họa hoặc mạng",
      lightGlow: "shadow-[0_0_10px_rgba(239,68,68,0.4)]",
      textColor: "text-red-400",
      borderLeft: "border-l-red-500"
    },
    warning: {
      color: "bg-amber-500",
      text: "Cảnh báo: Có bản cập nhật firmware hoặc thiết bị ngoại vi thiếu driver",
      lightGlow: "shadow-[0_0_10px_rgba(245,158,11,0.4)]",
      textColor: "text-amber-400",
      borderLeft: "border-l-amber-500"
    },
    optimal: {
      color: "bg-emerald-500",
      text: "Hệ thống hoạt động tốt: Tất cả thiết bị đã được nhận diện đầy đủ",
      lightGlow: "shadow-[0_0_10px_rgba(16,185,129,0.4)]",
      textColor: "text-emerald-400",
      borderLeft: "border-l-emerald-500"
    }
  };

  const current = severityConfig[severity];

  return (
    <div className={`flex flex-col gap-2 p-3.5 rounded-xl border border-white/5 border-l-2 ${current.borderLeft} bg-[#0E0F16]/60 w-full transition-all duration-300`}>
      {/* Upper line: Status light and descriptive text */}
      <div className="flex items-center gap-2.5">
        <span className={`h-2 w-2 rounded-full ${current.color} ${current.lightGlow} shrink-0 animate-pulse`} />
        <span className={`text-[12px] font-bold uppercase tracking-wider ${current.textColor} leading-none`}>
          {current.text}
        </span>
      </div>

      {/* Visual health bar indicator */}
      <div className="relative h-1 w-full rounded-full bg-black/40 overflow-hidden border border-white/5">
        <div
          className={`h-full ${current.color} rounded-full transition-all duration-500`}
          style={{
            width: severity === "optimal" ? "100%" : severity === "warning" ? "65%" : "30%"
          }}
        />
      </div>

      {/* Device summary counters under health bar */}
      <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-0.5">
        <span>Thiếu driver: {orphanDevices.length}</span>
        <span>Cập nhật firmware: {updatableCount}</span>
        <span>Lỗi tải firmware: {missingFirmware.length}</span>
      </div>
    </div>
  );
}
