//! Leak-free MPRIS signal listener.

use std::collections::HashMap;

use futures_util::StreamExt;
use log::{debug, warn};
use serde::Serialize;
use tokio::sync::watch;
use url::Url;
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
}

#[derive(Clone, Debug, Default)]
struct PlayerState {
    title: String,
    artist: String,
    album: String,
    art_url: String,
    playback_status: String,
}

pub struct MprisShutdown(watch::Sender<bool>);

impl MprisShutdown {
    pub fn shutdown(&self) {
        let _ = self.0.send(true);
    }
}

pub fn start(ipc: IpcEmitter) -> MprisShutdown {
    let (tx, rx) = watch::channel(false);
    tokio::spawn(run(ipc, rx));
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

        for name in dbus.list_names().await? {
            let name = name.to_string();
            if name.starts_with(PREFIX) {
                if let Some(state) = load_player(&connection, &name).await { players.insert(name, state); }
            }
        }
        emit_current(&ipc, &players);

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
                        emit_current(&ipc, &players);
                    } else if let Some(state) = load_player(&connection, &name).await {
                        players.insert(name, state);
                        emit_current(&ipc, &players);
                    }
                }
                message = properties.next() => {
                    let Some(Ok(message)) = message else { break };
                    let Some(sender) = message.header().sender().map(ToString::to_string) else { continue; };
                    if !sender.starts_with(PREFIX) || message.header().path().map(|p| p.as_str()) != Some(PATH) { continue; }
                    if let Ok((_iface, changed, _invalidated)) = message.body().deserialize::<(String, HashMap<String, OwnedValue>, Vec<String>)>() {
                        if let Some(player) = players.get_mut(&sender) {
                            apply_changes(player, &changed);
                            emit_current(&ipc, &players);
                        }
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
    let metadata: HashMap<String, OwnedValue> = proxy.get_property("Metadata").await.ok()?;
    let mut state = PlayerState::default();
    apply_metadata(&mut state, &metadata);
    state.playback_status = proxy
        .get_property("PlaybackStatus")
        .await
        .unwrap_or_default();
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
            }
        }
    }
    if let Some(v) = changed.get("PlaybackStatus").and_then(string_value) {
        state.playback_status = v;
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
}

fn string_value(value: &OwnedValue) -> Option<String> {
    String::try_from(value.try_clone().ok()?).ok()
}
fn string_array(value: &OwnedValue) -> Option<String> {
    Vec::<String>::try_from(value.try_clone().ok()?)
        .ok()
        .map(|v| v.join(", "))
}

/// Only safe webview-loadable schemes are forwarded. Local artwork uses the
/// Tauri asset protocol instead of an unrestricted `file://` URL.
fn normalize_art_url(value: &str) -> String {
    let Ok(url) = Url::parse(value) else {
        return String::new();
    };
    match url.scheme() {
        "http" | "https" => value.to_owned(),
        "file" => url
            .to_file_path()
            .ok()
            .and_then(|path| Url::from_file_path(path).ok())
            .map(|file_url| format!("asset://localhost{}", file_url.path()))
            .unwrap_or_default(),
        _ => String::new(),
    }
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
    });
    let _ = ipc.emit_latest("media-update", &info);
}

#[cfg(test)]
mod tests {
    use super::normalize_art_url;
    #[test]
    fn local_art_uses_asset_protocol() {
        assert_eq!(
            normalize_art_url("file:///tmp/album%20art.jpg"),
            "asset://localhost/tmp/album%20art.jpg"
        );
    }
    #[test]
    fn unsafe_art_scheme_is_rejected() {
        assert!(normalize_art_url("javascript:alert(1)").is_empty());
    }
}
