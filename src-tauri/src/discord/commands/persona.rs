use std::path::PathBuf;

use poise::serenity_prelude as serenity;

use crate::discord::{Context, Error};

// ─── /persona set-username ───────────────────────────────────────────────────

/// Registra o actualiza tu username de Twitch y/o TikTok para el overlay.
#[poise::command(slash_command, prefix_command)]
pub async fn set_username(
    ctx: Context<'_>,
    #[description = "Tu username de Twitch (sin @)"] twitch: Option<String>,
    #[description = "Tu username de TikTok (sin @)"] tiktok: Option<String>,
) -> Result<(), Error> {
    if twitch.is_none() && tiktok.is_none() {
        ctx.say("❌ Debes proporcionar al menos un username (Twitch o TikTok).").await?;
        return Ok(());
    }

    let discord_id = ctx.author().id.to_string();
    let display_name = ctx.author().name.clone();

    // Scope the MutexGuard before any .await
    let result = {
        let db = ctx.data().db.lock();
        match db {
            Ok(db) => crate::db::users::upsert_user_discord(
                &db,
                &discord_id,
                &display_name,
                twitch.as_deref(),
                tiktok.as_deref(),
            ).map_err(|e| e.to_string()),
            Err(e) => Err(e.to_string()),
        }
    };
    result?;

    let mut parts = vec![];
    if let Some(t) = &twitch {
        parts.push(format!("Twitch: **{}**", t));
    }
    if let Some(tt) = &tiktok {
        parts.push(format!("TikTok: **{}**", tt));
    }

    ctx.say(format!(
        "✅ Tus usernames han sido actualizados:\n{}",
        parts.join("\n")
    ))
    .await?;

    Ok(())
}

// ─── /persona upload-open ────────────────────────────────────────────────────

/// Sube tu imagen de boca abierta para el overlay (PNG/JPG, máx 2MB).
#[poise::command(slash_command)]
pub async fn upload_open(
    ctx: Context<'_>,
    #[description = "Imagen de boca abierta (PNG/JPG, máx 2MB)"] imagen: serenity::Attachment,
) -> Result<(), Error> {
    upload_image(ctx, imagen, true).await
}

// ─── /persona upload-closed ──────────────────────────────────────────────────

/// Sube tu imagen de boca cerrada para el overlay (PNG/JPG, máx 2MB).
#[poise::command(slash_command)]
pub async fn upload_closed(
    ctx: Context<'_>,
    #[description = "Imagen de boca cerrada (PNG/JPG, máx 2MB)"] imagen: serenity::Attachment,
) -> Result<(), Error> {
    upload_image(ctx, imagen, false).await
}

async fn upload_image(ctx: Context<'_>, attachment: serenity::Attachment, is_open: bool) -> Result<(), Error> {
    // Validar tipo MIME y extensión
    let filename = &attachment.filename;
    let content_type = attachment.content_type.as_deref().unwrap_or("");
    let is_valid_image = content_type.starts_with("image/png")
        || content_type.starts_with("image/jpeg")
        || filename.ends_with(".png")
        || filename.ends_with(".jpg")
        || filename.ends_with(".jpeg");

    if !is_valid_image {
        ctx.say("❌ Solo se aceptan imágenes PNG o JPG.").await?;
        return Ok(());
    }

    // Validar tamaño (máx 2 MB)
    if attachment.size > 2 * 1024 * 1024 {
        ctx.say("❌ La imagen es demasiado grande. Máximo 2MB.").await?;
        return Ok(());
    }

    // Deferir la respuesta — la descarga y el procesamiento pueden tardar
    ctx.defer().await?;

    // Descargar imagen
    let bytes = attachment.download().await?;
    let discord_id = ctx.author().id.to_string();
    let display_name = ctx.author().name.clone();

    // Asegurar que el usuario existe en la DB
    {
        let db = ctx.data().db.lock().map_err(|e| e.to_string())?;
        crate::db::users::upsert_user_discord(&db, &discord_id, &display_name, None, None)?;
    }

    // Obtener user_id
    let user_id: i64 = {
        let db = ctx.data().db.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT id FROM users WHERE discord_id = ?1",
            rusqlite::params![discord_id],
            |row| row.get::<_, i64>(0),
        )?
    };

    // Redimensionar a 512×512 PNG y guardar en filesystem
    let persona_dir = get_persona_dir(&ctx.data().app_data_dir, &discord_id);
    std::fs::create_dir_all(&persona_dir)?;

    let img = image::load_from_memory(&bytes)?;
    // Usar Nearest para preservar los bordes nítidos (pixel art) en lugar de Lanczos3 que difumina
    // Usar resize_to_fit en lugar de resize_to_fill para no recortar la imagen (crop) si no es cuadrada
    let resized = img.resize_to_fill(512, 512, image::imageops::FilterType::Lanczos3);

    let file_name = if is_open { "mouth_open.png" } else { "mouth_closed.png" };
    let file_path = persona_dir.join(file_name);
    resized.save_with_format(&file_path, image::ImageFormat::Png)?;

    let path_str = file_path.to_string_lossy().to_string();

    // Guardar ruta en DB
    {
        let db = ctx.data().db.lock().map_err(|e| e.to_string())?;
        if is_open {
            crate::db::users::update_mouth_open(&db, user_id, &path_str)?;
        } else {
            crate::db::users::update_mouth_closed(&db, user_id, &path_str)?;
        }
    }

    let label = if is_open { "boca abierta" } else { "boca cerrada" };
    ctx.say(format!("✅ Imagen de **{}** guardada correctamente (512×512 PNG).", label))
        .await?;

    Ok(())
}

