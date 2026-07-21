use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;

use crate::pci_ids;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrphanDevice {
    pub bus: String,
    pub vendor_id: String,
    pub device_id: String,
    pub class_id: Option<String>,
    pub vendor_name: Option<String>,
    pub device_name: Option<String>,
    pub subsystem_vendor: Option<String>,
    pub subsystem_device: Option<String>,
    pub kernel_driver_hint: Option<String>,
}

fn read_sysfs_hex(path: &Path, file: &str) -> Option<u16> {
    let raw = fs::read_to_string(path.join(file)).ok()?;
    let trimmed = raw.trim().trim_start_matches("0x");
    u16::from_str_radix(trimmed, 16).ok()
}

fn read_sysfs_str(path: &Path, file: &str) -> Option<String> {
    let raw = fs::read_to_string(path.join(file)).ok()?;
    let trimmed = raw.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn get_driver_name(path: &Path) -> Option<String> {
    let driver_link = path.join("driver");
    if driver_link.is_symlink() {
        if let Ok(target) = fs::read_link(driver_link) {
            if let Some(name) = target.file_name() {
                return Some(name.to_string_lossy().to_string());
            }
        }
        Some("kernel-builtin".into())
    } else {
        None
    }
}

fn extract_modalias_hint(modalias: &str) -> Option<String> {
    // modalias format: pci:v000010DEd000025A2sv...
    modalias.split('v').nth(2).and_then(|s| {
        let d_part = s.split('d').nth(1)?;
        let hex = d_part.get(..4)?;
        u16::from_str_radix(hex, 16).ok()?;
        Some(format!("modalias:{}", hex))
    })
}

fn scan_pci_orphans() -> Vec<OrphanDevice> {
    let pci_root = Path::new("/sys/bus/pci/devices");
    let entries = match fs::read_dir(pci_root) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    let mut orphans = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() || get_driver_name(&path).is_some() {
            continue;
        }

        let vendor_val = read_sysfs_hex(&path, "vendor");
        let device_val = read_sysfs_hex(&path, "device");
        let (vendor_id, device_id) = match (vendor_val, device_val) {
            (Some(v), Some(d)) => (v, d),
            _ => continue,
        };

        let vendor_name = pci_ids::resolve_vendor_name(vendor_id);
        let device_name = pci_ids::resolve_pci_name(vendor_id, device_id);

        let class_id = read_sysfs_str(&path, "class");
        let subsystem_vendor = read_sysfs_hex(&path, "subsystem_vendor")
            .map(|v| format!("{v:04x}"));
        let subsystem_device = read_sysfs_hex(&path, "subsystem_device")
            .map(|v| format!("{v:04x}"));

        let kernel_driver_hint = read_sysfs_str(&path, "modalias")
            .and_then(|m| extract_modalias_hint(&m));

        orphans.push(OrphanDevice {
            bus: "pci".into(),
            vendor_id: format!("{vendor_id:04x}"),
            device_id: format!("{device_id:04x}"),
            class_id,
            vendor_name,
            device_name,
            subsystem_vendor,
            subsystem_device,
            kernel_driver_hint,
        });
    }

    orphans
}

fn scan_usb_orphans() -> Vec<OrphanDevice> {
    let usb_root = Path::new("/sys/bus/usb/devices");
    let entries = match fs::read_dir(usb_root) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    let mut orphans = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() || get_driver_name(&path).is_some() {
            continue;
        }

        let vendor_raw = match read_sysfs_str(&path, "idVendor") {
            Some(v) => v,
            None => continue,
        };
        let device_raw = match read_sysfs_str(&path, "idProduct") {
            Some(d) => d,
            None => continue,
        };

        let vendor_id = u16::from_str_radix(&vendor_raw, 16).ok();
        let device_id = u16::from_str_radix(&device_raw, 16).ok();
        let (vendor_id, device_id) = match (vendor_id, device_id) {
            (Some(v), Some(d)) => (v, d),
            _ => continue,
        };

        let vendor_name = pci_ids::resolve_vendor_name(vendor_id);
        let device_name = pci_ids::resolve_pci_name(vendor_id, device_id);

        orphans.push(OrphanDevice {
            bus: "usb".into(),
            vendor_id: format!("{vendor_id:04x}"),
            device_id: format!("{device_id:04x}"),
            class_id: None,
            vendor_name,
            device_name,
            subsystem_vendor: None,
            subsystem_device: None,
            kernel_driver_hint: None,
        });
    }

    orphans
}

#[tauri::command]
pub fn scan_orphan_devices() -> Vec<OrphanDevice> {
    pci_ids::init();
    let mut devices = scan_pci_orphans();
    devices.extend(scan_usb_orphans());
    devices
}

