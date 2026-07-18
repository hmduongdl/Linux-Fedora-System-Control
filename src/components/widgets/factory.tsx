import { memo, type ReactNode } from "react";
import {
  Activity,
  BarChart3,
  Cpu,
  Gamepad2,
  HardDrive,
  Headphones,
  History,
  ListOrdered,
  Music2,
  Timer,
  Zap,
} from "lucide-react";

interface WidgetFactoryProps {
  title: string;
  icon?: ReactNode;
  accentColor?: string;
  children: ReactNode;
  className?: string;
}

const ICON_MAP: Record<string, ReactNode> = {
  "ĐANG PHÁT":        <Music2 size={14} strokeWidth={2} />,
  "TRẠNG THÁI GAME":  <Gamepad2 size={14} strokeWidth={2} />,
  "AUDIO / MIXER":    <Headphones size={14} strokeWidth={2} />,
  "CHỈ SỐ HỆ THỐNG": <Activity size={14} strokeWidth={2} />,
  "THÔNG SỐ PHẦN CỨNG": <HardDrive size={14} strokeWidth={2} />,
  "LỊCH SỬ HIỆU NĂNG": <History size={14} strokeWidth={2} />,
  "CÔNG CỤ PHIÊN":    <Timer size={14} strokeWidth={2} />,
  "QUICK ACTIONS":    <Zap size={14} strokeWidth={2} />,
  "TRÒ CHƠI ĐANG CHẠY": <Gamepad2 size={14} strokeWidth={2} />,
  "TIẾN TRÌNH HÀNG ĐẦU": <ListOrdered size={14} strokeWidth={2} />,
  "PERFORMANCE / HISTORY": <BarChart3 size={14} strokeWidth={2} />,
};

const COLOR_MAP: Record<string, string> = {
  "ĐANG PHÁT":           "text-primary",
  "TRẠNG THÁI GAME":     "text-emerald-400",
  "AUDIO / MIXER":       "text-cyan-accent",
  "CHỈ SỐ HỆ THỐNG":    "text-cyan-accent",
  "THÔNG SỐ PHẦN CỨNG": "text-on-surface-variant",
  "LỊCH SỬ HIỆU NĂNG":  "text-primary",
  "CÔNG CỤ PHIÊN":       "text-primary",
  "QUICK ACTIONS":       "text-cyan-accent",
  "TRÒ CHƠI ĐANG CHẠY": "text-pink-accent",
  "TIẾN TRÌNH HÀNG ĐẦU": "text-primary",
  "PERFORMANCE / HISTORY": "text-primary",
};

export const WidgetFactory = memo(function WidgetFactory({
  title,
  icon,
  accentColor,
  children,
  className = "",
}: WidgetFactoryProps) {
  const resolvedIcon = icon ?? ICON_MAP[title] ?? <Cpu size={14} strokeWidth={2} />;
  const resolvedColor = accentColor ?? COLOR_MAP[title] ?? "text-primary";

  return (
    <div
      className={`glass-panel flex min-h-0 flex-col ${className}`}
      style={{
        padding: "clamp(10px, 1.2vh, 16px)",
        gap: "clamp(8px, 1vh, 12px)",
      }}
    >
      <h3 className={`header-small-caps flex items-center gap-2 text-[10px] md:text-[11px] ${resolvedColor}`}>
        {resolvedIcon}
        {title}
      </h3>
      <div className="flex-1 min-h-0 flex flex-col justify-between">{children}</div>
    </div>
  );
});

export function StatusPill({
  children,
  tone = "violet",
}: {
  children: ReactNode;
  tone?: "violet" | "green" | "amber" | "muted";
}) {
  const colors = {
    violet: "border-[#8B5CF6]/35 bg-[#8B5CF6]/10 text-[#C4B5FD]",
    green:  "border-[#22C55E]/35 bg-[#22C55E]/10 text-[#86EFAC]",
    amber:  "border-[#F59E0B]/35 bg-[#F59E0B]/10 text-[#FCD34D]",
    muted:  "border-[#3A3B4C] bg-[#1A1B26] text-[#777797]",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${colors[tone]}`}
    >
      {children}
    </span>
  );
}
