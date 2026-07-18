//! Low-allocation system telemetry.
//!
//! `sysinfo` keeps useful history (notably CPU usage and network deltas) in
//! its collections.  Recreating `System`/`Networks` for every tick loses that
//! history and makes the allocator do unnecessary work, so both instances are
//! created once and kept behind a mutex for the monitor's lifetime.

use std::{
    borrow::Cow,
    collections::HashMap,
    fs,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

use serde::Serialize;
use sysinfo::{Disks, Networks, ProcessRefreshKind, System};
use tauri::AppHandle;
use tokio::net::TcpStream;

use crate::ipc::IpcEmitter;

static KERNEL_VERSION: OnceLock<String> = OnceLock::new();

const LATENCY_INTERVAL: Duration = Duration::from_secs(15);
const LATENCY_TIMEOUT: Duration = Duration::from_secs(1);
const LATENCY_TARGETS: &[&str] = &["1.1.1.1:443", "8.8.8.8:53"];
const OUTPUT_SCAN_INTERVAL: Duration = Duration::from_secs(30);
const GPU_SCAN_INTERVAL: Duration = Duration::from_secs(15);
const DISK_SCAN_INTERVAL: Duration = Duration::from_secs(600);
const FPS_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Clone)]
pub struct TelemetryEngine {
    system: Arc<Mutex<System>>,
    networks: Arc<Mutex<Networks>>,
    disks: Arc<Mutex<Disks>>,
    latency_ms: Arc<Mutex<Option<f64>>>,
    fps: Arc<Mutex<Option<f64>>>,
    active_output: Arc<Mutex<Option<String>>>,
    started_at: Instant,
    profile_switches: Arc<AtomicU64>,
    polling_interval_secs: Arc<AtomicU64>,
    started: Arc<AtomicBool>,
}

