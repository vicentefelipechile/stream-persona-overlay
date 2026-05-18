use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::{
    db::{config::log_message, users::find_active_user_by_tiktok},
    state::{AppState, ChatMessagePayload},
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

/// Processes a single TikTok chat event synchronously (no .await inside).
/// All DB work and emit are done here. Called from the async loop after each message.
fn handle_tiktok_event(
    state: &AppState,
    app_handle: &AppHandle,
    json: &serde_json::Value,
) {
    let event_type = json.get("event").and_then(|v| v.as_str()).unwrap_or("");
    if event_type != "chat" {
        return;
    }

    let data = match json.get("data") {
        Some(d) => d,
        None => return,
    };

    let username = data
        .get("uniqueId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let message = data
        .get("comment")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if username.is_empty() || message.is_empty() {
        return;
    }

    tracing::debug!("[tiktok] {}: {}", username, message);

    let Ok(db) = state.db.lock() else {
        tracing::error!("[tiktok] DB mutex poisoned");
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
        Err(e) => {
            tracing::error!("Error DB TikTok: {}", e);
            None
        }
    };

    // Drop the MutexGuard before emitting (emit is sync but good practice)
    drop(db);

    if let Some(payload) = payload_opt {
        if let Err(e) = app_handle.emit("chat-message", &payload) {
            tracing::error!("Error emitiendo evento TikTok chat-message: {}", e);
        }

        // TTS con eventos de lip-sync (si está habilitado)
        let tts_enabled = state.config_cache.read()
            .map(|c| c.tts_enabled)
            .unwrap_or(false);
        if tts_enabled {
            let app_clone = app_handle.clone();
            let tts_text  = payload.message.clone();
            let tts_voice = payload.voice_id.clone();
            let tts_uid   = payload.user_id;
            tauri::async_runtime::spawn(async move {
                if let Err(e) = crate::tts::speak_with_events(
                    tts_text, tts_voice, tts_uid, app_clone,
                ).await {
                    tracing::warn!("[tts/tiktok] Error en TTS: {}", e);
                }
            });
        }
    }
}
