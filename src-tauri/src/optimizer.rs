use serde::Deserialize;
use std::fs;
use zbus::proxy;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PowerProfile {
    PowerSaver,
    Balanced,
    Performance,
}

impl PowerProfile {
    fn as_dbus_value(&self) -> &'static str {
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
    fn set_profile(&self, profile: &str) -> zbus::Result<()>;
    #[zbus(property, name = "ActiveProfile")]
    fn active_profile(&self) -> zbus::Result<String>;
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
pub async fn set_power_profile(profile: PowerProfile) -> Result<String, String> {
    let connection = zbus::Connection::system()
        .await
        .map_err(|e| format!("power profile system bus unavailable: {e}"))?;
    let proxy = PowerProfilesProxy::new(&connection)
        .await
        .map_err(|e| format!("power profile daemon unavailable: {e}"))?;
    proxy
        .set_profile(profile.as_dbus_value())
        .await
        .map_err(|e| format!("power profile rejected: {e}"))?;
    proxy
        .active_profile()
        .await
        .map_err(|e| format!("power profile could not be verified: {e}"))
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
    fs::write("/proc/sys/vm/drop_caches", b"3\n")
        .map_err(|e| format!("drop caches denied by the OS: {e}"))?;
    Ok("RAM cache dropped".to_owned())
}