impl TelemetryEngine {
    /// Construct the single sysinfo instance used by the telemetry worker.
    pub fn new() -> Self {
        let mut system = System::new();
        // The first CPU sample is only a baseline.  Keeping the instance alive
        // lets sysinfo calculate the next sample without reallocation.
        system.refresh_cpu();
        system.refresh_memory();

        Self {
            system: Arc::new(Mutex::new(system)),
            networks: Arc::new(Mutex::new(Networks::new_with_refreshed_list())),
            disks: Arc::new(Mutex::new(Disks::new_with_refreshed_list())),
            latency_ms: Arc::new(Mutex::new(None)),
            fps: Arc::new(Mutex::new(None)),
            active_output: Arc::new(Mutex::new(None)),
            started_at: Instant::now(),
            profile_switches: Arc::new(AtomicU64::new(0)),
            polling_interval_secs: Arc::new(AtomicU64::new(2)),
            started: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn record_profile_switch(&self) {
        self.profile_switches.fetch_add(1, Ordering::Relaxed);
    }

    pub fn set_polling_interval(&self, seconds: u64) {
        self.polling_interval_secs
            .store(seconds.clamp(1, 10), Ordering::Relaxed);
    }

    /// Start exactly one periodic worker for this engine.
    pub fn start(&self, _app: AppHandle, ipc: IpcEmitter) {
        if self.started.swap(true, Ordering::AcqRel) {
            return;
        }

        let system = Arc::clone(&self.system);
        let networks = Arc::clone(&self.networks);
        let disks = Arc::clone(&self.disks);
        let latency_ms = Arc::clone(&self.latency_ms);
        let fps = Arc::clone(&self.fps);
        let active_output = Arc::clone(&self.active_output);

        // Keep latency checks independent of the one-second sysinfo loop. Try
        // multiple targets so a single blocked host doesn't kill the reading.
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(LATENCY_INTERVAL);
            loop {
                interval.tick().await;
                let sample = measure_latency().await;

                match latency_ms.lock() {
                    Ok(mut latency) => *latency = sample,
                    Err(_) => break,
                }
            }
        });

        // Output discovery is comparatively expensive and compositor-specific,
        // so keep it out of the one-second sysinfo loop and cache the result.
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(OUTPUT_SCAN_INTERVAL);
            loop {
                interval.tick().await;
                let output = tokio::task::spawn_blocking(active_display_output)
                    .await
                    .ok()
                    .flatten();
                match active_output.lock() {
                    Ok(mut current_output) => *current_output = output,
                    Err(_) => break,
                }
            }
        });

        // FPS measurement via DRM vblank counters. Falls back to display
        // refresh rate read from sysfs / xrandr / wlr-randr modes.
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(FPS_INTERVAL);
            // Skip the first immediate tick so the counter has a baseline.
            interval.tick().await;
            let mut last_vblank: Option<(u64, Instant)> = None;
            loop {
                interval.tick().await;
                let sample = sample_fps(&mut last_vblank);
                match fps.lock() {
                    Ok(mut f) => *f = sample,
                    Err(_) => break,
                }
            }
        });

        let latency_ms = Arc::clone(&self.latency_ms);
        let fps = Arc::clone(&self.fps);
        let active_output = Arc::clone(&self.active_output);
        let started_at = self.started_at;
        let profile_switches = Arc::clone(&self.profile_switches);
        let polling_interval_secs = Arc::clone(&self.polling_interval_secs);

        tauri::async_runtime::spawn(async move {
            let mut last_gpu_scan = Instant::now() - GPU_SCAN_INTERVAL;
            let mut last_process_scan = Instant::now() - Duration::from_secs(10);
            let mut last_disk_scan = Instant::now() - DISK_SCAN_INTERVAL;
            let mut gpus = Vec::new();
            loop {
                tokio::time::sleep(Duration::from_secs(
                    polling_interval_secs.load(Ordering::Relaxed).clamp(1, 10),
                ))
                .await;
                let tick_started = Instant::now();
                let should_scan_gpu = last_gpu_scan.elapsed() >= GPU_SCAN_INTERVAL;
                let should_scan_processes = last_process_scan.elapsed() >= Duration::from_secs(5);
                let should_scan_disks = last_disk_scan.elapsed() >= DISK_SCAN_INTERVAL;

                if should_scan_gpu {
                    let stage_started = Instant::now();
                    gpus = detect_gpus().await;
                    last_gpu_scan = Instant::now();
                    if stage_started.elapsed() >= Duration::from_millis(250) {
                        log::warn!(
                            "[perf] detect_gpus took {}ms",
                            stage_started.elapsed().as_millis()
                        );
                    }
                }

                // Keep the locks through emit: telemetry borrows names directly
                // from sysinfo, avoiding a String allocation per CPU/interface.
                let system_guard = match system.lock() {
                    Ok(guard) => guard,
                    Err(_) => break,
                };
                let mut networks_guard = match networks.lock() {
                    Ok(guard) => guard,
                    Err(_) => break,
                };
                let mut disks_guard = match disks.lock() {
                    Ok(guard) => guard,
                    Err(_) => break,
                };

                let mut system = system_guard;
                let stage_started = Instant::now();
                system.refresh_cpu();
                system.refresh_memory();
                // Keep process CPU deltas on the long-lived System instance so
                // the process list is not limited to the dashboard itself.
                if should_scan_processes {
                    // Request memory explicitly. The default refresh can leave
                    // cached process memory values unchanged on some sysinfo
                    // backends, which made unrelated processes show identical
                    // RAM values in the UI.
                    system.refresh_processes_specifics(
                        ProcessRefreshKind::new().with_cpu().with_memory(),
                    );
                    last_process_scan = Instant::now();
                }
                if stage_started.elapsed() >= Duration::from_millis(250) {
                    log::warn!(
                        "[perf] sysinfo refresh took {}ms (process_scan={})",
                        stage_started.elapsed().as_millis(),
                        should_scan_processes
                    );
                }
                let stage_started = Instant::now();
                networks_guard.refresh_list();
                networks_guard.refresh();
                if stage_started.elapsed() >= Duration::from_millis(250) {
                    log::warn!(
                        "[perf] network refresh took {}ms",
                        stage_started.elapsed().as_millis()
                    );
                }
                let stage_started = Instant::now();
                if should_scan_disks {
                    disks_guard.refresh();
                    last_disk_scan = Instant::now();
                    if stage_started.elapsed() >= Duration::from_millis(250) {
                        log::warn!(
                            "[perf] disk refresh took {}ms",
                            stage_started.elapsed().as_millis()
                        );
                    }
                }

                let latest_latency_ms = match latency_ms.lock() {
                    Ok(latency) => *latency,
                    Err(_) => break,
                };
                let latest_fps = match fps.lock() {
                    Ok(f) => *f,
                    Err(_) => break,
                };
                let output = match active_output.lock() {
                    Ok(output) => output.clone(),
                    Err(_) => break,
                };
                let telemetry = collect_telemetry(
                    &system,
                    &networks_guard,
                    &disks_guard,
                    latest_latency_ms,
                    latest_fps,
                    output,
                    gpus.clone(),
                    started_at.elapsed().as_secs(),
                    profile_switches.load(Ordering::Relaxed),
                );
                if tick_started.elapsed() >= Duration::from_millis(250) {
                    log::debug!(
                        "[perf] collect_telemetry reached at {}ms",
                        tick_started.elapsed().as_millis()
                    );
                }
                if !ipc.emit_latest("system-tick", &telemetry) {
                    log::debug!("telemetry event queue stopped");
                    break;
                }
                let elapsed = tick_started.elapsed();
                if elapsed >= Duration::from_millis(250) {
                    log::warn!(
                        "[perf] telemetry tick took {}ms (gpu_scan={}, process_scan={})",
                        elapsed.as_millis(),
                        should_scan_gpu,
                        should_scan_processes
                    );
                }
            }
        });
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct SystemTelemetry<'a> {
    pub timestamp_ms: u128,
    pub cpu: CpuMetrics<'a>,
    pub gpus: Vec<GpuMetrics<'a>>,
    pub temperatures: Vec<TemperatureSensor>,
    pub ram: RamMetrics,
    pub storage: StorageMetrics,
    pub storage_mounts: Vec<StorageMetrics>,
    pub network: NetworkMetrics<'a>,
    pub session: SessionMetrics,
    pub fps: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct CpuMetrics<'a> {
    pub name: Cow<'a, str>,
    pub vendor: Cow<'a, str>,
    pub total_usage_percent: f32,
    pub cores: Vec<CpuCoreMetrics>,
}

