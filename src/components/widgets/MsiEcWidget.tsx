import { memo } from "react";
import { 
  Wind, 
  Cpu, 
  Gauge, 
  Battery, 
  Flame, 
  Webcam, 
  Keyboard, 
  Shuffle, 
  AlertTriangle 
} from "lucide-react";
import { useSystemStore } from "../../store/useSystemStore";
import { WidgetFactory } from "./factory";

export const MsiEcWidget = memo(function MsiEcWidget() {
  const msiEcState = useSystemStore((s) => s.msiEcState);
  
  const setCoolerBoost = useSystemStore((s) => s.setMsiEcCoolerBoost);
  const setFanMode = useSystemStore((s) => s.setMsiEcFanMode);
  const setShiftMode = useSystemStore((s) => s.setMsiEcShiftMode);
  const setSuperBattery = useSystemStore((s) => s.setMsiEcSuperBattery);
  const setWebcam = useSystemStore((s) => s.setMsiEcWebcam);
  const setWinKey = useSystemStore((s) => s.setMsiEcWinKey);
  const setFnKey = useSystemStore((s) => s.setMsiEcFnKey);
  const setKbdBacklight = useSystemStore((s) => s.setMsiEcKbdBacklight);

  if (!msiEcState || !msiEcState.is_supported) {
    return (
      <WidgetFactory title="MSI HARDWARE CONTROL" accentColor="text-slate-500">
        <div className="flex flex-col items-center justify-center gap-2 rounded border border-white/5 bg-black/20 p-4 text-center text-[11px] text-slate-500">
          <AlertTriangle size={20} className="text-slate-600" />
          <p className="font-semibold">Driver msi-ec không hoạt động</p>
          <p className="text-[9px] text-slate-600 leading-normal">
            Ứng dụng không tìm thấy đường dẫn <code className="bg-black/40 px-1 rounded">/sys/devices/platform/msi-ec</code>. Vui lòng kiểm tra lại cấu hình driver trên hệ thống.
          </p>
        </div>
      </WidgetFactory>
    );
  }

  const {
    cooler_boost,
    fan_mode,
    available_fan_modes,
    shift_mode,
    available_shift_modes,
    super_battery,
    webcam,
    win_key,
    fn_key,
    kbd_backlight,
    kbd_backlight_max,
    cpu_fan_speed,
    cpu_temp,
    gpu_fan_speed,
    gpu_temp,
    fw_version,
  } = msiEcState;

  const handleWinFnSwap = () => {
    // If Win key is Left, set it to Right and Fn to Left, and vice-versa
    const nextWin = win_key === "left" ? "right" : "left";
    const nextFn = fn_key === "left" ? "right" : "left";
    void setWinKey(nextWin);
    void setFnKey(nextFn);
  };

  return (
    <WidgetFactory 
      title="MSI HARDWARE CONTROL" 
      accentColor="text-pink-accent"
      icon={<Cpu size={14} strokeWidth={2} className="text-pink-accent" />}
    >
      <div className="space-y-3.5 text-[11px]">
        {/* Firmware Version */}
        <div className="flex items-center justify-between text-[9px] text-slate-500 border-b border-white/5 pb-1.5">
          <span>Firmware EC:</span>
          <span className="font-mono bg-black/30 px-1.5 py-0.5 rounded border border-white/5">{fw_version}</span>
        </div>

        {/* Real-time Hardware Telemetry (Fan + Temp) */}
        <div className="grid grid-cols-2 gap-2">
          {/* CPU telemetry */}
          <div className="rounded border border-white/5 bg-black/25 p-2 space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-bold text-slate-400">
              <span>CPU Fan</span>
              <span className="text-pink-accent">{cpu_temp}°C</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Wind size={12} className={`text-slate-500 ${cpu_fan_speed > 0 ? "animate-spin" : ""}`} style={{ animationDuration: `${Math.max(0.5, 3 - (cpu_fan_speed / 30))}s` }} />
              <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                <div 
                  className="bg-pink-accent h-full transition-all duration-500" 
                  style={{ width: `${Math.min(100, cpu_fan_speed)}%` }}
                />
              </div>
              <span className="font-mono text-[9px] text-slate-400 min-w-[24px] text-right">{cpu_fan_speed}%</span>
            </div>
          </div>

          {/* GPU telemetry */}
          <div className="rounded border border-white/5 bg-black/25 p-2 space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-bold text-slate-400">
              <span>GPU Fan</span>
              <span className="text-cyan-accent">{gpu_temp}°C</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Wind size={12} className={`text-slate-500 ${gpu_fan_speed > 0 ? "animate-spin" : ""}`} style={{ animationDuration: `${Math.max(0.5, 3 - (gpu_fan_speed / 30))}s` }} />
              <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                <div 
                  className="bg-cyan-accent h-full transition-all duration-500" 
                  style={{ width: `${Math.min(100, gpu_fan_speed)}%` }}
                />
              </div>
              <span className="font-mono text-[9px] text-slate-400 min-w-[24px] text-right">{gpu_fan_speed}%</span>
            </div>
          </div>
        </div>

        {/* Cooler Boost & Shift Profile */}
        <div className="space-y-2">
          {/* Shift Profile (Performance Modes) */}
          <div>
            <div className="mb-1.5 flex items-center gap-1.5">
              <Gauge size={12} className="text-slate-400" />
              <span className="text-[9px] uppercase tracking-wider text-slate-400">Shift Mode (Hiệu năng)</span>
            </div>
            <div className="flex gap-1.5">
              {available_shift_modes.map((mode) => {
                const isActive = shift_mode === mode;
                let colorClass = "border-white/10 bg-black/20 text-slate-400 hover:border-pink-accent/30";
                let Icon = Gauge;

                if (isActive) {
                  if (mode === "eco") {
                    colorClass = "border-emerald-500/50 bg-emerald-500/10 text-emerald-400 glow-emerald";
                    Icon = Battery;
                  } else if (mode === "comfort") {
                    colorClass = "border-cyan-accent/50 bg-cyan-accent/10 text-cyan-accent glow-cyan";
                    Icon = Gauge;
                  } else if (mode === "turbo" || mode === "sport") {
                    colorClass = "border-pink-accent/50 bg-pink-accent/10 text-pink-accent glow-pink";
                    Icon = Flame;
                  } else {
                    colorClass = "border-primary/50 bg-primary/10 text-primary glow-purple";
                  }
                }

                return (
                  <button
                    key={mode}
                    onClick={() => void setShiftMode(mode)}
                    className={`flex-1 flex items-center justify-center gap-1.5 rounded border py-1.5 text-[10px] font-bold capitalize transition-colors ${colorClass}`}
                  >
                    <Icon size={12} />
                    {mode}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Fan Control & Cooler Boost */}
          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={() => void setCoolerBoost(!cooler_boost)}
              className={`col-span-1 flex flex-col items-center justify-center gap-1 rounded border py-2 text-[10px] font-bold uppercase transition-all duration-300 ${
                cooler_boost
                  ? "border-red-500/50 bg-red-500/10 text-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]"
                  : "border-white/10 bg-black/20 text-slate-400 hover:border-red-500/30"
              }`}
            >
              <Flame size={14} className={cooler_boost ? "animate-pulse text-red-500" : ""} />
              <span className="text-[8px] tracking-wider mt-0.5">Boost</span>
            </button>

            <div className="col-span-2 grid grid-cols-3 gap-1">
              {available_fan_modes.map((mode) => {
                const isActive = fan_mode === mode && !cooler_boost;
                return (
                  <button
                    key={mode}
                    onClick={() => {
                      void setCoolerBoost(false);
                      void setFanMode(mode);
                    }}
                    className={`flex flex-col items-center justify-center rounded border py-2 text-[9px] font-bold capitalize transition-colors ${
                      isActive
                        ? "border-pink-accent/50 bg-pink-accent/10 text-pink-accent"
                        : "border-white/10 bg-black/20 text-slate-500 hover:border-pink-accent/30"
                    }`}
                  >
                    <Wind size={12} />
                    <span className="mt-0.5">{mode}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Keyboard Backlight Slider */}
        {kbd_backlight_max > 0 && (
          <div className="border-t border-white/5 pt-2.5">
            <div className="mb-2 flex items-center justify-between text-slate-400">
              <div className="flex items-center gap-1.5">
                <Keyboard size={12} />
                <span className="text-[9px] uppercase tracking-wider">Đèn nền bàn phím</span>
              </div>
              <span className="font-mono text-[10px] text-pink-accent font-bold">
                Lớp {kbd_backlight} / {kbd_backlight_max}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => void setKbdBacklight(0)}
                className={`text-[9px] font-bold px-2 py-1 rounded border transition-colors ${
                  kbd_backlight === 0 
                    ? "border-pink-accent bg-pink-accent/10 text-pink-accent" 
                    : "border-white/10 bg-black/20 text-slate-400"
                }`}
              >
                Tắt
              </button>
              <div className="flex-1 flex gap-1.5 h-3 items-center">
                {Array.from({ length: kbd_backlight_max }).map((_, i) => {
                  const level = i + 1;
                  const isFilled = kbd_backlight >= level;
                  return (
                    <button
                      key={level}
                      onClick={() => void setKbdBacklight(level)}
                      className={`flex-1 h-2 rounded transition-all duration-300 ${
                        isFilled 
                          ? "bg-pink-accent shadow-[0_0_8px_rgba(236,72,153,0.3)]" 
                          : "bg-white/5 border border-white/10 hover:border-pink-accent/40"
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Utility Toggles: Webcam, Super Battery, Win/Fn Swap */}
        <div className="border-t border-white/5 pt-2.5 space-y-1.5">
          <div className="flex gap-2">
            {/* Webcam Block/Unblock */}
            <button
              onClick={() => void setWebcam(!webcam)}
              className={`flex-1 flex items-center gap-2 rounded border p-2 text-left transition-colors ${
                webcam
                  ? "border-pink-accent/50 bg-pink-accent/5 text-pink-accent"
                  : "border-white/5 bg-black/20 text-slate-400 hover:border-white/15"
              }`}
            >
              <Webcam size={13} className={webcam ? "text-pink-accent" : "text-slate-500"} />
              <div>
                <p className="text-[10px] font-bold leading-none">Webcam</p>
                <p className="text-[8px] text-slate-500 mt-0.5">{webcam ? "Đang mở" : "Đã khóa"}</p>
              </div>
            </button>

            {/* Super Battery */}
            <button
              onClick={() => void setSuperBattery(!super_battery)}
              className={`flex-1 flex items-center gap-2 rounded border p-2 text-left transition-colors ${
                super_battery
                  ? "border-emerald-500/50 bg-emerald-500/5 text-emerald-400"
                  : "border-white/5 bg-black/20 text-slate-400 hover:border-white/15"
              }`}
            >
              <Battery size={13} className={super_battery ? "text-emerald-400" : "text-slate-500"} />
              <div>
                <p className="text-[10px] font-bold leading-none">Eco Battery</p>
                <p className="text-[8px] text-slate-500 mt-0.5">{super_battery ? "Kích hoạt" : "Không bật"}</p>
              </div>
            </button>
          </div>

          {/* Win & Fn Swap control */}
          <button
            onClick={handleWinFnSwap}
            className="flex w-full items-center justify-between rounded border border-white/5 bg-black/20 p-2 text-left text-[10px] text-slate-400 hover:border-white/15 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Shuffle size={13} className="text-slate-500" />
              <div>
                <span className="font-bold">Đổi vị trí phím Win / Fn</span>
                <p className="text-[8px] text-slate-500">Phím Win bên {win_key === "left" ? "Trái" : "Phải"} | Fn bên {fn_key === "left" ? "Trái" : "Phải"}</p>
              </div>
            </div>
            <span className="text-[9px] font-mono bg-black/40 border border-white/5 px-1.5 py-0.5 rounded text-pink-accent font-bold">SWAP</span>
          </button>
        </div>
      </div>
    </WidgetFactory>
  );
});
