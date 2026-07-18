import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  SystemTelemetry,
  AudioState,
  MediaInfo,
  AppSettings,
  PerformanceProfile,
  ControlToggleResult,
  NetworkHistoryPoint,
  PerformanceHistoryPoint,
  ShutdownTimerResult,
  ShutdownTimerState,
  SystemControlState,
  ProcessInfo,
  BatteryInfo,
  RunningGameInfo,
  MsiEcState,
  GameFpsUpdate,
} from "../types/schema";

/* ── Defaults ── */

const DEFAULT_PROFILE: PerformanceProfile = {
  name: "balanced",
  cpu_governor: "schedutil",
  gpu_power_profile: "auto",
  gamemode_enabled: false,
};

const DEFAULT_SETTINGS: AppSettings = {
  refresh_interval_ms: 1000,
  active_profile: DEFAULT_PROFILE,
};

export const PERFORMANCE_HISTORY_LIMIT = 120;
export type OperatingMode = "work" | "game" | "silent";

let systemControlInFlight: Promise<unknown> | null = null;
let audioOutputInFlight: Promise<void> | null = null;
const muteInFlight = new Map<number, Promise<void>>();
const pendingVolumes = new Map<number, number>();
const volumeWorkers = new Map<number, Promise<void>>();
let processFetchInFlight: Promise<void> | null = null;
let batteryFetchInFlight: Promise<void> | null = null;
let runningGameFetchInFlight: Promise<void> | null = null;
let msiEcFetchInFlight: Promise<void> | null = null;

function runSystemControl<T>(action: () => Promise<T>): Promise<T> {
  if (systemControlInFlight) {
    return Promise.reject(new Error("Một thay đổi chế độ hệ thống khác đang được xử lý"));
  }
  const request = action();
  systemControlInFlight = request;
  void request.finally(() => {
    if (systemControlInFlight === request) systemControlInFlight = null;
  }).catch(() => undefined);
  return request;
}

export type { PerformanceHistoryPoint, ProcessInfo, BatteryInfo, RunningGameInfo } from "../types/schema";

/* ── Store ── */

export interface SystemStore {
  telemetry: SystemTelemetry | null;
  performanceHistory: PerformanceHistoryPoint[];
  networkHistory: NetworkHistoryPoint[];
  audio: AudioState | null;
  media: MediaInfo | null;
  settings: AppSettings;
  controls: SystemControlState;
  shutdownTimer: ShutdownTimerState;
  isTelemetryConnected: boolean;
  processes: ProcessInfo[];
  battery: BatteryInfo | null;
  runningGame: RunningGameInfo | null;
  gameFps: GameFpsUpdate | null;
  operatingMode: OperatingMode;

  setTelemetry: (data: SystemTelemetry) => void;
  setGameFps: (data: GameFpsUpdate) => void;
  setAudio: (data: AudioState) => void;
  setMedia: (data: MediaInfo) => void;
  setSettings: (data: Partial<AppSettings>) => void;
  setIsGamemodeActive: (active: boolean) => void;
  setProcesses: (data: ProcessInfo[]) => void;
  setBattery: (data: BatteryInfo) => void;
  setRunningGame: (data: RunningGameInfo | null) => void;

  toggleGamemode: () => Promise<string>;
  clearRamCache: () => Promise<string>;
  cleanDiskCache: () => Promise<string>;
  toggleDoNotDisturb: () => Promise<string>;
  toggleKeepAwake: () => Promise<string>;
  setPowerProfile: (profile: "power-saver" | "balanced" | "performance") => Promise<string>;
  setShutdownTimer: (minutes: number | null) => Promise<string>;
  setVolume: (deviceId: number, volumePercent: number) => Promise<void>;
  toggleMute: (deviceId: number) => Promise<void>;
  setAudioOutput: (deviceId: number) => Promise<void>;
  mediaPlayPause: () => Promise<void>;
  mediaNext: () => Promise<void>;
  mediaPrevious: () => Promise<void>;
  seekMedia: (positionSeconds: number) => Promise<void>;
  fetchProcesses: () => Promise<void>;
  fetchBattery: () => Promise<void>;
  setBatteryLimiter: (enabled: boolean) => Promise<void>;
  fetchRunningGame: () => Promise<void>;
  setOperatingMode: (mode: OperatingMode) => Promise<string>;
  
