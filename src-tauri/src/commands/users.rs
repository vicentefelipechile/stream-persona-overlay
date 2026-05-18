use tauri::State;

use crate::{
    db::users::{delete_user, get_all_users, get_user_by_id, toggle_user_active, update_user, UpdateUserPayload},
    state::AppState,
};

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ─── Tauri Commands — Usuarios ───────────────────────────────────────────────

#[tauri::command]
pub async fn get_users(state: State<'_, AppState>) -> CmdResult<Vec<crate::db::users::User>> {
    let db = state.db.lock().map_err(map_err)?;
    get_all_users(&db).map_err(map_err)
}

#[tauri::command]
pub async fn get_user(
    id: i64,
    state: State<'_, AppState>,
) -> CmdResult<Option<crate::db::users::User>> {
    let db = state.db.lock().map_err(map_err)?;
    get_user_by_id(&db, id).map_err(map_err)
}

#[tauri::command]
pub async fn update_user_cmd(
    user: UpdateUserPayload,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    let db = state.db.lock().map_err(map_err)?;
    update_user(&db, &user).map_err(map_err)
}

#[tauri::command]
pub async fn delete_user_cmd(id: i64, state: State<'_, AppState>) -> CmdResult<()> {
    let db = state.db.lock().map_err(map_err)?;
    delete_user(&db, id).map_err(map_err)
}

#[tauri::command]
pub async fn toggle_user_active_cmd(
    id: i64,
    state: State<'_, AppState>,
) -> CmdResult<bool> {
    let db = state.db.lock().map_err(map_err)?;
    toggle_user_active(&db, id).map_err(map_err)
}

#[tauri::command]
pub async fn get_recent_logs_cmd(
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> CmdResult<Vec<serde_json::Value>> {
    let db = state.db.lock().map_err(map_err)?;
    crate::db::config::get_recent_logs(&db, limit.unwrap_or(100)).map_err(map_err)
}
