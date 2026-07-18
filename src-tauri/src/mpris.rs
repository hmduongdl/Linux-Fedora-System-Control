//! Leak-free MPRIS signal listener.

use std::collections::HashMap;

use futures_util::StreamExt;
use log::{debug, warn};
use serde::Serialize;
use tokio::sync::watch;
use url::Url;
use zbus::names::BusName;
use zbus::zvariant::OwnedValue;
use zbus::{fdo::DBusProxy, AsyncDrop, Connection, MatchRule, MessageStream, Proxy};

use crate::ipc::IpcEmitter;

const PREFIX: &str = "org.mpris.MediaPlayer2.";
const PATH: &str = "/org/mpris/MediaPlayer2";
const PLAYER_IFACE: &str = "org.mpris.MediaPlayer2.Player";
const PROPERTIES_IFACE: &str = "org.freedesktop.DBus.Properties";

#[derive(Clone, Debug, Serialize)]
pub struct MediaInfo {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub art_url: String,
    pub playback_status: String,
    pub player_name: String,
    pub position_seconds: f64,
    pub length_seconds: f64,
}

#[derive(Clone, Debug, Default)]
struct PlayerState {
    title: String,
    artist: String,
    album: String,
    art_url: String,
    playback_status: String,
    position_microseconds: i64,
    length_microseconds: i64,
}

pub struct MprisShutdown(watch::Sender<bool>);

impl MprisShutdown {
    pub fn shutdown(&self) {
        let _ = self.0.send(true);
    }
}

pub fn start(ipc: IpcEmitter) -> MprisShutdown {
    let (tx, rx) = watch::channel(false);
    // `setup` can run before Tauri has installed its async runtime.  MPRIS
    // owns a long-lived zbus connection, so give it a dedicated Tokio runtime
    // instead of spawning from whichever thread happens to call `start`.
    std::thread::Builder::new()
        .name("mpris-listener".into())
        .spawn(move || {
            let runtime = tokio::runtime::Runtime::new()
                .expect("failed to create Tokio runtime for MPRIS listener");
            runtime.block_on(run(ipc, rx));
        })
        .expect("failed to start MPRIS listener thread");
    MprisShutdown(tx)
}

async fn run(ipc: IpcEmitter, mut shutdown: watch::Receiver<bool>) {
    let result = async {
        let connection = Connection::session().await?;
        let dbus = DBusProxy::new(&connection).await?;
        let rule = MatchRule::builder()
            .msg_type(zbus::message::Type::Signal)
            .interface(PROPERTIES_IFACE)?
            .member("PropertiesChanged")?
            .path(PATH)?
            .build();
        // One bounded stream for all players; dropping it unregisters its match rule.
        let mut properties = MessageStream::for_match_rule(rule, &connection, Some(32)).await?;
        let owner_rule = MatchRule::builder()
            .msg_type(zbus::message::Type::Signal)
            .sender("org.freedesktop.DBus")?
            .interface("org.freedesktop.DBus")?
            .member("NameOwnerChanged")?
            .build();
        let mut owners = MessageStream::for_match_rule(owner_rule, &connection, Some(16)).await?;
        let mut players = HashMap::<String, PlayerState>::new();
        let mut owners_by_unique = HashMap::<String, String>::new();

        let names = dbus.list_names().await?;
        let mpris_names: Vec<String> = names
            .iter()
            .map(ToString::to_string)
            .filter(|name| name.starts_with(PREFIX))
            .collect();
        log::info!("MPRIS players found: {:?}", mpris_names);
        for name in mpris_names {
            if let Ok(owner) = dbus.get_name_owner(BusName::try_from(name.as_str()).expect("valid MPRIS bus name")).await {
                owners_by_unique.insert(owner.to_string(), name.clone());
            }
            if let Some(state) = load_player(&connection, &name).await {
                players.insert(name, state);
            }
        }
        emit_current(&ipc, &players);

        let mut position_ticker = tokio::time::interval(std::time::Duration::from_secs(2));
        loop {
            tokio::select! {
                _ = shutdown.changed() => { debug!("MPRIS listener shutting down"); break; }
                signal = owners.next() => {
                    let Some(Ok(signal)) = signal else { break };
                    let Ok((name, _old_owner, new_owner)) = signal.body().deserialize::<(String, String, String)>() else { continue; };
                    if !name.starts_with(PREFIX) { continue; }
                    if new_owner.is_empty() {
                        // A disappeared player cannot leave a watcher/state behind.
                        players.remove(&name);
                        owners_by_unique.retain(|_, player| player != &name);
                        emit_current(&ipc, &players);
                    } else if let Some(state) = load_player(&connection, &name).await {
                        debug!("MPRIS player appeared on session bus: {name}");
                        owners_by_unique.insert(new_owner.clone(), name.clone());
                        players.insert(name, state);
                        emit_current(&ipc, &players);
                    }
                }
                message = properties.next() => {
                    let Some(Ok(message)) = message else { break };
                    let Some(sender) = message.header().sender().map(ToString::to_string) else { continue; };
                    let Some(player_name) = owners_by_unique.get(&sender) else { continue; };
                    if message.header().path().map(|p| p.as_str()) != Some(PATH) { continue; }
                    if let Ok((_iface, changed, _invalidated)) = message.body().deserialize::<(String, HashMap<String, OwnedValue>, Vec<String>)>() {
                        if let Some(player) = players.get_mut(player_name) {
                            apply_changes(player, &changed);
                            emit_current(&ipc, &players);
                        }
                    }
                }
                _ = position_ticker.tick() => {
                    let playing = players.values().any(|p| p.playback_status == "Playing");
                    if playing {
                        for (name, state) in players.iter_mut() {
                            if state.playback_status == "Playing" {
                                if let Ok(proxy) = Proxy::new(&connection, name.as_str(), PATH, PLAYER_IFACE).await {
                                    if let Ok(pos) = proxy.get_property::<i64>("Position").await {
                                        state.position_microseconds = pos;
                                    }
                                }
                            }
                        }
                        emit_current(&ipc, &players);
                    }
                }
            }
        }
        // Explicit drops make cleanup independent of task scheduling order.
        properties.async_drop().await;
        owners.async_drop().await;
        drop(players);
        Ok::<(), zbus::Error>(())
    }.await;
    if let Err(error) = result {
        warn!("MPRIS listener stopped: {error}");
    }
}

