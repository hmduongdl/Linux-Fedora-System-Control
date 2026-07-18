use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    process::{Child, Command},
    sync::Mutex,
};
use tokio::{
    process::Command as AsyncCommand,
    sync::Mutex as AsyncMutex,
    time::{timeout, Duration},
};
use zbus::proxy;

const POWER_PROFILE_TIMEOUT: Duration = Duration::from_secs(5);
pub(crate) static SYSTEM_CONTROL_LOCK: AsyncMutex<()> = AsyncMutex::const_new(());

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum PowerProfile {
    PowerSaver,
    Balanced,
    Performance,
}

#[derive(Debug, Serialize)]
pub struct ToggleResult {
    pub active: bool,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct ShutdownTimerResult {
    pub active: bool,
    pub minutes: Option<u32>,
    pub message: String,
}

pub struct KeepAwakeState(Mutex<Option<Child>>);

impl KeepAwakeState {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }

    pub fn stop(&self) {
        if let Ok(mut inhibitor) = self.0.lock() {
            if let Some(mut child) = inhibitor.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

impl PowerProfile {
    pub(crate) fn as_dbus_value(&self) -> &'static str {
        match self {
            Self::PowerSaver => "power-saver",
            Self::Balanced => "balanced",
            Self::Performance => "performance",
        }
    }
}

#[proxy(
    interface = "org.freedesktop.UPower.PowerProfiles",
    default_service = "org.freedesktop.UPower.PowerProfiles",
    default_path = "/org/freedesktop/UPower/PowerProfiles"
)]
trait PowerProfiles {
    #[zbus(property, name = "ActiveProfile")]
    fn active_profile(&self) -> zbus::Result<String>;
    #[zbus(property, name = "ActiveProfile")]
    fn set_active_profile(&self, profile: &str) -> zbus::Result<()>;
}

#[proxy(
    interface = "com.feralinteractive.GameMode",
    default_service = "com.feralinteractive.GameMode",
    default_path = "/com/feralinteractive/GameMode"
)]
trait GameMode {
    #[zbus(name = "RegisterGame")]
    fn register_game(&self, pid: u32) -> zbus::Result<()>;
    #[zbus(name = "UnregisterGame")]
    fn unregister_game(&self, pid: u32) -> zbus::Result<()>;
    #[zbus(name = "QueryStatus")]
    fn query_status(&self) -> zbus::Result<u32>;
}

#[tauri::command]
pub async fn set_power_profile(
    profile: PowerProfile,
    telemetry: tauri::State<'_, crate::monitor::TelemetryEngine>,
) -> Result<String, String> {
    let _control_guard = SYSTEM_CONTROL_LOCK
        .try_lock()
        .map_err(|_| "another system mode change is already running".to_owned())?;
    let active_profile = set_power_profile_value(profile, &telemetry).await?;
    apply_power_profile_hardware(profile)?;
    Ok(active_profile)
}

/// Keep the MSI EC settings aligned with the user-selected system power profile.
/// Cooler Boost remains an explicit user choice; a profile change only selects its
/// corresponding fan preset.
fn apply_power_profile_hardware(profile: PowerProfile) -> Result<(), String> {
    let fan_mode = match profile {
        PowerProfile::PowerSaver => "silent",
        PowerProfile::Balanced => "auto",
        PowerProfile::Performance => "advanced",
    };

    crate::msi_ec::set_msi_ec_fan_mode(fan_mode.to_owned()).map_err(|error| {
        format!(
            "power profile was changed, but fan mode '{fan_mode}' could not be applied: {error}"
        )
    })?;

    match profile {
        PowerProfile::PowerSaver => crate::monitor::set_battery_limiter(true)
            .map(|_| ())
            .map_err(|error| {
                format!(
                    "power profile was changed, but battery limiter could not be enabled: {error}"
                )
            }),
        PowerProfile::Performance => crate::monitor::set_battery_limiter(false)
            .map(|_| ())
            .map_err(|error| {
                format!(
                    "power profile was changed, but battery limiter could not be disabled: {error}"
                )
            }),
        PowerProfile::Balanced => Ok(()),
    }
}

