import { memo } from "react";
import { Clock3, Monitor, Repeat2 } from "lucide-react";
import { useSystemStore } from "../../store/useSystemStore";
import { LiveSessionTime } from "../LiveSessionTime";
import { StatusPill, WidgetFactory } from "./factory";

export const SessionCard = memo(function SessionCard() {
  const session = useSystemStore((state) => state.telemetry?.session);

  return (
    <WidgetFactory title="SESSION / OVERVIEW">
      {!session ? <div className="skeleton h-24 w-full" /> : <div className="grid gap-2 sm:grid-cols-[minmax(0,1.35fr)_repeat(3,minmax(0,1fr))]">
        <div className="rounded-md border border-[#8B5CF6]/35 bg-[#8B5CF6]/10 p-2">
          <div className="flex items-center justify-between gap-2"><span className="text-[10px] uppercase tracking-wide text-[#C4B5FD]">Dashboard runtime</span><StatusPill tone="green">Live</StatusPill></div>
          <div className="mt-1 text-[24px] font-medium leading-none text-[#F3E8FF]"><LiveSessionTime clock="dashboard" /></div>
          <p className="mt-1 text-[10px] text-[#AAAACC]">System up <LiveSessionTime /></p>
        </div>
        <div className="metric-tile"><span className="flex items-center gap-1"><Monitor size={11} /> Active output</span><strong className="truncate">{session.active_output ?? "Not detected"}</strong></div>
        <div className="metric-tile"><span className="flex items-center gap-1"><Repeat2 size={11} /> Profile switches</span><strong>{session.profile_switches}</strong></div>
        <div className="metric-tile"><span className="flex items-center gap-1"><Clock3 size={11} /> Session uptime</span><strong><LiveSessionTime /></strong></div>
      </div>}
    </WidgetFactory>
  );
});
