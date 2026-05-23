use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::{
    db::{config::log_message, users::find_active_user_by_tiktok},
    state::{AppState, ChatMessagePayload, ChatEventPayload},
};

/// Conecta a TikTool WebSocket API y escucha eventos de chat de TikTok LIVE.
/// Si el username está vacío, no hace nada.
pub async fn spawn_tiktok_client(state: AppState, app_handle: AppHandle) {
    let tiktok_username = {
        let Ok(db) = state.db.lock() else {
            tracing::error!("[tiktok] DB mutex poisoned — abortando cliente");
            return;
        };
        crate::db::config::get_config(&db)
            .unwrap_or_default()
            .tiktok_username
    };

    if tiktok_username.is_empty() {
        tracing::warn!("Username de TikTok no configurado — cliente no iniciado");
        return;
    }

    // URL de TikTool (sandbox gratuito)
    let url = format!(
        "wss://ws.tiktok.eulerstream.com/chat?uniqueId={}",
        tiktok_username
    );

    tracing::info!("Conectando a TikTok LIVE WS: {}", url);

    let ws_stream = match connect_async(&url).await {
        Ok((stream, _)) => stream,
        Err(e) => {
            tracing::error!("No se pudo conectar a TikTok WS: {}", e);
            return;
        }
    };

    let (_, mut read) = ws_stream.split();

    while let Some(msg_result) = read.next().await {
        match msg_result {
            Ok(Message::Text(text)) => {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    handle_tiktok_event(&state, &app_handle, &json);
                }
            }
            Ok(Message::Close(_)) => {
                tracing::info!("TikTok WS cerrado");
                break;
            }
            Err(e) => {
                tracing::error!("Error en TikTok WS: {}", e);
                break;
            }
            _ => {}
        }
    }
}

/// Processes a single TikTok event synchronously (no .await inside).
fn handle_tiktok_event(
    state: &AppState,
    app_handle: &AppHandle,
    json: &serde_json::Value,
) {
    let event_type = json.get("event").and_then(|v| v.as_str()).unwrap_or("");
    let data = match json.get("data") {
        Some(d) => d,
        None => return,
    };

    let Ok(cfg) = state.config_cache.read() else { return; };

    match event_type {
        "chat" => handle_chat(state, app_handle, data, &cfg),
        "gift" if cfg.tiktok_event_gift_enabled => handle_gift(state, app_handle, data, &cfg),
        "like" if cfg.tiktok_event_like_enabled => handle_like(state, app_handle, data, &cfg),
        "social" if cfg.tiktok_event_follow_enabled || cfg.tiktok_event_share_enabled => handle_social(state, app_handle, data, &cfg),
        "subscribe" if cfg.tiktok_event_subscribe_enabled => handle_subscribe(state, app_handle, data, &cfg),
        "envelope" if cfg.tiktok_event_envelope_enabled => handle_envelope(state, app_handle, data, &cfg),
        _ => {}
    }
}

