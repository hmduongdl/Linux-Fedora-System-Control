#[tauri::command]
fn close_window(window: tauri::WebviewWindow) {
    window.close().unwrap_or_default();
}

#[tauri::command]
fn minimize_window(window: tauri::WebviewWindow) {
    window.minimize().unwrap_or_default();
}

#[tauri::command]
fn toggle_maximize(window: tauri::WebviewWindow) {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().unwrap_or_default();
    } else {
        window.maximize().unwrap_or_default();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            close_window,
            minimize_window,
            toggle_maximize,
            audio::get_audio_state,
            audio::set_audio_volume,
            audio::toggle_audio_mute,
            optimizer::set_power_profile,
            optimizer::toggle_gamemode,
            optimizer::check_gamemode_status,
            optimizer::clear_ram_cache,
        ])
        .setup(|app| {
            let ipc = IpcEmitter::start(app.handle().clone());
            app.manage(mpris::start(ipc.clone()));
            let telemetry = TelemetryEngine::new();
            telemetry.start(app.handle().clone(), ipc.clone());
            app.manage(ipc);
            app.manage(telemetry);

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(shutdown) = app.try_state::<mpris::MprisShutdown>() {
                    shutdown.shutdown();
                }
            }
        });
}
mod audio;
mod ipc;
mod monitor;
mod optimizer;

use ipc::IpcEmitter;
use monitor::TelemetryEngine;
use tauri::Manager;
mod mpris;