pub(crate) async fn set_power_profile_value(
    profile: PowerProfile,
    telemetry: &crate::monitor::TelemetryEngine,
) -> Result<String, String> {
    let profile_val = profile.as_dbus_value();

    // Try standard DBus invocation first
    let dbus_result = async {
        let connection = zbus::Connection::system().await?;
        let proxy = PowerProfilesProxy::new(&connection).await?;
        proxy.set_active_profile(profile_val).await?;
        let active = proxy.active_profile().await?;
        Ok::<String, zbus::Error>(active)
    }
    .await;

    let active_profile = match dbus_result {
        Ok(active) => active,
        Err(e) => {
            log::warn!("DBus power profile switch failed: {e}. Trying powerprofilesctl...");
            match set_power_profile_with_cli(profile_val).await {
                Ok(active) => active,
                Err(cli_error) => {
                    log::warn!(
                        "powerprofilesctl fallback failed: {cli_error}. Trying tuned-adm..."
                    );
                    match set_power_profile_with_tuned(profile_val).await {
                        Ok(active) => active,
                        Err(tuned_error) => {
                            log::warn!(
                                "tuned-adm fallback failed: {tuned_error}. Trying helper..."
                            );
                            crate::privileged::run_privileged_action("set-power-profile", profile_val)
                                .map_err(|helper_error| {
                                    format!("{cli_error}; {tuned_error}; helper fallback failed: {helper_error}")
                                })?;
                            profile_val.to_owned()
                        }
                    }
                }
            }
        }
    };

    telemetry.record_profile_switch();
    Ok(active_profile)
}

async fn set_power_profile_with_cli(profile: &str) -> Result<String, String> {
    let command = [
        "/usr/bin/powerprofilesctl",
        "/usr/local/bin/powerprofilesctl",
        "powerprofilesctl",
    ]
    .into_iter()
    .find(|candidate| *candidate == "powerprofilesctl" || Path::new(candidate).is_file())
    .ok_or_else(|| {
        "powerprofilesctl is not installed; install power-profiles-daemon with `sudo dnf install power-profiles-daemon`".to_owned()
    })?;

    let set_output = timeout(
        POWER_PROFILE_TIMEOUT,
        AsyncCommand::new(command).args(["set", profile]).output(),
    )
    .await
    .map_err(|_| "powerprofilesctl set timed out".to_owned())?
    .map_err(|error| format!("could not start powerprofilesctl: {error}"))?;

    if !set_output.status.success() {
        return Err(format!(
            "powerprofilesctl rejected {profile}: {}",
            String::from_utf8_lossy(&set_output.stderr).trim()
        ));
    }

    let get_output = timeout(
        POWER_PROFILE_TIMEOUT,
        AsyncCommand::new(command).arg("get").output(),
    )
    .await
    .map_err(|_| "powerprofilesctl get timed out".to_owned())?
    .map_err(|error| format!("could not verify power profile: {error}"))?;

    if !get_output.status.success() {
        return Err(format!(
            "power profile verification failed: {}",
            String::from_utf8_lossy(&get_output.stderr).trim()
        ));
    }

    let active = String::from_utf8_lossy(&get_output.stdout)
        .trim()
        .to_owned();
    if active != profile {
        return Err(format!(
            "power profile verification returned {active}, expected {profile}"
        ));
    }
    Ok(active)
}

