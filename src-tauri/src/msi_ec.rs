use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

const MSI_EC_PATH: &str = "/sys/devices/platform/msi-ec";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsiEcState {
    pub is_supported: bool,
    pub cooler_boost: bool,
    pub fan_mode: String,
    pub available_fan_modes: Vec<String>,
    pub shift_mode: String,
    pub available_shift_modes: Vec<String>,
    pub super_battery: bool,
    pub webcam: bool,
    pub win_key: String,
    pub fn_key: String,
    pub kbd_backlight: u32,
    pub kbd_backlight_max: u32,
    pub cpu_fan_speed: u32,
    pub cpu_temp: u32,
    pub gpu_fan_speed: u32,
    pub gpu_temp: u32,
    pub acpi_thermal_temp: u32,
    pub fw_version: String,
    pub fw_release_date: String,
}

impl Default for MsiEcState {
    fn default() -> Self {
        Self {
            is_supported: false,
            cooler_boost: false,
            fan_mode: "unknown".to_owned(),
            available_fan_modes: vec![],
            shift_mode: "unknown".to_owned(),
            available_shift_modes: vec![],
            super_battery: false,
            webcam: false,
            win_key: "unknown".to_owned(),
            fn_key: "unknown".to_owned(),
            kbd_backlight: 0,
            kbd_backlight_max: 0,
            cpu_fan_speed: 0,
            cpu_temp: 0,
            gpu_fan_speed: 0,
            gpu_temp: 0,
            acpi_thermal_temp: 0,
            fw_version: "unknown".to_owned(),
            fw_release_date: "unknown".to_owned(),
        }
    }
}

fn read_sys_file<P: AsRef<Path>>(path: P) -> Option<String> {
    fs::read_to_string(path).ok().map(|s| s.trim().to_owned())
}

fn read_sys_u32<P: AsRef<Path>>(path: P) -> u32 {
    read_sys_file(path)
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0)
}

fn read_acpi_thermal_temp() -> u32 {
    fs::read_dir("/sys/class/thermal")
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("thermal_zone")
        })
        .filter_map(|entry| {
            let dir = entry.path();
            let kind = fs::read_to_string(dir.join("type")).ok()?;
            if !kind.to_ascii_lowercase().contains("acpi") {
                return None;
            }
            let millidegrees = fs::read_to_string(dir.join("temp"))
                .ok()?
                .trim()
                .parse::<i64>()
                .ok()?;
            Some((millidegrees / 1000).clamp(0, 200) as u32)
        })
        .max()
        .unwrap_or(0)
}

fn write_sys_file<P: AsRef<Path>>(path: P, value: &str) -> Result<(), String> {
    let p = path.as_ref();
    let filename = p.file_name().and_then(|f| f.to_str()).unwrap_or("");

    let action = match filename {
        "cooler_boost" => Some("set-cooler-boost"),
        "fan_mode" => Some("set-fan-mode"),
        "shift_mode" => Some("set-shift-mode"),
        "super_battery" => Some("set-super-battery"),
        "webcam" => Some("set-webcam"),
        "win_key" => Some("set-win-key"),
        "fn_key" => Some("set-fn-key"),
        "brightness" => Some("set-kbd-backlight"),
        _ => None,
    };

    let act =
        action.ok_or_else(|| format!("Unsupported privileged sysfs path: {}", p.display()))?;
    crate::privileged::run_privileged_action(act, value)
}

fn ensure_supported(base: &Path) -> Result<(), String> {
    if base.exists() {
        Ok(())
    } else {
        Err("msi-ec driver not supported or not loaded".to_owned())
    }
}

fn validate_mode(base: &Path, available_file: &str, mode: &str) -> Result<(), String> {
    let available = read_sys_file(base.join(available_file))
        .ok_or_else(|| format!("MSI EC attribute {available_file} is unavailable"))?;
    if available
        .split_whitespace()
        .any(|candidate| candidate == mode)
    {
        Ok(())
    } else {
        Err(format!(
            "Unsupported mode '{mode}'. Available values: {}",
            available.replace('\n', ", ")
        ))
    }
}

#[tauri::command]
pub fn check_msi_ec_supported() -> bool {
    Path::new(MSI_EC_PATH).exists()
}

