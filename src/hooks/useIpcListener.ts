import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useSystemStore } from "../store/useSystemStore";
import { dashboardFetchQueue } from "../lib/dashboardFetchQueue";
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

export type ActivePage = "dashboard" | "game" | "msi";

export function useIpcListener(activePage: ActivePage) {
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

    };

    setup();

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [setTelemetry, setAudio, setMedia, setGameFps]);

  useEffect(() => {
    const unregisterFetches: Array<() => void> = [];
    let initialDataFrame: number | null = null;

    if (activePage === "dashboard") {
      // Dashboard-only reads sleep as soon as another page is selected.
      unregisterFetches.push(
        dashboardFetchQueue.register("battery", fetchBattery, { cadenceTicks: 3, initialDelayMs: 100 }),
        dashboardFetchQueue.register("processes", fetchProcesses, { initialDelayMs: 800 }),
      );

      // Yield one frame so the dashboard shell and skeletons paint first.
      initialDataFrame = globalThis.requestAnimationFrame(() => {
        dashboardFetchQueue.enqueue("initial-audio", async () => {
          setAudio(await invoke<AudioState>("get_audio_state"));
        });
        dashboardFetchQueue.enqueue("initial-media", async () => {
          const media = await invoke<MediaInfo | null>("get_media_info");
          if (media) setMedia(media);
        });
      });
    } else if (activePage === "msi") {
      // Keep only data consumed by MSI Center awake.
      unregisterFetches.push(
        dashboardFetchQueue.register("battery", fetchBattery, { cadenceTicks: 3, initialDelayMs: 100 }),
        dashboardFetchQueue.register("msi-ec", fetchMsiEcState, { initialDelayMs: 500 }),
      );
    } else {
      // On Game page both Dashboard and MSI polling sleep.
      unregisterFetches.push(
        dashboardFetchQueue.register("running-game", fetchRunningGame, { initialDelayMs: 300 }),
      );
    }

    return () => {
      if (initialDataFrame !== null) globalThis.cancelAnimationFrame(initialDataFrame);
      unregisterFetches.forEach((unregister) => unregister());
    };
  }, [activePage, setAudio, setMedia, fetchProcesses, fetchBattery, fetchRunningGame, fetchMsiEcState]);
}