async fn set_power_profile_with_tuned(profile: &str) -> Result<String, String> {
    let tuned_profile = match profile {
        "power-saver" => "powersave",
        "balanced" => "balanced",
        // TuneD does not expose a profile literally named "performance".
        "performance" => "throughput-performance",
        _ => return Err(format!("unsupported power profile: {profile}")),
    };

    let set_output = timeout(
        POWER_PROFILE_TIMEOUT,
        AsyncCommand::new("tuned-adm")
            .args(["profile", tuned_profile])
            .output(),
    )
    .await
    .map_err(|_| "tuned-adm profile switch timed out".to_owned())?
    .map_err(|error| format!("could not start tuned-adm: {error}"))?;

    if !set_output.status.success() {
        return Err(format!(
            "tuned-adm rejected {tuned_profile}: {}",
            String::from_utf8_lossy(&set_output.stderr).trim()
        ));
    }

    let active_output = timeout(
        POWER_PROFILE_TIMEOUT,
        AsyncCommand::new("tuned-adm").arg("active").output(),
    )
    .await
    .map_err(|_| "tuned-adm verification timed out".to_owned())?
    .map_err(|error| format!("could not verify tuned profile: {error}"))?;

    if !active_output.status.success() {
        return Err(format!(
            "tuned-adm verification failed: {}",
            String::from_utf8_lossy(&active_output.stderr).trim()
        ));
    }

    let active = String::from_utf8_lossy(&active_output.stdout);
    if !active.lines().any(|line| {
        line.trim() == tuned_profile || line.trim().ends_with(&format!("profile: {tuned_profile}"))
    }) {
        return Err(format!(
            "tuned profile verification did not return {tuned_profile}"
        ));
    }
    Ok(profile.to_owned())
}