#[derive(Clone, Debug, Serialize)]
pub struct CpuCoreMetrics {
    pub core_id: usize,
    pub usage_percent: f32,
    pub frequency_mhz: u64,
    pub temperature_celsius: Option<f32>,
}

#[derive(Clone, Debug, Serialize)]
pub struct GpuMetrics<'a> {
    pub name: Cow<'a, str>,
    pub vendor: Cow<'a, str>,
    pub usage_percent: f32,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub temperature_celsius: Option<f32>,
}

#[derive(Clone, Debug, Serialize)]
pub struct TemperatureSensor {
    pub name: String,
    pub temperature_celsius: f32,
}

#[derive(Clone, Debug, Serialize)]
pub struct RamMetrics {
    pub total_gb: f64,
    pub used_gb: f64,
    pub free_gb: f64,
    pub usage_percent: f32,
    pub swap_total_gb: f64,
    pub swap_used_gb: f64,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct StorageMetrics {
    pub mount_point: String,
    pub total_gb: f64,
    pub used_gb: f64,
    pub available_gb: f64,
    pub usage_percent: f32,
}

#[derive(Clone, Debug, Serialize)]
pub struct NetworkMetrics<'a> {
    pub interfaces: Vec<NetworkInterface<'a>>,
    pub latency_ms: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct NetworkInterface<'a> {
    pub name: Cow<'a, str>,
    pub rx_bytes_per_sec: u64,
    pub tx_bytes_per_sec: u64,
    pub total_rx_gb: f64,
    pub total_tx_gb: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct SessionMetrics {
    pub system_uptime_seconds: u64,
    pub dashboard_runtime_seconds: u64,
    pub active_output: Option<String>,
    pub profile_switches: u64,
    pub kernel_version: String,
}

async fn measure_latency() -> Option<f64> {
    for target in LATENCY_TARGETS {
        let started_at = Instant::now();
        let result = tokio::time::timeout(LATENCY_TIMEOUT, TcpStream::connect(*target)).await;
        match result {
            Ok(Ok(_)) => return Some(started_at.elapsed().as_secs_f64() * 1_000.0),
            _ => continue,
        }
    }
    None
}

// ── FPS measurement ──────────────────────────────────────────────────────────

/// Return a DRM vblank counter for the first active CRTC, or None.
fn read_vblank_counter() -> Option<u64> {
    let debugfs = std::path::Path::new("/sys/kernel/debug/dri");
    if !debugfs.exists() {
        return None;
    }
    // Scan card subdirectories (0, 1, …) for crtc-*/vblank files
    for card in 0..4u32 {
        let card_dir = debugfs.join(card.to_string());
        if !card_dir.is_dir() {
            continue;
        }
        for crtc in 0..4u32 {
            let vblank_path = card_dir.join(format!("crtc-{}", crtc)).join("vblank");
            if let Ok(contents) = std::fs::read_to_string(&vblank_path) {
                if let Ok(count) = contents.trim().parse::<u64>() {
                    return Some(count);
                }
            }
        }
    }
    None
}

/// Parse the active display's refresh rate from sysfs DRM connector modes.
/// Scans /sys/class/drm/card*-*/ for connected + enabled outputs.
fn read_display_refresh_rate() -> Option<f64> {
    let drm_dir = std::path::Path::new("/sys/class/drm");
    let entries = std::fs::read_dir(drm_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name()?.to_string_lossy();
        // Connectors are card*-<output> (e.g. card0-DP-1)
        if !name.contains('-') {
            continue;
        }
        // Only connected + enabled outputs
        let status = std::fs::read_to_string(path.join("status")).unwrap_or_default();
        let enabled = std::fs::read_to_string(path.join("enabled")).unwrap_or_default();
        if status.trim() != "connected" || enabled.trim() != "enabled" {
            continue;
        }
        // Read the modes file — first line is the current mode
        let modes = std::fs::read_to_string(path.join("modes")).ok()?;
        // Format: "1920x1080@60.00" — parse the refresh rate after '@'
        for line in modes.lines() {
            if let Some(rate_str) = line.split('@').nth(1) {
                if let Ok(rate) = rate_str.trim().parse::<f64>() {
                    return Some(rate);
                }
            }
        }
    }
    None
}

/// Sample FPS using the DRM vblank counter delta. Falls back to the static
/// display refresh rate when debugfs is unavailable.
fn sample_fps(last_vblank: &mut Option<(u64, Instant)>) -> Option<f64> {
    if let Some(vblank) = read_vblank_counter() {
        let now = Instant::now();
        if let Some((prev_count, prev_time)) = *last_vblank {
            let delta_count = vblank.saturating_sub(prev_count) as f64;
            let delta_secs = now.duration_since(prev_time).as_secs_f64();
            *last_vblank = Some((vblank, now));
            if delta_secs > 0.0 && delta_count > 0.0 {
                return Some(delta_count / delta_secs);
            }
        } else {
            *last_vblank = Some((vblank, now));
        }
    }
    // Fallback: static display refresh rate
    read_display_refresh_rate()
}

fn gb(bytes: u64) -> f64 {
    bytes as f64 / 1_073_741_824.0
}

async fn detect_gpus() -> Vec<GpuMetrics<'static>> {
    let query = tokio::time::timeout(
        Duration::from_secs(3),
        tokio::process::Command::new("nvidia-smi")
            .args([
                "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
                "--format=csv,noheader,nounits",
            ])
            .output(),
    )
    .await;

