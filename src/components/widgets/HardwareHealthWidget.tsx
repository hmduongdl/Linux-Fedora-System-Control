import { useState, useEffect } from "react";
import {
  Cpu,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  ArrowRight,
  Lock,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Usb,
  ShieldAlert
} from "lucide-react";
import { useHardwareHealthStore } from "../../store/useHardwareHealthStore";
import { HardwareHealthSummary } from "./HardwareHealthSummary";
import { invoke } from "@tauri-apps/api/core";
import type { OrphanDevice, DriverRecommendation } from "../../types/schema";

export function HardwareHealthWidget() {
  const {
    orphanDevices,
    missingFirmware,
    firmwareStatus,
    isLoading,
    fetchHardwareHealth,
    installFirmware,
  } = useHardwareHealthStore();

  const [activeTab, setActiveTab] = useState<"orphans" | "updates" | "missing">("orphans");
  const [recommendations, setRecommendations] = useState<Record<string, DriverRecommendation | null>>({});
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({});

  // Fwupd installation states
  const [updatingIds, setUpdatingIds] = useState<string[]>([]);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "running" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch recommendations for orphan devices when they change
  useEffect(() => {
    const fetchRecs = async () => {
      setLoadingRecs(true);
      try {
        const results = await Promise.all(
          orphanDevices.map(async (dev) => {
            const key = `${dev.bus}-${dev.vendor_id}-${dev.device_id}`;
            try {
              const rec = await invoke<DriverRecommendation | null>("get_driver_recommendation", { device: dev });
              return { key, rec };
            } catch (err) {
              console.error(`Error loading rec for ${key}:`, err);
              return { key, rec: null };
            }
          })
        );
        const nextRecs: Record<string, DriverRecommendation | null> = {};
        for (const res of results) {
          nextRecs[res.key] = res.rec;
        }
        setRecommendations(nextRecs);
      } catch (err) {
        console.error("Failed to load driver recommendations:", err);
      } finally {
        setLoadingRecs(false);
      }
    };

    if (orphanDevices.length > 0) {
      void fetchRecs();
    } else {
      setRecommendations({});
    }
  }, [orphanDevices]);

  // Copy command helper with toast
  const handleCopyCommand = (command: string, id: string, name: string) => {
    void navigator.clipboard.writeText(command);
    setToastMessage(`Đã sao chép lệnh cài đặt cho ${name}`);
    setCopiedMap((prev) => ({ ...prev, [id]: true }));
    setTimeout(() => {
      setToastMessage(null);
      setCopiedMap((prev) => ({ ...prev, [id]: false }));
    }, 2000);
  };

  // fwupd flash update handler
  const handleUpdateFirmware = async (ids: string[]) => {
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

  const formatTimeAgo = (epochSecs: number) => {
    if (epochSecs === 0) return "Không xác định";
    const seconds = Math.floor(Date.now() / 1000 - epochSecs);
    if (seconds < 60) return "vừa xong";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} phút trước`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} giờ trước`;
    const days = Math.floor(hours / 24);
    return `${days} ngày trước`;
  };

  const isFlashing = updateStatus === "running";
  const updatableCount = firmwareStatus?.update_count ?? 0;
  const updatableDevices = firmwareStatus?.devices.filter((d) => d.update_version) ?? [];

  const getDeviceIcon = (dev: OrphanDevice) => {
    const name = (dev.device_name || "").toLowerCase();
    const vendor = (dev.vendor_name || "").toLowerCase();
    const classId = (dev.class_id || "").toLowerCase();

    if (
      name.includes("nvidia") ||
      name.includes("radeon") ||
      name.includes("vga") ||
      name.includes("graphics") ||
      name.includes("amd gpu") ||
      classId.includes("0300")
    ) {
      return <Cpu className="text-red-400" size={14} />;
    }
    if (
      name.includes("wireless") ||
      name.includes("wifi") ||
      name.includes("802.11") ||
      name.includes("wlan") ||
      name.includes("network") ||
      name.includes("ethernet") ||
      vendor.includes("broadcom") ||
      (vendor.includes("realtek") && name.includes("wireless"))
    ) {
      return <ExternalLink className="text-red-400" size={14} />;
    }
    if (
      name.includes("sata") ||
      name.includes("nvme") ||
      name.includes("storage") ||
      name.includes("ssd") ||
      classId.includes("0106") ||
      classId.includes("0108")
    ) {
      return <ShieldAlert className="text-red-400" size={14} />;
    }
    if (dev.bus === "usb") {
      return <Usb className="text-slate-400" size={14} />;
    }
    return <Cpu className="text-[#C4B5FD]" size={14} />;
  };

  const hasNoRecsCount = orphanDevices.filter((d) => {
    const key = `${d.bus}-${d.vendor_id}-${d.device_id}`;
    return !recommendations[key];
  }).length;

  return (
    <div className="adaptive-card glass-panel flex flex-col p-3 gap-2.5 relative overflow-hidden">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="absolute top-3 right-3 z-50 flex items-center gap-2 rounded-lg bg-emerald-500/90 text-white border border-emerald-400/20 px-3 py-1.5 shadow-2xl backdrop-blur-md animate-in fade-in duration-200">
          <Check size={13} className="animate-bounce shrink-0" />
          <span className="text-[12px] font-bold tracking-wide uppercase">{toastMessage}</span>
        </div>
      )}

      {/* Header section */}
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <h3 className="header-small-caps flex items-center gap-2 text-[13px] md:text-[14px] text-primary font-bold">
          <Cpu size={15} strokeWidth={2} />
          CHẨN ĐOÁN PHẦN CỨNG
        </h3>

        <button
          onClick={() => void fetchHardwareHealth()}
          disabled={isLoading || isFlashing}
          className="text-slate-500 hover:text-slate-300 transition-colors p-1 disabled:opacity-50"
          title="Quét lại"
        >
          <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Health Status Summary Bar */}
      <HardwareHealthSummary />

      {/* TABBED CONTROLS */}
      <div className="flex gap-1 bg-black/40 rounded-lg p-1 border border-white/5">
        {[
          { id: "orphans" as const, label: "Thiếu driver", count: orphanDevices.length, color: "text-[#c4b5fd]" },
          { id: "updates" as const, label: "Cập nhật firmware", count: updatableCount, color: "text-[#86efac]" },
          { id: "missing" as const, label: "Nhật ký firmware", count: missingFirmware.length, color: "text-pink-300" }
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1 rounded-md text-[12px] font-bold tracking-wide transition-all uppercase border ${
                isActive
                  ? "bg-primary/20 text-[#c4b5fd] border-primary/30 shadow-inner"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200 border-transparent"
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className={`rounded-full bg-white/10 px-1.5 py-0.2 text-[11px] font-mono font-bold ${tab.color}`}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* TAB CONTENT BODY */}
      <div className="min-h-[180px] max-h-[360px] overflow-y-auto custom-scrollbar pr-1">
        {/* Loading Skeleton State */}
        {isLoading && (
          <div className="space-y-2 py-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 rounded-lg border border-white/5 bg-[#0E0F16]/45 animate-pulse" />
            ))}
          </div>
        )}

        {/* Normal Content State */}
        {!isLoading && (
          <div>
            {/* TAB: ORPHAN DEVICES */}
            {activeTab === "orphans" && (
              <div>
                {orphanDevices.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center py-6 px-4">
                    <CheckCircle2 size={32} className="text-emerald-400 mb-2" />
                    <h4 className="text-[13px] font-bold text-slate-200 uppercase tracking-wide">Tất cả thiết bị đã sẵn sàng</h4>
                    <p className="text-[12px] text-slate-400 mt-1">Tất cả thiết bị PCI/USB đều đã có driver.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {/* Global summary hint if many devices lack auto-recommendations */}
                    {hasNoRecsCount > 0 && (
                      <div className="text-[12px] text-amber-400/90 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 mb-2">
                        <span>
                          <b>{hasNoRecsCount}/{orphanDevices.length}</b> thiết bị chưa có gói driver đề xuất — nhấn Search để tìm kiếm thủ công.
                        </span>
                      </div>
                    )}

                    {/* DENSE ORPHAN DEVICE ROWS */}
                    {orphanDevices.map((dev) => {
                      const devKey = `${dev.bus}-${dev.vendor_id}-${dev.device_id}`;
                      const rec = recommendations[devKey];
                      const name = dev.device_name || `Thiết bị ${dev.device_id}`;
                      const vendor = dev.vendor_name || `Vendor ${dev.vendor_id}`;

                      return (
                        <div
                          key={devKey}
                          className="rounded-lg border border-white/5 bg-[#0E0F16]/60 px-2.5 py-2 flex flex-col gap-1.5 hover:border-primary/30 transition-all"
                        >
                          <div className="flex items-center justify-between gap-2.5">
                            {/* Device Name + Vendor */}
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <div className="shrink-0 rounded bg-white/5 p-1 border border-white/5">
                                {getDeviceIcon(dev)}
                              </div>
                              <div className="min-w-0 truncate">
                                <span className="text-[13.5px] font-bold text-slate-200 truncate">{name}</span>
                                <span className="text-[12px] text-slate-400 ml-1.5">· {vendor}</span>
                              </div>
                            </div>

                            {/* PCI ID / Bus */}
                            <span className="text-[12px] font-mono text-slate-400 bg-black/30 px-1.5 py-0.5 rounded border border-white/5 shrink-0">
                              {dev.bus.toUpperCase()} {dev.vendor_id}:{dev.device_id}
                            </span>
                          </div>

                          {/* Recommendation & Action Row */}
                          {loadingRecs && !rec ? (
                            <div className="text-[11.5px] text-slate-400 italic animate-pulse">Đang tìm driver...</div>
                          ) : rec ? (
                            <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/5">
                              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                <span className="text-[11.5px] text-slate-400 truncate">{rec.description}</span>
                                <span className="text-[12px] font-mono text-[#C4B5FD] bg-white/5 border border-white/5 px-1.5 py-0.5 rounded shrink-0">
                                  {rec.packages.join(", ")}
                                </span>
                              </div>
                              <button
                                onClick={() => handleCopyCommand(rec.installCommand, devKey, name)}
                                className="shrink-0 flex items-center gap-1 rounded bg-primary/15 border border-primary/30 hover:bg-primary/25 px-2 py-0.5 text-[11.5px] font-bold text-[#c4b5fd] transition-all active:scale-95"
                              >
                                {copiedMap[devKey] ? <Check size={10} /> : <Copy size={10} />}
                                Copy lệnh
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between text-[12px] pt-1 border-t border-white/5">
                              <span className="text-slate-400">Thiếu driver PCI/USB</span>
                              <a
                                href={`https://linux-hardware.org/?id=${dev.vendor_id}:${dev.device_id}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded transition-all"
                              >
                                Tra cứu trực tuyến <ExternalLink size={10} />
                              </a>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB: FIRMWARE UPDATES */}
            {activeTab === "updates" && (
              <div>
                {!firmwareStatus?.available ? (
                  <div className="rounded-lg border border-white/5 border-l-2 border-l-pink-500 bg-[#0E0F16]/60 p-3 text-[12.5px] leading-relaxed text-slate-400">
                    <p className="font-bold text-[#c4b5fd] flex items-center gap-1.5 mb-1">
                      <AlertTriangle size={13} /> Chưa cài đặt trình quản lý firmware (fwupd)
                    </p>
                    <p>Không tìm thấy gói <code className="bg-white/5 px-1 py-0.5 rounded text-[#c4b5fd] font-mono text-[12px]">fwupd</code> trên hệ thống.</p>
                  </div>
                ) : !firmwareStatus?.daemon_running ? (
                  <div className="rounded-lg border border-white/5 border-l-2 border-l-amber-500 bg-[#0E0F16]/60 p-3 text-[12.5px] leading-relaxed text-slate-400">
                    <p className="font-bold text-amber-400 flex items-center gap-1.5 mb-1">
                      <AlertTriangle size={13} /> Dịch vụ nền fwupd chưa hoạt động
                    </p>
                    <p>Dịch vụ fwupd chưa được khởi động. Hãy chạy lệnh <code className="bg-white/5 px-1 py-0.5 rounded text-amber-400 font-mono text-[12px]">sudo systemctl start fwupd</code>.</p>
                  </div>
                ) : (
                  <div>
                    {updateStatus === "success" && (
                      <div className="mb-2 rounded-lg border border-emerald-500/10 bg-emerald-500/5 p-2 text-[12px] text-emerald-400">
                        ✓ Đã cài đặt firmware thành công! Thay đổi sẽ có hiệu lực sau khi khởi động lại.
                      </div>
                    )}
                    {updateStatus === "error" && errorMessage && (
                      <div className="mb-2 rounded-lg border border-white/5 border-l-2 border-l-red-500 bg-[#0E0F16]/60 p-2 text-[12px] text-pink-400">
                        Lỗi cập nhật: {errorMessage}
                      </div>
                    )}

                    {isFlashing && (
                      <div className="mb-2 rounded-lg border border-white/5 border-l-2 border-l-cyan-500 bg-[#0E0F16]/60 p-2 text-[12px] text-cyan-300 flex items-center gap-2 animate-pulse">
                        <Loader2 size={13} className="animate-spin shrink-0" />
                        <span>Đang cài đặt firmware... Vui lòng nhập mật khẩu quản trị khi được yêu cầu bởi Polkit.</span>
                      </div>
                    )}

                    {updatableDevices.length === 0 ? (
                      <div className="flex flex-col items-center justify-center text-center py-6 px-4">
                        <CheckCircle2 size={32} className="text-emerald-400 mb-2" />
                        <h4 className="text-[13px] font-bold text-slate-200 uppercase tracking-wide">Firmware đã cập nhật</h4>
                        <p className="text-[12px] text-slate-400 mt-1">Không có bản cập nhật firmware nào.</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {updatableDevices.map((dev) => {
                          const isDeviceFlashing = updatingIds.includes(dev.device_id);
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

                              <div className="flex items-center gap-2 shrink-0">
                                <div className="flex items-center gap-1 text-[12px] font-mono text-slate-300 bg-black/30 px-1.5 py-0.5 rounded border border-white/5">
                                  <span>v{dev.current_version}</span>
                                  <ArrowRight size={9} className="text-slate-500" />
                                  <span className="font-bold text-emerald-400">v{dev.update_version}</span>
                                </div>

                                <button
                                  onClick={() => void handleUpdateFirmware([dev.device_id])}
                                  disabled={isFlashing || isLoading}
                                  className="flex items-center gap-1 rounded bg-primary/15 border border-primary/30 hover:bg-primary/25 px-2 py-1 text-[11.5px] font-bold text-[#c4b5fd] transition-all active:scale-95 disabled:opacity-50"
                                >
                                  {isDeviceFlashing ? <Loader2 size={10} className="animate-spin" /> : <Lock size={10} />}
                                  Update
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* TAB: MISSING FIRMWARE LOGS */}
            {activeTab === "missing" && (
              <div>
                {missingFirmware.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center py-6 px-4">
                    <CheckCircle2 size={32} className="text-emerald-400 mb-2" />
                    <h4 className="text-[13px] font-bold text-slate-200 uppercase tracking-wide">Nhật ký kernel bình thường</h4>
                    <p className="text-[12px] text-slate-400 mt-1">Không có cảnh báo thiếu firmware nào trong 24 giờ qua.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-[12px] text-slate-400 mb-1">
                      Cảnh báo lỗi tải firmware từ nhật ký kernel:
                    </p>
                    {missingFirmware.map((fw, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-white/5 border-l-2 border-l-pink-500/70 bg-[#0E0F16]/60 px-2.5 py-2 text-[12px] flex items-center justify-between gap-2"
                      >
                        <span className="text-slate-200 font-mono break-all font-semibold select-all">
                          {fw.firmware_path}
                          {fw.kernel_module && (
                            <span className="ml-1 text-[11px] text-pink-300 font-normal">[{fw.kernel_module}]</span>
                          )}
                        </span>
                        <span className="shrink-0 text-slate-400 font-mono text-[11px]">
                          {formatTimeAgo(fw.timestamp)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