async fn load_player(connection: &Connection, bus_name: &str) -> Option<PlayerState> {
    let proxy = Proxy::new(connection, bus_name, PATH, PLAYER_IFACE)
        .await
        .ok()?;
    let mut state = PlayerState::default();
    // Metadata is optional in practice. Browsers can briefly expose a null,
    // incomplete, or differently typed Metadata value while a media session
    // is being initialized. Do not drop the player: PlaybackStatus and
    // Position are still useful enough to publish an event.
    match proxy
        .get_property::<HashMap<String, OwnedValue>>("Metadata")
        .await
    {
        Ok(metadata) => apply_metadata(&mut state, &metadata),
        Err(error) => debug!("MPRIS {bus_name}: Metadata unavailable: {error}"),
    }
    state.playback_status = proxy
        .get_property("PlaybackStatus")
        .await
        .unwrap_or_default();
    state.position_microseconds = proxy.get_property("Position").await.unwrap_or_default();
    Some(state)
}

fn apply_changes(state: &mut PlayerState, changed: &HashMap<String, OwnedValue>) {
    if let Some(value) = changed.get("Metadata") {
        if let Ok(metadata_value) = value.try_clone() {
            if let Ok(metadata) = HashMap::<String, OwnedValue>::try_from(metadata_value) {
                if let Some(v) = metadata.get("xesam:title").and_then(string_value) {
                    state.title = v;
                }
                if let Some(v) = metadata.get("xesam:artist").and_then(string_array) {
                    state.artist = v;
                }
                if let Some(v) = metadata.get("xesam:album").and_then(string_value) {
                    state.album = v;
                }
                if let Some(v) = metadata.get("mpris:artUrl").and_then(string_value) {
                    state.art_url = normalize_art_url(&v);
                }
                if let Some(v) = metadata.get("mpris:length").and_then(integer_value) {
                    state.length_microseconds = v;
                }
            }
        }
    }
    if let Some(v) = changed.get("PlaybackStatus").and_then(string_value) {
        state.playback_status = v;
    }
    if let Some(v) = changed.get("Position").and_then(integer_value) {
        state.position_microseconds = v;
    }
}

