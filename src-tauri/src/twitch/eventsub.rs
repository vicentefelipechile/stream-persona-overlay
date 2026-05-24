use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::{
    chat_filters::FilterDecision,
    state::{AppConfig, AppState, ChatEventPayload},
};

pub async fn spawn_twitch_eventsub(state: AppState, app_handle: AppHandle) {
    let cfg = {
        let Ok(db) = state.db.lock() else {
            tracing::error!("[twitch-eventsub] DB mutex poisoned");
            return;
        };
        crate::db::config::get_config(&db).unwrap_or_default()
    };

    if !cfg.twitch_eventsub_enabled {
        tracing::info!("[twitch-eventsub] EventSub deshabilitado — cliente no iniciado");
        return;
    }

    if cfg.twitch_bot_token.is_empty()
        || cfg.twitch_client_id.is_empty()
        || cfg.twitch_bot_user_id.is_empty()
    {
        tracing::warn!("[twitch-eventsub] Token, client_id o user_id no configurados — validá el token OAuth primero");
        return;
    }

    let ws_url = "wss://eventsub.wss.twitch.tv/ws";
    tracing::info!("[twitch-eventsub] Conectando a {}", ws_url);

    let (ws_stream, _) = match connect_async(ws_url).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("[twitch-eventsub] Error conectando: {}", e);
            return;
        }
    };

    let (_, mut read) = ws_stream.split();

    while let Some(msg_result) = read.next().await {
        match msg_result {
            Ok(Message::Text(text)) => {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    let msg_type = json
                        .get("metadata")
                        .and_then(|m| m.get("message_type"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");

                    match msg_type {
                        "session_welcome" => {
                            if let Some(session_id) = json
                                .get("payload")
                                .and_then(|p| p.get("session"))
                                .and_then(|s| s.get("id"))
                                .and_then(|v| v.as_str())
                            {
                                tracing::info!("[twitch-eventsub] Sesión iniciada: {}", session_id);
                                register_subscriptions(&cfg, session_id).await;
                            }
                        }
                        "notification" => {
                            let sub_type = json
                                .get("payload")
                                .and_then(|p| p.get("subscription"))
                                .and_then(|s| s.get("type"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let event = json.get("payload").and_then(|p| p.get("event"));
                            if let Some(evt) = event {
                                handle_twitch_event(&state, &app_handle, sub_type, evt);
                            }
                        }
                        _ => {}
                    }
                }
            }
            Ok(Message::Close(_)) => {
                tracing::info!("[twitch-eventsub] WS cerrado");
                break;
            }
            Err(e) => {
                tracing::error!("[twitch-eventsub] Error WS: {}", e);
                break;
            }
            _ => {}
        }
    }
}

async fn register_subscriptions(cfg: &AppConfig, session_id: &str) {
    // Raw bearer token (without "oauth:" prefix)
    let raw_token = cfg
        .twitch_bot_token
        .trim_start_matches("oauth:")
        .to_string();
    let broadcaster_id = &cfg.twitch_bot_user_id;
    let client_id = &cfg.twitch_client_id;

    // Subscriptions: (type, version, condition_extra_key)
    // channel.follow v2 requires moderator_user_id in addition to broadcaster_user_id
    let subs: &[(&str, &str, Option<(&str, &str)>)] = &[
        ("channel.cheer", "1", None),
        ("channel.subscribe", "1", None),
        (
            "channel.raid",
            "1",
            Some(("to_broadcaster_user_id", broadcaster_id)),
        ),
        (
            "channel.follow",
            "2",
            Some(("moderator_user_id", broadcaster_id)),
        ),
    ];

    let http = reqwest::Client::new();

    for (sub_type, version, extra) in subs {
        let mut condition = serde_json::json!({ "broadcaster_user_id": broadcaster_id });
        if let Some((key, val)) = extra {
            condition[*key] = serde_json::Value::String(val.to_string());
        }
        // channel.raid uses "to_broadcaster_user_id" as the main key, not "broadcaster_user_id"
        if *sub_type == "channel.raid" {
            condition = serde_json::json!({ "to_broadcaster_user_id": broadcaster_id });
        }

        let body = serde_json::json!({
            "type": sub_type,
            "version": version,
            "condition": condition,
            "transport": {
                "method": "websocket",
                "session_id": session_id
            }
        });

        match http
            .post("https://api.twitch.tv/helix/eventsub/subscriptions")
            .header("Authorization", format!("Bearer {}", raw_token))
            .header("Client-Id", client_id.as_str())
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
        {
            Ok(resp) if resp.status().as_u16() == 202 => {
                tracing::info!("[twitch-eventsub] Suscripción registrada: {}", sub_type);
            }
            Ok(resp) => {
                let status = resp.status().as_u16();
                let body = resp.text().await.unwrap_or_default();
                tracing::warn!(
                    "[twitch-eventsub] Error registrando {}: HTTP {} — {}",
                    sub_type,
                    status,
                    body
                );
            }
            Err(e) => {
                tracing::error!(
                    "[twitch-eventsub] Red error registrando {}: {}",
                    sub_type,
                    e
                );
            }
        }
    }
}

fn handle_twitch_event(
    state: &AppState,
    app_handle: &AppHandle,
    event_type: &str,
    event: &serde_json::Value,
) {
    let Ok(cfg) = state.config_cache.read() else {
        return;
    };

    match event_type {
        "channel.cheer" if cfg.twitch_event_cheer_enabled => {
            let username = event
                .get("user_login")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let bits = event.get("bits").and_then(|v| v.as_i64()).unwrap_or(0);

            if bits < cfg.twitch_event_cheer_min_bits as i64 {
                return;
            }

            {
                let Ok(mut filters) = state.chat_filters.lock() else {
                    return;
                };
                if let FilterDecision::Drop(_) =
                    filters.check_event("twitch", username, "cheer", &cfg)
                {
                    return;
                }
            }

            let Ok(db) = state.db.lock() else {
                return;
            };
            let user_id = crate::db::users::find_active_user_by_twitch(&db, username)
                .ok()
                .flatten()
                .map(|u| u.id);
            drop(db);

            let payload = ChatEventPayload {
                platform: "twitch".to_string(),
                event_kind: "cheer".to_string(),
                username: username.to_string(),
                user_id,
                display_name: event
                    .get("user_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                amount: Some(bits),
                text: event
                    .get("message")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                extra: serde_json::json!({}),
            };

            let _ = app_handle.emit("chat-event", &payload);
            state.broadcast_ws("chat-event", &payload);
        }
        "channel.subscribe" if cfg.twitch_event_sub_enabled => {
            let username = event
                .get("user_login")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            {
                let Ok(mut filters) = state.chat_filters.lock() else {
                    return;
                };
                if let FilterDecision::Drop(_) =
                    filters.check_event("twitch", username, "sub", &cfg)
                {
                    return;
                }
            }

            let Ok(db) = state.db.lock() else {
                return;
            };
            let user_id = crate::db::users::find_active_user_by_twitch(&db, username)
                .ok()
                .flatten()
                .map(|u| u.id);
            drop(db);

            let payload = ChatEventPayload {
                platform: "twitch".to_string(),
                event_kind: "sub".to_string(),
                username: username.to_string(),
                user_id,
                display_name: event
                    .get("user_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                amount: None,
                text: None,
                extra: serde_json::json!({}),
            };

            let _ = app_handle.emit("chat-event", &payload);
            state.broadcast_ws("chat-event", &payload);
        }
        "channel.raid" if cfg.twitch_event_raid_enabled => {
            let username = event
                .get("from_broadcaster_user_login")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let viewers = event.get("viewers").and_then(|v| v.as_i64()).unwrap_or(0);

            // Raids use a global (channel-scope) cooldown — key uses empty string for user
            {
                let Ok(mut filters) = state.chat_filters.lock() else {
                    return;
                };
                if let FilterDecision::Drop(_) = filters.check_event("twitch", "", "raid", &cfg) {
                    return;
                }
            }

            let Ok(db) = state.db.lock() else {
                return;
            };
            let user_id = crate::db::users::find_active_user_by_twitch(&db, username)
                .ok()
                .flatten()
                .map(|u| u.id);
            drop(db);

            let payload = ChatEventPayload {
                platform: "twitch".to_string(),
                event_kind: "raid".to_string(),
                username: username.to_string(),
                user_id,
                display_name: event
                    .get("from_broadcaster_user_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                amount: Some(viewers),
                text: None,
                extra: serde_json::json!({}),
            };

            let _ = app_handle.emit("chat-event", &payload);
            state.broadcast_ws("chat-event", &payload);
        }
        "channel.follow" if cfg.twitch_event_follow_enabled => {
            let username = event
                .get("user_login")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            {
                let Ok(mut filters) = state.chat_filters.lock() else {
                    return;
                };
                if let FilterDecision::Drop(_) =
                    filters.check_event("twitch", username, "follow", &cfg)
                {
                    return;
                }
            }

            let Ok(db) = state.db.lock() else {
                return;
            };
            let user_id = crate::db::users::find_active_user_by_twitch(&db, username)
                .ok()
                .flatten()
                .map(|u| u.id);
            drop(db);

            let payload = ChatEventPayload {
                platform: "twitch".to_string(),
                event_kind: "follow".to_string(),
                username: username.to_string(),
                user_id,
                display_name: event
                    .get("user_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                amount: None,
                text: None,
                extra: serde_json::json!({}),
            };

            let _ = app_handle.emit("chat-event", &payload);
            state.broadcast_ws("chat-event", &payload);
        }
        _ => {}
    }
}
