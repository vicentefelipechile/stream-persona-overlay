use poise::serenity_prelude as serenity;
use tauri::{AppHandle, Emitter};

use crate::state::AppState;

pub mod commands;

/// Poise framework data type.
/// AppState is Clone (all fields are Arc-wrapped) so it can be passed directly.
/// Using AppState directly avoids wrapping it in another RwLock, whose guards
/// are not Send and would prevent poise command futures from being Send.
pub type Data = AppState;
pub type Error = Box<dyn std::error::Error + Send + Sync>;
pub type Context<'a> = poise::Context<'a, Data, Error>;

/// Inicia el bot de Discord como tarea de tokio.
/// Retorna inmediatamente si el token está vacío.
pub async fn spawn_discord_bot(state: AppState, app_handle: AppHandle) {
    // Leer token desde la config
    let token = {
        let Ok(db) = state.db.lock() else {
            tracing::error!("[discord] DB mutex poisoned — bot no iniciado");
            return;
        };
        crate::db::config::get_config(&db)
            .ok()
            .map(|c| c.discord_bot_token)
            .unwrap_or_default()
    };

    if token.is_empty() {
        tracing::warn!("Discord bot token no configurado — bot no iniciado");
        return;
    }

    let app_for_setup = app_handle.clone();

    let framework = poise::Framework::builder()
        .options(poise::FrameworkOptions {
            commands: vec![
                commands::persona::set_username(),
                commands::persona::upload_open(),
                commands::persona::upload_closed(),
                commands::persona::preview(),
                commands::persona::remove(),
                commands::admin::admin(),
            ],
            ..Default::default()
        })
        .setup(move |ctx, ready, framework| {
            let state_clone = state.clone();
            let app_clone = app_for_setup.clone();
            let bot_name = ready.user.name.clone();
            Box::pin(async move {
                poise::builtins::register_globally(ctx, &framework.options().commands).await?;
                tracing::info!("Discord bot conectado como @{}", bot_name);
                let _ = app_clone.emit("discord-ready", &bot_name);
                Ok(state_clone)
            })
        })
        .build();

    let intents = serenity::GatewayIntents::non_privileged();

    let client = serenity::ClientBuilder::new(&token, intents)
        .framework(framework)
        .await;

    match client {
        Ok(mut c) => {
            if let Err(e) = c.start().await {
                tracing::error!("Error en Discord bot: {}", e);
                let _ = app_handle.emit("discord-error", &e.to_string());
            }
        }
        Err(e) => {
            tracing::error!("No se pudo iniciar el cliente de Discord: {}", e);
            let _ = app_handle.emit("discord-error", &e.to_string());
        }
    }
}
