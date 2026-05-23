use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use rusqlite::Connection;
use tauri::async_runtime::JoinHandle;
use tokio::sync::broadcast;

// =========================================================================================================
// AppState
// =========================================================================================================

/// Estado global compartido por todas las tasks de tokio
#[derive(Clone)]
pub struct AppState {
    /// SQLite connection wrapped in std::sync::Mutex.
    /// rusqlite::Connection is Send but NOT Sync (uses RefCell internally).
    /// std::sync::Mutex<T>: Sync when T: Send, satisfying tauri::State bounds.
    pub db: Arc<Mutex<Connection>>,
    /// In-memory config cache. Uses std::sync::RwLock (not tokio) so it can
    /// be written during Tauri's setup() closure, which runs before the Tokio
    /// runtime is active. Config reads/writes are synchronous and fast.
    pub config_cache: Arc<RwLock<AppConfig>>,
    /// Directorio de datos de la aplicación (app_data_dir de Tauri).
    /// Compartido con el bot de Discord para guardar las imágenes de personas
    /// en la ubicación correcta sin depender de current_dir().
    pub app_data_dir: Arc<PathBuf>,
    /// Handle de la tarea del bot de Discord.
    /// Permite abortarla antes de relanzar o al cerrar la app.
    pub discord_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    /// Handle de la tarea del cliente de Twitch.
    pub twitch_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    /// Handle de la tarea del cliente de Twitch EventSub.
    pub twitch_eventsub_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    /// Handle de la tarea del cliente de TikTok.
    pub tiktok_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    /// Broadcast channel sender for the OBS Browser Source WebSocket.
    /// Every Tauri event that the overlay reacts to is also broadcast here
    /// so connected browser clients receive the same data without Tauri IPC.
    pub ws_tx: broadcast::Sender<String>,
    /// Handle for the axum HTTP/WebSocket server task.
    pub server_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl AppState {
    pub fn new(conn: Connection, app_data_dir: PathBuf) -> Self {
        let (ws_tx, _) = broadcast::channel::<String>(512);
        AppState {
            db: Arc::new(Mutex::new(conn)),
            config_cache: Arc::new(RwLock::new(AppConfig::default())),
            app_data_dir: Arc::new(app_data_dir),
            discord_handle: Arc::new(Mutex::new(None)),
            twitch_handle: Arc::new(Mutex::new(None)),
            twitch_eventsub_handle: Arc::new(Mutex::new(None)),
            tiktok_handle: Arc::new(Mutex::new(None)),
            ws_tx,
            server_handle: Arc::new(Mutex::new(None)),
        }
    }

    /// Broadcast a JSON-encoded event to all connected OBS Browser Source WS clients.
    /// Silently ignores if there are no receivers.
    pub fn broadcast_ws<T: serde::Serialize>(&self, event: &str, payload: &T) {
        if let Ok(json) = serde_json::to_string(&serde_json::json!({
            "event": event,
            "payload": payload
        })) {
            let _ = self.ws_tx.send(json);
        }
    }

    /// Aborta la tarea del bot de Discord si está corriendo.
    pub fn abort_discord(&self) {
        if let Ok(mut guard) = self.discord_handle.lock() {
            if let Some(handle) = guard.take() {
                handle.abort();
                tracing::info!("Tarea de Discord abortada");
            }
        }
    }

    /// Aborta la tarea del cliente de Twitch si está corriendo.
    pub fn abort_twitch(&self) {
        if let Ok(mut guard) = self.twitch_handle.lock() {
            if let Some(handle) = guard.take() {
                handle.abort();
                tracing::info!("Tarea de Twitch abortada");
            }
        }
    }

    /// Aborta la tarea del cliente de Twitch EventSub si está corriendo.
    pub fn abort_twitch_eventsub(&self) {
        if let Ok(mut guard) = self.twitch_eventsub_handle.lock() {
            if let Some(handle) = guard.take() {
                handle.abort();
                tracing::info!("Tarea de Twitch EventSub abortada");
            }
        }
    }

    /// Aborta la tarea del cliente de TikTok si está corriendo.
    pub fn abort_tiktok(&self) {
        if let Ok(mut guard) = self.tiktok_handle.lock() {
            if let Some(handle) = guard.take() {
                handle.abort();
                tracing::info!("Tarea de TikTok abortada");
            }
        }
    }

    /// Aborta la tarea del servidor HTTP/WebSocket si está corriendo.
    pub fn abort_server(&self) {
        if let Ok(mut guard) = self.server_handle.lock() {
            if let Some(handle) = guard.take() {
                handle.abort();
                tracing::info!("[server] Tarea del servidor HTTP abortada");
            }
        }
    }

    /// Aborta todas las tareas de background (llamar al cerrar la app).
    pub fn abort_all(&self) {
        self.abort_discord();
        self.abort_twitch();
        self.abort_twitch_eventsub();
        self.abort_tiktok();
        self.abort_server();
    }
}

// ─── AppConfig ───────────────────────────────────────────────────────────────

/// Configuración de la aplicación (cacheada en memoria)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct AppConfig {
    pub chroma_color: String,
    pub overlay_width: u32,
    pub overlay_height: u32,
    pub tts_enabled: bool,
    pub twitch_channel: String,
    pub twitch_bot_username: String,
    pub twitch_bot_token: String,
    pub twitch_client_id: String,
    pub twitch_bot_user_id: String,
    pub tiktok_username: String,
    pub discord_bot_token: String,
    pub discord_guild_id: String,
    pub discord_channel_id: String,
    /// "parallel" (default) or "queue" — controls overlay persona layout
    pub overlay_display_mode: String,
    // ── Animation config ────────────────────────────────────────────────────
    pub animation_in: String,
    pub animation_out: String,
    pub visible_duration_secs: f64,
    pub idle_wiggle: bool,
    pub idle_breathe: bool,
    pub glow_effect: bool,
    pub glow_color: String,
    pub outline_effect: bool,
    pub persona_size_px: u32,
    pub audio_threshold: u8,
    pub max_visible_personas: u32,
    // ── Tamagotchi config ────────────────────────────────────────────────────
    pub tama_enabled: bool,
    pub tama_pet_size_px: u32,
    pub tama_floor_y: u32,
    pub tama_walk_speed: f64,
    pub tama_inactivity_mins: u32,
    pub tama_max_pets: u32,
    pub tama_action_check_secs: u32,
    pub tama_action_probability: f64,
    pub tama_enabled_actions: String,
    pub tama_jump_on_speak: bool,
    // ── Twitch config ────────────────────────────────────────────────────────
    pub twitch_eventsub_enabled: bool,
    pub twitch_chat_min_length: u32,
    pub twitch_chat_max_length: u32,
    pub twitch_chat_ignore_commands: bool,
    pub twitch_chat_ignore_users: String,
    pub twitch_chat_followers_only: bool,
    pub twitch_chat_subs_only: bool,
    pub twitch_chat_allowed_badges: String,
    pub twitch_event_cheer_enabled: bool,
    pub twitch_event_cheer_min_bits: u32,
    pub twitch_event_sub_enabled: bool,
    pub twitch_event_raid_enabled: bool,
    pub twitch_event_follow_enabled: bool,
    pub twitch_event_redemption_enabled: bool,
    pub twitch_redemption_action_map: String,
    pub twitch_event_hype_train_enabled: bool,
    pub twitch_event_stream_status_enabled: bool,
    pub twitch_tts_event_announcements: bool,
    // ── TikTok config ────────────────────────────────────────────────────────
    pub tiktok_api_key: String,
    pub tiktok_ws_endpoint: String,
    pub tiktok_chat_min_length: u32,
    pub tiktok_chat_max_length: u32,
    pub tiktok_chat_ignore_users: String,
    pub tiktok_event_gift_enabled: bool,
    pub tiktok_event_gift_min_coins: u32,
    pub tiktok_event_gift_big_coins: u32,
    pub tiktok_event_like_enabled: bool,
    pub tiktok_event_like_throttle_ms: u32,
    pub tiktok_event_follow_enabled: bool,
    pub tiktok_event_share_enabled: bool,
    pub tiktok_event_subscribe_enabled: bool,
    pub tiktok_event_member_enabled: bool,
    pub tiktok_event_envelope_enabled: bool,
    pub tiktok_gift_action_map: String,
    pub tiktok_tts_event_announcements: bool,
}

// ─── ChatMessagePayload ──────────────────────────────────────────────────────

/// Payload emitido al frontend cuando llega un mensaje del chat
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChatMessagePayload {
    pub platform: String,
    pub username: String,
    pub message: String,
    pub user_id: i64,
    pub display_name: String,
    pub mouth_open_path: String,
    pub mouth_closed_path: String,
    pub voice_id: String,
}

// ─── TtsStatePayload ─────────────────────────────────────────────────────────

/// Payload emitido al overlay para sincronizar el lip-sync con el TTS del OS
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TtsStatePayload {
    pub user_id: i64,
    pub speaking: bool,
}

// ─── ChatEventPayload ────────────────────────────────────────────────────────

/// Payload emitido para eventos no-chat (cheer, sub, raid, gift, follow, etc)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChatEventPayload {
    pub platform: String,
    pub event_kind: String,
    pub username: String,
    pub user_id: Option<i64>,
    pub display_name: String,
    pub amount: Option<i64>,
    pub text: Option<String>,
    pub extra: serde_json::Value,
}
