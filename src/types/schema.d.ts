/* ── TypeScript Interfaces cho SP-System-Monitor ── */

/** ── System Telemetry (CPU, RAM, GPU, Network) ── */

export interface CpuCoreMetrics {
  core_id: number;
  usage_percent: number;
  frequency_mhz: number;
  temperature_celsius: number | null;
}

export interface CpuMetrics {
  name: string;
  vendor: string;
  total_usage_percent: number;
  cores: CpuCoreMetrics[];
}

export interface GpuMetrics {
  name: string;
  vendor: string;
  usage_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  temperature_celsius: number | null;
}

export interface RamMetrics {
  total_gb: number;
  used_gb: number;
  free_gb: number;
  usage_percent: number;
  swap_total_gb: number;
  swap_used_gb: number;
}

export interface NetworkInterface {
  name: string;
  rx_bytes_per_sec: number;
  tx_bytes_per_sec: number;
  total_rx_gb: number;
  total_tx_gb: number;
}

export interface NetworkMetrics {
  interfaces: NetworkInterface[];
  /** TCP handshake latency to the monitor probe, or null while offline. */
  latency_ms: number | null;
}

/** Derived client-side samples from the `system-tick` network payload. */
export interface NetworkHistoryPoint {
  timestamp_ms: number;
  download_bytes_per_sec: number;
  upload_bytes_per_sec: number;
  latency_ms: number | null;
}

/** Derived client-side samples from CPU/RAM/ping/fps fields in `system-tick`. */
export interface PerformanceHistoryPoint {
  timestamp_ms: number;
  cpu_percent: number;
  ram_percent: number;
  latency_ms: number | null;
  fps: number | null;
  avg_temp: number | null;
}

export interface SystemTelemetry {
  timestamp_ms: number;
  cpu: CpuMetrics;
  gpus: GpuMetrics[];
  ram: RamMetrics;
  storage: StorageMetrics;
  storage_mounts: StorageMetrics[];
  network: NetworkMetrics;
  session: SessionMetrics;
  /** Frames-per-second sampled from DRM vblank counters, or display refresh rate as fallback. */
  fps: number | null;
}

export interface StorageMetrics {
  mount_point: string;
  total_gb: number;
  used_gb: number;
  available_gb: number;
  usage_percent: number;
}

export interface SessionMetrics {
  system_uptime_seconds: number;
  dashboard_runtime_seconds: number;
  active_output: string | null;
  profile_switches: number;
  kernel_version: string;
}

/** ── Audio State (PipeWire / WirePlumber Mixer) ── */

export interface AudioStream {
  id: number;
  name: string;
  application_name: string;
  media_class: "Stream/Input/Audio" | "Stream/Output/Audio";
  volume_percent: number;
  is_muted: boolean;
  state: "active" | "idle" | "suspended";
}

export interface AudioDevice {
  id: number;
  name: string;
  description: string;
  is_default: boolean;
  volume_percent: number;
  is_muted: boolean;
  streams: AudioStream[];
}

export interface AudioState {
  timestamp_ms: number;
  default_sink: AudioDevice | null;
  default_source: AudioDevice | null;
  inputs: AudioDevice[];
  outputs: AudioDevice[];
}

/** ── Media State (MPRIS Player Metadata) ── */

export interface MprisMetadata {
  title: string;
  artist: string | null;
  album: string | null;
  art_url: string | null;
  length_seconds: number;
}

export interface MprisPlayer {
  bus_name: string;
  identity: string;
  desktop_entry: string;
  playback_status: "Playing" | "Paused" | "Stopped";
  position_seconds: number;
  volume_percent: number;
  metadata: MprisMetadata | null;
  can_play: boolean;
  can_pause: boolean;
  can_next: boolean;
  can_previous: boolean;
  can_seek: boolean;
}

export interface MediaState {
  timestamp_ms: number;
  players: MprisPlayer[];
  active_player_bus_name: string | null;
}

/** ── Media Info (matches Rust MediaInfo struct) ── */

export interface MediaInfo {
  title: string;
  artist: string;
  album: string;
  art_url: string;
  playback_status: string;
  player_name: string;
  position_seconds: number;
  length_seconds: number;
}

/** ── Optimizer & GameMode ── */

export interface PerformanceProfile {
  name: string;
  cpu_governor: "powersave" | "performance" | "schedutil";
  gpu_power_profile: "auto" | "performance" | "low-power";
  gamemode_enabled: boolean;
}

export interface AppSettings {
  refresh_interval_ms: number;
  active_profile: PerformanceProfile;
}

/** Frontend state for optimizer toggles. */
export interface SystemControlState {
  is_gamemode_active: boolean;
  is_do_not_disturb_active: boolean;
  is_keep_awake_active: boolean;
}

/** Matches Rust `ToggleResult` returned by DND and Keep Awake commands. */
export interface ControlToggleResult {
  active: boolean;
  message: string;
}

/** Frontend state for the shutdown schedule; timestamp is client-side. */
export interface ShutdownTimerState {
  minutes: number | null;
  scheduled_at_ms: number | null;
}

/** Matches Rust `ShutdownTimerResult` returned by `set_shutdown_timer`. */
export interface ShutdownTimerResult {
  active: boolean;
  minutes: number | null;
  message: string;
}

/** Matches Rust `ProcessInfo` returned by `get_top_processes`. */
export interface ProcessInfo {
  pid: number;
  name: string;
  cpu_percent: number;
  mem_mb: number;
  mem_percent: number;
}

/** Matches Rust `BatteryInfo` returned by `get_battery`. */
export interface BatteryInfo {
  percent: number;
  charging: boolean;
  present: boolean;
  status: string;
  estimated_runtime_minutes: number | null;
  charge_limit_percent: number | null;
  health_mode: boolean;
  health_percent: number | null;
}

/** Matches Rust `RunningGameInfo` returned by `get_running_game`. */
export interface RunningGameInfo {
  name: string;
  pid: number;
  cpu_percent: number;
  mem_mb: number;
}

export interface MsiEcState {
  is_supported: boolean;
  cooler_boost: boolean;
  fan_mode: string;
  available_fan_modes: string[];
  shift_mode: string;
  available_shift_modes: string[];
  super_battery: boolean;
  webcam: boolean;
  win_key: string;
  fn_key: string;
  kbd_backlight: number;
  kbd_backlight_max: number;
  cpu_fan_speed: number;
  cpu_temp: number;
  gpu_fan_speed: number;
  gpu_temp: number;
  acpi_thermal_temp: number;
  fw_version: string;
  fw_release_date: string;
}

export interface GameFpsUpdate {
  fps: number | null;
  frametime_ms: number | null;
  timestamp: number;
}

export interface GameSession {
  filename: string;
  start_time_ms: number;
  average_fps: number | null;
}
