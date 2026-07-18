//! Low-allocation system telemetry.
//!
//! `sysinfo` keeps useful history (notably CPU usage and network deltas) in
//! its collections.  Recreating `System`/`Networks` for every tick loses that
//! history and makes the allocator do unnecessary work, so both instances are
//! created once and kept behind a mutex for the monitor's lifetime.

use std::{
    borrow::Cow,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use serde::Serialize;
use sysinfo::{Networks, System};
use tauri::AppHandle;

use crate::ipc::IpcEmitter;

const TELEMETRY_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Clone)]
pub struct TelemetryEngine {
    system: Arc<Mutex<System>>,
    networks: Arc<Mutex<Networks>>,
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
            started: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Start exactly one periodic worker for this engine.
    pub fn start(&self, _app: AppHandle, ipc: IpcEmitter) {
        if self.started.swap(true, Ordering::AcqRel) {
            return;
        }

        let system = Arc::clone(&self.system);
        let networks = Arc::clone(&self.networks);

        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(TELEMETRY_INTERVAL);
            // The first interval tick is immediate; discard it so CPU usage
            // has a complete sampling interval to calculate.
            interval.tick().await;
            loop {
                interval.tick().await;

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

                let mut system = system_guard;
                system.refresh_cpu();
                system.refresh_memory();
                networks_guard.refresh_list();
                networks_guard.refresh();

                let telemetry = collect_telemetry(&system, &networks_guard);
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
    pub network: NetworkMetrics<'a>,
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

#[derive(Clone, Debug, Serialize)]
pub struct NetworkMetrics<'a> {
    pub interfaces: Vec<NetworkInterface<'a>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct NetworkInterface<'a> {
    pub name: Cow<'a, str>,
    pub rx_bytes_per_sec: u64,
    pub tx_bytes_per_sec: u64,
    pub total_rx_gb: f64,
    pub total_tx_gb: f64,
}

fn gb(bytes: u64) -> f64 {
    bytes as f64 / 1_073_741_824.0
}

fn collect_telemetry<'a>(system: &'a System, networks: &'a Networks) -> SystemTelemetry<'a> {
    let cpus = system.cpus();
    let (name, vendor) = cpus
        .first()
        .map(|cpu| (cpu.brand(), cpu.vendor_id()))
        .unwrap_or(("Unknown CPU", "Unknown vendor"));

    let total_memory = system.total_memory();
    let used_memory = system.used_memory();
    let total_swap = system.total_swap();
    let used_swap = system.used_swap();

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
        gpus: Vec::new(),
        ram: RamMetrics {
            total_gb: gb(total_memory),
            used_gb: gb(used_memory),
            free_gb: gb(total_memory.saturating_sub(used_memory)),
            usage_percent: used_memory as f32 * 100.0 / total_memory.max(1) as f32,
            swap_total_gb: gb(total_swap),
            swap_used_gb: gb(used_swap),
        },
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
        },
    }
}
