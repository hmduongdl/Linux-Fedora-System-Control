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
            optimizer::set_power_profile,
            optimizer::toggle_gamemode,
            optimizer::check_gamemode_status,
            optimizer::clear_ram_cache,
            optimizer::clean_disk_cache,
            optimizer::toggle_do_not_disturb,
            optimizer::toggle_keep_awake,
            optimizer::set_shutdown_timer,
            mpris::media_play_pause,
            mpris::media_next,
            mpris::media_previous,
            mpris::seek_media,
            mpris::get_media_info,
            monitor::get_top_processes,
            monitor::get_battery,
            monitor::set_battery_limiter,
            monitor::get_running_game,
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
