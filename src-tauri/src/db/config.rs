use anyhow::Result;
use rusqlite::{params, Connection};

use crate::state::AppConfig;

pub fn get_config(conn: &Connection) -> Result<AppConfig> {
    let mut stmt = conn.prepare("SELECT key, value FROM config")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut cfg = AppConfig::default();
    for row in rows.filter_map(|r| r.ok()) {
        let (key, value) = row;
        match key.as_str() {
            "chroma_color"         => cfg.chroma_color           = value,
            "overlay_width"         => cfg.overlay_width          = value.parse().unwrap_or(1920),
            "overlay_height"        => cfg.overlay_height         = value.parse().unwrap_or(1080),
            "tts_enabled"           => cfg.tts_enabled            = value == "true",
            "twitch_channel"        => cfg.twitch_channel         = value,
            "twitch_bot_username"   => cfg.twitch_bot_username    = value,
            "twitch_bot_token"      => cfg.twitch_bot_token       = value,
            "tiktok_username"       => cfg.tiktok_username        = value,
            "discord_bot_token"     => cfg.discord_bot_token      = value,
            "discord_guild_id"      => cfg.discord_guild_id       = value,
            "discord_channel_id"    => cfg.discord_channel_id     = value,
            "overlay_display_mode" => cfg.overlay_display_mode    = value,
            // ── Animation config ─────────────────────────────────────────────
            "animation_in"          => cfg.animation_in           = value,
            "animation_out"         => cfg.animation_out          = value,
            "visible_duration_secs" => cfg.visible_duration_secs  = value.parse().unwrap_or(8.0),
            "idle_wiggle"           => cfg.idle_wiggle            = value == "true",
            "idle_breathe"          => cfg.idle_breathe           = value == "true",
            "glow_effect"           => cfg.glow_effect            = value == "true",
            "glow_color"            => cfg.glow_color             = value,
            "outline_effect"        => cfg.outline_effect         = value == "true",
            "persona_size_px"       => cfg.persona_size_px        = value.parse().unwrap_or(256),
            "audio_threshold"       => cfg.audio_threshold        = value.parse().unwrap_or(20),
            "max_visible_personas"  => cfg.max_visible_personas   = value.parse().unwrap_or(4),
            _ => {}
        }
    }

    // Aplicar defaults si están vacíos
    if cfg.chroma_color.is_empty() {
        cfg.chroma_color = "#00FF00".to_string();
    }
    if cfg.overlay_width == 0 {
        cfg.overlay_width = 1920;
    }
    if cfg.overlay_height == 0 {
        cfg.overlay_height = 1080;
    }

    Ok(cfg)
}

pub fn set_config_value(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO config (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Log de mensajes de chat (opcional, para debug)
pub fn log_message(
    conn: &Connection,
    platform: &str,
    username: &str,
    message: &str,
    user_id: Option<i64>,
) -> Result<()> {
    conn.execute(
        "INSERT INTO message_log (platform, username, message, user_id)
         VALUES (?1, ?2, ?3, ?4)",
        params![platform, username, message, user_id],
    )?;
    Ok(())
}

pub fn get_recent_logs(conn: &Connection, limit: u32) -> Result<Vec<serde_json::Value>> {
    let mut stmt = conn.prepare(
        "SELECT id, platform, username, message, user_id, shown, created_at
         FROM message_log
         ORDER BY created_at DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, i64>(0)?,
            "platform": row.get::<_, String>(1)?,
            "username": row.get::<_, String>(2)?,
            "message": row.get::<_, String>(3)?,
            "user_id": row.get::<_, Option<i64>>(4)?,
            "shown": row.get::<_, i64>(5)? != 0,
            "created_at": row.get::<_, String>(6)?,
        }))
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}
