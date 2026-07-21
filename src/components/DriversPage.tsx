import { useEffect, useRef } from "react";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { useHardwareHealthStore } from "../store/useHardwareHealthStore";
import { HardwareHealthWidget } from "./widgets/HardwareHealthWidget";
import { FirmwareUpdateList } from "./widgets/FirmwareUpdateList";
import { OrphanDeviceList } from "./widgets/OrphanDeviceList";

export default function DriversPage({ fullscreen = false }: { fullscreen?: boolean }) {
  const mainRef = useRef<HTMLElement>(null);
  const didFetch = useRef(false);

  const { firmwareStatus, orphanDevices, isLoading, error, fetchHardwareHealth } = useHardwareHealthStore();

  useEffect(() => {
    if (!didFetch.current) {
      didFetch.current = true;
      fetchHardwareHealth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const missingDriverCount = orphanDevices.length;

  return (
    <main
      ref={mainRef}
      className={`drivers-page${fullscreen ? " drivers-page-fullscreen" : ""}`}
    >
      <div className="drivers-layout">
        {/* MISSING DRIVER WARNING */}
        {!isLoading && missingDriverCount > 0 && (
          <div className="drivers-error-banner border-amber-500/30 bg-amber-500/10 text-amber-300">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <div className="leading-relaxed text-[12px]">
              <span className="font-bold">Phát hiện {missingDriverCount} thiết bị thiếu driver!</span> Truy cập tab "Thiếu driver" trong mục Chẩn đoán phần cứng để xem chi tiết và cài đặt.
            </div>
          </div>
        )}

        {/* ERROR ALERT */}
        {error && (
          <div className="drivers-error-banner">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <div className="leading-relaxed text-[12px]">
              <span className="font-bold">Lỗi khi quét phần cứng:</span> {error}
            </div>
          </div>
        )}

        {/* INLINE LOADING SKELETON */}
        {isLoading && !firmwareStatus && (
          <div className="col-span-full mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-white/5 bg-[#0E0F16]/45 p-4 animate-pulse">
                  <div className="h-4 w-4 rounded bg-white/10 mb-3" />
                  <div className="h-3 w-12 rounded bg-white/5 mb-2" />
                  <div className="h-5 w-8 rounded bg-white/10" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cột 1: Cập nhật firmware & Chẩn đoán phần cứng */}
        <div className="drivers-col drivers-col-left">
          <FirmwareUpdateList />
          <HardwareHealthWidget />
        </div>

        {/* Cột 2: Danh sách thiết bị & Trình điều khiển */}
        <div className="drivers-col drivers-col-right">
          <OrphanDeviceList />
        </div>
      </div>
    </main>
  );
}
