import { memo, useRef, useSyncExternalStore } from "react";
import { useSystemStore } from "../store/useSystemStore";

type SessionClock = "dashboard" | "system";

const listeners = new Set<() => void>();
let clockTimer: ReturnType<typeof globalThis.setInterval> | null = null;
let monotonicNow = performance.now();

function subscribeClock(listener: () => void) {
  listeners.add(listener);
  if (clockTimer === null) {
    monotonicNow = performance.now();
    clockTimer = globalThis.setInterval(() => {
      monotonicNow = performance.now();
      listeners.forEach((notify) => notify());
    }, 1_000);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && clockTimer !== null) {
      globalThis.clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

function getClockSnapshot() {
  return monotonicNow;
}

function formatElapsedTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600).toString().padStart(2, "0");
  const minutes = Math.floor((seconds % 3_600) / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return days > 0 ? `${days}d ${hours}:${minutes}:${remainder}` : `${hours}:${minutes}:${remainder}`;
}

export const LiveSessionTime = memo(function LiveSessionTime({
  clock = "system",
  fallback = "00:00:00",
}: {
  clock?: SessionClock;
  fallback?: string;
}) {
  const telemetry = useSystemStore((state) => state.telemetry);
  const now = useSyncExternalStore(subscribeClock, getClockSnapshot, getClockSnapshot);
  const sourceSeconds = telemetry?.session[
    clock === "dashboard" ? "dashboard_runtime_seconds" : "system_uptime_seconds"
  ];
  const sampleTimestamp = telemetry?.timestamp_ms;
  const anchor = useRef<{ seconds: number; receivedAt: number } | null>(null);
  const lastSampleTimestamp = useRef<number | null>(null);

  if (
    sourceSeconds != null &&
    sampleTimestamp != null &&
    lastSampleTimestamp.current !== sampleTimestamp
  ) {
    lastSampleTimestamp.current = sampleTimestamp;
    const receivedAt = performance.now();
    if (!anchor.current) {
      anchor.current = { seconds: sourceSeconds, receivedAt };
    } else {
      const predictedSeconds = anchor.current.seconds
        + Math.floor(Math.max(0, receivedAt - anchor.current.receivedAt) / 1_000);
      // Normal telemetry arrives every ~2 seconds. Do not hard-reset for that
      // routine sample, otherwise the visible clock can jump by two seconds.
      // A large drift means suspend/resume or a genuine clock discontinuity.
      if (Math.abs(sourceSeconds - predictedSeconds) > 5) {
        anchor.current = { seconds: sourceSeconds, receivedAt };
      }
    }
  }

  if (!anchor.current) return fallback;
  const elapsedSinceSample = Math.floor(Math.max(0, now - anchor.current.receivedAt) / 1_000);
  return formatElapsedTime(anchor.current.seconds + elapsedSinceSample);
});
