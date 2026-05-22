use std::collections::HashSet;
use tauri::{AppHandle, Emitter};
use twitch_irc::login::StaticLoginCredentials;
use twitch_irc::{ClientConfig, SecureTCPTransport, TwitchIRCClient};

use crate::{
    db::{config::log_message, users::find_active_user_by_twitch},
    state::{AppState, ChatMessagePayload},
};

/// Inicia el cliente Twitch IRC y escucha mensajes del canal configurado.
pub async fn spawn_twitch_client(state: AppState, app_handle: AppHandle) {
    let (channel, bot_username, bot_token) = {
        let Ok(db) = state.db.lock() else {
            tracing::error!("[twitch] DB mutex poisoned — abortando cliente");
            return;
        };
        match crate::db::config::get_config(&db) {
            Ok(c) => (c.twitch_channel, c.twitch_bot_username, c.twitch_bot_token),
            Err(e) => {
                tracing::error!("[twitch] Error leyendo config: {}", e);
                return;
            }
        }
    };

    if channel.is_empty() {
        tracing::warn!("Canal de Twitch no configurado — cliente no iniciado");
        return;
    }

    // Usar credenciales autenticadas si están configuradas.
    // Con una conexión anónima Twitch sólo envía mensajes cuando el canal
    // está en vivo; con credenciales válidas llegan siempre.
    // StaticLoginCredentials::new() espera el token SIN "oauth:" — la crate
    // lo agrega internamente al enviar PASS por IRC.
    let config = if !bot_username.is_empty() && !bot_token.is_empty() {
        let raw_token = bot_token.trim_start_matches("oauth:").to_string();
        tracing::info!("[twitch] Conectando como @{} (autenticado)", bot_username);
        ClientConfig::new_simple(StaticLoginCredentials::new(
            bot_username.clone(),
            Some(raw_token),
        ))
    } else {
        tracing::warn!("[twitch] Sin credenciales de bot — conexión anónima (solo funciona con el canal en vivo)");
        ClientConfig::default()
    };

    let (mut incoming_messages, client) =
        TwitchIRCClient::<SecureTCPTransport, StaticLoginCredentials>::new(config);

    if let Err(e) = client.join(channel.clone()) {
        tracing::error!("[twitch] No se pudo unir al canal @{}: {:?}", channel, e);
        let _ = app_handle.emit("twitch-error", format!("No se pudo unir a @{}", channel));
        return;
    }
    tracing::info!("[twitch] JOIN enviado a @{} — esperando RoomState...", channel);

    // Usernames para los que ya se mostró el aviso de "no registrado" esta sesión
    let mut notified_unregistered: HashSet<String> = HashSet::new();

    while let Some(message) = incoming_messages.recv().await {
        use twitch_irc::message::ServerMessage;

        match message {
            // RoomState = el servidor confirmó que estamos dentro del canal
            ServerMessage::RoomState(room) => {
                tracing::info!("[twitch] Unido a @{}", room.channel_login);
                let _ = app_handle.emit("twitch-connected", &room.channel_login);
            }

            // Notice puede indicar error de autenticación o ban del bot
            ServerMessage::Notice(notice) => {
                tracing::warn!("[twitch] Notice: {}", notice.message_text);
                let msg = notice.message_text.to_lowercase();
                if msg.contains("login authentication")
                    || msg.contains("improperly formatted")
                    || msg.contains("invalid nick")
                {
                    tracing::error!("[twitch] Error de autenticación: {}", notice.message_text);
                    let _ = app_handle.emit("twitch-error", &notice.message_text);
                    break;
                }
            }

            ServerMessage::Privmsg(msg) => {
                let username = msg.sender.login.clone();
                let text = msg.message_text.clone();

                tracing::debug!("[twitch] @{}: {}", username, text);

                let (payload_opt, is_unregistered) = {
                    let Ok(db) = state.db.lock() else {
                        tracing::error!("[twitch] DB mutex poisoned");
                        break;
                    };
                    match find_active_user_by_twitch(&db, &username) {
                        Ok(Some(user)) => {
                            let _ = log_message(&db, "twitch", &username, &text, Some(user.id));
                            let payload = user.persona.as_ref().map(|persona| ChatMessagePayload {
                                platform: "twitch".to_string(),
                                username: username.clone(),
                                message: text.clone(),
                                user_id: user.id,
                                display_name: user.display_name.clone(),
                                mouth_open_path: persona.mouth_open_path.clone(),
                                mouth_closed_path: persona.mouth_closed_path.clone(),
                                voice_id: user.voice_id.clone(),
                            });
                            (payload, false)
                        }
                        Ok(None) => {
                            let _ = log_message(&db, "twitch", &username, &text, None);
                            (None, true)
                        }
                        Err(e) => {
                            tracing::error!("[twitch] Error buscando usuario en DB: {}", e);
                            (None, false)
                        }
                    }
                };

                // Notificar una sola vez por sesión cuando el usuario no está registrado
                if is_unregistered && !notified_unregistered.contains(&username) {
                    notified_unregistered.insert(username.clone());
                    tracing::info!("[twitch] @{} no está registrado — ignorando mensaje", username);
                    let _ = app_handle.emit("twitch-unregistered-user", &username);
                }

                if let Some(payload) = payload_opt {
                    if let Err(e) = app_handle.emit("chat-message", &payload) {
                        tracing::error!("[twitch] Error emitiendo chat-message: {}", e);
                    }

                    let tts_enabled = state.config_cache.read()
                        .map(|c| c.tts_enabled)
                        .unwrap_or(false);
                    if tts_enabled {
                        let app_clone  = app_handle.clone();
                        let tts_text   = payload.message.clone();
                        let tts_voice  = payload.voice_id.clone();
                        let tts_uid    = payload.user_id;
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) = crate::tts::speak_with_events(
                                tts_text, tts_voice, tts_uid, app_clone,
                            ).await {
                                tracing::warn!("[tts/twitch] Error en TTS: {}", e);
                            }
                        });
                    }
                }
            }

            ServerMessage::Reconnect(_) => {
                tracing::warn!("[twitch] Servidor pidió reconexión — saliendo del loop");
                break;
            }

            other => {
                tracing::debug!("[twitch] Mensaje ignorado: {:?}", std::mem::discriminant(&other));
            }
        }
    }

    tracing::warn!("[twitch] Loop de mensajes terminó para @{}", channel);
}