fn apply_metadata(state: &mut PlayerState, metadata: &HashMap<String, OwnedValue>) {
    if let Some(v) = metadata.get("xesam:title").and_then(string_value) {
        state.title = v;
    }
    if let Some(v) = metadata.get("xesam:artist").and_then(string_array) {
        state.artist = v;
    }
    if let Some(v) = metadata.get("xesam:album").and_then(string_value) {
        state.album = v;
    }
    if let Some(v) = metadata.get("mpris:artUrl").and_then(string_value) {
        state.art_url = normalize_art_url(&v);
    }
    if let Some(v) = metadata.get("mpris:length").and_then(integer_value) {
        state.length_microseconds = v;
    }
}

fn string_value(value: &OwnedValue) -> Option<String> {
    String::try_from(value.try_clone().ok()?).ok()
}
fn string_array(value: &OwnedValue) -> Option<String> {
    Vec::<String>::try_from(value.try_clone().ok()?)
        .ok()
        .map(|v| v.join(", "))
}
fn integer_value(value: &OwnedValue) -> Option<i64> {
    i64::try_from(value.try_clone().ok()?).ok()
}

async fn active_player_name(connection: &Connection) -> zbus::Result<String> {
    let dbus = DBusProxy::new(connection).await?;
    let mut fallback = None;
    for name in dbus.list_names().await? {
        let name = name.to_string();
        if !name.starts_with(PREFIX) {
            continue;
        }
        fallback.get_or_insert_with(|| name.clone());
        let proxy = Proxy::new(connection, name.as_str(), PATH, PLAYER_IFACE).await?;
        let status: String = proxy
            .get_property("PlaybackStatus")
            .await
            .unwrap_or_default();
        if status == "Playing" {
            return Ok(name);
        }
    }
    fallback.ok_or_else(|| zbus::Error::Failure("No MPRIS player available".into()))
}

async fn player_command(method: &str) -> Result<(), String> {
    let connection = Connection::session()
        .await
        .map_err(|error| error.to_string())?;
    let name = active_player_name(&connection)
        .await
        .map_err(|error| error.to_string())?;
    let proxy = Proxy::new(&connection, name, PATH, PLAYER_IFACE)
        .await
        .map_err(|error| error.to_string())?;
    proxy
        .call_method(method, &())
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn media_play_pause() -> Result<(), String> {
    player_command("PlayPause").await
}

#[tauri::command]
pub async fn media_next() -> Result<(), String> {
    player_command("Next").await
}

#[tauri::command]
pub async fn media_previous() -> Result<(), String> {
    player_command("Previous").await
}

#[tauri::command]
pub async fn seek_media(position_seconds: f64) -> Result<(), String> {
    let connection = Connection::session()
        .await
        .map_err(|error| error.to_string())?;
    let name = active_player_name(&connection)
        .await
        .map_err(|error| error.to_string())?;
    let proxy = Proxy::new(&connection, name, PATH, PLAYER_IFACE)
        .await
        .map_err(|error| error.to_string())?;

    let target = (position_seconds.max(0.0) * 1_000_000.0).round() as i64;

    // Try absolute SetPosition first (works for web browsers playing YouTube/etc. which fail on relative Position properties)
    let metadata = proxy
        .get_property::<HashMap<String, OwnedValue>>("Metadata")
        .await;

    let mut set_position_success = false;
    if let Ok(metadata) = metadata {
        let track_id = metadata
            .get("mpris:trackid")
            .and_then(|v| zbus::zvariant::ObjectPath::try_from(v.try_clone().ok()?).ok())
            .unwrap_or_else(|| zbus::zvariant::ObjectPath::try_from("/").unwrap());

        if proxy
            .call_method("SetPosition", &(&track_id, target))
            .await
            .is_ok()
        {
            set_position_success = true;
        }
    }

    // Fallback to relative Seek if SetPosition failed
    if !set_position_success {
        let current: i64 = proxy.get_property("Position").await.unwrap_or(0);
        proxy
            .call_method("Seek", &(target.saturating_sub(current)))
            .await
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn base64_encode(bytes: &[u8]) -> String {
    const CHARSET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((bytes.len() + 2) / 3 * 4);

    for chunk in bytes.chunks(3) {
        match chunk.len() {
            3 => {
                let b = ((chunk[0] as u32) << 16) | ((chunk[1] as u32) << 8) | (chunk[2] as u32);
                result.push(CHARSET[((b >> 18) & 63) as usize] as char);
                result.push(CHARSET[((b >> 12) & 63) as usize] as char);
                result.push(CHARSET[((b >> 6) & 63) as usize] as char);
                result.push(CHARSET[(b & 63) as usize] as char);
            }
            2 => {
                let b = ((chunk[0] as u32) << 8) | (chunk[1] as u32);
                result.push(CHARSET[((b >> 10) & 63) as usize] as char);
                result.push(CHARSET[((b >> 4) & 63) as usize] as char);
                result.push(CHARSET[((b << 2) & 63) as usize] as char);
                result.push('=');
            }
            1 => {
                let b = chunk[0] as u32;
                result.push(CHARSET[((b >> 2) & 63) as usize] as char);
                result.push(CHARSET[((b << 4) & 63) as usize] as char);
                result.push('=');
                result.push('=');
            }
            _ => unreachable!(),
        }
    }
    result
}

fn read_local_art_as_data_uri(path: &std::path::Path) -> Result<String, std::io::Error> {
    use std::fs::File;
    use std::io::Read;

    let mut file = File::open(path)?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)?;

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        _ => "image/jpeg",
    };

    Ok(format!("data:{};base64,{}", mime, base64_encode(&buffer)))
}

fn normalize_art_url(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }

    if let Ok(url) = Url::parse(value) {
        match url.scheme() {
            "http" | "https" => return value.to_owned(),
            "file" => {
                if let Ok(path) = url.to_file_path() {
                    if let Ok(data_uri) = read_local_art_as_data_uri(&path) {
                        return data_uri;
                    }
                }
            }
            _ => {}
        }
    } else {
        // Handle raw local absolute paths
        let path = std::path::Path::new(value);
        if path.is_absolute() && path.exists() {
            if let Ok(data_uri) = read_local_art_as_data_uri(path) {
                return data_uri;
            }
        }
    }

    String::new()
}