// ── FULL HARDWARE INVENTORY (CATEGORIZED SCAN) ───────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FullHardwareDevice {
    pub id: String,
    pub category: String, // "Bộ xử lý & Chipset", "Lưu trữ", "Mạng & Kết nối", "Đồ họa", "Nguồn điện & Pin"
    pub type_name: String,
    pub name: String,
    pub vendor: String,
    pub driver: String,
    pub version: String,
    pub pci_id: Option<String>,
    pub status: String,
    pub status_text: String,
    pub details: Option<String>,
}

#[tauri::command]
pub fn scan_full_hardware_devices() -> Vec<FullHardwareDevice> {
    pci_ids::init();
    let mut list = Vec::new();

    // 1. CPU
    if let Ok(cpuinfo) = fs::read_to_string("/proc/cpuinfo") {
        let model = cpuinfo
            .lines()
            .find_map(|l| l.strip_prefix("model name").and_then(|s| s.split(':').nth(1)))
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "Bộ xử lý x86_64".into());

        let vendor = cpuinfo
            .lines()
            .find_map(|l| l.strip_prefix("vendor_id").and_then(|s| s.split(':').nth(1)))
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "Intel/AMD".into());

        let core_count = cpuinfo.lines().filter(|l| l.starts_with("processor")).count();

        list.push(FullHardwareDevice {
            id: "cpu-main".into(),
            category: "Bộ xử lý & Chipset".into(),
            type_name: "cpu".into(),
            name: model,
            vendor,
            driver: "kernel-builtin".into(),
            version: format!("{} nhân / luồng", core_count),
            pci_id: None,
            status: "active".into(),
            status_text: "Hoạt động tốt".into(),
            details: Some(format!("Core count: {}", core_count)),
        });
    }

    // 2. ALL PCI DEVICES (Chipset, Graphics, Storage Controllers, Audio, Network)
    let pci_root = Path::new("/sys/bus/pci/devices");
    if let Ok(entries) = fs::read_dir(pci_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let vendor_val = read_sysfs_hex(&path, "vendor");
            let device_val = read_sysfs_hex(&path, "device");
            let (vendor_id, device_id) = match (vendor_val, device_val) {
                (Some(v), Some(d)) => (v, d),
                _ => continue,
            };

            let vendor_name = pci_ids::resolve_vendor_name(vendor_id)
                .unwrap_or_else(|| format!("Vendor 0x{:04x}", vendor_id));
            let device_name = pci_ids::resolve_pci_name(vendor_id, device_id)
                .unwrap_or_else(|| format!("PCI Device 0x{:04x}", device_id));

            let class_hex = read_sysfs_str(&path, "class").unwrap_or_default();
            let driver = get_driver_name(&path);

            // Categorize by PCI Class ID
            let category = if class_hex.starts_with("0x03") {
                "Đồ họa"
            } else if class_hex.starts_with("0x02") {
                "Mạng & Kết nối"
            } else if class_hex.starts_with("0x01") {
                "Lưu trữ"
            } else {
                "Bộ xử lý & Chipset"
            };

            let type_name = if class_hex.starts_with("0x03") {
                "gpu"
            } else if class_hex.starts_with("0x02") {
                "net"
            } else if class_hex.starts_with("0x01") {
                "storage"
            } else {
                "chipset"
            };

            let is_missing = driver.is_none();
            let driver_str = driver.unwrap_or_else(|| "Chưa có trình điều khiển".into());

            let slot_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let pci_str = format!("{:04x}:{:04x}", vendor_id, device_id);

            list.push(FullHardwareDevice {
                id: format!("pci-{}", slot_name),
                category: category.into(),
                type_name: type_name.into(),
                name: device_name,
                vendor: vendor_name,
                driver: driver_str,
                version: format!("PCI {}", slot_name),
                pci_id: Some(pci_str),
                status: if is_missing { "missing".into() } else { "active".into() },
                status_text: if is_missing { "Thiếu trình điều khiển".into() } else { "Đã kích hoạt".into() },
                details: Some(format!("Class: {}", class_hex)),
            });
        }
    }

    // 3. USB DEVICES
    let usb_root = Path::new("/sys/bus/usb/devices");
    if let Ok(entries) = fs::read_dir(usb_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let vendor_raw = match read_sysfs_str(&path, "idVendor") {
                Some(v) => v,
                None => continue,
            };
            let device_raw = match read_sysfs_str(&path, "idProduct") {
                Some(d) => d,
                None => continue,
            };

            let vendor_id = u16::from_str_radix(&vendor_raw, 16).unwrap_or(0);
            let device_id = u16::from_str_radix(&device_raw, 16).unwrap_or(0);
            if vendor_id == 0 || device_id == 0 {
                continue;
            }

            let product = read_sysfs_str(&path, "product")
                .or_else(|| pci_ids::resolve_pci_name(vendor_id, device_id))
                .unwrap_or_else(|| format!("USB Device {:04x}:{:04x}", vendor_id, device_id));

            let manufacturer = read_sysfs_str(&path, "manufacturer")
                .or_else(|| pci_ids::resolve_vendor_name(vendor_id))
                .unwrap_or_else(|| format!("Vendor {:04x}", vendor_id));

            let driver = get_driver_name(&path);
            let is_missing = driver.is_none();
            let dev_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();

            list.push(FullHardwareDevice {
                id: format!("usb-{}", dev_name),
                category: "Mạng & Kết nối".into(),
                type_name: "usb".into(),
                name: product,
                vendor: manufacturer,
                driver: driver.unwrap_or_else(|| "Chưa có trình điều khiển".into()),
                version: "USB Bus".into(),
                pci_id: Some(format!("{:04x}:{:04x}", vendor_id, device_id)),
                status: if is_missing { "missing".into() } else { "active".into() },
                status_text: if is_missing { "Thiếu trình điều khiển".into() } else { "Đã kích hoạt".into() },
                details: None,
            });
        }
    }

    // 4. POWER SUPPLY & BATTERY
    let power_root = Path::new("/sys/class/power_supply");
    if let Ok(entries) = fs::read_dir(power_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let p_type = read_sysfs_str(&path, "type").unwrap_or_else(|| "Power".into());
            let model = read_sysfs_str(&path, "model_name").unwrap_or_else(|| name.clone());
            let vendor = read_sysfs_str(&path, "manufacturer").unwrap_or_else(|| "OEM".into());
            let status = read_sysfs_str(&path, "status").unwrap_or_else(|| "Online".into());
            let cap = read_sysfs_str(&path, "capacity").map(|c| format!("{}%", c)).unwrap_or_else(|| status.clone());

            list.push(FullHardwareDevice {
                id: format!("power-{}", name),
                category: "Nguồn điện & Pin".into(),
                type_name: "power".into(),
                name: format!("{} ({})", model, p_type),
                vendor,
                driver: "kernel-power".into(),
                version: cap,
                pci_id: None,
                status: "active".into(),
                status_text: status,
                details: None,
            });
        }
    }

    list
}