    if let Ok(Ok(output)) = query {
        if output.status.success() {
            let gpus = String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter_map(|line| {
                    let fields: Vec<_> = line.split(',').map(str::trim).collect();
                    if fields.len() != 5 {
                        return None;
                    }
                    Some(GpuMetrics {
                        name: Cow::Owned(fields[0].to_owned()),
                        vendor: Cow::Borrowed("NVIDIA"),
                        usage_percent: fields[1].parse().unwrap_or(0.0),
                        memory_used_mb: fields[2].parse().unwrap_or(0),
                        memory_total_mb: fields[3].parse().unwrap_or(0),
                        temperature_celsius: fields[4].parse().ok(),
                    })
                })
                .collect::<Vec<_>>();
            if !gpus.is_empty() {
                return gpus;
            }
        }
    }

    // nvidia-smi is unavailable when the NVIDIA driver is stopped or the
    // laptop is in hybrid/low-power mode. Keep the adapter visible via PCI.
    let pci_query = tokio::time::timeout(
        Duration::from_secs(3),
        tokio::process::Command::new("lspci").output(),
    )
    .await;

    let Ok(Ok(output)) = pci_query else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| line.contains("VGA compatible controller") || line.contains("3D controller"))
        .filter_map(|line| {
            let name = line
                .split_once("VGA compatible controller:")
                .or_else(|| line.split_once("3D controller:"))?
                .1
                .trim();
            let vendor = if name.contains("NVIDIA") {
                "NVIDIA"
            } else {
                "Graphics"
            };
            Some(GpuMetrics {
                name: Cow::Owned(name.to_owned()),
                vendor: Cow::Borrowed(vendor),
                usage_percent: 0.0,
                memory_used_mb: 0,
                memory_total_mb: 0,
                temperature_celsius: None,
            })
        })
        .collect()
}

/// Read all hardware-monitor temperature inputs exposed by the Linux kernel.
/// Values are millidegrees Celsius; labels come from the driver when present.
fn read_temperature_sensors() -> Vec<TemperatureSensor> {
    let Ok(hwmons) = fs::read_dir("/sys/class/hwmon") else {
        return Vec::new();
    };

    let mut sensors = Vec::new();
    for hwmon in hwmons.flatten() {
        let path = hwmon.path();
        let device_name = fs::read_to_string(path.join("name"))
            .ok()
            .map(|name| name.trim().to_owned())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "Hardware monitor".to_owned());
        let Ok(entries) = fs::read_dir(&path) else {
            continue;
        };

        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let file_name = file_name.to_string_lossy();
            let Some(channel) = file_name
                .strip_prefix("temp")
                .and_then(|name| name.strip_suffix("_input"))
            else {
                continue;
            };
            let Some(millidegrees) = fs::read_to_string(entry.path())
                .ok()
                .and_then(|value| value.trim().parse::<f32>().ok())
            else {
                continue;
            };
            let temperature_celsius = millidegrees / 1000.0;
            if !(0.0..=150.0).contains(&temperature_celsius) {
                continue;
            }
            let label = fs::read_to_string(path.join(format!("temp{channel}_label")))
                .ok()
                .map(|label| label.trim().to_owned())
                .filter(|label| !label.is_empty())
                .unwrap_or_else(|| format!("Temperature {channel}"));
            sensors.push(TemperatureSensor {
                name: format!("{device_name} · {label}"),
                temperature_celsius,
            });
        }
    }
    sensors.sort_by(|a, b| a.name.cmp(&b.name));
    // Several DIMMs can expose the same driver/label combination (for
    // example `spd5118 · Temperature 1`). Keep both readings, but make their
    // display identity stable and unique for React and for users.
    let mut duplicate_counts = HashMap::<String, usize>::new();
    for sensor in &mut sensors {
        let count = duplicate_counts.entry(sensor.name.clone()).or_default();
        *count += 1;
        if *count > 1 {
            sensor.name.push_str(&format!(" #{}", *count));
        }
    }
    sensors
}