fn handle_chat(state: &AppState, app_handle: &AppHandle, data: &serde_json::Value, cfg: &crate::state::AppConfig) {
    let username = data.get("uniqueId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let message = data.get("comment").and_then(|v| v.as_str()).unwrap_or("").to_string();

    if username.is_empty() || message.is_empty() {
        return;
    }

    let msg_len = message.len() as u32;
    if msg_len < cfg.tiktok_chat_min_length || msg_len > cfg.tiktok_chat_max_length {
        return;
    }

    let Ok(db) = state.db.lock() else {
        return;
    };

    let payload_opt = match find_active_user_by_tiktok(&db, &username) {
        Ok(Some(user)) => {
            let _ = log_message(&db, "tiktok", &username, &message, Some(user.id));
            user.persona.as_ref().map(|persona| ChatMessagePayload {
                platform: "tiktok".to_string(),
                username: username.clone(),
                message: message.clone(),
                user_id: user.id,
                display_name: user.display_name.clone(),
                mouth_open_path: persona.mouth_open_path.clone(),
                mouth_closed_path: persona.mouth_closed_path.clone(),
                voice_id: user.voice_id.clone(),
            })
        }
        Ok(None) => {
            let _ = log_message(&db, "tiktok", &username, &message, None);
            None
        }
        Err(_) => None,
    };

    drop(db);

    if let Some(payload) = payload_opt {
        let _ = app_handle.emit("chat-message", &payload);
        state.broadcast_ws("chat-message", &payload);

        if cfg.tts_enabled {
            let app_clone = app_handle.clone();
            let ws_tx = state.ws_tx.clone();
            let tts_text = payload.message.clone();
            let tts_voice = payload.voice_id.clone();
            let tts_uid = payload.user_id;
            tauri::async_runtime::spawn(async move {
                let _ = crate::tts::speak_with_events(tts_text, tts_voice, tts_uid, app_clone, ws_tx).await;
            });
        }
    }
}

fn handle_gift(state: &AppState, app_handle: &AppHandle, data: &serde_json::Value, cfg: &crate::state::AppConfig) {
    let username = data.get("uniqueId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let repeat_end = data.get("repeatEnd").and_then(|v| v.as_bool()).unwrap_or(true);
    let gift_amount = data.get("diamondCount").and_then(|v| v.as_i64()).unwrap_or(0);

    if username.is_empty() || !repeat_end {
        return;
    }

    let Ok(db) = state.db.lock() else { return; };
    let user_id = find_active_user_by_tiktok(&db, &username).ok().flatten().map(|u| u.id);
    drop(db);

    let event_kind = if gift_amount >= cfg.tiktok_event_gift_big_coins as i64 {
        "tiktok_gift_big".to_string()
    } else {
        "tiktok_gift".to_string()
    };

    let payload = ChatEventPayload {
        platform: "tiktok".to_string(),
        event_kind,
        username,
        user_id,
        display_name: String::new(),
        amount: Some(gift_amount),
        text: None,
        extra: serde_json::json!({}),
    };

    let _ = app_handle.emit("chat-event", &payload);
    state.broadcast_ws("chat-event", &payload);
}

fn handle_like(state: &AppState, app_handle: &AppHandle, data: &serde_json::Value, _cfg: &crate::state::AppConfig) {
    let username = data.get("uniqueId").and_then(|v| v.as_str()).unwrap_or("").to_string();

    if username.is_empty() {
        return;
    }

    let Ok(db) = state.db.lock() else { return; };
    let user_id = find_active_user_by_tiktok(&db, &username).ok().flatten().map(|u| u.id);
    drop(db);

    let payload = ChatEventPayload {
        platform: "tiktok".to_string(),
        event_kind: "tiktok_like".to_string(),
        username,
        user_id,
        display_name: String::new(),
        amount: None,
        text: None,
        extra: serde_json::json!({}),
    };

    let _ = app_handle.emit("chat-event", &payload);
    state.broadcast_ws("chat-event", &payload);
}

fn handle_social(state: &AppState, app_handle: &AppHandle, data: &serde_json::Value, cfg: &crate::state::AppConfig) {
    let username = data.get("uniqueId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let display_type = data.get("displayType").and_then(|v| v.as_str()).unwrap_or("");

    if username.is_empty() {
        return;
    }

    let event_kind = match display_type {
        "pm_main_follow_message" if cfg.tiktok_event_follow_enabled => "tiktok_follow".to_string(),
        "pm_main_share_message" if cfg.tiktok_event_share_enabled => "tiktok_share".to_string(),
        _ => return,
    };

    let Ok(db) = state.db.lock() else { return; };
    let user_id = find_active_user_by_tiktok(&db, &username).ok().flatten().map(|u| u.id);
    drop(db);

    let payload = ChatEventPayload {
        platform: "tiktok".to_string(),
        event_kind,
        username,
        user_id,
        display_name: String::new(),
        amount: None,
        text: None,
        extra: serde_json::json!({}),
    };

    let _ = app_handle.emit("chat-event", &payload);
    state.broadcast_ws("chat-event", &payload);
}

fn handle_subscribe(state: &AppState, app_handle: &AppHandle, data: &serde_json::Value, _cfg: &crate::state::AppConfig) {
    let username = data.get("uniqueId").and_then(|v| v.as_str()).unwrap_or("").to_string();

    if username.is_empty() {
        return;
    }

    let Ok(db) = state.db.lock() else { return; };
    let user_id = find_active_user_by_tiktok(&db, &username).ok().flatten().map(|u| u.id);
    drop(db);

    let payload = ChatEventPayload {
        platform: "tiktok".to_string(),
        event_kind: "tiktok_subscribe".to_string(),
        username,
        user_id,
        display_name: String::new(),
        amount: None,
        text: None,
        extra: serde_json::json!({}),
    };

    let _ = app_handle.emit("chat-event", &payload);
    state.broadcast_ws("chat-event", &payload);
}

fn handle_envelope(state: &AppState, app_handle: &AppHandle, data: &serde_json::Value, _cfg: &crate::state::AppConfig) {
    let username = data.get("uniqueId").and_then(|v| v.as_str()).unwrap_or("").to_string();

    if username.is_empty() {
        return;
    }

    let Ok(db) = state.db.lock() else { return; };
    let user_id = find_active_user_by_tiktok(&db, &username).ok().flatten().map(|u| u.id);
    drop(db);

    let payload = ChatEventPayload {
        platform: "tiktok".to_string(),
        event_kind: "tiktok_envelope".to_string(),
        username,
        user_id,
        display_name: String::new(),
        amount: None,
        text: None,
        extra: serde_json::json!({}),
    };

    let _ = app_handle.emit("chat-event", &payload);
    state.broadcast_ws("chat-event", &payload);
}