// ── PHYSICAL STORAGE DISK SCANNER (LSBLK INTEGRATION) ───────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartitionInfo {
    pub name: String,
    pub mountpoint: Option<String>,
    pub fstype: Option<String>,
    pub size_bytes: u64,
    pub size_gb: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhysicalDiskInfo {
    pub name: String,
    pub dev_path: String,
    pub model: String,
    pub tran: Option<String>,
    pub is_ssd: bool,
    pub total_bytes: u64,
    pub total_gb: f64,
    pub total_tb: f64,
    pub partitions: Vec<PartitionInfo>,
}

#[derive(Deserialize)]
struct LsblkChild {
    name: String,
    size: Option<u64>,
    #[serde(rename = "type")]
    _device_type: Option<String>,
    fstype: Option<String>,
    mountpoints: Option<Vec<Option<String>>>,
}

#[derive(Deserialize)]
struct LsblkDisk {
    name: String,
    size: Option<u64>,
    #[serde(rename = "type")]
    device_type: Option<String>,
    model: Option<String>,
    rota: Option<bool>,
    tran: Option<String>,
    children: Option<Vec<LsblkChild>>,
}

#[derive(Deserialize)]
struct LsblkOutput {
    blockdevices: Vec<LsblkDisk>,
}

#[tauri::command]
pub fn scan_physical_disks() -> Vec<PhysicalDiskInfo> {
    let output = Command::new("lsblk")
        .args(["-b", "-J", "-o", "NAME,SIZE,TYPE,MODEL,ROTA,TRAN,MOUNTPOINTS,FSTYPE"])
        .output();

    let stdout = match output {
        Ok(out) if out.status.success() => out.stdout,
        _ => return Vec::new(),
    };

    let parsed: LsblkOutput = match serde_json::from_slice(&stdout) {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };

    let mut result = Vec::new();

    for disk in parsed.blockdevices {
        // Filter out zram, loop, and non-disk devices
        if disk.device_type.as_deref() != Some("disk") || disk.name.starts_with("zram") || disk.name.starts_with("loop") {
            continue;
        }

        let total_bytes = disk.size.unwrap_or(0);
        if total_bytes == 0 {
            continue;
        }

        let total_gb = total_bytes as f64 / 1_000_000_000.0;
        let total_tb = total_bytes as f64 / 1_000_000_000_000.0;
        let model_str = disk.model.filter(|m| !m.is_empty()).unwrap_or_else(|| disk.name.clone());
        let is_ssd = !disk.rota.unwrap_or(true);

        let mut partitions = Vec::new();
        if let Some(children) = disk.children {
            for child in children {
                let p_bytes = child.size.unwrap_or(0);
                let p_gb = p_bytes as f64 / 1_000_000_000.0;
                let primary_mount = child.mountpoints
                    .and_then(|pts| pts.into_iter().flatten().find(|m| !m.is_empty()));

                partitions.push(PartitionInfo {
                    name: child.name,
                    mountpoint: primary_mount,
                    fstype: child.fstype,
                    size_bytes: p_bytes,
                    size_gb: p_gb,
                });
            }
        }

        result.push(PhysicalDiskInfo {
            dev_path: format!("/dev/{}", disk.name),
            name: disk.name,
            model: model_str,
            tran: disk.tran,
            is_ssd,
            total_bytes,
            total_gb,
            total_tb,
            partitions,
        });
    }

    result
}