fn collect_telemetry<'a>(
    system: &'a System,
    networks: &'a Networks,
    disks: &'a Disks,
    latency_ms: Option<f64>,
    fps: Option<f64>,
    active_output: Option<String>,
    gpus: Vec<GpuMetrics<'a>>,
    dashboard_runtime_seconds: u64,
    profile_switches: u64,
) -> SystemTelemetry<'a> {
    let cpus = system.cpus();
    let (name, vendor) = cpus
        .first()
        .map(|cpu| (cpu.brand(), cpu.vendor_id()))
        .unwrap_or(("Unknown CPU", "Unknown vendor"));

    let total_memory = system.total_memory();
    // Match htop/Vitals-style "memory in use": reclaimable page cache is
    // available to applications and should not make RAM appear artificially
    // full. `used_memory()` is based on MemFree on Linux, while
    // MemAvailable is the useful pressure-oriented value.
    let available_memory = system.available_memory();
    let used_memory = total_memory.saturating_sub(available_memory);
    let total_swap = system.total_swap();
    let used_swap = system.used_swap();
    let root_disk = disks
        .iter()
        .find(|disk| disk.mount_point() == std::path::Path::new("/"))
        .or_else(|| disks.iter().max_by_key(|disk| disk.total_space()));
    let storage_mounts: Vec<StorageMetrics> = disks
        .iter()
        .map(|disk| {
            let total = disk.total_space();
            let available = disk.available_space();
            let used = total.saturating_sub(available);
            StorageMetrics {
                mount_point: disk.mount_point().to_string_lossy().into_owned(),
                total_gb: gb(total),
                used_gb: gb(used),
                available_gb: gb(available),
                usage_percent: used as f32 * 100.0 / total.max(1) as f32,
            }
        })
        .collect();
    let storage = root_disk.map_or_else(StorageMetrics::default, |disk| {
        let total = disk.total_space();
        let available = disk.available_space();
        let used = total.saturating_sub(available);
        StorageMetrics {
            mount_point: disk.mount_point().to_string_lossy().into_owned(),
            total_gb: gb(total),
            used_gb: gb(used),
            available_gb: gb(available),
            usage_percent: used as f32 * 100.0 / total.max(1) as f32,
        }
    });

    SystemTelemetry {
        timestamp_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |duration| duration.as_millis()),
        cpu: CpuMetrics {
            name: Cow::Borrowed(name),
            vendor: Cow::Borrowed(vendor),
            total_usage_percent: cpus.iter().map(|cpu| cpu.cpu_usage()).sum::<f32>()
                / cpus.len().max(1) as f32,
            cores: cpus
                .iter()
                .enumerate()
                .map(|(core_id, cpu)| CpuCoreMetrics {
                    core_id,
                    usage_percent: cpu.cpu_usage(),
                    frequency_mhz: cpu.frequency(),
                    temperature_celsius: None,
                })
                .collect(),
        },
        gpus,
        temperatures: read_temperature_sensors(),
        ram: RamMetrics {
            total_gb: gb(total_memory),
            used_gb: gb(used_memory),
            free_gb: gb(available_memory),
            usage_percent: used_memory as f32 * 100.0 / total_memory.max(1) as f32,
            swap_total_gb: gb(total_swap),
            swap_used_gb: gb(used_swap),
        },
        storage,
        storage_mounts,
        network: NetworkMetrics {
            interfaces: networks
                .iter()
                .map(|(name, network)| NetworkInterface {
                    name: Cow::Borrowed(name),
                    rx_bytes_per_sec: network.received(),
                    tx_bytes_per_sec: network.transmitted(),
                    total_rx_gb: gb(network.total_received()),
                    total_tx_gb: gb(network.total_transmitted()),
                })
                .collect(),
            latency_ms,
        },
        session: SessionMetrics {
            system_uptime_seconds: System::uptime(),
            dashboard_runtime_seconds,
            active_output,
            profile_switches,
            kernel_version: KERNEL_VERSION
                .get_or_init(|| System::kernel_version().unwrap_or_else(|| "Unknown".to_owned()))
                .clone(),
        },
        fps,
    }
}

