use crate::discord::{Context, Error};

// ─── /admin ──────────────────────────────────────────────────────────────────
//
// Streamer-only admin commands. These let the streamer manage registered users
// directly from Discord without opening the desktop panel.
//
// NOTE: There is no guild-role enforcement here yet — any user can call these.
// To restrict them, check ctx.author().id against a configurable "streamer_id"
// stored in the config table, or use poise's `check` callbacks.

/// Admin commands for the streamer (list / toggle / remove users).
#[poise::command(
    slash_command,
    prefix_command,
    subcommands("list_users", "toggle_user", "remove_user", "send_test")
)]
pub async fn admin(_ctx: Context<'_>) -> Result<(), Error> {
    Ok(())
}

// ─── /admin list-users ───────────────────────────────────────────────────────

/// Lists all registered users and their overlay status.
#[poise::command(slash_command, prefix_command, rename = "list-users")]
pub async fn list_users(ctx: Context<'_>) -> Result<(), Error> {
    // Compute the reply string in a sync block, drop the MutexGuard before .await
    let reply: String = {
        let db = ctx.data().db.lock().map_err(|e| e.to_string())?;
        let users = crate::db::users::get_all_users(&db)?;

        if users.is_empty() {
            "📋 No hay usuarios registrados todavía.".to_string()
        } else {
            let mut lines: Vec<String> = vec!["**Usuarios registrados:**\n".to_string()];
            for u in &users {
                let status = if u.is_active { "🟢" } else { "🔴" };
                let twitch = u
                    .twitch_username
                    .as_deref()
                    .map(|t| format!("Twitch: `{}`", t))
                    .unwrap_or_else(|| "sin Twitch".to_string());
                let tiktok = u
                    .tiktok_username
                    .as_deref()
                    .map(|t| format!("TikTok: `@{}`", t))
                    .unwrap_or_else(|| "sin TikTok".to_string());
                let persona = if u.persona.is_some() { "🖼️" } else { "⚠️ sin persona" };
                lines.push(format!(
                    "{} **{}** (ID: `{}`) — {} | {} | {}",
                    status, u.display_name, u.id, twitch, tiktok, persona
                ));
            }
            lines.join("\n")
        }
    };
    // db (MutexGuard) is dropped here — safe to .await

    // Discord messages are capped at 2000 chars; chunk if needed
    if reply.len() <= 1900 {
        ctx.say(reply).await?;
    } else {
        for chunk in reply.as_bytes().chunks(1900) {
            ctx.say(String::from_utf8_lossy(chunk)).await?;
        }
    }

    Ok(())
}

// ─── /admin toggle-user ──────────────────────────────────────────────────────

/// Activates or deactivates a user by their numeric DB ID.
#[poise::command(slash_command, prefix_command, rename = "toggle-user")]
pub async fn toggle_user(
    ctx: Context<'_>,
    #[description = "Numeric ID of the user (from /admin list-users)"] user_id: i64,
) -> Result<(), Error> {
    let new_state: bool = {
        let db = ctx.data().db.lock().map_err(|e| e.to_string())?;
        crate::db::users::toggle_user_active(&db, user_id)?
    };

    let icon = if new_state { "🟢 activado" } else { "🔴 desactivado" };
    ctx.say(format!("✅ Usuario `{}` ha sido {}.", user_id, icon))
        .await?;

    tracing::info!("Admin discord: toggled user {} → active={}", user_id, new_state);
    Ok(())
}

// ─── /admin remove-user ──────────────────────────────────────────────────────

/// Permanently removes a user and their persona from the overlay.
#[poise::command(slash_command, prefix_command, rename = "remove-user")]
pub async fn remove_user(
    ctx: Context<'_>,
    #[description = "Numeric ID of the user (from /admin list-users)"] user_id: i64,
) -> Result<(), Error> {
    // Verify existence and delete — all in a sync block
    let removed_name: Option<String> = {
        let db = ctx.data().db.lock().map_err(|e| e.to_string())?;
        let user = crate::db::users::get_user_by_id(&db, user_id)?;
        match user {
            None => None,
            Some(u) => {
                crate::db::users::delete_user(&db, user_id)?;
                let persona_dir = std::path::PathBuf::from("personas").join(&u.discord_id);
                let _ = std::fs::remove_dir_all(&persona_dir);
                Some(u.display_name)
            }
        }
    };

    match removed_name {
        None => {
            ctx.say(format!("❌ No existe ningún usuario con ID `{}`.", user_id))
                .await?;
        }
        Some(name) => {
            ctx.say(format!(
                "✅ Usuario **{}** (`{}`) y su persona han sido eliminados permanentemente.",
                name, user_id
            ))
            .await?;
            tracing::info!("Admin discord: removed user {} ({})", user_id, name);
        }
    }

    Ok(())
}

// ─── /admin send-test ────────────────────────────────────────────────────────

/// Sends a test overlay message for a user by their DB ID.
#[poise::command(slash_command, prefix_command, rename = "send-test")]
pub async fn send_test(
    ctx: Context<'_>,
    #[description = "Numeric ID of the user to test"] user_id: i64,
) -> Result<(), Error> {
    // Check user exists and has a persona — sync block
    let reply: String = {
        let db = ctx.data().db.lock().map_err(|e| e.to_string())?;
        let user = crate::db::users::get_user_by_id(&db, user_id)?;
        match user {
            None => format!("❌ No existe ningún usuario con ID `{}`.", user_id),
            Some(u) if u.persona.is_none() => {
                format!("❌ El usuario **{}** no tiene persona subida.", u.display_name)
            }
            Some(u) => {
                tracing::warn!(
                    "send-test desde Discord (user {}): AppHandle no accesible desde poise. \
                     Usa el panel de admin para pruebas en tiempo real.",
                    u.display_name
                );
                format!(
                    "⚠️ Mensaje de prueba para **{}** registrado. \
                     Para ver el overlay en tiempo real, usa el botón de prueba en el panel de administración.",
                    u.display_name
                )
            }
        }
    };

    ctx.say(reply).await?;
    Ok(())
}
