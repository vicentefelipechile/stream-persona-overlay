pub mod eventsub;

use std::collections::HashSet;
use tauri::{AppHandle, Emitter, Manager};
use twitch_irc::login::StaticLoginCredentials;
use twitch_irc::{ClientConfig, SecureTCPTransport, TwitchIRCClient};

use crate::{
    chat_filters::FilterDecision,
    db::{
        config::{log_message, log_message_dropped},
        users::find_active_user_by_twitch,
    },
    state::{guest_user_id, AppState, ChatMessagePayload},
};

/// Returns the directory that contains guest_open.png / guest_closed.png.
/// In release builds uses the Tauri resource dir; in dev falls back to the
/// source-tree resources/ folder so no bundling step is needed.
fn guest_resource_dir(app_handle: &AppHandle) -> std::path::PathBuf {
    if let Ok(dir) = app_handle.path().resource_dir() {
        if dir.join("guest_open.png").exists() {
            return dir;
        }
    }
    // Dev-mode fallback: files live at src-tauri/resources/ in the source tree.
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
}

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
    tracing::info!(
        "[twitch] JOIN enviado a @{} — esperando RoomState...",
        channel
    );

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

                // Anti-spam filter (read config + lock filters before touching DB)
                let filter_decision = {
                    let Ok(cfg) = state.config_cache.read() else {
                        continue;
                    };
                    let Ok(mut filters) = state.chat_filters.lock() else {
                        continue;
                    };
                    filters.check_chat("twitch", &username, &text, &cfg)
                };

                if let FilterDecision::Drop(reason) = filter_decision {
                    tracing::debug!(
                        "[twitch/filter] @{} bloqueado: {}",
                        username,
                        reason.as_str()
                    );
                    let Ok(db) = state.db.lock() else {
                        break;
                    };
                    let _ = log_message_dropped(&db, "twitch", &username, &text, reason.as_str());
                    continue;
                }

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

                // Guest viewer fallback — emit a pet for unregistered users if guests are enabled
                let guest_payload_opt: Option<ChatMessagePayload> = if payload_opt.is_none()
                    && is_unregistered
                {
                    let (
                        guests_enabled,
                        guests_twitch,
                        tama_enabled,
                        guests_tts,
                        label_prefix,
                        guest_open_cfg,
                        guest_closed_cfg,
                    ) = {
                        state
                            .config_cache
                            .read()
                            .map(|c| {
                                (
                                    c.tama_guests_enabled,
                                    c.tama_guests_twitch,
                                    c.tama_enabled,
                                    c.tama_guests_tts,
                                    c.tama_guests_label_prefix.clone(),
                                    c.tama_guest_mouth_open_path.clone(),
                                    c.tama_guest_mouth_closed_path.clone(),
                                )
                            })
                            .unwrap_or((
                                false,
                                false,
                                false,
                                false,
                                String::new(),
                                String::new(),
                                String::new(),
                            ))
                    };
                    if guests_enabled && guests_twitch && tama_enabled {
                        let (mouth_open, mouth_closed) =
                            if !guest_open_cfg.is_empty() && !guest_closed_cfg.is_empty() {
                                (guest_open_cfg, guest_closed_cfg)
                            } else {
                                let res_dir = guest_resource_dir(&app_handle);
                                (
                                    res_dir.join("guest_open.png").to_string_lossy().to_string(),
                                    res_dir
                                        .join("guest_closed.png")
                                        .to_string_lossy()
                                        .to_string(),
                                )
                            };
                        tracing::info!("[twitch/guest] Spawning guest pet for @{}", username);
                        Some(ChatMessagePayload {
                            platform: "twitch".to_string(),
                            username: username.clone(),
                            message: text.clone(),
                            user_id: guest_user_id("twitch", &username),
                            display_name: format!("{}{}", label_prefix, username),
                            mouth_open_path: mouth_open,
                            mouth_closed_path: mouth_closed,
                            voice_id: if guests_tts {
                                "default".to_string()
                            } else {
                                String::new()
                            },
                        })
                    } else {
                        None
                    }
                } else {
                    None
                };

                let effective_payload = payload_opt.or(guest_payload_opt);

                // Only notify "ignorando" when we are truly dropping this user's message
                if is_unregistered
                    && effective_payload.is_none()
                    && !notified_unregistered.contains(&username)
                {
                    notified_unregistered.insert(username.clone());
                    tracing::info!(
                        "[twitch] @{} no está registrado — ignorando mensaje",
                        username
                    );
                    let _ = app_handle.emit("twitch-unregistered-user", &username);
                }
                let is_guest = effective_payload
                    .as_ref()
                    .map(|p| p.user_id < 0)
                    .unwrap_or(false);

                if let Some(payload) = effective_payload {
                    if let Err(e) = app_handle.emit("chat-message", &payload) {
                        tracing::error!("[twitch] Error emitiendo chat-message: {}", e);
                    }
                    state.broadcast_ws("chat-message", &payload);

                    let (tts_enabled, guests_tts) = state
                        .config_cache
                        .read()
                        .map(|c| (c.tts_enabled, c.tama_guests_tts))
                        .unwrap_or((false, false));
                    let should_tts =
                        tts_enabled && (!is_guest || guests_tts) && !payload.voice_id.is_empty();
                    if should_tts {
                        let app_clone = app_handle.clone();
                        let ws_tx = state.ws_tx.clone();
                        let tts_text = payload.message.clone();
                        let tts_voice = payload.voice_id.clone();
                        let tts_uid = payload.user_id;
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) = crate::tts::speak_with_events(
                                tts_text, tts_voice, tts_uid, app_clone, ws_tx,
                            )
                            .await
                            {
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
                tracing::debug!(
                    "[twitch] Mensaje ignorado: {:?}",
                    std::mem::discriminant(&other)
                );
            }
        }
    }

    tracing::warn!("[twitch] Loop de mensajes terminó para @{}", channel);
}