fn active_display_output() -> Option<String> {
    if let Ok(wlr_output) = std::process::Command::new("wlr-randr").output() {
        if wlr_output.status.success() {
            if let Some(output) = String::from_utf8_lossy(&wlr_output.stdout)
                .lines()
                .find_map(parse_wlr_output)
            {
                return Some(output);
            }
        }
    }

    let xrandr_output = std::process::Command::new("xrandr").output().ok()?;
    if !xrandr_output.status.success() {
        return None;
    }
    let outputs = String::from_utf8_lossy(&xrandr_output.stdout);
    outputs
        .lines()
        .find(|line| line.contains(" connected primary"))
        .or_else(|| outputs.lines().find(|line| line.contains(" connected")))
        .and_then(|line| line.split_whitespace().next().map(str::to_owned))
}

fn parse_wlr_output(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if !(trimmed.contains(" enabled") || trimmed.contains("(enabled)")) {
        return None;
    }
    trimmed.split_whitespace().next().map(str::to_owned)
}

// ── Top Processes ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub process_count: u32,
    pub cpu_percent: f32,
    pub mem_mb: f64,
    pub mem_percent: f32,
}

fn parse_memory_field_mib(contents: &str, field: &str) -> Option<f64> {
    contents.lines().find_map(|line| {
        let kib = line
            .trim_start()
            .strip_prefix(field)?
            .split_ascii_whitespace()
            .next()?
            .parse::<u64>()
            .ok()?;
        Some(kib as f64 / 1024.0)
    })
}

fn parse_status_u32(contents: &str, field: &str) -> Option<u32> {
    contents.lines().find_map(|line| {
        line.trim_start()
            .strip_prefix(field)?
            .trim()
            .parse::<u32>()
            .ok()
    })
}

#[derive(Clone, Copy)]
struct ProcessMemory {
    tgid: u32,
    private_mb: f64,
    file_mb: f64,
    shmem_mb: f64,
}

fn process_memory(pid: u32, fallback_bytes: u64) -> ProcessMemory {
    let fallback_mb = fallback_bytes as f64 / 1_048_576.0;
    let Ok(status) = fs::read_to_string(format!("/proc/{pid}/status")) else {
        return ProcessMemory {
            tgid: pid,
            private_mb: fallback_mb,
            file_mb: 0.0,
            shmem_mb: 0.0,
        };
    };

    let tgid = parse_status_u32(&status, "Tgid:").unwrap_or(pid);
    let private_mb = parse_memory_field_mib(&status, "RssAnon:");
    let file_mb = parse_memory_field_mib(&status, "RssFile:");
    let shmem_mb = parse_memory_field_mib(&status, "RssShmem:");
    match (private_mb, file_mb, shmem_mb) {
        (Some(private_mb), Some(file_mb), Some(shmem_mb)) => ProcessMemory {
            tgid,
            private_mb,
            file_mb,
            shmem_mb,
        },
        _ => ProcessMemory {
            tgid,
            private_mb: parse_memory_field_mib(&status, "VmRSS:").unwrap_or(fallback_mb),
            file_mb: 0.0,
            shmem_mb: 0.0,
        },
    }
}

fn executable_identity(pid: u32) -> Option<(String, String)> {
    let executable = fs::read_link(format!("/proc/{pid}/exe")).ok()?;
    let display_name = executable.file_stem()?.to_string_lossy().into_owned();
    let key = executable.to_string_lossy().into_owned();
    (!display_name.is_empty()).then_some((key, display_name))
}

#[derive(Default)]
struct ProcessGroup {
    pid: u32,
    display_name: String,
    process_count: u32,
    cpu_percent: f32,
    mem_mb: f64,
    private_mb: f64,
    file_mb: f64,
    shmem_mb: f64,
}

