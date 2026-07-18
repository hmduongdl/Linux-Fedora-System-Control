use crate::ipc::IpcEmitter;
use serde::Serialize;
use std::collections::HashMap;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize)]
pub struct GameSession {
    filename: String,
    start_time_ms: u64,
    average_fps: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
struct FpsUpdate {
    fps: Option<f64>,
    frametime_ms: Option<f64>,
    timestamp: u64,
}

fn get_log_dir() -> Result<std::path::PathBuf, String> {
    let base = if let Ok(data_home) = std::env::var("XDG_DATA_HOME") {
        std::path::PathBuf::from(data_home)
    } else if let Ok(home) = std::env::var("HOME") {
        std::path::PathBuf::from(home).join(".local/share")
    } else {
        return Err("Neither XDG_DATA_HOME nor HOME environment variable is set".into());
    };
    Ok(base.join("purrdora").join("mangohud-logs"))
}

fn get_mangohud_config_path() -> Result<std::path::PathBuf, String> {
    let base = if let Ok(config_home) = std::env::var("XDG_CONFIG_HOME") {
        std::path::PathBuf::from(config_home)
    } else if let Ok(home) = std::env::var("HOME") {
        std::path::PathBuf::from(home).join(".config")
    } else {
        return Err("Neither XDG_CONFIG_HOME nor HOME environment variable is set".into());
    };
    Ok(base.join("MangoHud").join("MangoHud.conf"))
}

#[tauri::command]
pub fn is_mangohud_installed() -> bool {
    std::process::Command::new("mangohud")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[tauri::command]
pub fn is_mangohud_configured() -> Result<bool, String> {
    let config_path = get_mangohud_config_path()?;
    if !config_path.exists() {
        return Ok(false);
    }

    let log_dir = get_log_dir()?;
    let log_dir_str = log_dir.to_string_lossy().into_owned();

    let content = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("output_folder=") {
            let val = trimmed.strip_prefix("output_folder=").unwrap_or("").trim();
            if val == log_dir_str {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

#[tauri::command]
pub fn configure_mangohud() -> Result<String, String> {
    let log_dir = get_log_dir()?;
    if !log_dir.exists() {
        std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    }

    let config_path = get_mangohud_config_path()?;
    let config_dir = config_path.parent().ok_or("Invalid config path")?;
    if !config_dir.exists() {
        std::fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
    }

    let log_dir_str = log_dir.to_string_lossy().into_owned();
    let output_folder_line = format!("output_folder={}", log_dir_str);

    if !config_path.exists() {
        let default_content = format!(
            "# MangoHud configuration for Purrdora\n{}\nlog_duration=0\nautostart_log=0\n",
            output_folder_line
        );
        std::fs::write(&config_path, default_content).map_err(|e| e.to_string())?;
        return Ok("Created new MangoHud configuration file".into());
    }

    let content = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    let mut updated = false;

    for line in lines.iter_mut() {
        let trimmed = line.trim();
        if trimmed.starts_with("output_folder=") {
            *line = output_folder_line.clone();
            updated = true;
            break;
        }
    }

    if !updated {
        lines.push(output_folder_line);
    }

    let new_content = lines.join("\n") + "\n";
    std::fs::write(&config_path, new_content).map_err(|e| e.to_string())?;

    Ok("Updated MangoHud configuration file successfully".into())
}

#[tauri::command]
pub fn enable_mangohud_for_launch(_mode: String) -> Result<HashMap<String, String>, String> {
    let mut envs = HashMap::new();
    envs.insert("MANGOHUD".to_string(), "1".to_string());
    envs.insert("MANGOHUD_DLSYM".to_string(), "1".to_string());
    Ok(envs)
}

#[tauri::command]
pub fn list_recent_game_sessions() -> Result<Vec<GameSession>, String> {
    let log_dir = get_log_dir()?;
    if !log_dir.exists() {
        return Ok(Vec::new());
    }

    let mut sessions = Vec::new();
    if let Ok(entries) = std::fs::read_dir(log_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().map_or(false, |ext| ext == "csv") {
                let filename = path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();

                let metadata = path.metadata().map_err(|e| e.to_string())?;
                let start_time_ms = metadata
                    .modified()
                    .unwrap_or(std::time::SystemTime::now())
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;

                let avg_fps = calculate_avg_fps(&path);

                sessions.push(GameSession {
                    filename,
                    start_time_ms,
                    average_fps: avg_fps,
                });
            }
        }
    }

    sessions.sort_by(|a, b| b.start_time_ms.cmp(&a.start_time_ms));
    // Keep the history bounded so opening Game Mode cannot scan/render an
    // unbounded number of old MangoHud sessions.
    sessions.truncate(20);
    Ok(sessions)
}

fn calculate_avg_fps(path: &std::path::Path) -> Option<f64> {
    let file = std::fs::File::open(path).ok()?;
    use std::io::{BufRead, BufReader};
    let reader = BufReader::new(file);

    let mut fps_col_idx: Option<usize> = None;
    let mut fps_sum = 0.0;
    let mut fps_count = 0u64;

    for line_res in reader.lines() {
        let line = line_res.ok()?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if fps_col_idx.is_none() {
            if trimmed.contains("fps") && trimmed.contains("frametime") {
                let parts: Vec<&str> = trimmed.split(',').map(|s| s.trim()).collect();
                fps_col_idx = parts.iter().position(|&x| x == "fps");
            }
        } else {
            let parts: Vec<&str> = trimmed.split(',').map(|s| s.trim()).collect();
            if let Some(idx) = fps_col_idx {
                if parts.len() > idx {
                    if let Ok(fps) = parts[idx].parse::<f64>() {
                        fps_sum += fps;
                        fps_count += 1;
                    }
                }
            }
        }
    }

    if fps_count == 0 {
        None
    } else {
        Some(fps_sum / fps_count as f64)
    }
}

fn emit_null(ipc: &IpcEmitter) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    ipc.emit_latest(
        "game-fps-update",
        &FpsUpdate {
            fps: None,
            frametime_ms: None,
            timestamp: now,
        },
    );
}

fn emit_update(ipc: &IpcEmitter, fps: Option<f64>, frametime_ms: Option<f64>) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    ipc.emit_latest(
        "game-fps-update",
        &FpsUpdate {
            fps,
            frametime_ms,
            timestamp: now,
        },
    );
}

pub fn start_worker<R: tauri::Runtime>(_app: tauri::AppHandle<R>, ipc: IpcEmitter) {
    tauri::async_runtime::spawn(async move {
        let mut last_file_path: Option<std::path::PathBuf> = None;
        let mut last_read_offset: u64 = 0;
        let mut fps_col_idx: Option<usize> = None;
        let mut frametime_col_idx: Option<usize> = None;
        let mut last_emit_time = Instant::now();

        // Emit initial null state
        emit_null(&ipc);

        loop {
            // MangoHud writes continuously while a game is running. Polling
            // every 8 seconds is sufficient for the dashboard while keeping
            // background work low. When idle, poll every 5 seconds so a new
            // game/log is detected without waking the app every second.
            let poll_interval = if last_file_path.is_some() {
                Duration::from_secs(8)
            } else {
                Duration::from_secs(5)
            };
            tokio::time::sleep(poll_interval).await;

            let log_dir = match get_log_dir() {
                Ok(dir) => dir,
                Err(err) => {
                    log::error!("Failed to get mangohud log directory: {}", err);
                    continue;
                }
            };

            // Do not create the log directory from the always-on worker. It
            // is created explicitly when MangoHud is configured, and an
            // absent directory means there is nothing to monitor.
            if !log_dir.is_dir() {
                continue;
            }

            let mut most_recent: Option<(std::path::PathBuf, std::time::SystemTime)> = None;
            if let Ok(entries) = std::fs::read_dir(&log_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() && path.extension().map_or(false, |ext| ext == "csv") {
                        if let Ok(metadata) = entry.metadata() {
                            if let Ok(modified) = metadata.modified() {
                                if most_recent.is_none()
                                    || modified > most_recent.as_ref().unwrap().1
                                {
                                    most_recent = Some((path, modified));
                                }
                            }
                        }
                    }
                }
            }

            match most_recent {
                Some((path, modified)) => {
                    let now = std::time::SystemTime::now();
                    let elapsed = now
                        .duration_since(modified)
                        .unwrap_or(Duration::from_secs(0));

                    if elapsed > Duration::from_secs(5) {
                        if last_file_path.is_some()
                            || last_emit_time.elapsed() > Duration::from_secs(5)
                        {
                            emit_null(&ipc);
                            last_file_path = None;
                            last_read_offset = 0;
                            fps_col_idx = None;
                            frametime_col_idx = None;
                            last_emit_time = Instant::now();
                        }
                        continue;
                    }

                    if last_file_path.as_ref() != Some(&path) {
                        last_file_path = Some(path.clone());
                        last_read_offset = 0;
                        fps_col_idx = None;
                        frametime_col_idx = None;
                    }

                    if let Ok(file) = std::fs::File::open(&path) {
                        if let Ok(metadata) = file.metadata() {
                            let file_len = metadata.len();

                            if file_len < last_read_offset {
                                last_read_offset = 0;
                            }

                            if file_len > last_read_offset {
                                use std::io::{BufRead, BufReader, Seek, SeekFrom};
                                let mut reader = BufReader::new(file);
                                let _ = reader.seek(SeekFrom::Start(last_read_offset));

                                let mut line = String::new();
                                let mut new_offset = last_read_offset;

                                while let Ok(bytes_read) = reader.read_line(&mut line) {
                                    if bytes_read == 0 {
                                        break;
                                    }
                                    new_offset += bytes_read as u64;

                                    let trimmed = line.trim();
                                    if !trimmed.is_empty() {
                                        if fps_col_idx.is_none() {
                                            if trimmed.contains("fps")
                                                && trimmed.contains("frametime")
                                            {
                                                let parts: Vec<&str> =
                                                    trimmed.split(',').map(|s| s.trim()).collect();
                                                fps_col_idx =
                                                    parts.iter().position(|&x| x == "fps");
                                                frametime_col_idx =
                                                    parts.iter().position(|&x| x == "frametime");
                                            }
                                        } else {
                                            let parts: Vec<&str> =
                                                trimmed.split(',').map(|s| s.trim()).collect();
                                            if let (Some(fps_idx), Some(ft_idx)) =
                                                (fps_col_idx, frametime_col_idx)
                                            {
                                                if parts.len() > fps_idx && parts.len() > ft_idx {
                                                    let fps_val: Option<f64> =
                                                        parts[fps_idx].parse().ok();
                                                    let ft_val: Option<f64> =
                                                        parts[ft_idx].parse().ok();

                                                    if let (Some(fps), Some(ft)) = (fps_val, ft_val)
                                                    {
                                                        emit_update(&ipc, Some(fps), Some(ft));
                                                        last_emit_time = Instant::now();
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    line.clear();
                                }
                                last_read_offset = new_offset;
                            }
                        }
                    }
                }
                None => {
                    if last_file_path.is_some() || last_emit_time.elapsed() > Duration::from_secs(5)
                    {
                        emit_null(&ipc);
                        last_file_path = None;
                        last_read_offset = 0;
                        fps_col_idx = None;
                        frametime_col_idx = None;
                        last_emit_time = Instant::now();
                    }
                }
            }
        }
    });
}
