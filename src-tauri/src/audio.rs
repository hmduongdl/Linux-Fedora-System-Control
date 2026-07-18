use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use std::{fmt, io};
use tokio::{
    process::Command,
    time::{timeout, Duration},
};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);

static VOLUME_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?m)^\s*Volume:\s+(?P<volume>[0-9]+(?:\.[0-9]+)?)(?:\s+\[(?P<muted>MUTED)\])?")
        .unwrap()
});
static STATUS_NODE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\s*(?:[│├└─* ]+)?(?P<id>[0-9]+)\.\s+(?P<name>.+?)\s*$").unwrap());

#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AudioError {
    CommandNotFound {
        command: String,
    },
    Spawn {
        command: String,
        message: String,
    },
    Timeout {
        command: String,
    },
    CommandFailed {
        command: String,
        status: Option<i32>,
        stderr: String,
    },
    InvalidUtf8 {
        command: String,
    },
    Parse {
        field: String,
        value: String,
    },
}

impl fmt::Display for AudioError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CommandNotFound { command } => write!(f, "audio command not found: {command}"),
            Self::Spawn { command, message } => write!(f, "could not start {command}: {message}"),
            Self::Timeout { command } => write!(f, "{command} did not respond in time"),
            Self::CommandFailed {
                command,
                status,
                stderr,
            } => write!(f, "{command} failed ({status:?}): {stderr}"),
            Self::InvalidUtf8 { command } => write!(f, "{command} returned invalid UTF-8"),
            Self::Parse { field, value } => write!(f, "could not parse {field}: {value}"),
        }
    }
}

impl std::error::Error for AudioError {}

#[derive(Debug, Clone, Serialize)]
pub struct AudioDevice {
    pub id: u32,
    pub name: String,
    pub description: String,
    pub is_default: bool,
    pub volume_percent: f32,
    pub is_muted: bool,
    pub streams: Vec<AudioStream>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioStream {
    pub id: u32,
    pub name: String,
    pub application_name: String,
    pub media_class: String,
    pub volume_percent: f32,
    pub is_muted: bool,
    pub state: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioState {
    pub timestamp_ms: u64,
    pub default_sink: Option<AudioDevice>,
    pub default_source: Option<AudioDevice>,
    pub inputs: Vec<AudioDevice>,
    pub outputs: Vec<AudioDevice>,
}

async fn wpctl(args: &[&str]) -> Result<String, AudioError> {
    let command = format!("wpctl {}", args.join(" "));
    let output = timeout(
        COMMAND_TIMEOUT,
        Command::new("wpctl").args(args).kill_on_drop(true).output(),
    )
    .await
    .map_err(|_| AudioError::Timeout {
        command: command.clone(),
    })?
    .map_err(|error| match error.kind() {
        io::ErrorKind::NotFound => AudioError::CommandNotFound {
            command: "wpctl".into(),
        },
        _ => AudioError::Spawn {
            command: command.clone(),
            message: error.to_string(),
        },
    })?;
    if !output.status.success() {
        return Err(AudioError::CommandFailed {
            command,
            status: output.status.code(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        });
    }
    String::from_utf8(output.stdout).map_err(|_| AudioError::InvalidUtf8 { command })
}

fn parse_volume(output: &str) -> Result<(f32, bool), AudioError> {
    let captures = VOLUME_RE
        .captures(output)
        .ok_or_else(|| AudioError::Parse {
            field: "volume".into(),
            value: output.trim().into(),
        })?;
    let volume = captures["volume"]
        .parse::<f32>()
        .map_err(|_| AudioError::Parse {
            field: "volume".into(),
            value: captures["volume"].into(),
        })?;
    Ok((
        (volume * 100.0).clamp(0.0, 100.0),
        captures.name("muted").is_some(),
    ))
}

fn parse_status_nodes(output: &str) -> Vec<(u32, String)> {
    output
        .lines()
        .filter_map(|line| {
            STATUS_NODE_RE.captures(line).and_then(|captures| {
                Some((
                    captures["id"].parse().ok()?,
                    captures["name"].trim().to_owned(),
                ))
            })
        })
        .collect()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as u64)
}

#[tauri::command]
pub async fn get_audio_state() -> Result<AudioState, AudioError> {
    let status = wpctl(&["status", "-n"]).await?;
    let sink_output = wpctl(&["get-volume", "@DEFAULT_AUDIO_SINK@"]).await?;
    let (sink_volume, sink_muted) = parse_volume(&sink_output)?;
    let sink = parse_status_nodes(&status)
        .into_iter()
        .next()
        .map(|(id, name)| AudioDevice {
            id,
            name: name.clone(),
            description: name,
            is_default: true,
            volume_percent: sink_volume,
            is_muted: sink_muted,
            streams: Vec::new(),
        });
    Ok(AudioState {
        timestamp_ms: now_ms(),
        default_sink: sink.clone(),
        default_source: None,
        inputs: Vec::new(),
        outputs: sink.into_iter().collect(),
    })
}

#[tauri::command]
pub async fn set_audio_volume(id: u32, volume_percent: f32) -> Result<(), AudioError> {
    let volume = (volume_percent.clamp(0.0, 100.0) / 100.0).to_string();
    wpctl(&["set-volume", &id.to_string(), &volume])
        .await
        .map(|_| ())
}

#[tauri::command]
pub async fn toggle_audio_mute(id: u32) -> Result<(), AudioError> {
    wpctl(&["set-mute", &id.to_string(), "toggle"])
        .await
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::{parse_status_nodes, parse_volume};

    #[test]
    fn parses_wpctl_volume_and_mute() {
        assert_eq!(parse_volume("Volume: 0.42 [MUTED]").unwrap(), (42.0, true));
        assert_eq!(parse_volume("Volume: 0.875").unwrap(), (87.5, false));
    }

    #[test]
    fn parses_status_node_ids_without_string_splitting() {
        assert_eq!(
            parse_status_nodes(" │  * 53. Built-in Audio Analog Stereo\n"),
            vec![(53, "Built-in Audio Analog Stereo".to_owned())]
        );
    }
}