/// Estimate application memory without scanning `smaps_rollup`, which can take
/// seconds for browsers with thousands of mappings. Anonymous RSS is summed
/// per process; file-backed/shared RSS is counted once per executable group.
/// This is responsive, avoids the worst RSS double counting, and follows the
/// same fast `/proc/<pid>/status` family of counters used by process monitors.
#[tauri::command]
pub fn get_top_processes(telemetry: tauri::State<'_, TelemetryEngine>) -> Vec<ProcessInfo> {
    // Copy the cheap sysinfo fields first and release the shared telemetry lock
    // before reading /proc. PSS and executable resolution can be slow on busy
    // systems and must not block the main telemetry refresh loop.
    let (num_cpus, total_memory, process_snapshot) = {
        let Ok(system) = telemetry.system.lock() else {
            return Vec::new();
        };
        let snapshot = system
            .processes()
            .values()
            .map(|process| {
                (
                    process.pid().as_u32(),
                    process.name().to_string().trim().to_owned(),
                    process.cpu_usage(),
                    process.memory(),
                )
            })
            .collect::<Vec<_>>();
        (
            system.cpus().len().max(1) as f32,
            system.total_memory() as f64,
            snapshot,
        )
    };

    let mut groups = HashMap::<String, ProcessGroup>::new();
    for (pid, process_name, cpu_usage, memory) in process_snapshot {
        if process_name.is_empty() {
            continue;
        }
        let process_memory = process_memory(pid, memory);
        // sysinfo can expose Linux tasks/TIDs alongside process leaders. Every
        // task in a thread group reports the same resident address space, so
        // counting them produced impossible values such as Cursor x311 using
        // 25 GiB. Only the thread-group leader represents process memory.
        if process_memory.tgid != pid {
            continue;
        }
        let executable = executable_identity(pid);
        let display_name = executable
            .as_ref()
            .map(|(_, name)| name.clone())
            .unwrap_or_else(|| process_name.clone());
        // Group by the resolved executable, like process monitors do. A
        // terminal-launched dev app inherits Ptyxis' systemd scope together
        // with pnpm, Vite, Cargo and the shell, so cgroup-based grouping can
        // incorrectly merge several GiB of unrelated processes under one
        // arbitrary name. Browser helpers still group correctly because their
        // /proc/<pid>/exe targets are identical.
        let key = executable
            .as_ref()
            .map(|(path, _)| format!("exe:{path}"))
            .unwrap_or_else(|| format!("name:{}", process_name.to_lowercase()));
        let cpu = (cpu_usage / num_cpus).clamp(0.0, 100.0);
        let group = groups.entry(key).or_insert_with(|| ProcessGroup {
            pid,
            display_name,
            ..ProcessGroup::default()
        });
        group.process_count += 1;
        group.cpu_percent = (group.cpu_percent + cpu).clamp(0.0, 100.0);
        group.private_mb += process_memory.private_mb;
        group.file_mb = group.file_mb.max(process_memory.file_mb);
        group.shmem_mb = group.shmem_mb.max(process_memory.shmem_mb);
        group.mem_mb = group.private_mb + group.file_mb + group.shmem_mb;
    }

    let mut groups: Vec<ProcessGroup> = groups.into_values().collect();
    groups.sort_by(|a, b| {
        b.mem_mb
            .partial_cmp(&a.mem_mb)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut procs: Vec<ProcessInfo> = groups
        .into_iter()
        .map(|group| ProcessInfo {
            pid: group.pid,
            name: group.display_name,
            process_count: group.process_count,
            cpu_percent: group.cpu_percent,
            mem_mb: group.mem_mb,
            mem_percent: if total_memory > 0.0 {
                (group.mem_mb as f32 / (total_memory / 1_048_576.0) as f32) * 100.0
            } else {
                0.0
            },
        })
        .collect();

    procs.sort_by(|a, b| {
        b.mem_mb
            .partial_cmp(&a.mem_mb)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                b.cpu_percent
                    .partial_cmp(&a.cpu_percent)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    });
    procs.truncate(8);
    procs
}

// ── Battery ────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct BatteryInfo {
    pub percent: u8,
    pub charging: bool,
    pub present: bool,
    pub status: String,
    pub estimated_runtime_minutes: Option<u32>,
    pub charge_limit_percent: Option<u8>,
    pub health_mode: bool,
    pub health_percent: Option<u8>,
}

fn find_battery_path() -> Option<std::path::PathBuf> {
    std::fs::read_dir("/sys/class/power_supply")
        .ok()?
        .filter_map(Result::ok)
        .find(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .to_ascii_uppercase()
                .starts_with("BAT")
        })
        .map(|entry| entry.path())
}

fn read_battery_value(path: &std::path::Path, name: &str) -> Option<u64> {
    std::fs::read_to_string(path.join(name))
        .ok()?
        .trim()
        .parse()
        .ok()
}

