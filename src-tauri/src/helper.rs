use std::env;
use std::fs;
use std::path::Path;
use std::process::Command;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: purrdora-helper <action> [value]");
        std::process::exit(1);
    }

    let action = &args[1];

    let result = match action.as_str() {
        "drop-caches" => drop_caches(),
        "clean-disk-cache" => clean_disk_cache(),
        _ => {
            if args.len() < 3 {
                eprintln!("Usage: purrdora-helper {} <value>", action);
                std::process::exit(1);
            }
            let value = &args[2];
            match action.as_str() {
                "set-fan-mode" => set_fan_mode(value),
                "set-shift-mode" => set_shift_mode(value),
                "set-cooler-boost" => set_cooler_boost(value),
                "set-super-battery" => set_super_battery(value),
                "set-webcam" => set_webcam(value),
                "set-win-key" => set_win_key(value),
                "set-fn-key" => set_fn_key(value),
                "set-kbd-backlight" => set_kbd_backlight(value),
                "set-battery-limit" => set_battery_limit(value),
                "set-power-profile" => set_power_profile(value),
                _ => {
                    eprintln!("Unknown action: {}", action);
                    std::process::exit(1);
                }
            }
        }
    };

    if let Err(e) = result {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    }
    println!("Success");
}

fn write_sys(path: &str, value: &str) -> Result<(), String> {
    write_sys_path(Path::new(path), value)
}

fn write_sys_path(path: &Path, value: &str) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }
    fs::write(path, value).map_err(|e| format!("Failed to write to {}: {}", path.display(), e))
}

fn set_fan_mode(mode: &str) -> Result<(), String> {
    let safe_modes = ["auto", "silent", "basic", "advanced"];
    if !safe_modes.contains(&mode) {
        return Err(format!("Invalid fan mode: {}", mode));
    }
    write_sys("/sys/devices/platform/msi-ec/fan_mode", mode)
}

fn set_shift_mode(mode: &str) -> Result<(), String> {
    let safe_modes = ["eco", "comfort", "sport", "turbo", "user"];
    if !safe_modes.contains(&mode) {
        return Err(format!("Invalid shift mode: {}", mode));
    }
    write_sys("/sys/devices/platform/msi-ec/shift_mode", mode)
}

fn set_cooler_boost(val: &str) -> Result<(), String> {
    if val != "on" && val != "off" {
        return Err("Value must be 'on' or 'off'".to_owned());
    }
    write_sys("/sys/devices/platform/msi-ec/cooler_boost", val)
}

fn set_super_battery(val: &str) -> Result<(), String> {
    if val != "on" && val != "off" {
        return Err("Value must be 'on' or 'off'".to_owned());
    }
    write_sys("/sys/devices/platform/msi-ec/super_battery", val)
}

fn set_webcam(val: &str) -> Result<(), String> {
    if val != "on" && val != "off" {
        return Err("Value must be 'on' or 'off'".to_owned());
    }
    write_sys("/sys/devices/platform/msi-ec/webcam", val)
}

fn set_win_key(val: &str) -> Result<(), String> {
    if val != "left" && val != "right" {
        return Err("Value must be 'left' or 'right'".to_owned());
    }
    write_sys("/sys/devices/platform/msi-ec/win_key", val)
}

fn set_fn_key(val: &str) -> Result<(), String> {
    if val != "left" && val != "right" {
        return Err("Value must be 'left' or 'right'".to_owned());
    }
    write_sys("/sys/devices/platform/msi-ec/fn_key", val)
}

fn set_kbd_backlight(val: &str) -> Result<(), String> {
    let level: u32 = val
        .parse()
        .map_err(|_| "Must be a valid number".to_owned())?;
    let max_brightness = fs::read_to_string(
        "/sys/devices/platform/msi-ec/leds/msiacpi::kbd_backlight/max_brightness",
    )
    .ok()
    .and_then(|s| s.trim().parse::<u32>().ok())
    .unwrap_or(3);
    if level > max_brightness {
        return Err(format!(
            "Level exceeds max brightness of {}",
            max_brightness
        ));
    }
    write_sys(
        "/sys/devices/platform/msi-ec/leds/msiacpi::kbd_backlight/brightness",
        &level.to_string(),
    )
}

fn set_battery_limit(val: &str) -> Result<(), String> {
    if val != "80" && val != "100" {
        return Err("Battery limit must be 80 or 100".to_owned());
    }
    let bat_dir = fs::read_dir("/sys/class/power_supply")
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .find(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            name.starts_with("bat")
        })
        .ok_or_else(|| "No battery found".to_owned())?;
    let path = bat_dir.path().join("charge_control_end_threshold");
    write_sys_path(&path, val)
}

fn set_power_profile(profile: &str) -> Result<(), String> {
    let safe_profiles = ["power-saver", "balanced", "performance"];
    if !safe_profiles.contains(&profile) {
        return Err(format!("Invalid power profile: {}", profile));
    }
    let status = Command::new("powerprofilesctl")
        .args(["set", profile])
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("powerprofilesctl command failed".to_owned())
    }
}

fn drop_caches() -> Result<(), String> {
    let _ = Command::new("sync").status();
    write_sys("/proc/sys/vm/drop_caches", "3")
}

fn clean_disk_cache() -> Result<(), String> {
    let status = Command::new("dnf")
        .args(["clean", "all"])
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("dnf clean all command failed".to_owned())
    }
}

