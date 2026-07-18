import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useSystemStore } from "../store/useSystemStore";
import type { SystemTelemetry, AudioState, MediaInfo, GameFpsUpdate } from "../types/schema";

type ByteStreamPayload = {
  encoding: "json-utf8";
  byte_len: number;
  data: number[];
};

function decodeIpcPayload<T>(payload: T | ByteStreamPayload): T {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "encoding" in payload &&
    payload.encoding === "json-utf8" &&
    Array.isArray(payload.data)
  ) {
    const bytes = new Uint8Array(payload.data);
    if (bytes.byteLength !== payload.byte_len) {
      throw new Error("IPC byte-stream length mismatch");
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }
  return payload as T;
}

export function useIpcListener() {
  const setTelemetry   = useSystemStore((s) => s.setTelemetry);
  const setAudio       = useSystemStore((s) => s.setAudio);
  const setMedia       = useSystemStore((s) => s.setMedia);
  const fetchProcesses = useSystemStore((s) => s.fetchProcesses);
  const fetchBattery   = useSystemStore((s) => s.fetchBattery);
  const fetchRunningGame = useSystemStore((s) => s.fetchRunningGame);
  const fetchMsiEcState = useSystemStore((s) => s.fetchMsiEcState);
  const setGameFps = useSystemStore((s) => s.setGameFps);

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    const intervals: ReturnType<typeof window.setInterval>[] = [];

    const setup = async () => {
      // ── IPC event listeners ───────────────────────────────────────
      const u1 = await listen<SystemTelemetry>("system-tick", (event) => {
        try {
          setTelemetry(decodeIpcPayload<SystemTelemetry>(event.payload));
        } catch (error) {
          console.error("[system-tick] invalid IPC payload", error);
        }
      });
      unlisteners.push(u1);

      const u2 = await listen<MediaInfo>("media-update", (event) => {
        try {
          setMedia(decodeIpcPayload<MediaInfo>(event.payload));
        } catch (error) {
          console.error("[media-update] invalid IPC payload", error);
        }
      });
      unlisteners.push(u2);

      const u4 = await listen<GameFpsUpdate>("game-fps-update", (event) => {
        try {
          setGameFps(decodeIpcPayload<GameFpsUpdate>(event.payload));
        } catch (error) {
          console.error("[game-fps-update] invalid IPC payload", error);
        }
      });
      unlisteners.push(u4);

      try {
        const u3 = await listen<AudioState>("audio-update", (event) => {
          try {
            setAudio(decodeIpcPayload<AudioState>(event.payload));
          } catch (error) {
            console.error("[audio-update] invalid IPC payload", error);
          }
        });
        unlisteners.push(u3);
      } catch (error) { console.error("[audio-update] listener unavailable", error); }

      // ── Initial data fetches ──────────────────────────────────────
      // Do not block event registration on a slow D-Bus/sysfs command.
      // Telemetry must keep flowing even when an optional subsystem is down.
      void Promise.allSettled([
        invoke<AudioState>("get_audio_state").then(setAudio),
        invoke<MediaInfo | null>("get_media_info").then((media) => {
          if (media) setMedia(media);
        }),
        fetchProcesses(),
        fetchBattery(),
        fetchRunningGame(),
        fetchMsiEcState(),
      ]).then((results) => {
        results.forEach((result) => {
          if (result.status === "rejected") {
            console.error("[initial-data] unavailable", result.reason);
          }
        });
      });

      // ── Periodic refresh (reduced frequency to save resources) ──────────
      intervals.push(window.setInterval(() => void fetchProcesses(), 10_000));
      intervals.push(window.setInterval(() => void fetchBattery(), 30_000));
      intervals.push(window.setInterval(() => void fetchRunningGame(), 15_000));
      intervals.push(window.setInterval(() => void fetchMsiEcState(), 15_000));
    };

    setup();

    return () => {
      unlisteners.forEach((fn) => fn());
      intervals.forEach((id) => window.clearInterval(id));
    };
  }, [setTelemetry, setAudio, setMedia, fetchProcesses, fetchBattery, fetchRunningGame, fetchMsiEcState, setGameFps]);
}