/// Read battery level from the Linux sysfs power supply class.
#[tauri::command]
pub fn get_battery() -> BatteryInfo {
    let Some(bat_path) = find_battery_path() else {
        return BatteryInfo {
            percent: 0,
            charging: false,
            present: false,
            status: "Not present".to_owned(),
            estimated_runtime_minutes: None,
            charge_limit_percent: None,
            health_mode: false,
            health_percent: None,
        };
    };

    let read_file = |name: &str| -> Option<String> {
        std::fs::read_to_string(bat_path.join(name))
            .ok()
            .map(|s| s.trim().to_owned())
    };

    let percent = read_file("capacity")
        .and_then(|s| s.parse::<u8>().ok())
        .unwrap_or(0);

    let status = read_file("status").unwrap_or_default();
    // `Full` means the charger has stopped; it is not actively charging.
    let charging = status == "Charging";
    let estimated_runtime_minutes = if charging {
        None
    } else if let Some(seconds) = read_battery_value(&bat_path, "time_to_empty_now") {
        u32::try_from(seconds / 60).ok()
    } else {
        let remaining = read_battery_value(&bat_path, "energy_now")
            .or_else(|| read_battery_value(&bat_path, "charge_now"));
        let rate = read_battery_value(&bat_path, "power_now")
            .or_else(|| read_battery_value(&bat_path, "current_now"));
        match (remaining, rate) {
            (Some(remaining), Some(rate)) if rate > 0 => {
                u32::try_from(remaining.saturating_mul(60) / rate).ok()
            }
            _ => None,
        }
    };
    let charge_limit_percent = read_battery_value(&bat_path, "charge_control_end_threshold")
        .and_then(|value| u8::try_from(value).ok());
    let full_capacity = read_battery_value(&bat_path, "energy_full")
        .or_else(|| read_battery_value(&bat_path, "charge_full"));
    let design_capacity = read_battery_value(&bat_path, "energy_full_design")
        .or_else(|| read_battery_value(&bat_path, "charge_full_design"));
    let health_percent = match (full_capacity, design_capacity) {
        (Some(full), Some(design)) if design > 0 => {
            u8::try_from(full.saturating_mul(100).saturating_div(design).min(100)).ok()
        }
        _ => None,
    };
    BatteryInfo {
        percent,
        charging,
        present: true,
        status,
        estimated_runtime_minutes,
        charge_limit_percent,
        health_mode: charge_limit_percent.is_some_and(|limit| limit <= 80),
        health_percent,
    }
}

/// Set the kernel battery charge threshold to 80% (health mode) or 100%.
#[tauri::command]
pub fn set_battery_limiter(enabled: bool) -> Result<BatteryInfo, String> {
    let battery = find_battery_path().ok_or_else(|| "Battery not detected".to_owned())?;
    let threshold = battery.join("charge_control_end_threshold");
    if !threshold.exists() {
        return Err("Battery charge threshold is not supported by this kernel/firmware".to_owned());
    }
    let value = if enabled { "80" } else { "100" };

    crate::privileged::run_privileged_action("set-battery-limit", value)?;

    let actual = read_battery_value(&battery, "charge_control_end_threshold");
    if actual != value.parse::<u64>().ok() {
        return Err(format!(
            "Firmware did not retain the requested {value}% charge limit"
        ));
    }
    Ok(get_battery())
}

// ── Running Game ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct RunningGameInfo {
    pub name: String,
    pub pid: u32,
    pub cpu_percent: f32,
    pub mem_mb: f64,
}

/// Heuristic: scan processes for known game-related executable patterns.
const GAME_PATTERNS: &[&str] = &[
    "wine",
    "proton",
    "steam",
    "lutris",
    "heroic",
    "gamescope",
    "umu-run",
    "umurun",
];

/// Returns the most likely running game process, if any.
/// Reuses the long-lived System instance from TelemetryEngine to avoid
/// recreating a fresh System + process scan each time.
#[tauri::command]
pub fn get_running_game(telemetry: tauri::State<'_, TelemetryEngine>) -> Option<RunningGameInfo> {
    let sys = match telemetry.system.lock() {
        Ok(sys) => sys,
        Err(_) => return None,
    };

    sys.processes()
        .values()
        .filter(|p| {
            let name_lower = p.name().to_ascii_lowercase();
            GAME_PATTERNS.iter().any(|pat| name_lower.contains(pat))
        })
        .max_by(|a, b| {
            a.cpu_usage()
                .partial_cmp(&b.cpu_usage())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|p| RunningGameInfo {
            name: p.name().to_string(),
            pid: p.pid().as_u32(),
            cpu_percent: p.cpu_usage(),
            mem_mb: p.memory() as f64 / 1_048_576.0,
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_memory() {
        let mut sys = System::new();
        sys.refresh_processes();
        let mut count = 0;
        for p in sys.processes().values() {
            println!(
                "Process: {} (PID {}), memory bytes: {}, mem_mb calculation: {}",
                p.name(),
                p.pid(),
                p.memory(),
                p.memory() as f64 / 1_048_576.0
            );
            count += 1;
            if count >= 5 {
                break;
            }
        }
    }

    #[test]
    fn parses_proc_memory_fields_in_mib() {
        let sample =
            "Name:\tbrave\nTgid:\t6236\nVmSize:\t409600 kB\nVmRSS:\t153600 kB\nThreads:\t12\n";
        assert_eq!(parse_memory_field_mib(sample, "VmRSS:"), Some(150.0));
        assert_eq!(parse_memory_field_mib(sample, "Pss:"), None);
        assert_eq!(parse_status_u32(sample, "Tgid:"), Some(6236));
    }
}
