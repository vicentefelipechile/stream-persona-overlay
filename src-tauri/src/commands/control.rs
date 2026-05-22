use tauri::{AppHandle, Emitter, Manager, State};

use crate::state::AppState;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ─── Tauri Commands — Control de Bots ────────────────────────────────────────

/// Reinicia el bot de Discord (requiere que el token esté configurado).
#[tauri::command]
pub async fn restart_discord_bot(
    state: State<'_, AppState>,
    app: AppHandle,
) -> CmdResult<()> {
    let inner = state.inner().clone();
    // Abortar instancia anterior para no dejar conexiones huérfanas en Discord
    inner.abort_discord();
    let app_clone = app.clone();
    let handle = tauri::async_runtime::spawn(async move {
        crate::discord::spawn_discord_bot(inner, app_clone).await;
    });
    if let Ok(mut h) = state.discord_handle.lock() { *h = Some(handle); }
    tracing::info!("Bot de Discord reiniciando...");
    Ok(())
}

/// Conecta al canal de Twitch especificado.
#[tauri::command]
pub async fn connect_twitch(
    channel: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> CmdResult<()> {
    // Scope the Mutex guard before spawning / emitting
    {
        let db = state.db.lock().map_err(map_err)?;
        crate::db::config::set_config_value(&db, "twitch_channel", &channel)
            .map_err(map_err)?;
    }

    let inner = state.inner().clone();
    let app_clone = app.clone();
    // Abortar cliente anterior antes de reconectar
    inner.abort_twitch();
    let handle = tauri::async_runtime::spawn(async move {
        crate::twitch::spawn_twitch_client(inner, app_clone).await;
    });
    if let Ok(mut h) = state.twitch_handle.lock() { *h = Some(handle); }

    // twitch-connected se emite desde twitch/mod.rs al recibir RoomState
    tracing::info!("Iniciando cliente Twitch para canal: {}", channel);
    Ok(())
}

/// Valida un token OAuth de Twitch contra la API oficial y devuelve el username.
/// El token puede incluir o no el prefijo "oauth:" — se normaliza automáticamente.
/// Guarda `twitch_bot_token` (con prefijo) y `twitch_bot_username` en la DB.
#[tauri::command]
pub async fn validate_twitch_token(
    token: String,
    state: State<'_, AppState>,
) -> CmdResult<String> {
    // Normalizar: quitar prefijo si existe, luego volver a agregar
    let raw_token = token.trim().trim_start_matches("oauth:").to_string();
    if raw_token.is_empty() {
        return Err("El token no puede estar vacío".to_string());
    }
    let bearer = format!("OAuth {}", raw_token);

    #[derive(serde::Deserialize)]
    struct ValidateResponse {
        login: String,
    }

    let resp = reqwest::Client::new()
        .get("https://id.twitch.tv/oauth2/validate")
        .header("Authorization", &bearer)
        .send()
        .await
        .map_err(|e| format!("Error de red: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        return Err(format!("Token inválido (HTTP {}). Verificá que el token sea correcto y tenga el scope chat:read.", status));
    }

    let data: ValidateResponse = resp.json().await
        .map_err(|e| format!("Respuesta inesperada de Twitch: {}", e))?;

    let username = data.login.clone();
    let stored_token = format!("oauth:{}", raw_token);

    {
        let db = state.db.lock().map_err(map_err)?;
        crate::db::config::set_config_value(&db, "twitch_bot_username", &username).map_err(map_err)?;
        crate::db::config::set_config_value(&db, "twitch_bot_token",    &stored_token).map_err(map_err)?;
    }

    tracing::info!("[twitch] Token validado para @{}", username);
    Ok(username)
}

/// Conecta al LIVE de TikTok del username especificado.
#[tauri::command]
pub async fn connect_tiktok(
    username: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> CmdResult<()> {
    {
        let db = state.db.lock().map_err(map_err)?;
        crate::db::config::set_config_value(&db, "tiktok_username", &username)
            .map_err(map_err)?;
    }

    let inner = state.inner().clone();
    let app_clone = app.clone();
    // Abortar cliente anterior antes de reconectar
    inner.abort_tiktok();
    let handle = tauri::async_runtime::spawn(async move {
        crate::tiktok::spawn_tiktok_client(inner, app_clone).await;
    });
    if let Ok(mut h) = state.tiktok_handle.lock() { *h = Some(handle); }

    app.emit("tiktok-connected", &username).map_err(map_err)?;
    tracing::info!("Conectando a TikTok LIVE: {}", username);
    Ok(())
}

/// Muestra u oculta la ventana overlay (ventana para captura en OBS).
#[tauri::command]
pub async fn toggle_overlay(app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        if overlay.is_visible().map_err(|e: tauri::Error| e.to_string())? {
            overlay.hide().map_err(map_err)?;
            tracing::info!("Overlay ocultado");
        } else {
            // Notify overlay.ts to reset the fade cover BEFORE the window becomes
            // visible. The 120ms delay gives the WebView time to process the event
            // and paint the black cover before show() is called.
            let _ = app.emit("overlay-will-show", ());
            state.broadcast_ws("overlay-will-show", &serde_json::Value::Null);
            tokio::time::sleep(std::time::Duration::from_millis(120)).await;
            overlay.show().map_err(map_err)?;
            tracing::info!("Overlay mostrado");
        }
    }
    Ok(())
}

/// Envía un mensaje de prueba al overlay (para preview/debug).
/// Si TTS está habilitado, también lo sintetiza para probar el lip-sync.
#[tauri::command]
pub async fn send_test_message(
    display_name: String,
    mouth_open_path: String,
    mouth_closed_path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> CmdResult<()> {
    let payload = crate::state::ChatMessagePayload {
        platform: "test".to_string(),
        username: "test_user".to_string(),
        message: format!("Hola, soy {}! Este es un mensaje de prueba.", display_name),
        user_id: 0,
        display_name: display_name.clone(),
        mouth_open_path,
        mouth_closed_path,
        voice_id: "default".to_string(),
    };
    app.emit("chat-message", &payload).map_err(map_err)?;
    state.broadcast_ws("chat-message", &payload);

    // Speak the test message so the streamer can verify lip-sync
    let tts_enabled = state.config_cache.read()
        .map(|c| c.tts_enabled)
        .unwrap_or(false);
    if tts_enabled {
        let app_clone = app.clone();
        let ws_tx     = state.ws_tx.clone();
        let tts_text  = payload.message.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = crate::tts::speak_with_events(
                tts_text,
                "default".to_string(),
                0, // test user_id
                app_clone,
                ws_tx,
            ).await {
                tracing::warn!("[tts/test] Error en TTS de prueba: {}", e);
            }
        });
    }

    Ok(())
}
