import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useSystemStore } from "../store/useSystemStore";
import type { SystemTelemetry, AudioState, MediaInfo } from "../types/schema";

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
  const setTelemetry = useSystemStore((s) => s.setTelemetry);
  const setAudio = useSystemStore((s) => s.setAudio);
  const setMedia = useSystemStore((s) => s.setMedia);

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    const setup = async () => {
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

      // Future audio event from PipeWire listener
      try {
        const u3 = await listen<AudioState>("audio-update", (event) => {
          try {
            setAudio(decodeIpcPayload<AudioState>(event.payload));
          } catch (error) {
            console.error("[audio-update] invalid IPC payload", error);
          }
        });
        unlisteners.push(u3);
      } catch {
        // audio-update event not yet implemented in backend
      }
    };

    setup();

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [setTelemetry, setAudio, setMedia]);
}
