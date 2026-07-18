#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            audio::get_audio_state,
            audio::set_audio_volume,
            audio::toggle_audio_mute,
            audio::set_default_audio_output,
            bluetooth::get_bluetooth_state,
            bluetooth::scan_bluetooth_devices,
            bluetooth::connect_bluetooth_device,
            optimizer::set_power_profile,
            optimizer::toggle_gamemode,
            optimizer::check_gamemode_status,
            optimizer::clear_ram_cache,
            optimizer::clean_disk_cache,
            optimizer::toggle_do_not_disturb,
            optimizer::toggle_keep_awake,
            optimizer::set_shutdown_timer,
            optimizer::system_power_action,
            mpris::media_play_pause,
            mpris::media_next,
            mpris::media_previous,
            mpris::seek_media,
            mpris::get_media_info,
            monitor::get_top_processes,
            monitor::get_battery,
            monitor::set_battery_limiter,
            monitor::get_running_game,
            get_local_ip,
            msi_ec::check_msi_ec_supported,
            msi_ec::get_msi_ec_state,
            msi_ec::set_msi_ec_cooler_boost,
            msi_ec::set_msi_ec_fan_mode,
            msi_ec::set_msi_ec_shift_mode,
            msi_ec::set_msi_ec_super_battery,
            msi_ec::set_msi_ec_webcam,
            msi_ec::set_msi_ec_win_key,
            msi_ec::set_msi_ec_fn_key,
            msi_ec::set_msi_ec_kbd_backlight,
            operating_mode::set_operating_mode,
            privileged::check_helper_installation,
            mangohud::is_mangohud_installed,
            mangohud::is_mangohud_configured,
            mangohud::configure_mangohud,
            mangohud::enable_mangohud_for_launch,
            mangohud::list_recent_game_sessions,
        ])
        .setup(|app| {
            let ipc = IpcEmitter::start(app.handle().clone());
            audio::start(ipc.clone());
            app.manage(mpris::start(ipc.clone()));
            let telemetry = TelemetryEngine::new();
            telemetry.start(app.handle().clone(), ipc.clone());
            // Re-enable MangoHud/Game Mode monitoring. The worker is
            // intentionally throttled (8s while a log is active, 5s while
            // idle) so FPS history is available without recreating the
            // previous high-frequency polling lag.
            mangohud::start_worker(app.handle().clone(), ipc.clone());
            app.manage(ipc);
            app.manage(telemetry);
            app.manage(optimizer::KeepAwakeState::new());

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let window = app
                .get_webview_window("main")
                .ok_or_else(|| "main webview window was not created".to_owned())?;

            // Start at 80% of the active monitor so the initial window is
            // comfortable on 720p/FHD/2K/4K displays. Fullscreen later uses
            // the monitor's native size; this native call avoids frontend
            // `window.set_size` permission errors and resize feedback loops.
            if let Ok(Some(monitor)) = window.current_monitor() {
                let monitor_size = monitor.size();
                let width = ((monitor_size.width as f64) * 0.8).round() as u32;
                let height = ((monitor_size.height as f64) * 0.8).round() as u32;
                let _ = window.set_size(tauri::PhysicalSize::new(width, height));
            }

            // Opening WebKitGTK's inspector automatically makes development
            // restarts much less reliable on Linux. Keep it opt-in so normal
            // `tauri dev` runs have the same stable window lifecycle as a
            // release build. Set PURRDORA_OPEN_DEVTOOLS=1 when it is needed.
            #[cfg(debug_assertions)]
            if std::env::var_os("PURRDORA_OPEN_DEVTOOLS").is_some() {
                window.open_devtools();
            }

            window.center()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match &event {
                tauri::RunEvent::ExitRequested { code, .. } => {
                    log::info!("application exit requested (code: {code:?})");
                }
                tauri::RunEvent::Exit => log::info!("application event loop exited"),
                _ => {}
            }
            if let tauri::RunEvent::Exit = event {
                if let Some(shutdown) = app.try_state::<mpris::MprisShutdown>() {
                    shutdown.shutdown();
                }
                if let Some(keep_awake) = app.try_state::<optimizer::KeepAwakeState>() {
                    keep_awake.stop();
                }
            }
        });
}
mod audio;
mod bluetooth;
mod ipc;
mod mangohud;
mod monitor;
mod msi_ec;
mod operating_mode;
mod optimizer;
mod privileged;

use ipc::IpcEmitter;
use monitor::TelemetryEngine;
use tauri::Manager;
mod mpris;

#[tauri::command]
fn get_local_ip() -> Option<String> {
    use std::net::UdpSocket;

    // Connecting a UDP socket does not send traffic, but lets the OS select
    // the interface currently used for the default route.
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("1.1.1.1:80").ok()?;
    let address = socket.local_addr().ok()?.ip();
    (!address.is_loopback()).then(|| address.to_string())
}
