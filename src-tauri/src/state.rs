use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use rusqlite::Connection;
use tauri::async_runtime::JoinHandle;

// ─── AppState ────────────────────────────────────────────────────────────────

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
    /// Handle de la tarea del cliente de TikTok.
    pub tiktok_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl AppState {
    pub fn new(conn: Connection, app_data_dir: PathBuf) -> Self {
        AppState {
            db: Arc::new(Mutex::new(conn)),
            config_cache: Arc::new(RwLock::new(AppConfig::default())),
            app_data_dir: Arc::new(app_data_dir),
            discord_handle: Arc::new(Mutex::new(None)),
            twitch_handle: Arc::new(Mutex::new(None)),
            tiktok_handle: Arc::new(Mutex::new(None)),
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

    /// Aborta la tarea del cliente de TikTok si está corriendo.
    pub fn abort_tiktok(&self) {
        if let Ok(mut guard) = self.tiktok_handle.lock() {
            if let Some(handle) = guard.take() {
                handle.abort();
                tracing::info!("Tarea de TikTok abortada");
            }
        }
    }

    /// Aborta todas las tareas de background (llamar al cerrar la app).
    pub fn abort_all(&self) {
        self.abort_discord();
        self.abort_twitch();
        self.abort_tiktok();
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