// ─── /persona preview ────────────────────────────────────────────────────────

/// Muestra un preview de tu persona actual.
#[poise::command(slash_command, prefix_command)]
pub async fn preview(ctx: Context<'_>) -> Result<(), Error> {
    let discord_id = ctx.author().id.to_string();

    // All DB work in a single scoped block — no .await inside
    let persona_result: Option<(String, String)> = {
        let db = ctx.data().db.lock().map_err(|e| e.to_string())?;

        let user_id: Option<i64> = db
            .query_row(
                "SELECT id FROM users WHERE discord_id = ?1",
                rusqlite::params![discord_id],
                |row| row.get(0),
            )
            .ok();

        match user_id {
            None => None,
            Some(uid) => db
                .query_row(
                    "SELECT mouth_open_path, mouth_closed_path FROM personas WHERE user_id = ?1",
                    rusqlite::params![uid],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .ok(),
        }
    };

    match persona_result {
        None => {
            ctx.say("❌ No tienes ninguna persona registrada. Usa `/persona upload-open` primero.").await?;
        }
        Some((open, closed)) => {
            let embed = serenity::CreateEmbed::new()
                .title(format!("Persona de {}", ctx.author().name))
                .color(0x00c896u32)
                .field("Boca abierta", &open, false)
                .field("Boca cerrada", &closed, false);

            ctx.send(poise::CreateReply::default().embed(embed)).await?;
        }
    }

    Ok(())
}

// ─── /persona remove ─────────────────────────────────────────────────────────

/// Elimina tu persona del overlay.
#[poise::command(slash_command, prefix_command)]
pub async fn remove(ctx: Context<'_>) -> Result<(), Error> {
    let discord_id = ctx.author().id.to_string();

    // Obtain user_id and delete — all in a sync block
    let remove_result: Result<Option<i64>, Error> = {
        let db = ctx.data().db.lock().map_err(|e| e.to_string())?;

        let user_id: Option<i64> = db
            .query_row(
                "SELECT id FROM users WHERE discord_id = ?1",
                rusqlite::params![discord_id],
                |row| row.get(0),
            )
            .ok();

        if let Some(uid) = user_id {
            crate::db::users::delete_persona(&db, uid)?;
        }

        Ok(user_id)
    };

    match remove_result? {
        None => {
            ctx.say("❌ No tienes ninguna persona registrada.").await?;
        }
        Some(_) => {
            // Best-effort filesystem cleanup (after db guard is dropped)
            let persona_dir = get_persona_dir(&ctx.data().app_data_dir, &discord_id);
            let _ = std::fs::remove_dir_all(&persona_dir);

            ctx.say("✅ Tu persona ha sido eliminada del overlay.").await?;
        }
    }

    Ok(())
}

// ─── Helper ──────────────────────────────────────────────────────────────────

fn get_persona_dir(app_data_dir: &std::path::Path, discord_id: &str) -> PathBuf {
    app_data_dir.join("personas").join(discord_id)
}
