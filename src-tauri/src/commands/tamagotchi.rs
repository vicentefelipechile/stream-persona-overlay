use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};

use crate::{db::config::set_config_value, state::AppState};

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
    pub floor_x: f64,
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
            "SELECT ps.user_id, u.display_name, ps.last_seen_at, ps.floor_x, ps.is_sleeping
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
                floor_x: row.get(3)?,
                is_sleeping: row.get::<_, i64>(4)? != 0,
            })
        })
        .map_err(map_err)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

/// Called by the overlay whenever a pet spawns or its state changes.
/// Keeps the DB in sync so the admin panel can show the current pet list.
#[tauri::command]
pub async fn tama_upsert_pet_state(
    user_id: i64,
    display_name: String,
    floor_x: f64,
    is_sleeping: bool,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    let db = state.db.lock().map_err(map_err)?;
    db.execute(
        "INSERT INTO pet_state (user_id, last_seen_at, floor_x, is_sleeping)
         VALUES (?1, datetime('now'), ?2, ?3)
         ON CONFLICT(user_id) DO UPDATE SET
             last_seen_at = datetime('now'),
             floor_x      = excluded.floor_x,
             is_sleeping  = excluded.is_sleeping",
        rusqlite::params![user_id, floor_x, is_sleeping as i64],
    )
    .map_err(map_err)?;

    let _ = display_name; // display_name is in users table — no need to duplicate
    Ok(())
}

/// Called by the overlay when a pet despawns.
#[tauri::command]
pub async fn tama_remove_pet_state(user_id: i64, state: State<'_, AppState>) -> CmdResult<()> {
    let db = state.db.lock().map_err(map_err)?;
    db.execute(
        "DELETE FROM pet_state WHERE user_id = ?1",
        rusqlite::params![user_id],
    )
    .map_err(map_err)?;
    Ok(())
}
