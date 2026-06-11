use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use tauri::async_runtime::JoinHandle;
use tokio::sync::broadcast;

use crate::chat_filters::ChatFilters;
use crate::grid::GridManager;
use crate::streamer_mic::StreamerMic;

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
    /// Directory containing the bundled default guest sprites
    /// (guest_open.png / guest_closed.png). In release this is the Tauri resource
    /// dir; in dev, src-tauri/resources/. Used to let the /persona HTTP route serve
    /// these images to the OBS Browser Source — they live outside app_data_dir, so
    /// they must be explicitly on the allow-list.
    pub resource_dir: Arc<PathBuf>,
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
    /// Rate-limiter and anti-spam filter state shared across all chat handlers.
    pub chat_filters: Arc<Mutex<ChatFilters>>,
    /// Native microphone capture for the streamer persona mouth sync. Owns the
    /// active cpal session; broadcasts `streamer-speaking` to the overlay.
    pub streamer_mic: Arc<StreamerMic>,
    /// Authoritative 2D grid that places every pet on a cell. Rust assigns cells
    /// and broadcasts `tama-grid-*` so the overlay and OBS Browser Source render
    /// the same positions instead of each deriving them from `window.innerWidth`.
    pub grid: Arc<GridManager>,
}

impl AppState {
    pub fn new(conn: Connection, app_data_dir: PathBuf, resource_dir: PathBuf) -> Self {
        let (ws_tx, _) = broadcast::channel::<String>(512);
        AppState {
            db: Arc::new(Mutex::new(conn)),
            config_cache: Arc::new(RwLock::new(AppConfig::default())),
            app_data_dir: Arc::new(app_data_dir),
            resource_dir: Arc::new(resource_dir),
            discord_handle: Arc::new(Mutex::new(None)),
            twitch_handle: Arc::new(Mutex::new(None)),
            twitch_eventsub_handle: Arc::new(Mutex::new(None)),
            tiktok_handle: Arc::new(Mutex::new(None)),
            ws_tx,
            server_handle: Arc::new(Mutex::new(None)),
            chat_filters: Arc::new(Mutex::new(ChatFilters::default())),
            streamer_mic: Arc::new(StreamerMic::new()),
            grid: Arc::new(GridManager::new()),
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
        self.streamer_mic.stop();
    }
}

/// Returns the directory that contains the bundled default guest sprites
/// (`guest_open.png` / `guest_closed.png`). In release builds this is the Tauri
/// resource dir; in dev it falls back to `src-tauri/resources/` so no bundling
/// step is needed. Resolved once at startup and stored in `AppState.resource_dir`;
/// the Twitch/TikTok handlers use it to build guest pet image paths and the
/// `/persona` HTTP route uses it to allow serving these files to the browser overlay.
pub fn guest_resource_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    if let Ok(dir) = app_handle.path().resource_dir() {
        if dir.join("guest_open.png").exists() {
            return dir;
        }
    }
    // Dev-mode fallback: files live at src-tauri/resources/ in the source tree.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
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
    /// JSON map of chat keyword -> tama action ID (e.g. {"pelea":"fight"}).
    /// When a registered pet's owner types a keyword, that action is forced.
    pub tama_keyword_actions: String,
    /// Pet name label font size in pixels.
    pub tama_name_font_size_px: u32,
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
    /// JSON map of event_kind -> alert settings
    /// ({ enabled, image, sound, text, duration_ms, transition }).
    /// Drives the configurable on-overlay alerts (overlay-alerts.html). Covers
    /// both Twitch (cheer/sub/raid/follow/hype_train) and TikTok event kinds.
    pub alerts_config: String,
    // ── Anti-spam / rate-limit config (chat) ────────────────────────────────
    pub twitch_chat_antispam_preset: String,
    pub twitch_chat_user_cooldown_ms: u32,
    pub twitch_chat_dedup_window_ms: u32,
    pub twitch_chat_rate_max_msgs: u32,
    pub twitch_chat_rate_window_secs: u32,
    pub tiktok_chat_antispam_preset: String,
    pub tiktok_chat_user_cooldown_ms: u32,
    pub tiktok_chat_dedup_window_ms: u32,
    pub tiktok_chat_rate_max_msgs: u32,
    pub tiktok_chat_rate_window_secs: u32,
    pub chat_global_throughput_preset: String,
    pub chat_global_rate_max_per_sec: u32,
    // ── Event cooldown config ────────────────────────────────────────────────
    pub twitch_event_cooldown_preset: String,
    pub twitch_event_cheer_user_cooldown_ms: u32,
    pub twitch_event_sub_user_cooldown_ms: u32,
    pub twitch_event_raid_global_cooldown_ms: u32,
    pub twitch_event_follow_user_cooldown_ms: u32,
    pub tiktok_event_cooldown_preset: String,
    pub tiktok_event_gift_user_cooldown_ms: u32,
    pub tiktok_event_like_user_cooldown_ms: u32,
    pub tiktok_event_follow_user_cooldown_ms: u32,
    pub tiktok_event_share_user_cooldown_ms: u32,
    pub tiktok_event_subscribe_user_cooldown_ms: u32,
    pub tiktok_event_envelope_user_cooldown_ms: u32,
    // ── Guest viewer config ──────────────────────────────────────────────────
    pub tama_guests_enabled: bool,
    pub tama_guests_twitch: bool,
    pub tama_guests_tiktok: bool,
    pub tama_guests_tts: bool,
    pub tama_guests_label_prefix: String,
    /// Absolute path to a custom guest mouth-open sprite (empty = use bundled default)
    pub tama_guest_mouth_open_path: String,
    /// Absolute path to a custom guest mouth-closed sprite (empty = use bundled default)
    pub tama_guest_mouth_closed_path: String,
    /// When true, TikTok guest pets use the chatter's TikTok profile picture as
    /// their sprite (takes priority over the bundled/custom default guest sprite).
    pub tama_guest_tiktok_avatar: bool,
    // ── Grid layout config ───────────────────────────────────────────────────
    /// Reinterpreted for the 2D grid: "static" => small floor grid (6x1),
    /// anything else (incl. legacy "dynamic") => normal grid (150x30).
    pub tama_layout_mode: String,
    /// Doubles both grid axes when true (the "Matriz de alta precisión" toggle).
    pub tama_grid_high_precision: bool,
    /// Enables the perspective scale (front rows larger, back rows smaller).
    pub tama_grid_perspective: bool,
    /// Scale applied to pets on the front-most row (perspective on).
    pub tama_grid_near_scale: f64,
    /// Scale applied to pets on the back-most row (perspective on).
    pub tama_grid_far_scale: f64,
    /// Fraction of the viewport height where the floor band starts (0–1).
    pub tama_grid_floor_top_frac: f64,
    /// When true, the backend periodically nudges pets to a free neighbor cell.
    pub tama_grid_wander_enabled: bool,
    /// Legacy keys — kept so get_config/set_config don't drop them, no longer used.
    pub tama_static_anchor: String,
    pub tama_static_spacing_px: u32,
    // ── Streamer persona config ───────────────────────────────────────────────
    /// Master toggle for the streamer persona overlay (overlay-streamer.html)
    pub streamer_persona_enabled: bool,
    /// Absolute path to the mouth-open / eyes-open sprite (empty = unset)
    pub streamer_sprite_mo_eo: String,
    /// Absolute path to the mouth-closed / eyes-open sprite
    pub streamer_sprite_mc_eo: String,
    /// Absolute path to the mouth-open / eyes-closed sprite
    pub streamer_sprite_mo_ec: String,
    /// Absolute path to the mouth-closed / eyes-closed sprite
    pub streamer_sprite_mc_ec: String,
    /// Milliseconds the eyes stay open between blinks
    pub streamer_blink_interval_ms: u32,
    /// Milliseconds a single blink lasts (eyes closed)
    pub streamer_blink_duration_ms: u32,
    /// Talk animation kind: "none" | "bounce" | "tremor" | "sway" | "pulse"
    pub streamer_talk_animation: String,
    /// Sprite display size in pixels
    pub streamer_size_px: u32,
    /// Horizontal anchor: "left" | "center" | "right"
    pub streamer_anchor: String,
    /// Microphone level threshold (0–100) above which the mouth opens
    pub streamer_mic_threshold: u32,
    /// Selected microphone deviceId (empty = system default)
    pub streamer_mic_device_id: String,
}

