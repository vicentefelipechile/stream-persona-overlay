use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

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
        "overlay_bg_mode" => cache.overlay_bg_mode = value.clone(),
        "overlay_bg_image_path" => cache.overlay_bg_image_path = value.clone(),
        "overlay_bg_quality" => cache.overlay_bg_quality = value.clone(),
        "tts_enabled" => cache.tts_enabled = value == "true",
        // Read once at server startup — cached here for consistency, takes effect on restart.
        "lan_access_enabled" => cache.lan_access_enabled = value == "true",
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
        // ── Grid layout cache (read live by the grid reconfigure below) ────────
        "tama_placement_mode" => cache.tama_placement_mode = value.clone(),
        "tama_row_anchor" => cache.tama_row_anchor = value.clone(),
        "tama_layout_mode" => cache.tama_layout_mode = value.clone(),
        "tama_grid_high_precision" => cache.tama_grid_high_precision = value == "true",
        "tama_grid_perspective" => cache.tama_grid_perspective = value == "true",
        "tama_grid_perspective_type" => cache.tama_grid_perspective_type = value.clone(),
        "tama_grid_near_scale" => cache.tama_grid_near_scale = value.parse().unwrap_or(1.3),
        "tama_grid_far_scale" => cache.tama_grid_far_scale = value.parse().unwrap_or(0.6),
        "tama_grid_floor_top_frac" => {
            cache.tama_grid_floor_top_frac = value.parse().unwrap_or(0.55)
        }
        "tama_grid_wander_enabled" => cache.tama_grid_wander_enabled = value == "true",
        // Alert config is read by the twitch/tiktok handlers at runtime — keep
        // the cache in sync so edits take effect without restarting.
        "alerts_config" => cache.alerts_config = value.clone(),
        // ── Streamer persona cache (read live by overlay-streamer) ─────────────
        "streamer_persona_enabled" => cache.streamer_persona_enabled = value == "true",
        "streamer_sprite_mo_eo" => cache.streamer_sprite_mo_eo = value.clone(),
        "streamer_sprite_mc_eo" => cache.streamer_sprite_mc_eo = value.clone(),
        "streamer_sprite_mo_ec" => cache.streamer_sprite_mo_ec = value.clone(),
        "streamer_sprite_mc_ec" => cache.streamer_sprite_mc_ec = value.clone(),
        "streamer_blink_interval_ms" => {
            cache.streamer_blink_interval_ms = value.parse().unwrap_or(4000)
        }
        "streamer_blink_duration_ms" => {
            cache.streamer_blink_duration_ms = value.parse().unwrap_or(150)
        }
        "streamer_talk_animation" => cache.streamer_talk_animation = value.clone(),
        "streamer_size_px" => cache.streamer_size_px = value.parse().unwrap_or(512),
        "streamer_anchor" => cache.streamer_anchor = value.clone(),
        "streamer_mic_threshold" => cache.streamer_mic_threshold = value.parse().unwrap_or(20),
        "streamer_mic_device_id" => cache.streamer_mic_device_id = value.clone(),
        _ => {}
    }

    // A change to a grid-shaping key resizes the authoritative grid in place and
    // re-emits cells to every client. Only the dimension keys trigger a rebuild.
    let rebuild_grid = matches!(
        key.as_str(),
        "tama_placement_mode" | "tama_row_anchor" | "tama_grid_high_precision"
    );
    let (row_mode, high_precision, row_anchor) = (
        cache.tama_placement_mode == "row",
        cache.tama_grid_high_precision,
        cache.tama_row_anchor.clone(),
    );

    let is_tama = key.starts_with("tama_");
    let is_streamer = key.starts_with("streamer_");
    let is_overlay_bg = key.starts_with("overlay_bg_");
    drop(cache);

    // Background mode/quality changes (set via the generic command, not the upload
    // command) must reach the overlay live. Reuse the same `overlay-bg-changed`
    // event the dedicated upload command emits.
    if is_overlay_bg {
        let full_config = {
            let db = state.db.lock().map_err(map_err)?;
            get_config(&db).map_err(map_err)?
        };
        app.emit("overlay-bg-changed", &full_config)
            .map_err(map_err)?;
        state.broadcast_ws("overlay-bg-changed", &full_config);
    }

    // Emit the full-config event BEFORE rebuilding the grid. A grid-shaping change
    // (e.g. tama_row_anchor) emits both `tama-config-changed` (carries the new anchor)
    // and, from reconfigure(), `tama-grid-config` + a fresh snapshot of cell updates.
    // The overlay applies the anchor from `tama-config-changed`; if the snapshot's
    // grid-updates arrived first they'd re-place pets using the OLD anchor and the
    // resulting walk animation would fight the later snap (pets stuck on the wrong
    // edge until a resize). Emitting the config first guarantees Grid2D has the new
    // anchor before any cell update lands, so every placement uses the right edge.
    if is_tama || is_streamer {
        let full_config = {
            let db = state.db.lock().map_err(map_err)?;
            get_config(&db).map_err(map_err)?
        };
        let event = if is_tama {
            "tama-config-changed"
        } else {
            "streamer-config-changed"
        };
        app.emit(event, &full_config).map_err(map_err)?;
        state.broadcast_ws(event, &full_config);
        tracing::info!("[config] {} emitido (key={})", event, key);
    }

    if rebuild_grid {
        state
            .grid
            .reconfigure(&app, row_mode, high_precision, &row_anchor);
    }
    Ok(())
}

#[tauri::command]
pub async fn get_available_voices_cmd() -> CmdResult<Vec<VoiceInfo>> {
    crate::tts::get_voices().map_err(map_err)
}