// ── MISSING FIRMWARE BLOB SCANNER ───────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct MissingFirmware {
    pub firmware_path: String,
    pub kernel_module: Option<String>,
    pub timestamp: u64,
}

#[derive(Debug, serde::Deserialize)]
struct JournalEntry {
    #[serde(rename = "__REALTIME_TIMESTAMP")]
    timestamp: Option<String>,
    #[serde(rename = "SYSLOG_IDENTIFIER")]
    identifier: Option<String>,
    #[serde(rename = "MESSAGE")]
    message: Option<String>,
}

fn extract_firmware_info(message: &str) -> Option<(&str, Option<&str>)> {
    if !message.contains("Direct firmware load for") || !message.contains("failed with error -2") {
        return None;
    }

    let path = message
        .split("Direct firmware load for ")
        .nth(1)?
        .split(" failed with error")
        .next()?
        .trim();

    let module = message
        .split_whitespace()
        .next()
        .filter(|word| !word.starts_with("Direct") && !word.is_empty())
        .map(|s| s.trim_end_matches(':'));

    Some((path, module))
}

fn deduplicate_firmware(found: Vec<MissingFirmware>) -> Vec<MissingFirmware> {
    let mut seen = std::collections::HashSet::new();
    found
        .into_iter()
        .filter(|f| seen.insert(f.firmware_path.clone()))
        .collect()
}

fn parse_journalctl_json(raw: &str) -> Vec<JournalEntry> {
    raw.lines()
        .filter_map(|line| serde_json::from_str::<JournalEntry>(line).ok())
        .collect()
}

fn collect_missing_firmware() -> Vec<MissingFirmware> {
    let output = Command::new("journalctl")
        .args(["-k", "--since", "24 hours ago", "--output=json"])
        .output();

    let stdout = match output {
        Ok(out) if out.status.success() => out.stdout,
        _ => return Vec::new(),
    };

    let raw = String::from_utf8_lossy(&stdout);
    let entries = parse_journalctl_json(&raw);

    let mut found: Vec<MissingFirmware> = Vec::new();

    for entry in &entries {
        let message = match &entry.message {
            Some(m) => m,
            None => continue,
        };

        if entry.identifier.as_deref() != Some("kernel") {
            continue;
        }

        let (path, module) = match extract_firmware_info(message) {
            Some(p) => p,
            None => continue,
        };

        let timestamp = entry
            .timestamp
            .as_deref()
            .and_then(|t| t.parse::<f64>().ok())
            .map(|t| (t / 1_000_000.0) as u64)
            .unwrap_or(0);

        found.push(MissingFirmware {
            firmware_path: path.to_string(),
            kernel_module: module.map(str::to_string),
            timestamp,
        });
    }

    found.sort_by_key(|f| f.timestamp);
    deduplicate_firmware(found)
}

#[tauri::command]
pub fn scan_missing_firmware() -> Vec<MissingFirmware> {
    collect_missing_firmware()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scan_physical_disks() {
        let disks = scan_physical_disks();
        println!("Disks found: {:#?}", disks);
        assert!(!disks.is_empty(), "Should find at least 1 physical disk");
        let nvme = disks.iter().find(|d| d.name.contains("nvme"));
        if let Some(disk) = nvme {
            assert!(disk.total_gb > 900.0, "Physical disk capacity should be ~1TB (900+ GB), got {} GB", disk.total_gb);
        }
    }
}