#[tauri::command]
pub fn get_msi_ec_state() -> MsiEcState {
    let base = Path::new(MSI_EC_PATH);
    if !base.exists() {
        return MsiEcState::default();
    }

    let cooler_boost = read_sys_file(base.join("cooler_boost"))
        .map(|s| s == "on")
        .unwrap_or(false);

    let fan_mode = read_sys_file(base.join("fan_mode")).unwrap_or_else(|| "unknown".to_owned());

    let available_fan_modes = read_sys_file(base.join("available_fan_modes"))
        .map(|s| s.split_whitespace().map(|x| x.to_owned()).collect())
        .unwrap_or_default();

    let shift_mode = read_sys_file(base.join("shift_mode")).unwrap_or_else(|| "unknown".to_owned());

    let available_shift_modes = read_sys_file(base.join("available_shift_modes"))
        .map(|s| s.split_whitespace().map(|x| x.to_owned()).collect())
        .unwrap_or_default();

    let super_battery = read_sys_file(base.join("super_battery"))
        .map(|s| s == "on")
        .unwrap_or(false);

    let webcam = read_sys_file(base.join("webcam"))
        .map(|s| s == "on")
        .unwrap_or(false);

    let win_key = read_sys_file(base.join("win_key")).unwrap_or_else(|| "unknown".to_owned());
    let fn_key = read_sys_file(base.join("fn_key")).unwrap_or_else(|| "unknown".to_owned());

    let kbd_backlight = read_sys_u32(base.join("leds/msiacpi::kbd_backlight/brightness"));
    let kbd_backlight_max = read_sys_u32(base.join("leds/msiacpi::kbd_backlight/max_brightness"));

    let cpu_fan_speed = read_sys_u32(base.join("cpu/realtime_fan_speed"));
    let cpu_temp = read_sys_u32(base.join("cpu/realtime_temperature"));
    let gpu_fan_speed = read_sys_u32(base.join("gpu/realtime_fan_speed"));
    let gpu_temp = read_sys_u32(base.join("gpu/realtime_temperature"));
    let acpi_thermal_temp = read_acpi_thermal_temp();

    let fw_version = read_sys_file(base.join("fw_version")).unwrap_or_else(|| "unknown".to_owned());
    let fw_release_date =
        read_sys_file(base.join("fw_release_date")).unwrap_or_else(|| "unknown".to_owned());

    MsiEcState {
        is_supported: true,
        cooler_boost,
        fan_mode,
        available_fan_modes,
        shift_mode,
        available_shift_modes,
        super_battery,
        webcam,
        win_key,
        fn_key,
        kbd_backlight,
        kbd_backlight_max,
        cpu_fan_speed,
        cpu_temp,
        gpu_fan_speed,
        gpu_temp,
        acpi_thermal_temp,
        fw_version,
        fw_release_date,
    }
}

#[tauri::command]
pub fn set_msi_ec_cooler_boost(enabled: bool) -> Result<String, String> {
    let base = Path::new(MSI_EC_PATH);
    ensure_supported(base)?;
    let value = if enabled { "on" } else { "off" };
    write_sys_file(base.join("cooler_boost"), value)?;
    Ok(format!("Cooler Boost set to {}", value))
}

#[tauri::command]
pub fn set_msi_ec_fan_mode(mode: String) -> Result<String, String> {
    let base = Path::new(MSI_EC_PATH);
    ensure_supported(base)?;
    validate_mode(base, "available_fan_modes", &mode)?;
    write_sys_file(base.join("fan_mode"), &mode)?;
    Ok(format!("Fan mode set to {}", mode))
}

#[tauri::command]
pub fn set_msi_ec_shift_mode(mode: String) -> Result<String, String> {
    let base = Path::new(MSI_EC_PATH);
    ensure_supported(base)?;
    validate_mode(base, "available_shift_modes", &mode)?;
    write_sys_file(base.join("shift_mode"), &mode)?;
    Ok(format!("Shift mode (performance profile) set to {}", mode))
}

#[tauri::command]
pub fn set_msi_ec_super_battery(enabled: bool) -> Result<String, String> {
    let base = Path::new(MSI_EC_PATH);
    ensure_supported(base)?;
    let value = if enabled { "on" } else { "off" };
    write_sys_file(base.join("super_battery"), value)?;
    Ok(format!("Super Battery set to {}", value))
}

#[tauri::command]
pub fn set_msi_ec_webcam(enabled: bool) -> Result<String, String> {
    let base = Path::new(MSI_EC_PATH);
    ensure_supported(base)?;
    let value = if enabled { "on" } else { "off" };
    write_sys_file(base.join("webcam"), value)?;
    Ok(format!("Webcam set to {}", value))
}

#[tauri::command]
pub fn set_msi_ec_win_key(mode: String) -> Result<String, String> {
    let base = Path::new(MSI_EC_PATH);
    ensure_supported(base)?;
    write_sys_file(base.join("win_key"), &mode)?;
    Ok(format!("Windows key setting set to {}", mode))
}

#[tauri::command]
pub fn set_msi_ec_fn_key(mode: String) -> Result<String, String> {
    let base = Path::new(MSI_EC_PATH);
    ensure_supported(base)?;
    write_sys_file(base.join("fn_key"), &mode)?;
    Ok(format!("Fn key setting set to {}", mode))
}

#[tauri::command]
pub fn set_msi_ec_kbd_backlight(level: u32) -> Result<String, String> {
    let base = Path::new(MSI_EC_PATH);
    ensure_supported(base)?;
    let path = base.join("leds/msiacpi::kbd_backlight/brightness");
    let max = read_sys_u32(base.join("leds/msiacpi::kbd_backlight/max_brightness"));
    if max == 0 {
        return Err("Keyboard backlight control is not supported".to_owned());
    }
    if level > max {
        return Err(format!(
            "Invalid keyboard backlight level {level}; maximum is {max}"
        ));
    }
    write_sys_file(path, &level.to_string())?;
    Ok(format!("Keyboard backlight level set to {}", level))
}