/// Returns this machine's primary LAN IPv4 address (e.g. "192.168.1.42"), used to
/// build the overlay URL shown when LAN access is enabled. No packets are actually
/// sent: a UDP socket "connected" to a public address makes the OS pick the
/// outbound interface, whose local address we then read. Returns None if it can't
/// be resolved (e.g. no network).
#[tauri::command]
pub async fn get_lan_ip_cmd() -> CmdResult<Option<String>> {
    let socket = match std::net::UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => s,
        Err(_) => return Ok(None),
    };
    if socket.connect("8.8.8.8:80").is_err() {
        return Ok(None);
    }
    Ok(socket
        .local_addr()
        .ok()
        .map(|addr| addr.ip().to_string())
        .filter(|ip| ip != "0.0.0.0"))
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

// ─── Overlay Background Commands ─────────────────────────────────────────────

const BG_IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];
const MAX_BG_BYTES: usize = 8 * 1024 * 1024;

/// Emits the full config as `overlay-bg-changed` (Tauri window + WS browser source)
/// so both overlays re-read the background mode / quality / image path live.
fn emit_overlay_bg_changed(state: &AppState, app: &AppHandle) -> CmdResult<()> {
    let full_config = {
        let db = state.db.lock().map_err(map_err)?;
        get_config(&db).map_err(map_err)?
    };
    app.emit("overlay-bg-changed", &full_config)
        .map_err(map_err)?;
    state.broadcast_ws("overlay-bg-changed", &full_config);
    Ok(())
}

/// Uploads a custom overlay background image. Saves three quality variants under
/// `{app_data_dir}/overlay_bg/`:
///   - `bg_original.<ext>` — bytes verbatim (preserves animated GIFs at full quality)
///   - `bg_media.png`      — ~960px wide, lightly blurred (smaller + softer)
///   - `bg_baja.png`       — ~160px wide (very low-res; reads as pixelated/blurry)
/// Switches `overlay_bg_mode` to "image", stores the original path, and emits the
/// background-changed event. The overlay derives the variant filename from the
/// chosen quality.
#[tauri::command]
pub async fn set_overlay_background(
    file_name: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> CmdResult<String> {
    if data.len() > MAX_BG_BYTES {
        return Err("La imagen no puede superar los 8 MB".to_string());
    }

    let ext = file_name
        .rsplit('.')
        .next()
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !BG_IMAGE_EXTS.contains(&ext.as_str()) {
        return Err(format!(
            "Formato no soportado (.{}). Permitidos: {}",
            ext,
            BG_IMAGE_EXTS.join(", ")
        ));
    }

    let bg_dir = state.app_data_dir.join("overlay_bg");
    std::fs::create_dir_all(&bg_dir)
        .map_err(|e| format!("No se pudo crear el directorio de fondo: {}", e))?;

    // Original — verbatim bytes (keeps animated GIFs intact).
    let original_path = bg_dir.join(format!("bg_original.{}", ext));
    std::fs::write(&original_path, &data)
        .map_err(|e| format!("Error guardando imagen original: {}", e))?;

    // Decode once for the downscaled variants. If decoding fails (rare formats),
    // the original still works and the lower qualities fall back to it on the
    // frontend — but treat a decode error as fatal here to surface bad uploads.
    let img = image::load_from_memory(&data).map_err(|e| format!("Imagen inválida: {}", e))?;

    // Media — reduced resolution + light blur.
    let media = img.resize(960, 960, image::imageops::FilterType::Lanczos3);
    let media = image::DynamicImage::ImageRgba8(image::imageops::blur(&media.to_rgba8(), 2.0));
    media
        .save(bg_dir.join("bg_media.png"))
        .map_err(|e| format!("Error guardando variante media: {}", e))?;

    // Baja — very small; CSS upscaling makes it read as low-resolution.
    let baja = img.resize(160, 160, image::imageops::FilterType::Triangle);
    baja.save(bg_dir.join("bg_baja.png"))
        .map_err(|e| format!("Error guardando variante baja: {}", e))?;

    let path_str = original_path.to_string_lossy().to_string();

    {
        let db = state.db.lock().map_err(map_err)?;
        set_config_value(&db, "overlay_bg_image_path", &path_str).map_err(map_err)?;
        set_config_value(&db, "overlay_bg_mode", "image").map_err(map_err)?;
    }
    {
        let mut cache = state.config_cache.write().map_err(map_err)?;
        cache.overlay_bg_image_path = path_str.clone();
        cache.overlay_bg_mode = "image".to_string();
    }

    emit_overlay_bg_changed(&state, &app)?;
    tracing::info!("[overlay] Fondo personalizado guardado: {}", path_str);
    Ok(path_str)
}

/// Clears the custom overlay background, reverting `overlay_bg_mode` to "color".
/// The files on disk are left in place; only the config is updated.
#[tauri::command]
pub async fn clear_overlay_background(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> CmdResult<()> {
    {
        let db = state.db.lock().map_err(map_err)?;
        set_config_value(&db, "overlay_bg_mode", "color").map_err(map_err)?;
        set_config_value(&db, "overlay_bg_image_path", "").map_err(map_err)?;
    }
    {
        let mut cache = state.config_cache.write().map_err(map_err)?;
        cache.overlay_bg_mode = "color".to_string();
        cache.overlay_bg_image_path = String::new();
    }

    emit_overlay_bg_changed(&state, &app)?;
    tracing::info!("[overlay] Fondo personalizado eliminado");
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
pub async fn disconnect_tiktok(state: State<'_, AppState>, app: AppHandle) -> CmdResult<()> {
    state.abort_tiktok();
    // The panel knows it asked for this, but the overlay doesn't — mirror it there.
    crate::tiktok::notify_overlay(&app, state.inner(), "info", "TikTok desconectado");
    tracing::info!("[tiktok] Desconectado");
    Ok(())
}
