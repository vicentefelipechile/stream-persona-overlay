use serde::Deserialize;
use tauri::{Emitter, State};

use crate::{
    db::config::{get_config, set_config_value},
    state::{AppConfig, AppState},
    tts::VoiceInfo,
};

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ─── Tauri Commands — Configuración ─────────────────────────────────────────

#[tauri::command]
pub async fn get_config_cmd(state: State<'_, AppState>) -> CmdResult<AppConfig> {
    let db = state.db.lock().map_err(map_err)?;
    get_config(&db).map_err(map_err)
}

#[tauri::command]
pub async fn set_config_cmd(
    key: String,
    value: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> CmdResult<()> {
    // Scope the Mutex guard so it is dropped before any .await
    {
        let db = state.db.lock().map_err(map_err)?;
        set_config_value(&db, &key, &value).map_err(map_err)?;
    }

    // Update in-memory cache (std RwLock)
    let mut cache = state.config_cache.write().map_err(map_err)?;
    match key.as_str() {
        "chroma_color" => cache.chroma_color = value.clone(),
        "overlay_width" => cache.overlay_width = value.parse().unwrap_or(1920),
        "overlay_height" => cache.overlay_height = value.parse().unwrap_or(1080),
        "tts_enabled" => cache.tts_enabled = value == "true",
        "twitch_channel" => cache.twitch_channel = value.clone(),
        "tiktok_username" => cache.tiktok_username = value.clone(),
        "discord_bot_token" => cache.discord_bot_token = value.clone(),
        "discord_guild_id" => cache.discord_guild_id = value.clone(),
        "discord_channel_id" => cache.discord_channel_id = value.clone(),
        "overlay_display_mode" => {
            cache.overlay_display_mode = value.clone();
            drop(cache);
            app.emit("overlay-display-mode-changed", &value)
                .map_err(map_err)?;
            return Ok(());
        }
        // ── Animation config cache ────────────────────────────────────────────
        "animation_in" => cache.animation_in = value.clone(),
        "animation_out" => cache.animation_out = value.clone(),
        "visible_duration_secs" => cache.visible_duration_secs = value.parse().unwrap_or(8.0),
        "idle_wiggle" => cache.idle_wiggle = value == "true",
        "idle_breathe" => cache.idle_breathe = value == "true",
        "glow_effect" => cache.glow_effect = value == "true",
        "glow_color" => cache.glow_color = value.clone(),
        "outline_effect" => cache.outline_effect = value == "true",
        "persona_size_px" => cache.persona_size_px = value.parse().unwrap_or(256),
        "audio_threshold" => cache.audio_threshold = value.parse().unwrap_or(20),
        "max_visible_personas" => cache.max_visible_personas = value.parse().unwrap_or(4),
        // ── Tama guest config cache (read by twitch/tiktok handlers at runtime) ────
        "tama_enabled" => cache.tama_enabled = value == "true",
        "tama_guests_enabled" => cache.tama_guests_enabled = value == "true",
        "tama_guests_twitch" => cache.tama_guests_twitch = value == "true",
        "tama_guests_tiktok" => cache.tama_guests_tiktok = value == "true",
        "tama_guests_tts" => cache.tama_guests_tts = value == "true",
        "tama_guests_label_prefix" => cache.tama_guests_label_prefix = value.clone(),
        "tama_guest_mouth_open_path" => cache.tama_guest_mouth_open_path = value.clone(),
        "tama_guest_mouth_closed_path" => cache.tama_guest_mouth_closed_path = value.clone(),
        _ => {}
    }

    let is_tama = key.starts_with("tama_");
    drop(cache);

    if is_tama {
        let full_config = {
            let db = state.db.lock().map_err(map_err)?;
            get_config(&db).map_err(map_err)?
        };
        app.emit("tama-config-changed", &full_config)
            .map_err(map_err)?;
        state.broadcast_ws("tama-config-changed", &full_config);
        tracing::info!("[config] tama-config-changed emitido (key={})", key);
    }
    Ok(())
}

#[tauri::command]
pub async fn get_available_voices_cmd() -> CmdResult<Vec<VoiceInfo>> {
    crate::tts::get_voices().map_err(map_err)
}

/// Cambia el color chroma del overlay en tiempo real vía evento Tauri.
#[tauri::command]
pub async fn set_chroma_color(
    color: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> CmdResult<()> {
    // Scope the Mutex guard before the .emit() call
    {
        let db = state.db.lock().map_err(map_err)?;
        set_config_value(&db, "chroma_color", &color).map_err(map_err)?;
    }

    // Notificar al overlay en tiempo real (Tauri window + WS browser source)
    app.emit("chroma-color-changed", &color).map_err(map_err)?;
    state.broadcast_ws("chroma-color-changed", &color);

    Ok(())
}

// ─── Animation Config Commands ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AnimationConfigInput {
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

/// Persists all animation config fields to the DB and updates the in-memory cache.
/// Emits "animation-config-changed" so the overlay can reload config live.
#[tauri::command]
pub async fn save_animation_config(
    config: AnimationConfigInput,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> CmdResult<()> {
    {
        let db = state.db.lock().map_err(map_err)?;
        set_config_value(&db, "animation_in", &config.animation_in).map_err(map_err)?;
        set_config_value(&db, "animation_out", &config.animation_out).map_err(map_err)?;
        set_config_value(
            &db,
            "visible_duration_secs",
            &config.visible_duration_secs.to_string(),
        )
        .map_err(map_err)?;
        set_config_value(&db, "idle_wiggle", &config.idle_wiggle.to_string()).map_err(map_err)?;
        set_config_value(&db, "idle_breathe", &config.idle_breathe.to_string()).map_err(map_err)?;
        set_config_value(&db, "glow_effect", &config.glow_effect.to_string()).map_err(map_err)?;
        set_config_value(&db, "glow_color", &config.glow_color).map_err(map_err)?;
        set_config_value(&db, "outline_effect", &config.outline_effect.to_string())
            .map_err(map_err)?;
        set_config_value(&db, "persona_size_px", &config.persona_size_px.to_string())
            .map_err(map_err)?;
        set_config_value(&db, "audio_threshold", &config.audio_threshold.to_string())
            .map_err(map_err)?;
        set_config_value(
            &db,
            "max_visible_personas",
            &config.max_visible_personas.to_string(),
        )
        .map_err(map_err)?;
    }

    // Update in-memory cache
    {
        let mut cache = state.config_cache.write().map_err(map_err)?;
        cache.animation_in = config.animation_in.clone();
        cache.animation_out = config.animation_out.clone();
        cache.visible_duration_secs = config.visible_duration_secs;
        cache.idle_wiggle = config.idle_wiggle;
        cache.idle_breathe = config.idle_breathe;
        cache.glow_effect = config.glow_effect;
        cache.glow_color = config.glow_color.clone();
        cache.outline_effect = config.outline_effect;
        cache.persona_size_px = config.persona_size_px;
        cache.audio_threshold = config.audio_threshold;
        cache.max_visible_personas = config.max_visible_personas;
    }

    // Notify overlay of the updated animation config
    let full_config = {
        let db = state.db.lock().map_err(map_err)?;
        get_config(&db).map_err(map_err)?
    };
    app.emit("animation-config-changed", &full_config)
        .map_err(map_err)?;
    tracing::info!("[config] Configuración de animaciones guardada");
    Ok(())
}

// ─── Platform Disconnect Commands ───────────────────────────────────────────

#[tauri::command]
pub async fn disconnect_twitch(state: State<'_, AppState>) -> CmdResult<()> {
    state.abort_twitch();
    state.abort_twitch_eventsub();
    tracing::info!("[twitch] Desconectado");
    Ok(())
}

#[tauri::command]
pub async fn disconnect_tiktok(state: State<'_, AppState>) -> CmdResult<()> {
    state.abort_tiktok();
    tracing::info!("[tiktok] Desconectado");
    Ok(())
}