pub(crate) fn set_notifications_muted(muted: bool) -> Result<(), String> {
    let status = Command::new("gsettings")
        .args([
            "set",
            "org.gnome.desktop.notifications",
            "show-banners",
            if muted { "false" } else { "true" },
        ])
        .status()
        .map_err(|error| format!("could not update GNOME notifications: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("GNOME rejected notification mode".to_owned())
    }
}

#[tauri::command]
pub async fn toggle_gamemode() -> Result<String, String> {
    let connection = zbus::Connection::session()
        .await
        .map_err(|e| format!("GameMode session bus unavailable: {e}"))?;
    let proxy = GameModeProxy::new(&connection)
        .await
        .map_err(|e| format!("GameMode daemon unavailable: {e}"))?;
    let pid = std::process::id();
    let status = proxy
        .query_status()
        .await
        .map_err(|e| format!("GameMode status query failed: {e}"))?;
    if status == 0 {
        proxy
            .register_game(pid)
            .await
            .map_err(|e| format!("GameMode activation rejected: {e}"))?;
        // Turn off health mode (battery charge limit) when activating game mode
        let _ = crate::monitor::set_battery_limiter(false);
        Ok("GameMode enabled".to_owned())
    } else {
        proxy
            .unregister_game(pid)
            .await
            .map_err(|e| format!("GameMode deactivation rejected: {e}"))?;
        Ok("GameMode disabled".to_owned())
    }
}

#[tauri::command]
pub async fn check_gamemode_status() -> Result<String, String> {
    let connection = zbus::Connection::session()
        .await
        .map_err(|e| format!("GameMode session bus unavailable: {e}"))?;
    let proxy = GameModeProxy::new(&connection)
        .await
        .map_err(|e| format!("GameMode daemon unavailable: {e}"))?;
    let status = proxy
        .query_status()
        .await
        .map_err(|e| format!("GameMode status query failed: {e}"))?;
    Ok(if status == 0 { "inactive" } else { "active" }.to_owned())
}

#[tauri::command]
pub fn clear_ram_cache() -> Result<String, String> {
    crate::privileged::run_privileged_action("drop-caches", "")?;
    Ok("RAM cache dropped".to_owned())
}

/// Remove only DNF's downloaded package metadata/cache; never touches user files.
#[tauri::command]
pub fn clean_disk_cache() -> Result<String, String> {
    crate::privileged::run_privileged_action("clean-disk-cache", "")?;
    Ok("DNF package cache cleaned".to_owned())
}

#[tauri::command]
pub fn toggle_do_not_disturb() -> Result<ToggleResult, String> {
    let output = Command::new("gsettings")
        .args(["get", "org.gnome.desktop.notifications", "show-banners"])
        .output()
        .map_err(|error| format!("GNOME notification settings unavailable: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "could not read GNOME notification setting: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let banners_visible = match String::from_utf8_lossy(&output.stdout).trim() {
        "true" => true,
        "false" => false,
        value => return Err(format!("unexpected GNOME notification setting: {value}")),
    };
    let do_not_disturb = banners_visible;
    let status = Command::new("gsettings")
        .args([
            "set",
            "org.gnome.desktop.notifications",
            "show-banners",
            if do_not_disturb { "false" } else { "true" },
        ])
        .status()
        .map_err(|error| format!("could not update GNOME notification setting: {error}"))?;
    if !status.success() {
        return Err("GNOME rejected the Do Not Disturb change".to_owned());
    }

    Ok(ToggleResult {
        active: do_not_disturb,
        message: if do_not_disturb {
            "Do Not Disturb enabled"
        } else {
            "Do Not Disturb disabled"
        }
        .to_owned(),
    })
}

#[tauri::command]
pub fn toggle_keep_awake(state: tauri::State<'_, KeepAwakeState>) -> Result<ToggleResult, String> {
    let mut inhibitor = state
        .0
        .lock()
        .map_err(|_| "Keep Awake state is unavailable".to_owned())?;

    if let Some(child) = inhibitor.as_mut() {
        match child.try_wait() {
            Ok(None) => {
                child
                    .kill()
                    .map_err(|error| format!("could not stop Keep Awake inhibitor: {error}"))?;
                let _ = child.wait();
                *inhibitor = None;
                return Ok(ToggleResult {
                    active: false,
                    message: "Keep Awake disabled".to_owned(),
                });
            }
            Ok(Some(_)) => *inhibitor = None,
            Err(error) => return Err(format!("could not inspect Keep Awake inhibitor: {error}")),
        }
    }

    let child = Command::new("systemd-inhibit")
        .args([
            "--what=idle:sleep",
            "--mode=block",
            "--why=Purrdora Keep Awake",
            "sleep",
            "infinity",
        ])
        .spawn()
        .map_err(|error| format!("could not start systemd inhibitor: {error}"))?;
    *inhibitor = Some(child);

    Ok(ToggleResult {
        active: true,
        message: "Keep Awake enabled".to_owned(),
    })
}

#[tauri::command]
pub fn set_shutdown_timer(minutes: Option<u32>) -> Result<ShutdownTimerResult, String> {
    match minutes {
        Some(minutes) if (1..=1_440).contains(&minutes) => {
            let output = Command::new("shutdown")
                .args(["-h", &format!("+{minutes}")])
                .output()
                .map_err(|error| format!("could not schedule shutdown: {error}"))?;
            if !output.status.success() {
                return Err(format!(
                    "shutdown schedule rejected: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                ));
            }
            Ok(ShutdownTimerResult {
                active: true,
                minutes: Some(minutes),
                message: format!("Shutdown scheduled in {minutes} minutes"),
            })
        }
        Some(_) => Err("shutdown timer must be between 1 and 1,440 minutes".to_owned()),
        None => {
            let output = Command::new("shutdown")
                .arg("-c")
                .output()
                .map_err(|error| format!("could not cancel shutdown: {error}"))?;
            if !output.status.success() {
                return Err(format!(
                    "shutdown cancellation rejected: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                ));
            }
            Ok(ShutdownTimerResult {
                active: false,
                minutes: None,
                message: "Scheduled shutdown cancelled".to_owned(),
            })
        }
    }
}

#[tauri::command]
pub fn system_power_action(action: String) -> Result<(), String> {
    if !matches!(action.as_str(), "poweroff" | "reboot") {
        return Err(format!("unsupported power action: {action}"));
    }
    let output = Command::new("systemctl")
        .args([action.as_str(), "--no-wall"])
        .output()
        .map_err(|error| format!("could not {action} system: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "{} rejected: {}",
            action,
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}
