import { useState } from "react";
import {
  Cpu,
  RefreshCw,
  HardDrive,
  MemoryStick,
  Wifi,
  Zap,
  Activity,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { useHardwareHealthStore } from "../../store/useHardwareHealthStore";
import type { FullHardwareDevice } from "../../types/schema";

export function OrphanDeviceList() {
  const {
    fullHardwareDevices,
    isLoading,
    fetchHardwareHealth,
  } = useHardwareHealthStore();

  const categories = ["Bộ xử lý & Chipset", "Lưu trữ", "Đồ họa", "Mạng & Kết nối", "Nguồn điện & Pin"];

  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(categories.map((c) => [c, true]))
  );

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  const getDevicesForCategory = (catName: string): FullHardwareDevice[] => {
    return fullHardwareDevices.filter((d) => d.category === catName);
  };

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case "Bộ xử lý & Chipset":
        return <Cpu size={14} className="text-[#C4B5FD]" />;
      case "Lưu trữ":
        return <HardDrive size={14} className="text-cyan-400" />;
      case "Đồ họa":
        return <Activity size={14} className="text-pink-400" />;
      case "Mạng & Kết nối":
        return <Wifi size={14} className="text-[#86efac]" />;
      case "Nguồn điện & Pin":
        return <Zap size={14} className="text-amber-400" />;
      default:
        return <MemoryStick size={14} className="text-slate-400" />;
    }
  };

  return (
    <div className="adaptive-card glass-panel flex flex-col p-3 gap-2.5 relative overflow-hidden h-full">
      {/* Header section */}
      <div className="flex items-center justify-between border-b border-white/5 pb-2 shrink-0">
        <h3 className="header-small-caps flex items-center gap-2 text-[13px] md:text-[14px] text-primary font-bold">
          <Cpu size={15} strokeWidth={2} />
          DANH SÁCH THIẾT BỊ &amp; TRÌNH ĐIỀU KHIỂN
        </h3>
        <button
          onClick={() => void fetchHardwareHealth()}
          disabled={isLoading}
          className="text-slate-500 hover:text-slate-300 transition-colors p-1 disabled:opacity-50"
          title="Quét lại toàn bộ phần cứng"
        >
          <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Main Content List Container */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1 space-y-3">
        {isLoading && fullHardwareDevices.length === 0 ? (
          <div className="space-y-2 py-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 rounded-lg border border-white/5 bg-[#0E0F16]/45 animate-pulse" />
            ))}
          </div>
        ) : (
          categories.map((category) => {
            const devList = getDevicesForCategory(category);
            const isCollapsed = collapsedCategories[category];

            if (devList.length === 0) return null;

            return (
              <div key={category} className="space-y-1.5">
                {/* Category Header Bar */}
                <button
                  onClick={() => toggleCategory(category)}
                  className="w-full flex items-center justify-between text-[12.5px] font-bold text-slate-300 uppercase tracking-wider py-1 px-2 rounded bg-white/[0.02] border border-white/5 hover:bg-white/5 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    {getCategoryIcon(category)}
                    <span>{category}</span>
                    <span className="text-[11.5px] text-slate-400 font-mono font-normal">
                      ({devList.length})
                    </span>
                  </span>
                  {isCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                </button>

                {!isCollapsed && (
                  <div className="space-y-1.5 pl-1">
                    {devList.map((dev) => (
                        <div
                          key={dev.id}
                          className="h-[42px] rounded-lg border border-white/5 bg-[#0E0F16]/60 px-2.5 py-1.5 flex items-center justify-between gap-2.5 hover:border-primary/30 transition-all"
                        >
                          {/* Left: Device Name + Vendor */}
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className="shrink-0 rounded-md bg-white/5 p-1 border border-white/5">
                              {getCategoryIcon(dev.category)}
                            </div>
                            <div className="min-w-0 flex-1 truncate">
                              <span className="text-[13.5px] font-bold text-slate-200 truncate" title={dev.name}>
                                {dev.name}
                              </span>
                              <span className="text-[12px] text-slate-400 ml-1.5 font-normal">
                                · {dev.vendor}
                              </span>
                            </div>
                          </div>

                          {/* Right: Status badge */}
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
                                dev.status === "missing"
                                  ? "text-pink-400 bg-pink-500/10 border border-pink-500/20"
                                  : "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                              }`}
                            >
                              {dev.status_text}
                            </span>
                          </div>
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
