use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::{
    chat_filters::FilterDecision,
    db::{
        config::{log_message, log_message_dropped},
        users::find_active_user_by_tiktok,
    },
    state::{
        guest_resource_dir, guest_user_id, AppState, ChatEventPayload, ChatMessagePayload,
        TiktokAlertPayload,
    },
};

/// Conecta a TikTool WebSocket API y escucha eventos de chat de TikTok LIVE.
/// Si el username está vacío, no hace nada.
pub async fn spawn_tiktok_client(state: AppState, app_handle: AppHandle) {
    let (tiktok_username, api_key, ws_endpoint) = {
        let Ok(db) = state.db.lock() else {
            tracing::error!("[tiktok] DB mutex poisoned — abortando cliente");
            return;
        };
        let cfg = crate::db::config::get_config(&db).unwrap_or_default();
        (
            cfg.tiktok_username,
            cfg.tiktok_api_key,
            cfg.tiktok_ws_endpoint,
        )
    };

    // Strip a leading "@" — the TikTool API expects a bare uniqueId
    let tiktok_username = tiktok_username.trim().trim_start_matches('@');

    if tiktok_username.is_empty() {
        tracing::warn!("Username de TikTok no configurado — cliente no iniciado");
        return;
    }

    if api_key.is_empty() {
        tracing::error!("API key de TikTok no configurada — cliente no iniciado (obtén una en https://tik.tools)");
        let _ = app_handle.emit(
            "tiktok-error",
            "API key no configurada (obtén una gratis en tik.tools)",
        );
        return;
    }

    let endpoint = if ws_endpoint.trim().is_empty() {
        "wss://api.tik.tools"
    } else {
        ws_endpoint.trim()
    };
    // Strip any trailing slash so exactly one is appended below.
    let endpoint = endpoint.trim_end_matches('/');

    // TikTool managed WebSocket: {endpoint}/?uniqueId={username}&apiKey={key}
    // The "/" before the query is REQUIRED — without a path the handshake
    // request line is "GET ?uniqueId=... HTTP/1.1", which Cloudflare (fronting
    // api.tik.tools) rejects with a generic 400 Bad Request.
    let url = format!(
        "{}/?uniqueId={}&apiKey={}",
        endpoint, tiktok_username, api_key
    );

    // Log without leaking the API key
    tracing::info!(
        "Conectando a TikTok LIVE WS: {}/?uniqueId={}&apiKey=***",
        endpoint,
        tiktok_username
    );

    let ws_stream = match connect_async(&url).await {
        Ok((stream, _)) => stream,
        Err(e) => {
            // On a failed handshake tungstenite hands back the HTTP response —
            // its body carries TikTool's real reason (bad key, user offline, …).
            let detail = if let tokio_tungstenite::tungstenite::Error::Http(resp) = &e {
                let status = resp.status();
                let body = resp
                    .body()
                    .as_ref()
                    .map(|b| String::from_utf8_lossy(b).into_owned())
                    .unwrap_or_default();
                tracing::error!("No se pudo conectar a TikTok WS: {} — {}", status, body);
                status.to_string()
            } else {
                tracing::error!("No se pudo conectar a TikTok WS: {}", e);
                e.to_string()
            };
            let _ = app_handle.emit("tiktok-error", format!("No se pudo conectar: {}", detail));
            return;
        }
    };

    // Handshake succeeded — now the connection is genuinely established.
    tracing::info!("Conectado a TikTok LIVE: @{}", tiktok_username);
    let _ = app_handle.emit("tiktok-connected", tiktok_username);

    let (_, mut read) = ws_stream.split();

    while let Some(msg_result) = read.next().await {
        match msg_result {
            Ok(Message::Text(text)) => {
                // Diagnostic: log every raw frame so the exact event structure
                // is visible in the terminal. Lower to debug! once verified.
                tracing::info!("[tiktok/raw] {}", text);
                match serde_json::from_str::<serde_json::Value>(&text) {
                    Ok(json) => handle_tiktok_event(&state, &app_handle, &json),
                    Err(e) => tracing::warn!("[tiktok] frame no es JSON válido: {} — {}", e, text),
                }
            }
            Ok(Message::Binary(bin)) => {
                tracing::warn!("[tiktok] frame binario inesperado ({} bytes)", bin.len());
            }
            Ok(Message::Close(frame)) => {
                tracing::info!("TikTok WS cerrado: {:?}", frame);
                // Surface the close reason to the UI — e.g. code 4404
                // "Creator is not currently live" — so the badge stops
                // showing a stale "Conectado".
                let reason = frame
                    .as_ref()
                    .map(|f| f.reason.to_string())
                    .filter(|r| !r.is_empty());
                let msg = match reason.as_deref() {
                    Some(r) if r.contains("not currently live") => {
                        "el creador no está en directo".to_string()
                    }
                    Some(r) => r.to_string(),
                    None => "conexión cerrada".to_string(),
                };
                let _ = app_handle.emit("tiktok-error", format!("Desconectado: {}", msg));
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

/// Extracts a TikTok uniqueId from event `data`, supporting both the nested
/// (`data.user.uniqueId`) and flat (`data.uniqueId`) shapes TikTool may send.
fn extract_unique_id(data: &serde_json::Value) -> String {
    data.get("user")
        .and_then(|u| u.get("uniqueId"))
        .and_then(|v| v.as_str())
        .or_else(|| data.get("uniqueId").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string()
}

/// Extracts the chatter's TikTok profile picture URL from event `data`.
/// Prefers `profilePictureUrl`, falling back to `avatarUrl`. Returns "" if absent.
fn extract_avatar_url(data: &serde_json::Value) -> String {
    data.get("user")
        .and_then(|u| {
            u.get("profilePictureUrl")
                .or_else(|| u.get("avatarUrl"))
                .and_then(|v| v.as_str())
        })
        .unwrap_or("")
        .to_string()
}

/// Returns a human-friendly label for the `{user}` alert token: the nickname
/// (`data.user.nickname`) when present and non-empty, otherwise the uniqueId.
fn extract_user_label(data: &serde_json::Value, unique_id: &str) -> String {
    data.get("user")
        .and_then(|u| u.get("nickname"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| unique_id.to_string())
}

/// Builds a fully-formatted alert payload from the per-event config, regardless
/// of the `enabled` flag. Returns `None` only when the JSON is invalid or has no
/// entry for `event_kind`. `user_label` fills `{user}`; `amount` fills `{amount}`.
fn resolve_alert(
    alerts_config: &str,
    event_kind: &str,
    user_label: &str,
    amount: Option<i64>,
) -> Option<TiktokAlertPayload> {
    let alerts = serde_json::from_str::<serde_json::Value>(alerts_config).ok()?;
    let entry = alerts.get(event_kind)?;

    let amount_str = amount.map(|a| a.to_string()).unwrap_or_default();
    let text = entry
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .replace("{user}", user_label)
        .replace("{amount}", &amount_str);

    Some(TiktokAlertPayload {
        event_kind: event_kind.to_string(),
        image_path: entry
            .get("image")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        sound_path: entry
            .get("sound")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        text,
        duration_ms: entry
            .get("duration_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(4000) as u32,
        transition: entry
            .get("transition")
            .and_then(|v| v.as_str())
            .unwrap_or("fade")
            .to_string(),
    })
}

/// Emits a fully-resolved `tiktok-alert` (Tauri + WS broadcast).
fn emit_alert(state: &AppState, app_handle: &AppHandle, payload: &TiktokAlertPayload) {
    let _ = app_handle.emit("tiktok-alert", payload);
    state.broadcast_ws("tiktok-alert", payload);
}

/// Resolves the configured alert for `event_kind` and, if its `enabled` flag is
/// set, emits it so the dedicated alert overlay can render it.
fn maybe_emit_alert(
    state: &AppState,
    app_handle: &AppHandle,
    cfg: &crate::state::AppConfig,
    event_kind: &str,
    user_label: &str,
    amount: Option<i64>,
) {
    let enabled = serde_json::from_str::<serde_json::Value>(&cfg.tiktok_alerts_config)
        .ok()
        .and_then(|v| {
            v.get(event_kind)
                .and_then(|e| e.get("enabled"))
                .and_then(|b| b.as_bool())
        })
        .unwrap_or(false);
    if !enabled {
        return;
    }

    if let Some(payload) = resolve_alert(&cfg.tiktok_alerts_config, event_kind, user_label, amount)
    {
        emit_alert(state, app_handle, &payload);
    }
}

/// Forces an alert for `event_kind` using sample data, ignoring the `enabled`
/// flag — used by the `tiktok_test_alert` command so the streamer can preview
/// the alert on the overlay. Returns false if no alert is configured for the kind.
pub fn emit_test_alert(state: &AppState, app_handle: &AppHandle, event_kind: &str) -> bool {
    let alerts_config = {
        let Ok(cfg) = state.config_cache.read() else {
            return false;
        };
        cfg.tiktok_alerts_config.clone()
    };
    let amount = if event_kind.contains("gift") {
        Some(100)
    } else {
        None
    };
    match resolve_alert(&alerts_config, event_kind, "TestUser", amount) {
        Some(payload) => {
            emit_alert(state, app_handle, &payload);
            true
        }
        None => false,
    }
}

/// Processes a single TikTok event synchronously (no .await inside).
fn handle_tiktok_event(state: &AppState, app_handle: &AppHandle, json: &serde_json::Value) {
    let event_type = json.get("event").and_then(|v| v.as_str()).unwrap_or("");
    let data = match json.get("data") {
        Some(d) => d,
        None => {
            tracing::info!(
                "[tiktok] evento '{}' sin campo 'data' — ignorado",
                event_type
            );
            return;
        }
    };

    tracing::info!("[tiktok] evento recibido: '{}'", event_type);

    let Ok(cfg) = state.config_cache.read() else {
        return;
    };

    match event_type {
        "chat" => handle_chat(state, app_handle, data, &cfg),
        "gift" if cfg.tiktok_event_gift_enabled => handle_gift(state, app_handle, data, &cfg),
        "like" if cfg.tiktok_event_like_enabled => handle_like(state, app_handle, data, &cfg),
        "social" if cfg.tiktok_event_follow_enabled || cfg.tiktok_event_share_enabled => {
            handle_social(state, app_handle, data, &cfg)
        }
        "subscribe" if cfg.tiktok_event_subscribe_enabled => {
            handle_subscribe(state, app_handle, data, &cfg)
        }
        "envelope" if cfg.tiktok_event_envelope_enabled => {
            handle_envelope(state, app_handle, data, &cfg)
        }
        "member" if cfg.tiktok_event_member_enabled => handle_member(state, app_handle, data, &cfg),
        _ => {}
    }
}

fn handle_chat(
    state: &AppState,
    app_handle: &AppHandle,
    data: &serde_json::Value,
    cfg: &crate::state::AppConfig,
) {
    let username = extract_unique_id(data);
    let message = data
        .get("comment")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if username.is_empty() || message.is_empty() {
        tracing::warn!(
            "[tiktok/chat] descartado: username='{}', mensaje='{}' (¿estructura JSON inesperada?)",
            username,
            message
        );
        return;
    }

    let msg_len = message.chars().count() as u32;
    if msg_len < cfg.tiktok_chat_min_length || msg_len > cfg.tiktok_chat_max_length {
        tracing::debug!(
            "[tiktok/chat] @{} fuera de rango de longitud ({} caracteres)",
            username,
            msg_len
        );
        return;
    }

    tracing::info!("[tiktok/chat] @{}: {}", username, message);

    // Anti-spam filter — cfg is already read (caller holds config_cache read lock)
    let filter_decision = {
        let Ok(mut filters) = state.chat_filters.lock() else {
            return;
        };
        filters.check_chat("tiktok", &username, &message, cfg)
    };

    if let FilterDecision::Drop(reason) = filter_decision {
        tracing::debug!(
            "[tiktok/filter] @{} bloqueado: {}",
            username,
            reason.as_str()
        );
        let Ok(db) = state.db.lock() else {
            return;
        };
        let _ = log_message_dropped(&db, "tiktok", &username, &message, reason.as_str());
        return;
    }

    let Ok(db) = state.db.lock() else {
        return;
    };

    let (payload_opt, is_unregistered) = match find_active_user_by_tiktok(&db, &username) {
        Ok(Some(user)) => {
            let _ = log_message(&db, "tiktok", &username, &message, Some(user.id));
            let payload = user.persona.as_ref().map(|persona| ChatMessagePayload {
                platform: "tiktok".to_string(),
                username: username.clone(),
                message: message.clone(),
                user_id: user.id,
                display_name: user.display_name.clone(),
                mouth_open_path: persona.mouth_open_path.clone(),
                mouth_closed_path: persona.mouth_closed_path.clone(),
                voice_id: user.voice_id.clone(),
            });
            (payload, false)
        }
        Ok(None) => {
            let _ = log_message(&db, "tiktok", &username, &message, None);
            (None, true)
        }
        Err(_) => (None, false),
    };

    drop(db);

    // Guest viewer fallback — emit a pet for unregistered users if guests are enabled
    let guest_payload_opt: Option<ChatMessagePayload> = if payload_opt.is_none()
        && is_unregistered
        && cfg.tama_guests_enabled
        && cfg.tama_guests_tiktok
        && cfg.tama_enabled
    {
        // Priority: TikTok profile picture (if enabled and present) > custom guest
        // sprite > bundled default. The avatar URL is used verbatim as both mouth
        // frames; the overlay passes http(s) URLs straight through to the <img>.
        let avatar_url = extract_avatar_url(data);
        let (mouth_open, mouth_closed) = if cfg.tama_guest_tiktok_avatar
            && !avatar_url.is_empty()
        {
            (avatar_url.clone(), avatar_url)
        } else if !cfg.tama_guest_mouth_open_path.is_empty()
            && !cfg.tama_guest_mouth_closed_path.is_empty()
        {
            (
                cfg.tama_guest_mouth_open_path.clone(),
                cfg.tama_guest_mouth_closed_path.clone(),
            )
        } else {
            let res_dir = guest_resource_dir(app_handle);
            (
                res_dir.join("guest_open.png").to_string_lossy().to_string(),
                res_dir
                    .join("guest_closed.png")
                    .to_string_lossy()
                    .to_string(),
            )
        };
        tracing::info!("[tiktok/guest] Spawning guest pet for @{}", username);
        Some(ChatMessagePayload {
            platform: "tiktok".to_string(),
            username: username.clone(),
            message: message.clone(),
            user_id: guest_user_id("tiktok", &username),
            display_name: format!("{}{}", cfg.tama_guests_label_prefix, username),
            mouth_open_path: mouth_open,
            mouth_closed_path: mouth_closed,
            voice_id: if cfg.tama_guests_tts {
                "default".to_string()
            } else {
                String::new()
            },
        })
    } else {
        None
    };

    let effective_payload = payload_opt.or(guest_payload_opt);
    let is_guest = effective_payload
        .as_ref()
        .map(|p| p.user_id < 0)
        .unwrap_or(false);

    if let Some(payload) = effective_payload {
        let _ = app_handle.emit("chat-message", &payload);
        state.broadcast_ws("chat-message", &payload);

        let should_tts =
            cfg.tts_enabled && (!is_guest || cfg.tama_guests_tts) && !payload.voice_id.is_empty();
        if should_tts {
            let app_clone = app_handle.clone();
            let ws_tx = state.ws_tx.clone();
            let tts_text = payload.message.clone();
            let tts_voice = payload.voice_id.clone();
            let tts_uid = payload.user_id;
            tauri::async_runtime::spawn(async move {
                let _ =
                    crate::tts::speak_with_events(tts_text, tts_voice, tts_uid, app_clone, ws_tx)
                        .await;
            });
        }
    }
}

fn handle_gift(
    state: &AppState,
    app_handle: &AppHandle,
    data: &serde_json::Value,
    cfg: &crate::state::AppConfig,
) {
    let username = extract_unique_id(data);
    let repeat_end = data
        .get("repeatEnd")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let gift_amount = data
        .get("diamondCount")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    if username.is_empty() || !repeat_end {
        return;
    }

    let event_kind = if gift_amount >= cfg.tiktok_event_gift_big_coins as i64 {
        "tiktok_gift_big"
    } else {
        "tiktok_gift"
    };

    // Event cooldown filter
    {
        let Ok(mut filters) = state.chat_filters.lock() else {
            return;
        };
        if let FilterDecision::Drop(_) = filters.check_event("tiktok", &username, event_kind, cfg) {
            return;
        }
    }

    let Ok(db) = state.db.lock() else {
        return;
    };
    let user_id = find_active_user_by_tiktok(&db, &username)
        .ok()
        .flatten()
        .map(|u| u.id);
    drop(db);

    let user_label = extract_user_label(data, &username);
    let payload = ChatEventPayload {
        platform: "tiktok".to_string(),
        event_kind: event_kind.to_string(),
        username,
        user_id,
        display_name: String::new(),
        amount: Some(gift_amount),
        text: None,
        extra: serde_json::json!({}),
    };

    let _ = app_handle.emit("chat-event", &payload);
    state.broadcast_ws("chat-event", &payload);

    maybe_emit_alert(
        state,
        app_handle,
        cfg,
        event_kind,
        &user_label,
        Some(gift_amount),
    );
}

fn handle_like(
    state: &AppState,
    app_handle: &AppHandle,
    data: &serde_json::Value,
    cfg: &crate::state::AppConfig,
) {
    let username = extract_unique_id(data);

    if username.is_empty() {
        return;
    }

    // Event cooldown filter (replaces the old tiktok_event_like_throttle_ms inline logic)
    {
        let Ok(mut filters) = state.chat_filters.lock() else {
            return;
        };
        if let FilterDecision::Drop(_) =
            filters.check_event("tiktok", &username, "tiktok_like", cfg)
        {
            return;
        }
    }

    let Ok(db) = state.db.lock() else {
        return;
    };
    let user_id = find_active_user_by_tiktok(&db, &username)
        .ok()
        .flatten()
        .map(|u| u.id);
    drop(db);

    let user_label = extract_user_label(data, &username);
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

    maybe_emit_alert(state, app_handle, cfg, "tiktok_like", &user_label, None);
}

fn handle_social(
    state: &AppState,
    app_handle: &AppHandle,
    data: &serde_json::Value,
    cfg: &crate::state::AppConfig,
) {
    let username = extract_unique_id(data);
    let display_type = data
        .get("displayType")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if username.is_empty() {
        return;
    }

    let event_kind = match display_type {
        "pm_main_follow_message" if cfg.tiktok_event_follow_enabled => "tiktok_follow",
        "pm_main_share_message" if cfg.tiktok_event_share_enabled => "tiktok_share",
        _ => return,
    };

    // Event cooldown filter
    {
        let Ok(mut filters) = state.chat_filters.lock() else {
            return;
        };
        if let FilterDecision::Drop(_) = filters.check_event("tiktok", &username, event_kind, cfg) {
            return;
        }
    }

    let Ok(db) = state.db.lock() else {
        return;
    };
    let user_id = find_active_user_by_tiktok(&db, &username)
        .ok()
        .flatten()
        .map(|u| u.id);
    drop(db);

    let user_label = extract_user_label(data, &username);
    let payload = ChatEventPayload {
        platform: "tiktok".to_string(),
        event_kind: event_kind.to_string(),
        username,
        user_id,
        display_name: String::new(),
        amount: None,
        text: None,
        extra: serde_json::json!({}),
    };

    let _ = app_handle.emit("chat-event", &payload);
    state.broadcast_ws("chat-event", &payload);

    maybe_emit_alert(state, app_handle, cfg, event_kind, &user_label, None);
}

fn handle_subscribe(
    state: &AppState,
    app_handle: &AppHandle,
    data: &serde_json::Value,
    cfg: &crate::state::AppConfig,
) {
    let username = extract_unique_id(data);

    if username.is_empty() {
        return;
    }

    {
        let Ok(mut filters) = state.chat_filters.lock() else {
            return;
        };
        if let FilterDecision::Drop(_) =
            filters.check_event("tiktok", &username, "tiktok_subscribe", cfg)
        {
            return;
        }
    }

    let Ok(db) = state.db.lock() else {
        return;
    };
    let user_id = find_active_user_by_tiktok(&db, &username)
        .ok()
        .flatten()
        .map(|u| u.id);
    drop(db);

    let user_label = extract_user_label(data, &username);
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

    maybe_emit_alert(
        state,
        app_handle,
        cfg,
        "tiktok_subscribe",
        &user_label,
        None,
    );
}

fn handle_envelope(
    state: &AppState,
    app_handle: &AppHandle,
    data: &serde_json::Value,
    cfg: &crate::state::AppConfig,
) {
    let username = extract_unique_id(data);

    if username.is_empty() {
        return;
    }

    {
        let Ok(mut filters) = state.chat_filters.lock() else {
            return;
        };
        if let FilterDecision::Drop(_) =
            filters.check_event("tiktok", &username, "tiktok_envelope", cfg)
        {
            return;
        }
    }

    let Ok(db) = state.db.lock() else {
        return;
    };
    let user_id = find_active_user_by_tiktok(&db, &username)
        .ok()
        .flatten()
        .map(|u| u.id);
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

/// Handles a `member` event (a viewer joining the room). Gated by
/// `tiktok_event_member_enabled` (default off — these fire very frequently).
/// Emits `chat-event` with `event_kind = "tiktok_member"` and a matching alert.
fn handle_member(
    state: &AppState,
    app_handle: &AppHandle,
    data: &serde_json::Value,
    cfg: &crate::state::AppConfig,
) {
    let username = extract_unique_id(data);

    if username.is_empty() {
        return;
    }

    {
        let Ok(mut filters) = state.chat_filters.lock() else {
            return;
        };
        if let FilterDecision::Drop(_) =
            filters.check_event("tiktok", &username, "tiktok_member", cfg)
        {
            return;
        }
    }

    let Ok(db) = state.db.lock() else {
        return;
    };
    let user_id = find_active_user_by_tiktok(&db, &username)
        .ok()
        .flatten()
        .map(|u| u.id);
    drop(db);

    let user_label = extract_user_label(data, &username);
    let payload = ChatEventPayload {
        platform: "tiktok".to_string(),
        event_kind: "tiktok_member".to_string(),
        username,
        user_id,
        display_name: String::new(),
        amount: None,
        text: None,
        extra: serde_json::json!({}),
    };

    let _ = app_handle.emit("chat-event", &payload);
    state.broadcast_ws("chat-event", &payload);

    maybe_emit_alert(state, app_handle, cfg, "tiktok_member", &user_label, None);
}
