//! Backpressure-safe event delivery to the Tauri Webview.

use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

use serde::{Serialize, Serializer};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::Notify;

const QUEUE_CAPACITY: usize = 8;
const LARGE_PAYLOAD_BYTES: usize = 5 * 1024;

#[derive(Clone)]
pub struct IpcEmitter {
    queue: Arc<Mutex<VecDeque<QueuedEvent>>>,
    notify: Arc<Notify>,
}

struct QueuedEvent {
    name: String,
    payload: EventPayload,
}

#[derive(Clone)]
enum EventPayload {
    Json(Value),
    Bytes { bytes: Vec<u8>, byte_len: usize },
}

impl Serialize for EventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Json(value) => value.serialize(serializer),
            Self::Bytes { bytes, byte_len } => {
                #[derive(Serialize)]
                struct ByteStream<'a> {
                    encoding: &'static str,
                    byte_len: usize,
                    data: &'a [u8],
                }
                ByteStream {
                    encoding: "json-utf8",
                    byte_len: *byte_len,
                    data: bytes,
                }
                .serialize(serializer)
            }
        }
    }
}

impl IpcEmitter {
    pub fn start<R: Runtime>(app: AppHandle<R>) -> Self {
        let emitter = Self {
            queue: Arc::new(Mutex::new(VecDeque::with_capacity(QUEUE_CAPACITY))),
            notify: Arc::new(Notify::new()),
        };
        tauri::async_runtime::spawn(dispatch_loop(
            app,
            emitter.queue.clone(),
            emitter.notify.clone(),
        ));
        emitter
    }

    /// Non-blocking latest-value enqueue. Full queues discard the oldest item.
    pub fn emit_latest<T: Serialize>(&self, event: impl Into<String>, payload: &T) -> bool {
        let bytes = match serde_json::to_vec(payload) {
            Ok(bytes) => bytes,
            Err(error) => {
                log::error!("IPC payload serialization failed: {error}");
                return false;
            }
        };
        let payload = if bytes.len() > LARGE_PAYLOAD_BYTES {
            EventPayload::Bytes {
                byte_len: bytes.len(),
                bytes,
            }
        } else {
            match serde_json::from_slice(&bytes) {
                Ok(value) => EventPayload::Json(value),
                Err(error) => {
                    log::error!("IPC payload conversion failed: {error}");
                    return false;
                }
            }
        };
        let mut queue = match self.queue.lock() {
            Ok(queue) => queue,
            Err(_) => return false,
        };
        if queue.len() == QUEUE_CAPACITY {
            queue.pop_front();
        }
        queue.push_back(QueuedEvent {
            name: event.into(),
            payload,
        });
        drop(queue);
        self.notify.notify_one();
        true
    }
}

async fn dispatch_loop<R: Runtime>(
    app: AppHandle<R>,
    queue: Arc<Mutex<VecDeque<QueuedEvent>>>,
    notify: Arc<Notify>,
) {
    loop {
        let event = queue.lock().ok().and_then(|mut queue| queue.pop_front());
        let Some(event) = event else {
            notify.notified().await;
            continue;
        };
        if let Err(error) = app.emit(&event.name, event.payload) {
            log::warn!("IPC event '{}' was not delivered: {error}", event.name);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::LARGE_PAYLOAD_BYTES;
    #[test]
    fn large_payload_threshold_is_five_kibibytes() {
        assert_eq!(LARGE_PAYLOAD_BYTES, 5120);
    }
}
