use serde::Serialize;
use std::{fmt, fs, io, path::Path};
use tokio::{
    process::Command,
    time::{timeout, Duration},
};

#[derive(Debug, Serialize)]
pub struct BluetoothDevice {
    pub address: String,
    pub name: String,
    pub connected: bool,
    pub paired: bool,
    pub trusted: bool,
}
#[derive(Debug, Serialize)]
pub struct BluetoothState {
    pub powered: bool,
    pub discovering: bool,
    pub devices: Vec<BluetoothDevice>,
    pub usb_devices: Vec<UsbDevice>,
}
#[derive(Debug, Serialize)]
pub struct UsbDevice {
    pub id: String,
    pub name: String,
    pub manufacturer: Option<String>,
    pub vendor_id: String,
    pub product_id: String,
    pub kind: String,
}
#[derive(Debug, Serialize)]
pub struct BluetoothError {
    pub message: String,
}
impl fmt::Display for BluetoothError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for BluetoothError {}

async fn ctl(args: &[&str]) -> Result<String, BluetoothError> {
    let output = timeout(
        Duration::from_secs(12),
        Command::new("bluetoothctl")
            .args(args)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| BluetoothError {
        message: "Bluetooth did not respond in time".into(),
    })?
    .map_err(|e| BluetoothError {
        message: if e.kind() == io::ErrorKind::NotFound {
            "bluetoothctl is not installed".into()
        } else {
            e.to_string()
        },
    })?;
    if !output.status.success() {
        return Err(BluetoothError {
            message: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
fn yes(output: &str, key: &str) -> bool {
    output
        .lines()
        .any(|line| line.trim() == format!("{key}: yes"))
}
fn valid_address(address: &str) -> bool {
    address.len() == 17
        && address.split(':').count() == 6
        && address.chars().all(|c| c == ':' || c.is_ascii_hexdigit())
}

fn read_trimmed(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn get_usb_devices() -> Vec<UsbDevice> {
    let Ok(entries) = fs::read_dir("/sys/bus/usb/devices") else {
        return Vec::new();
    };
    let mut devices = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let id = entry.file_name().to_string_lossy().into_owned();
        // Interface nodes contain ':'. Root controllers start with "usb".
        if id.contains(':') || id.starts_with("usb") {
            continue;
        }
        let (Some(vendor_id), Some(product_id)) = (
            read_trimmed(&path.join("idVendor")),
            read_trimmed(&path.join("idProduct")),
        ) else {
            continue;
        };
        let device_class = read_trimmed(&path.join("bDeviceClass")).unwrap_or_default();
        let product = read_trimmed(&path.join("product"));
        if device_class == "09"
            || product
                .as_deref()
                .is_some_and(|name| name.to_ascii_lowercase().contains("hub"))
        {
            continue;
        }
        let manufacturer = read_trimmed(&path.join("manufacturer"));
        let name = product
            .clone()
            .or_else(|| manufacturer.clone())
            .unwrap_or_else(|| format!("USB device {vendor_id}:{product_id}"));
        let searchable = format!("{} {}", name, manufacturer.as_deref().unwrap_or_default())
            .to_ascii_lowercase();
        let kind = if ["receiver", "wireless", "dongle", "2.4g"]
            .iter()
            .any(|term| searchable.contains(term))
        {
            "Wireless receiver"
        } else {
            "USB"
        }
        .to_owned();
        devices.push(UsbDevice {
            id,
            name,
            manufacturer,
            vendor_id,
            product_id,
            kind,
        });
    }
    devices.sort_by_key(|device| device.name.to_lowercase());
    devices
}

#[tauri::command]
pub async fn get_bluetooth_state() -> Result<BluetoothState, BluetoothError> {
    // USB devices must remain visible even on systems without a Bluetooth
    // controller or while BlueZ is temporarily unavailable.
    let controller = ctl(&["show"]).await.unwrap_or_default();
    let list = ctl(&["devices"]).await.unwrap_or_default();
    let mut devices = Vec::new();
    for line in list.lines() {
        let mut parts = line.trim().splitn(3, ' ');
        if parts.next() != Some("Device") {
            continue;
        }
        let (Some(address), Some(fallback)) = (parts.next(), parts.next()) else {
            continue;
        };
        let info = ctl(&["info", address]).await.unwrap_or_default();
        let name = info
            .lines()
            .find_map(|line| line.trim().strip_prefix("Name: "))
            .unwrap_or(fallback)
            .to_owned();
        devices.push(BluetoothDevice {
            address: address.into(),
            name,
            connected: yes(&info, "Connected"),
            paired: yes(&info, "Paired"),
            trusted: yes(&info, "Trusted"),
        });
    }
    devices.sort_by_key(|d| (!d.connected, !d.paired, d.name.to_lowercase()));
    Ok(BluetoothState {
        powered: yes(&controller, "Powered"),
        discovering: yes(&controller, "Discovering"),
        devices,
        usb_devices: get_usb_devices(),
    })
}

#[tauri::command]
pub async fn scan_bluetooth_devices() -> Result<BluetoothState, BluetoothError> {
    ctl(&["power", "on"]).await?;
    ctl(&["--timeout", "8", "scan", "on"]).await?;
    get_bluetooth_state().await
}

#[tauri::command]
pub async fn connect_bluetooth_device(address: String) -> Result<BluetoothState, BluetoothError> {
    if !valid_address(&address) {
        return Err(BluetoothError {
            message: "Invalid Bluetooth address".into(),
        });
    }
    let state = get_bluetooth_state().await?;
    let device = state
        .devices
        .iter()
        .find(|d| d.address.eq_ignore_ascii_case(&address))
        .ok_or_else(|| BluetoothError {
            message: "Bluetooth device is no longer available".into(),
        })?;
    if !device.paired {
        ctl(&["pair", &address]).await?;
    }
    if !device.trusted {
        ctl(&["trust", &address]).await?;
    }
    ctl(&["connect", &address]).await?;
    get_bluetooth_state().await
}