  msiEcState: MsiEcState | null;
  fetchMsiEcState: () => Promise<void>;
  setMsiEcCoolerBoost: (enabled: boolean) => Promise<string>;
  setMsiEcFanMode: (mode: string) => Promise<string>;
  setMsiEcShiftMode: (mode: string) => Promise<string>;
  setMsiEcSuperBattery: (enabled: boolean) => Promise<string>;
  setMsiEcWebcam: (enabled: boolean) => Promise<string>;
  setMsiEcWinKey: (mode: string) => Promise<string>;
  setMsiEcFnKey: (mode: string) => Promise<string>;
  setMsiEcKbdBacklight: (level: number) => Promise<string>;
}

export const useSystemStore = create<SystemStore>((set, get) => ({
  telemetry: null,
  performanceHistory: [],
  networkHistory: [],
  audio: null,
  media: null,
  settings: DEFAULT_SETTINGS,
  controls: {
    is_gamemode_active: false,
    is_do_not_disturb_active: false,
    is_keep_awake_active: false,
  },
  shutdownTimer: { minutes: null, scheduled_at_ms: null },
  isTelemetryConnected: false,
  processes: [],
  battery: null,
  runningGame: null,
  gameFps: null,
  operatingMode: (localStorage.getItem("purrdora_operating_mode") as OperatingMode | null) ?? "work",
  msiEcState: null,

  setTelemetry: (data) => {
    set((state) => {
      const sensorTemperatures = data.temperatures ?? [];
      const temperatures = sensorTemperatures.length
        ? sensorTemperatures.map((sensor) => sensor.temperature_celsius)
        : data.gpus.flatMap((gpu) => gpu.temperature_celsius == null ? [] : [gpu.temperature_celsius]);
      const avgTemp = temperatures.length
        ? temperatures.reduce((total, temperature) => total + temperature, 0) / temperatures.length
        : null;

      const point: PerformanceHistoryPoint = {
        timestamp_ms: data.timestamp_ms,
        cpu_percent: data.cpu.total_usage_percent,
        ram_percent: data.ram.usage_percent,
        latency_ms: data.network.latency_ms,
        fps: data.fps,
        avg_temp: avgTemp,
      };
      const history = state.performanceHistory;
      let performanceHistory: PerformanceHistoryPoint[];
      if (history.at(-1)?.timestamp_ms === point.timestamp_ms) {
        performanceHistory = history;
      } else if (history.length >= PERFORMANCE_HISTORY_LIMIT) {
        performanceHistory = [...history.slice(1), point];
      } else {
        performanceHistory = [...history, point];
      }
      const interfaces = data.network.interfaces.filter((networkInterface) => networkInterface.name !== "lo");
      const networkPoint: NetworkHistoryPoint = {
        timestamp_ms: data.timestamp_ms,
        download_bytes_per_sec: interfaces.reduce((total, networkInterface) => total + networkInterface.rx_bytes_per_sec, 0),
        upload_bytes_per_sec: interfaces.reduce((total, networkInterface) => total + networkInterface.tx_bytes_per_sec, 0),
        latency_ms: data.network.latency_ms,
      };
      const lastNet = state.networkHistory[state.networkHistory.length - 1];
      const networkHistory = lastNet?.timestamp_ms === networkPoint.timestamp_ms
        ? state.networkHistory
        : state.networkHistory.length >= PERFORMANCE_HISTORY_LIMIT
          ? [...state.networkHistory.slice(1), networkPoint]
          : [...state.networkHistory, networkPoint];

      return { telemetry: data, performanceHistory, networkHistory, isTelemetryConnected: true };
    });
  },


  setAudio: (data) => {
    set({ audio: data });
  },

  setMedia: (data) => {
    set({ media: data });
  },

  setSettings: (data) => {
    set((s) => ({ settings: { ...s.settings, ...data } }));
  },

  setIsGamemodeActive: (active) => {
    set((state) => ({ controls: { ...state.controls, is_gamemode_active: active } }));
  },

  setProcesses: (data) => { set({ processes: data }); },
  setBattery: (data) => { set({ battery: data }); },
  setRunningGame: (data) => { set({ runningGame: data }); },
  setGameFps: (data) => { set({ gameFps: data }); },

  fetchProcesses: async () => {
    if (processFetchInFlight) return processFetchInFlight;
    const started = performance.now();
    const request = (async () => {
      try {
        const data = await invoke<ProcessInfo[]>("get_top_processes");
        set({ processes: data });
      } catch (e) { console.error("[fetchProcesses]", e); }
      finally {
        const elapsed = performance.now() - started;
        if (elapsed >= 1_000) console.warn(`[perf] fetchProcesses took ${Math.round(elapsed)}ms`);
      }
    })();
    processFetchInFlight = request;
    try { await request; }
    finally { if (processFetchInFlight === request) processFetchInFlight = null; }
  },

  fetchBattery: async () => {
    if (batteryFetchInFlight) return batteryFetchInFlight;
    const started = performance.now();
    const request = (async () => {
      try {
        const data = await invoke<BatteryInfo>("get_battery");
        set({ battery: data });
      } catch (e) { console.error("[fetchBattery]", e); }
      finally {
        const elapsed = performance.now() - started;
        if (elapsed >= 1_000) console.warn(`[perf] fetchBattery took ${Math.round(elapsed)}ms`);
      }
    })();
    batteryFetchInFlight = request;
    try { await request; }
    finally { if (batteryFetchInFlight === request) batteryFetchInFlight = null; }
  },

  setBatteryLimiter: async (enabled) => {
    try {
      const battery = await invoke<BatteryInfo>("set_battery_limiter", { enabled });
      set({ battery });
    } catch (e) {
      console.error("[setBatteryLimiter]", e);
      throw e;
    }
  },

  fetchRunningGame: async () => {
    if (runningGameFetchInFlight) return runningGameFetchInFlight;
    const request = (async () => {
      try {
        const data = await invoke<RunningGameInfo | null>("get_running_game");
        set({ runningGame: data });
      } catch (e) { console.error("[fetchRunningGame]", e); }
    })();
    runningGameFetchInFlight = request;
    try { await request; }
    finally { if (runningGameFetchInFlight === request) runningGameFetchInFlight = null; }
  },

  setOperatingMode: async (mode) => {
    return runSystemControl(async () => {
      try {
      const result = await invoke<{ mode: OperatingMode; warnings: string[] }>("set_operating_mode", { mode });
      localStorage.setItem("purrdora_operating_mode", result.mode);
      set({ operatingMode: result.mode });
      await Promise.all([get().fetchMsiEcState(), get().fetchBattery()]);
      return result.warnings.length ? result.warnings.join(" · ") : `${result.mode} mode enabled`;
      } catch (e) {
        console.error("[setOperatingMode]", e);
        throw e;
      }
    });
  },

  /* ── Tauri invoke actions ── */

  toggleGamemode: async () => {
    try {
      const result = await invoke<string>("toggle_gamemode");
      const check = await invoke<string>("check_gamemode_status");
      set((state) => ({ controls: { ...state.controls, is_gamemode_active: check.includes("active") } }));
      return result;
    } catch (e) {
      console.error("[toggleGamemode]", e);
      throw e;
    }
  },

  clearRamCache: async () => {
    try {
      return await invoke<string>("clear_ram_cache");
    } catch (e) {
      console.error("[clearRamCache]", e);
      throw e;
    }
  },

  cleanDiskCache: async () => {
    try {
      return await invoke<string>("clean_disk_cache");
    } catch (e) {
      console.error("[cleanDiskCache]", e);
      throw e;
    }
  },

  toggleDoNotDisturb: async () => {
    try {
      const result = await invoke<ControlToggleResult>("toggle_do_not_disturb");
      set((state) => ({ controls: { ...state.controls, is_do_not_disturb_active: result.active } }));
      return result.message;
    } catch (e) {
      console.error("[toggleDoNotDisturb]", e);
      throw e;
    }
  },

  toggleKeepAwake: async () => {
    try {
      const result = await invoke<ControlToggleResult>("toggle_keep_awake");
      set((state) => ({ controls: { ...state.controls, is_keep_awake_active: result.active } }));
      return result.message;
    } catch (e) {
      console.error("[toggleKeepAwake]", e);
      throw e;
    }
  },

  setPowerProfile: async (profile) => {
    return runSystemControl(async () => {
      try {
        const activeProfile = await invoke<string>("set_power_profile", { profile });
        const name = activeProfile === "power-saver" ? "powersave" : activeProfile;
        set((state) => ({
          settings: {
            ...state.settings,
            active_profile: { ...state.settings.active_profile, name },
          },
        }));
        await get().fetchMsiEcState();
        return activeProfile;
      } catch (e) {
        console.error("[setPowerProfile]", e);
        throw e;
      }
    });
  },

  setShutdownTimer: async (minutes) => {
    try {
      const result = await invoke<ShutdownTimerResult>("set_shutdown_timer", { minutes });
      set({
        shutdownTimer: {
          minutes: result.minutes,
          scheduled_at_ms: result.active && result.minutes != null
            ? Date.now() + result.minutes * 60_000
            : null,
        },
      });
      return result.message;
    } catch (e) {
      console.error("[setShutdownTimer]", e);
      throw e;
    }
  },

  setVolume: async (deviceId, volumePercent) => {
    pendingVolumes.set(deviceId, volumePercent);
    const running = volumeWorkers.get(deviceId);
    if (running) return running;

    const worker = (async () => {
      while (pendingVolumes.has(deviceId)) {
        const latestVolume = pendingVolumes.get(deviceId)!;
        pendingVolumes.delete(deviceId);
        try {
          await invoke("set_audio_volume", { id: deviceId, volumePercent: latestVolume });
        } catch (e) {
          console.error("[setVolume]", e);
          throw e;
        }
      }
    })();
    volumeWorkers.set(deviceId, worker);
    try {
      await worker;
    } finally {
      if (volumeWorkers.get(deviceId) === worker) volumeWorkers.delete(deviceId);
    }
  },

  toggleMute: async (deviceId) => {
    const running = muteInFlight.get(deviceId);
    if (running) return running;
    const previous = get().audio;
    if (!previous) return;
    const toggleDevice = (device: AudioState["outputs"][number]) =>
      device.id === deviceId ? { ...device, is_muted: !device.is_muted } : device;
    set({
      audio: {
        ...previous,
        default_sink: previous.default_sink?.id === deviceId
          ? { ...previous.default_sink, is_muted: !previous.default_sink.is_muted }
          : previous.default_sink,
        outputs: previous.outputs.map(toggleDevice),
      },
    });
    const request = invoke<void>("toggle_audio_mute", { id: deviceId });
    muteInFlight.set(deviceId, request);
    try {
      await request;
    } catch (e) {
      set({ audio: previous });
      console.error("[toggleMute]", e);
      throw e;
    } finally {
      if (muteInFlight.get(deviceId) === request) muteInFlight.delete(deviceId);
    }
  },

  setAudioOutput: async (deviceId) => {
    if (audioOutputInFlight) return audioOutputInFlight;
    const previous = get().audio;
    if (!previous) return;
    const selected = previous.outputs.find((device) => device.id === deviceId);
    if (!selected) return;

    set({
      audio: {
        ...previous,
        default_sink: { ...selected, is_default: true },
        outputs: previous.outputs.map((device) => ({
          ...device,
          is_default: device.id === deviceId,
        })),
      },
    });
    const request = (async () => {
      try {
      const audio = await invoke<AudioState>("set_default_audio_output", { id: deviceId });
      set({ audio });
      } catch (e) {
        set({ audio: previous });
        console.error("[setAudioOutput]", e);
        throw e;
      }
    })();
    audioOutputInFlight = request;
    try {
      await request;
    } finally {
      if (audioOutputInFlight === request) audioOutputInFlight = null;
    }
  },

  mediaPlayPause: async () => {
    set((s) => {
      if (!s.media) return {};
      const currentStatus = s.media.playback_status;
      const nextStatus =
        currentStatus === "Playing" ? "Paused" : "Playing";
      return { media: { ...s.media, playback_status: nextStatus } };
    });
    try {
      await invoke("media_play_pause");
    } catch (e) {
      console.error("[mediaPlayPause]", e);
      set((s) => {
        if (!s.media) return {};
        const revertedStatus =
          s.media.playback_status === "Playing" ? "Paused" : "Playing";
        return { media: { ...s.media, playback_status: revertedStatus } };
      });
    }
  },

  mediaNext: async () => {
    try {
      await invoke("media_next");
    } catch (e) {
      console.error("[mediaNext]", e);
    }
  },

  mediaPrevious: async () => {
    try {
      await invoke("media_previous");
    } catch (e) {
      console.error("[mediaPrevious]", e);
    }
  },

  seekMedia: async (positionSeconds) => {
    try {
      await invoke("seek_media", { positionSeconds });
      set((s) => s.media ? { media: { ...s.media, position_seconds: positionSeconds } } : {});
    } catch (e) {
      console.error("[seekMedia]", e);
    }
  },

  fetchMsiEcState: async () => {
    if (msiEcFetchInFlight) return msiEcFetchInFlight;
    const request = (async () => {
      try {
        const data = await invoke<MsiEcState>("get_msi_ec_state");
        set({ msiEcState: data });
      } catch (e) {
        console.error("[fetchMsiEcState]", e);
      }
    })();
    msiEcFetchInFlight = request;
    try { await request; }
    finally { if (msiEcFetchInFlight === request) msiEcFetchInFlight = null; }
  },

  setMsiEcCoolerBoost: async (enabled) => {
    try {
      const msg = await invoke<string>("set_msi_ec_cooler_boost", { enabled });
      set((s) => s.msiEcState ? { msiEcState: { ...s.msiEcState, cooler_boost: enabled } } : {});
      return msg;
    } catch (e) {
      console.error("[setMsiEcCoolerBoost]", e);
      throw e;
    }
  },

  setMsiEcFanMode: async (mode) => {
    try {
      const msg = await invoke<string>("set_msi_ec_fan_mode", { mode });
      set((s) => s.msiEcState ? { msiEcState: { ...s.msiEcState, fan_mode: mode } } : {});
      return msg;
    } catch (e) {
      console.error("[setMsiEcFanMode]", e);
      throw e;
    }
  },

  setMsiEcShiftMode: async (mode) => {
    try {
      const msg = await invoke<string>("set_msi_ec_shift_mode", { mode });
      set((s) => s.msiEcState ? { msiEcState: { ...s.msiEcState, shift_mode: mode } } : {});
      return msg;
    } catch (e) {
      console.error("[setMsiEcShiftMode]", e);
      throw e;
    }
  },

  setMsiEcSuperBattery: async (enabled) => {
    try {
      const msg = await invoke<string>("set_msi_ec_super_battery", { enabled });
      set((s) => s.msiEcState ? { msiEcState: { ...s.msiEcState, super_battery: enabled } } : {});
      return msg;
    } catch (e) {
      console.error("[setMsiEcSuperBattery]", e);
      throw e;
    }
  },

  setMsiEcWebcam: async (enabled) => {
    try {
      const msg = await invoke<string>("set_msi_ec_webcam", { enabled });
      set((s) => s.msiEcState ? { msiEcState: { ...s.msiEcState, webcam: enabled } } : {});
      return msg;
    } catch (e) {
      console.error("[setMsiEcWebcam]", e);
      throw e;
    }
  },

  setMsiEcWinKey: async (mode) => {
    try {
      const msg = await invoke<string>("set_msi_ec_win_key", { mode });
      set((s) => s.msiEcState ? { msiEcState: { ...s.msiEcState, win_key: mode } } : {});
      return msg;
    } catch (e) {
      console.error("[setMsiEcWinKey]", e);
      throw e;
    }
  },

  setMsiEcFnKey: async (mode) => {
    try {
      const msg = await invoke<string>("set_msi_ec_fn_key", { mode });
      set((s) => s.msiEcState ? { msiEcState: { ...s.msiEcState, fn_key: mode } } : {});
      return msg;
    } catch (e) {
      console.error("[setMsiEcFnKey]", e);
      throw e;
    }
  },

  setMsiEcKbdBacklight: async (level) => {
    try {
      const msg = await invoke<string>("set_msi_ec_kbd_backlight", { level });
      set((s) => s.msiEcState ? { msiEcState: { ...s.msiEcState, kbd_backlight: level } } : {});
      return msg;
    } catch (e) {
      console.error("[setMsiEcKbdBacklight]", e);
      throw e;
    }
  },
}));
