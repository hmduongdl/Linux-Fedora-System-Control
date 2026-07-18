import { memo, useCallback, useEffect, useState } from "react";
import { TimerOff } from "lucide-react";
import { useSystemStore } from "../store/useSystemStore";
import { StatusPill } from "./ui/StatusPill";

const PRESETS = [1, 2, 4, 6, 8, 10];

function formatRemaining(milliseconds: number) {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes.toString().padStart(2, "0")}m` : `${minutes}m`;
}

const ShutdownTimer = memo(function ShutdownTimer() {
  const shutdownTimer = useSystemStore((state) => state.shutdownTimer);
  const selectedMinutes = shutdownTimer.minutes;
  const scheduledAt = shutdownTimer.scheduled_at_ms;
  const setShutdownTimer = useSystemStore((state) => state.setShutdownTimer);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remaining = scheduledAt == null ? null : Math.max(0, scheduledAt - now);

  useEffect(() => {
    if (scheduledAt == null) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [scheduledAt]);

  const applyTimer = useCallback(async (minutes: number | null) => {
    setLoading(true);
    setError(null);
    try {
      await setShutdownTimer(minutes);
      setNow(Date.now());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Shutdown timer failed");
    } finally {
      setLoading(false);
    }
  }, [setShutdownTimer]);

  return (
    <section className="glass-panel h-full p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div><h2 className="text-[11px] font-semibold uppercase tracking-widest text-[#A855F7]">Shutdown / Timer</h2><p className="mt-0.5 text-[10px] text-[#777797]">Schedule a safe power-off</p></div>
        <StatusPill label={remaining == null ? "No timer" : formatRemaining(remaining)} active={remaining != null} />
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {PRESETS.map((hours) => {
          const minutes = hours * 60;
          const active = selectedMinutes === minutes;
          return <button key={hours} type="button" disabled={loading} onClick={() => applyTimer(minutes)} className={`rounded-md border px-1.5 py-2 text-[11px] font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${active ? "border-[#8B5CF6] bg-[#8B5CF6]/15 text-[#DDD6FE] shadow-[0_0_10px_rgba(139,92,246,0.12)]" : "border-[#2A2B3C] bg-[#161722] text-[#AAAACC] hover:border-[#8B5CF6]/55 hover:text-[#E9D5FF]"}`}>{hours}h</button>;
        })}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[10px] text-[#777797]">{error ?? (remaining == null ? "No shutdown has been scheduled" : `Power off in ${formatRemaining(remaining)}`)}</span>
        {selectedMinutes != null && <button type="button" disabled={loading} onClick={() => applyTimer(null)} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#3A3B4C] px-2 py-1 text-[10px] text-[#C5C5DA] transition-colors hover:border-[#EC4899]/60 hover:bg-[#EC4899]/10 hover:text-[#F9A8D4] disabled:opacity-60"><TimerOff size={12} /> Cancel</button>}
      </div>
    </section>
  );
});

export default ShutdownTimer;
