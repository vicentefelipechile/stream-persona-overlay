use rusqlite::{Connection, Result};

/// Ejecuta todas las migraciones de la base de datos en orden.
pub fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS users (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_id      TEXT NOT NULL UNIQUE,
            display_name    TEXT NOT NULL,
            twitch_username TEXT,
            tiktok_username TEXT,
            voice_id        TEXT NOT NULL DEFAULT 'default',
            is_active       INTEGER NOT NULL DEFAULT 1,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS personas (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            mouth_open_path   TEXT NOT NULL,
            mouth_closed_path TEXT NOT NULL,
            uploaded_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS config (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS message_log (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            platform   TEXT NOT NULL,
            username   TEXT NOT NULL,
            message    TEXT NOT NULL,
            user_id    INTEGER REFERENCES users(id),
            shown      INTEGER NOT NULL DEFAULT 0,
            event_kind TEXT NOT NULL DEFAULT 'chat',
            amount     INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS pet_state (
            user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
            floor_x      REAL NOT NULL DEFAULT 0,
            is_sleeping  INTEGER NOT NULL DEFAULT 0
        );
        ",
    )?;

    // Insertar valores de configuración por defecto si no existen
    let defaults = [
        ("chroma_color", "#00FF00"),
        ("overlay_width", "1920"),
        ("overlay_height", "1080"),
        ("tts_enabled", "true"),
        ("twitch_channel", ""),
        ("twitch_bot_username", ""),
        ("twitch_bot_token", ""),
        ("twitch_client_id", ""),
        ("twitch_bot_user_id", ""),
        ("tiktok_username", ""),
        ("discord_bot_token", ""),
        ("discord_guild_id", ""),
        ("discord_channel_id", ""),
        ("overlay_display_mode", "parallel"),
        // ── Animation config ──────────────────────────────────────────────────
        ("animation_in",          "bounce"),
        ("animation_out",         "slide-up"),
        ("visible_duration_secs", "8"),
        ("idle_wiggle",           "true"),
        ("idle_breathe",          "false"),
        ("glow_effect",           "false"),
        ("glow_color",            "#00c896"),
        ("outline_effect",        "true"),
        ("persona_size_px",       "256"),
        ("audio_threshold",       "20"),
        ("max_visible_personas",  "4"),
        // ── Tamagotchi config ─────────────────────────────────────────────────
        ("tama_enabled",            "true"),
        ("tama_pet_size_px",        "80"),
        ("tama_floor_y",            "900"),
        ("tama_walk_speed",         "0.6"),
        ("tama_inactivity_mins",    "5"),
        ("tama_max_pets",           "8"),
        ("tama_action_check_secs",  "8"),
        ("tama_action_probability", "0.15"),
        ("tama_enabled_actions",    r#"["jump","popcorn","dance","fight","explode"]"#),
        ("tama_jump_on_speak",      "false"),
        // ── Twitch config ─────────────────────────────────────────────────
        ("twitch_eventsub_enabled",     "false"),
        ("twitch_chat_min_length",      "0"),
        ("twitch_chat_max_length",      "500"),
        ("twitch_chat_ignore_commands", "true"),
        ("twitch_chat_ignore_users",    "[]"),
        ("twitch_chat_followers_only",  "false"),
        ("twitch_chat_subs_only",       "false"),
        ("twitch_chat_allowed_badges",  "[]"),
        ("twitch_event_cheer_enabled",  "true"),
        ("twitch_event_cheer_min_bits", "100"),
        ("twitch_event_sub_enabled",    "true"),
        ("twitch_event_raid_enabled",   "true"),
        ("twitch_event_follow_enabled", "true"),
        ("twitch_event_redemption_enabled", "true"),
        ("twitch_redemption_action_map", "{}"),
        ("twitch_event_hype_train_enabled", "true"),
        ("twitch_event_stream_status_enabled", "true"),
        ("twitch_tts_event_announcements", "true"),
        // ── TikTok config ─────────────────────────────────────────────────
        ("tiktok_api_key",              ""),
        ("tiktok_ws_endpoint",          "wss://ws.eulerstream.com"),
        ("tiktok_chat_min_length",      "0"),
        ("tiktok_chat_max_length",      "300"),
        ("tiktok_chat_ignore_users",    "[]"),
        ("tiktok_event_gift_enabled",   "true"),
        ("tiktok_event_gift_min_coins", "10"),
        ("tiktok_event_gift_big_coins", "100"),
        ("tiktok_event_like_enabled",   "true"),
        ("tiktok_event_like_throttle_ms", "4000"),
        ("tiktok_event_follow_enabled", "true"),
        ("tiktok_event_share_enabled",  "true"),
        ("tiktok_event_subscribe_enabled", "true"),
        ("tiktok_event_member_enabled", "false"),
        ("tiktok_event_envelope_enabled", "true"),
        ("tiktok_gift_action_map",      "{}"),
        ("tiktok_tts_event_announcements", "true"),
    ];

    for (key, value) in &defaults {
        conn.execute(
            "INSERT OR IGNORE INTO config (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        )?;
    }

    Ok(())
}