// =========================================================================================================
// Guest User ID
// =========================================================================================================

/// Derives a stable negative i64 from (platform, username).
/// Negative IDs never collide with real SQLite autoincrement IDs (always >= 1).
/// The same (platform, username) pair always produces the same ID within a session.
pub fn guest_user_id(platform: &str, username: &str) -> i64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    format!("{}:{}", platform, username).hash(&mut h);
    -((h.finish() % (i64::MAX as u64)) as i64 + 1)
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

// ─── GridUpdatePayload ───────────────────────────────────────────────────────

/// Emitted as `tama-grid-update` whenever the backend assigns or moves a pet to a
/// cell. The overlay translates the cell to pixels (with a perspective scale).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GridUpdatePayload {
    pub user_id: i64,
    pub cell_x: u16,
    pub cell_y: u16,
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

// ─── EventAlertPayload ───────────────────────────────────────────────────────

/// Fully-resolved alert payload emitted as `event-alert` and consumed by the
/// dedicated alert overlay (overlay-alerts.html). The backend resolves the
/// per-event alert config (text formatting, asset paths) before emitting so the
/// overlay only has to render and queue. Used by both Twitch and TikTok events.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EventAlertPayload {
    pub event_kind: String,
    /// Absolute OS path to the alert image (empty = no image). The overlay
    /// converts it via convertFileSrc / browserConvertFileSrc.
    pub image_path: String,
    /// Absolute OS path to the alert sound (empty = no sound).
    pub sound_path: String,
    /// Already-formatted display text ({user}/{amount} tokens resolved).
    pub text: String,
    pub duration_ms: u32,
    /// One of: "fade", "slide-down", "slide-up", "scale", "none".
    pub transition: String,
}
