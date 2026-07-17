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
}

export interface SystemTelemetry {
  timestamp_ms: number;
  cpu: CpuMetrics;
  gpus: GpuMetrics[];
  ram: RamMetrics;
  network: NetworkMetrics;
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