fn emit_current(ipc: &IpcEmitter, players: &HashMap<String, PlayerState>) {
    let selected = players
        .iter()
        .find(|(_, p)| p.playback_status == "Playing")
        .or_else(|| players.iter().next());
    let info = selected.map(|(name, p)| MediaInfo {
        title: p.title.clone(),
        artist: p.artist.clone(),
        album: p.album.clone(),
        art_url: p.art_url.clone(),
        playback_status: p.playback_status.clone(),
        player_name: name.clone(),
        position_seconds: (p.position_microseconds.max(0) as f64) / 1_000_000.0,
        length_seconds: (p.length_microseconds.max(0) as f64) / 1_000_000.0,
    });
    let _ = ipc.emit_latest("media-update", &info);
}

#[tauri::command]
pub async fn get_media_info() -> Option<MediaInfo> {
    let connection = Connection::session().await.ok()?;
    let dbus = DBusProxy::new(&connection).await.ok()?;
    let names: Vec<String> = dbus
        .list_names()
        .await
        .ok()?
        .iter()
        .map(ToString::to_string)
        .filter(|name| name.starts_with(PREFIX))
        .collect();
    let mut players = HashMap::new();
    for name in names {
        if let Some(state) = load_player(&connection, &name).await {
            players.insert(name, state);
        }
    }
    let selected = players
        .iter()
        .find(|(_, p)| p.playback_status == "Playing")
        .or_else(|| players.iter().next());
    selected.map(|(name, p)| MediaInfo {
        title: p.title.clone(),
        artist: p.artist.clone(),
        album: p.album.clone(),
        art_url: p.art_url.clone(),
        playback_status: p.playback_status.clone(),
        player_name: name.clone(),
        position_seconds: p.position_microseconds.max(0) as f64 / 1_000_000.0,
        length_seconds: p.length_microseconds.max(0) as f64 / 1_000_000.0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn base64_encoding_works() {
        assert_eq!(base64_encode(b"hello"), "aGVsbG8=");
    }
    #[test]
    fn safe_art_scheme_is_preserved() {
        assert_eq!(
            normalize_art_url("https://example.com/cover.jpg"),
            "https://example.com/cover.jpg"
        );
    }
    #[test]
    fn unsafe_art_scheme_is_rejected() {
        assert!(normalize_art_url("javascript:alert(1)").is_empty());
    }
}
