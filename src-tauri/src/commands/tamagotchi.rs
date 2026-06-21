use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};

use crate::{
    db::config::{get_config, set_config_value},
    state::AppState,
};

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// =========================================================================================================
// Types
// =========================================================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PetStateRow {
    pub user_id: i64,
    pub display_name: String,
    pub last_seen_at: String,
    pub cell_x: u16,
    pub cell_y: u16,
    pub is_sleeping: bool,
}

// =========================================================================================================
// Commands
// =========================================================================================================

/// Emits a tama-action event to the overlay window so PetManager can
/// forward it to the target pet. The input field is free-form JSON.
#[tauri::command]
pub async fn tama_trigger_action(
    user_id: i64,
    action_id: String,
    input: serde_json::Value,
    app: tauri::AppHandle,
) -> CmdResult<()> {
    #[derive(Serialize, Clone)]
    struct Payload {
        user_id: i64,
        action_id: String,
        input: serde_json::Value,
    }

    let payload = Payload {
        user_id,
        action_id,
        input,
    };
    app.emit("tama-action", payload.clone()).map_err(map_err)?;

    // Also broadcast to OBS Browser Source WebSocket clients
    let state = app.state::<AppState>();
    state.broadcast_ws("tama-action", &payload);

    tracing::info!("[tama] Action triggered for user_id={}", user_id);
    Ok(())
}

/// Emits a tama-reset event so every overlay (the Tauri window and any OBS/TikTok
/// Browser Source) destroys and recreates all active pets from scratch. Used to
/// recover pets that froze mid-action (e.g. a broken fight) without restarting
/// the connection.
#[tauri::command]
pub async fn tama_reset_all(app: tauri::AppHandle) -> CmdResult<()> {
    app.emit("tama-reset", ()).map_err(map_err)?;

    // Also broadcast to OBS Browser Source WebSocket clients.
    let state = app.state::<AppState>();
    state.broadcast_ws("tama-reset", &serde_json::Value::Null);

    tracing::info!("[tama] Reset all pets requested");
    Ok(())
}

/// Persists tama_enabled to the config table.
#[tauri::command]
pub async fn tama_set_enabled(enabled: bool, state: State<'_, AppState>) -> CmdResult<()> {
    let db = state.db.lock().map_err(map_err)?;
    set_config_value(&db, "tama_enabled", &enabled.to_string()).map_err(map_err)?;
    tracing::info!("[tama] tama_enabled set to {}", enabled);
    Ok(())
}

