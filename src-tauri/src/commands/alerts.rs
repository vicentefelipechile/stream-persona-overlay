// =========================================================================================================
// Event Alert Commands
// =========================================================================================================
// Manage the per-event alert assets (image / sound) and preview alerts on the
// dedicated alert overlay (overlay-alerts.html). The alert settings themselves
// (enabled / text / duration_ms / transition) live in the `alerts_config`
// JSON key and are saved from the frontend via the generic `set_config_cmd`.
// Covers both Twitch (cheer/sub/raid/follow/hype_train) and TikTok event kinds.
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

/// Event kinds that support a configurable alert. Used to validate the
/// `event_kind` argument so it can never be used to escape the alerts dir.
const ALERT_EVENT_KINDS: &[&str] = &[
    // Twitch
    "cheer",
    "sub",
    "raid",
    "follow",
    "hype_train",
    // TikTok
    "tiktok_gift",
    "tiktok_gift_big",
    "tiktok_follow",
    "tiktok_share",
    "tiktok_subscribe",
    "tiktok_like",
    "tiktok_member",
];

const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];
const SOUND_EXTS: &[&str] = &["mp3", "ogg", "wav"];
const MAX_ASSET_BYTES: usize = 5 * 1024 * 1024;

/// Writes the alerts JSON back to the DB and refreshes the in-memory cache, then
/// emits the full config so the admin panel can refresh.
fn persist_alerts_config(
    state: &AppState,
    app: &tauri::AppHandle,
    alerts_json: &str,
) -> CmdResult<()> {
    {
        let db = state.db.lock().map_err(map_err)?;
        set_config_value(&db, "alerts_config", alerts_json).map_err(map_err)?;
    }
    {
        let mut cache = state.config_cache.write().map_err(map_err)?;
        cache.alerts_config = alerts_json.to_string();
    }

    let full_config = {
        let db = state.db.lock().map_err(map_err)?;
        get_config(&db).map_err(map_err)?
    };
    app.emit("event-alerts-changed", &full_config)
        .map_err(map_err)?;
    Ok(())
}

/// Sets the `image` or `sound` path of a single event's alert entry in the
/// `alerts_config` JSON, creating the entry object if missing.
fn set_asset_path(alerts_json: &str, event_kind: &str, field: &str, path: &str) -> String {
    let mut root: serde_json::Value =
        serde_json::from_str(alerts_json).unwrap_or_else(|_| serde_json::json!({}));
    if !root.is_object() {
        root = serde_json::json!({});
    }
    let obj = root.as_object_mut().unwrap();
    let entry = obj
        .entry(event_kind.to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !entry.is_object() {
        *entry = serde_json::json!({});
    }
    entry
        .as_object_mut()
        .unwrap()
        .insert(field.to_string(), serde_json::json!(path));
    serde_json::to_string(&root).unwrap_or_else(|_| alerts_json.to_string())
}

/// Saves a custom alert image or sound under `{app_data_dir}/alerts/` and stores
/// its absolute path in the `alerts_config` JSON. The bytes are written verbatim
/// (no resize) so animated GIFs are preserved. Returns the saved path.
///
/// `asset_type` is `"image"` or `"sound"`; `file_name` is only used for its
/// extension (to validate the type and name the saved file).
#[tauri::command]
pub async fn set_event_alert_asset(
    event_kind: String,
    asset_type: String,
    file_name: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> CmdResult<String> {
    if !ALERT_EVENT_KINDS.contains(&event_kind.as_str()) {
        return Err(format!("event_kind desconocido: {}", event_kind));
    }
    if data.len() > MAX_ASSET_BYTES {
        return Err("El archivo no puede superar los 5 MB".to_string());
    }

    let ext = file_name
        .rsplit('.')
        .next()
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    let (field, allowed) = match asset_type.as_str() {
        "image" => ("image", IMAGE_EXTS),
        "sound" => ("sound", SOUND_EXTS),
        _ => return Err("asset_type debe ser \"image\" o \"sound\"".to_string()),
    };
    if !allowed.contains(&ext.as_str()) {
        return Err(format!(
            "Formato no soportado (.{}). Permitidos: {}",
            ext,
            allowed.join(", ")
        ));
    }

    let alerts_dir = state.app_data_dir.join("alerts");
    std::fs::create_dir_all(&alerts_dir)
        .map_err(|e| format!("No se pudo crear el directorio de alertas: {}", e))?;

    let dest_path = alerts_dir.join(format!("{}_{}.{}", event_kind, asset_type, ext));
    std::fs::write(&dest_path, &data).map_err(|e| format!("Error guardando archivo: {}", e))?;

    let path_str = dest_path.to_string_lossy().to_string();

    let current = {
        let cache = state.config_cache.read().map_err(map_err)?;
        cache.alerts_config.clone()
    };
    let updated = set_asset_path(&current, &event_kind, field, &path_str);
    persist_alerts_config(&state, &app, &updated)?;

    tracing::info!(
        "[alerts] Asset '{}' de '{}' guardado: {}",
        asset_type,
        event_kind,
        path_str
    );
    Ok(path_str)
}

/// Clears the `image` or `sound` path of an event's alert entry (reverting to
/// no asset). The file on disk is left in place; only the config reference is removed.
#[tauri::command]
pub async fn clear_event_alert_asset(
    event_kind: String,
    asset_type: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> CmdResult<()> {
    if !ALERT_EVENT_KINDS.contains(&event_kind.as_str()) {
        return Err(format!("event_kind desconocido: {}", event_kind));
    }
    let field = match asset_type.as_str() {
        "image" => "image",
        "sound" => "sound",
        _ => return Err("asset_type debe ser \"image\" o \"sound\"".to_string()),
    };

    let current = {
        let cache = state.config_cache.read().map_err(map_err)?;
        cache.alerts_config.clone()
    };
    let updated = set_asset_path(&current, &event_kind, field, "");
    persist_alerts_config(&state, &app, &updated)?;

    tracing::info!(
        "[alerts] Asset '{}' de '{}' eliminado",
        asset_type,
        event_kind
    );
    Ok(())
}

/// Fires a preview alert for `event_kind` using sample data, ignoring the
/// `enabled` flag, so the streamer can see it on the alert overlay.
#[tauri::command]
pub async fn test_event_alert(
    event_kind: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> CmdResult<()> {
    if crate::alerts::emit_test_alert(&state, &app, &event_kind) {
        Ok(())
    } else {
        Err(format!(
            "No hay alerta configurada para el evento '{}'",
            event_kind
        ))
    }
}
