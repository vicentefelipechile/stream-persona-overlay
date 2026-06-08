// =========================================================================================================
// Streamer Persona Commands
// =========================================================================================================
// Upload / reset the four sprites that make up the streamer persona overlay
// (overlay-streamer.html). The four slots are the mouth × eyes matrix:
//
//   mo_eo = mouth open,   eyes open
//   mc_eo = mouth closed, eyes open
//   mo_ec = mouth open,   eyes closed
//   mc_ec = mouth closed, eyes closed
//
// Unlike the guest/persona images, these are the STREAMER's own assets, so they
// are saved at full resolution and quality — the bytes are written verbatim
// (no decode + re-encode, no resize). We only sniff the file header to confirm
// it is a supported image and to pick the right extension; this is effectively
// instant even for large PNGs. The path is persisted in config, the cache is
// refreshed and `streamer-config-changed` is emitted (and broadcast over WS so
// the OBS overlay updates live).
// =========================================================================================================

use tauri::{Emitter, State};

use crate::{
    db::config::{get_config, set_config_value},
    state::AppState,
};

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Maps a slot id to its config_key. Returns an error for unknown slots.
fn slot_key(slot: &str) -> Result<&'static str, String> {
    match slot {
        "mo_eo" => Ok("streamer_sprite_mo_eo"),
        "mc_eo" => Ok("streamer_sprite_mc_eo"),
        "mo_ec" => Ok("streamer_sprite_mo_ec"),
        "mc_ec" => Ok("streamer_sprite_mc_ec"),
        _ => Err(format!("slot inválido: {}", slot)),
    }
}

/// Sniffs the image header and returns the file extension to use. Rejects
/// unsupported formats. Reads only the magic bytes — does not decode pixels.
fn sniff_extension(bytes: &[u8]) -> Result<&'static str, String> {
    match image::guess_format(bytes).map_err(|e| format!("Imagen inválida: {}", e))? {
        image::ImageFormat::Png => Ok("png"),
        image::ImageFormat::Jpeg => Ok("jpg"),
        image::ImageFormat::WebP => Ok("webp"),
        image::ImageFormat::Gif => Ok("gif"),
        other => Err(format!("Formato no soportado: {:?}", other)),
    }
}

/// Syncs a single streamer sprite path into the in-memory config cache.
fn sync_cache_path(cache: &mut crate::state::AppConfig, config_key: &str, path: &str) {
    match config_key {
        "streamer_sprite_mo_eo" => cache.streamer_sprite_mo_eo = path.to_string(),
        "streamer_sprite_mc_eo" => cache.streamer_sprite_mc_eo = path.to_string(),
        "streamer_sprite_mo_ec" => cache.streamer_sprite_mo_ec = path.to_string(),
        "streamer_sprite_mc_ec" => cache.streamer_sprite_mc_ec = path.to_string(),
        _ => {}
    }
}

/// Saves a custom streamer persona sprite for the given slot at full quality.
///
/// `slot` must be one of `"mo_eo"`, `"mc_eo"`, `"mo_ec"`, `"mc_ec"`.
/// `image_data` is the raw file bytes (PNG / JPEG / WebP / GIF, max 25 MB).
/// The bytes are written verbatim — no resize, no re-encode.
#[tauri::command]
pub async fn set_streamer_sprite(
    slot: String,
    image_data: Vec<u8>,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> CmdResult<()> {
    if image_data.len() > 25 * 1024 * 1024 {
        return Err("La imagen no puede superar los 25 MB".to_string());
    }

    let config_key = slot_key(&slot)?;
    let ext = sniff_extension(&image_data)?;

    let dest_path = state.app_data_dir.join(format!("streamer_{}.{}", slot, ext));
    std::fs::write(&dest_path, &image_data)
        .map_err(|e| format!("Error guardando imagen: {}", e))?;

    let path_str = dest_path.to_string_lossy().to_string();

    {
        let db = state.db.lock().map_err(map_err)?;
        set_config_value(&db, config_key, &path_str).map_err(map_err)?;
    }

    {
        let mut cache = state.config_cache.write().map_err(map_err)?;
        sync_cache_path(&mut cache, config_key, &path_str);
    }

    let full_config = {
        let db = state.db.lock().map_err(map_err)?;
        get_config(&db).map_err(map_err)?
    };
    app.emit("streamer-config-changed", &full_config)
        .map_err(map_err)?;
    state.broadcast_ws("streamer-config-changed", &full_config);

    tracing::info!("[streamer] Sprite '{}' actualizado: {}", slot, path_str);
    Ok(())
}

/// Clears the sprite for a slot by emptying its config key (file left on disk).
#[tauri::command]
pub async fn reset_streamer_sprite(
    slot: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> CmdResult<()> {
    let config_key = slot_key(&slot)?;

    {
        let db = state.db.lock().map_err(map_err)?;
        set_config_value(&db, config_key, "").map_err(map_err)?;
    }

    {
        let mut cache = state.config_cache.write().map_err(map_err)?;
        sync_cache_path(&mut cache, config_key, "");
    }

    let full_config = {
        let db = state.db.lock().map_err(map_err)?;
        get_config(&db).map_err(map_err)?
    };
    app.emit("streamer-config-changed", &full_config)
        .map_err(map_err)?;
    state.broadcast_ws("streamer-config-changed", &full_config);

    tracing::info!("[streamer] Sprite '{}' restablecido", slot);
    Ok(())
}