/// Returns all active pet rows joined with their display_name from users.
#[tauri::command]
pub async fn tama_get_pet_states(state: State<'_, AppState>) -> CmdResult<Vec<PetStateRow>> {
    let db = state.db.lock().map_err(map_err)?;
    let mut stmt = db
        .prepare(
            "SELECT ps.user_id, u.display_name, ps.last_seen_at, ps.cell_x, ps.cell_y, ps.is_sleeping
             FROM pet_state ps
             JOIN users u ON u.id = ps.user_id
             ORDER BY ps.last_seen_at DESC",
        )
        .map_err(map_err)?;

    let rows = stmt
        .query_map([], |row| {
            Ok(PetStateRow {
                user_id: row.get(0)?,
                display_name: row.get(1)?,
                last_seen_at: row.get(2)?,
                cell_x: row.get::<_, i64>(3)? as u16,
                cell_y: row.get::<_, i64>(4)? as u16,
                is_sleeping: row.get::<_, i64>(5)? != 0,
            })
        })
        .map_err(map_err)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

/// Called by the overlay whenever a pet spawns or its sleep state changes.
/// Keeps the DB in sync so the admin panel can show the current pet list. The
/// authoritative position lives in `GridManager`; the cell is persisted here only
/// so the panel can display it and so a restart can rehydrate.
#[tauri::command]
pub async fn tama_upsert_pet_state(
    user_id: i64,
    display_name: String,
    cell_x: u16,
    cell_y: u16,
    is_sleeping: bool,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    let db = state.db.lock().map_err(map_err)?;
    db.execute(
        "INSERT INTO pet_state (user_id, last_seen_at, cell_x, cell_y, is_sleeping)
         VALUES (?1, datetime('now'), ?2, ?3, ?4)
         ON CONFLICT(user_id) DO UPDATE SET
             last_seen_at = datetime('now'),
             cell_x       = excluded.cell_x,
             cell_y       = excluded.cell_y,
             is_sleeping  = excluded.is_sleeping",
        rusqlite::params![user_id, cell_x as i64, cell_y as i64, is_sleeping as i64],
    )
    .map_err(map_err)?;

    let _ = display_name; // display_name is in users table — no need to duplicate
    Ok(())
}

// =========================================================================================================
// Grid Commands
// =========================================================================================================

/// Ensures the pet has an assigned grid cell (allocating one on first call) and
/// emits a `tama-grid-update`. Called by the overlay when a pet spawns so the
/// backend remains the single source of truth for placement.
#[tauri::command]
pub async fn tama_grid_ensure(user_id: i64, app: tauri::AppHandle) -> CmdResult<()> {
    let state = app.state::<AppState>();
    state.grid.ensure(&app, user_id);
    Ok(())
}

/// Returns the current grid dimensions plus every pet's cell, so a client that
/// connects after pets already exist can rehydrate without waiting for updates.
#[tauri::command]
pub async fn tama_grid_get_state(
    state: State<'_, AppState>,
) -> CmdResult<crate::grid::GridSnapshot> {
    Ok(state.grid.snapshot())
}

/// Moves a pet to the free cell nearest the requested target, emitting the update.
/// Used by actions (e.g. fight) so pets converge on a meeting cell chosen by the
/// authoritative grid instead of a hard-coded screen position.
#[tauri::command]
pub async fn tama_grid_move(
    user_id: i64,
    cell_x: u16,
    cell_y: u16,
    app: tauri::AppHandle,
) -> CmdResult<()> {
    let state = app.state::<AppState>();
    state
        .grid
        .move_to_nearest_free(&app, user_id, (cell_x, cell_y));
    Ok(())
}

/// Called by the overlay when a pet falls asleep (inactive) or wakes up (active).
/// In the static row this re-packs the line so inactive pets drift to the far end and
/// the talkers stay packed against the anchor; in free mode it's a no-op.
#[tauri::command]
pub async fn tama_grid_set_active(
    user_id: i64,
    active: bool,
    app: tauri::AppHandle,
) -> CmdResult<()> {
    let state = app.state::<AppState>();
    state.grid.set_active(&app, user_id, active);
    Ok(())
}

/// Called by the overlay when a pet despawns. Frees the pet's grid cell (so the
/// slot can be reused and a `tama-grid-remove` is broadcast) and deletes its row.
#[tauri::command]
pub async fn tama_remove_pet_state(user_id: i64, app: tauri::AppHandle) -> CmdResult<()> {
    let state = app.state::<AppState>();
    state.grid.release(&app, user_id);
    {
        let db = state.db.lock().map_err(map_err)?;
        db.execute(
            "DELETE FROM pet_state WHERE user_id = ?1",
            rusqlite::params![user_id],
        )
        .map_err(map_err)?;
    }
    Ok(())
}

// =========================================================================================================
// Guest Image Commands
// =========================================================================================================

/// Saves a custom guest pet image (mouth open or closed) to app_data_dir and
/// updates the corresponding config key so Twitch/TikTok handlers use it.
///
/// `image_type` must be `"open"` or `"closed"`.
/// `image_data` is the raw file bytes (PNG or JPEG, max 2 MB).
#[tauri::command]
pub async fn set_guest_image(
    image_type: String,
    image_data: Vec<u8>,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> CmdResult<()> {
    if image_data.len() > 2 * 1024 * 1024 {
        return Err("La imagen no puede superar los 2 MB".to_string());
    }

    let (filename, config_key) = match image_type.as_str() {
        "open" => ("guest_open.png", "tama_guest_mouth_open_path"),
        "closed" => ("guest_closed.png", "tama_guest_mouth_closed_path"),
        _ => return Err("image_type debe ser \"open\" o \"closed\"".to_string()),
    };

    let img =
        image::load_from_memory(&image_data).map_err(|e| format!("Imagen inválida: {}", e))?;

    let resized = img.resize_exact(512, 512, image::imageops::FilterType::Lanczos3);

    let dest_path = state.app_data_dir.join(filename);
    resized
        .save(&dest_path)
        .map_err(|e| format!("Error guardando imagen: {}", e))?;

    let path_str = dest_path.to_string_lossy().to_string();

    {
        let db = state.db.lock().map_err(map_err)?;
        set_config_value(&db, config_key, &path_str).map_err(map_err)?;
    }

    {
        let mut cache = state.config_cache.write().map_err(map_err)?;
        match config_key {
            "tama_guest_mouth_open_path" => cache.tama_guest_mouth_open_path = path_str.clone(),
            "tama_guest_mouth_closed_path" => cache.tama_guest_mouth_closed_path = path_str.clone(),
            _ => {}
        }
    }

    let full_config = {
        let db = state.db.lock().map_err(map_err)?;
        get_config(&db).map_err(map_err)?
    };
    app.emit("tama-config-changed", &full_config)
        .map_err(map_err)?;
    state.broadcast_ws("tama-config-changed", &full_config);

    tracing::info!(
        "[tama] Imagen de invitado '{}' actualizada: {}",
        image_type,
        path_str
    );
    Ok(())
}

/// Resets a guest image to the bundled default by clearing the config key.
#[tauri::command]
pub async fn reset_guest_image(
    image_type: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> CmdResult<()> {
    let config_key = match image_type.as_str() {
        "open" => "tama_guest_mouth_open_path",
        "closed" => "tama_guest_mouth_closed_path",
        _ => return Err("image_type debe ser \"open\" o \"closed\"".to_string()),
    };

    {
        let db = state.db.lock().map_err(map_err)?;
        set_config_value(&db, config_key, "").map_err(map_err)?;
    }

    {
        let mut cache = state.config_cache.write().map_err(map_err)?;
        match config_key {
            "tama_guest_mouth_open_path" => cache.tama_guest_mouth_open_path = String::new(),
            "tama_guest_mouth_closed_path" => cache.tama_guest_mouth_closed_path = String::new(),
            _ => {}
        }
    }

    let full_config = {
        let db = state.db.lock().map_err(map_err)?;
        get_config(&db).map_err(map_err)?
    };
    app.emit("tama-config-changed", &full_config)
        .map_err(map_err)?;
    state.broadcast_ws("tama-config-changed", &full_config);

    tracing::info!(
        "[tama] Imagen de invitado '{}' restablecida al default",
        image_type
    );
    Ok(())
}
