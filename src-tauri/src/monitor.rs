//! Low-allocation system telemetry.
//!
//! `sysinfo` keeps useful history (notably CPU usage and network deltas) in
//! its collections.  Recreating `System`/`Networks` for every tick loses that
//! history and makes the allocator do unnecessary work, so both instances are
//! created once and kept behind a mutex for the monitor's lifetime.

use std::{
    borrow::Cow,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

use serde::Serialize;
use sysinfo::{Disks, Networks, System};
use tauri::AppHandle;
use tokio::net::TcpStream;

use crate::ipc::IpcEmitter;

static KERNEL_VERSION: OnceLock<String> = OnceLock::new();

const LATENCY_INTERVAL: Duration = Duration::from_secs(15);
const LATENCY_TIMEOUT: Duration = Duration::from_secs(1);
const LATENCY_TARGETS: &[&str] = &["1.1.1.1:443", "8.8.8.8:53"];
const OUTPUT_SCAN_INTERVAL: Duration = Duration::from_secs(30);
const GPU_SCAN_INTERVAL: Duration = Duration::from_secs(15);
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
            let mut gpus = Vec::new();
            loop {
                tokio::time::sleep(Duration::from_secs(
                    polling_interval_secs.load(Ordering::Relaxed).clamp(1, 10),
                ))
                .await;

                if last_gpu_scan.elapsed() >= GPU_SCAN_INTERVAL {
                    gpus = detect_gpus().await;
                    last_gpu_scan = Instant::now();
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
                system.refresh_cpu();
                system.refresh_memory();
                // Keep process CPU deltas on the long-lived System instance so
                // the process list is not limited to the dashboard itself.
                if last_process_scan.elapsed() >= Duration::from_secs(5) {
                    system.refresh_processes();
                    last_process_scan = Instant::now();
                }
                networks_guard.refresh_list();
                networks_guard.refresh();
                disks_guard.refresh();

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
                if !ipc.emit_latest("system-tick", &telemetry) {
                    log::debug!("telemetry event queue stopped");
                    break;
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
    let used_memory = system.used_memory();
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
        ram: RamMetrics {
            total_gb: gb(total_memory),
            used_gb: gb(used_memory),
            free_gb: gb(total_memory.saturating_sub(used_memory)),
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
    pub cpu_percent: f32,
    pub mem_mb: f64,
    pub mem_percent: f32,
}

/// Returns proportional set size (PSS), which divides shared pages between
/// processes. Summing RSS for multi-process applications such as browsers
/// counts the same shared memory repeatedly and substantially over-reports RAM.
fn process_memory_mib(pid: u32, rss_bytes: u64) -> f64 {
    let path = format!("/proc/{pid}/smaps_rollup");
    std::fs::read_to_string(path)
        .ok()
        .and_then(|contents| parse_pss_mib(&contents))
        .unwrap_or(rss_bytes as f64 / 1_048_576.0)
}

fn parse_pss_mib(smaps_rollup: &str) -> Option<f64> {
    smaps_rollup.lines().find_map(|line| {
        let kib = line
            .trim_start()
            .strip_prefix("Pss:")?
            .split_ascii_whitespace()
            .next()?
            .parse::<u64>()
            .ok()?;
        Some(kib as f64 / 1024.0)
    })
}

#[tauri::command]
pub fn get_top_processes(telemetry: tauri::State<'_, TelemetryEngine>) -> Vec<ProcessInfo> {
    let Ok(system) = telemetry.system.lock() else {
        return Vec::new();
    };

    let num_cpus = system.cpus().len().max(1) as f32;
    let total_memory = system.total_memory() as f64;

    // Group processes by name to avoid duplicates with the same memory/GB usage (e.g., multiple browser processes)
    use std::collections::HashMap;
    let mut grouped: HashMap<String, (u32, f32, f64)> = HashMap::new();

    for p in system.processes().values() {
        let name = p.name();
        if name.is_empty() {
            continue;
        }
        let name_str = name.to_string();
        let cpu = (p.cpu_usage() / num_cpus).clamp(0.0, 100.0);
        let mem = process_memory_mib(p.pid().as_u32(), p.memory());

        let entry = grouped
            .entry(name_str)
            .or_insert((p.pid().as_u32(), 0.0, 0.0));
        entry.1 += cpu;
        entry.2 += mem;
    }

    let mut procs: Vec<ProcessInfo> = grouped
        .into_iter()
        .map(|(name, (pid, cpu_percent, mem_mb))| ProcessInfo {
            pid,
            name,
            cpu_percent,
            mem_mb,
            mem_percent: if total_memory > 0.0 {
                (mem_mb as f32 / (total_memory / 1_048_576.0) as f32) * 100.0
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
    fn parses_pss_from_proc_smaps_rollup_in_mib() {
        let sample = "Rss:              409600 kB\nPss:              153600 kB\nPss_Dirty:         10240 kB\n";
        assert_eq!(parse_pss_mib(sample), Some(150.0));
        assert_eq!(parse_pss_mib("Rss: 1024 kB\n"), None);
    }
}
