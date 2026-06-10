use rusqlite::{Connection, OptionalExtension, Result};

/// Default per-event alert config (see `state::TiktokAlertPayload`). One entry per
/// supported TikTok event_kind. `like` and `member` default to disabled because
/// they fire very frequently and would otherwise flood the alert overlay.
const TIKTOK_ALERTS_DEFAULT: &str = r#"{
  "tiktok_gift":      { "enabled": true,  "image": "", "sound": "", "text": "{user} donó {amount} monedas", "duration_ms": 5000, "transition": "fade" },
  "tiktok_gift_big":  { "enabled": true,  "image": "", "sound": "", "text": "¡{user} donó {amount} monedas!", "duration_ms": 7000, "transition": "scale" },
  "tiktok_follow":    { "enabled": true,  "image": "", "sound": "", "text": "{user} te sigue", "duration_ms": 4000, "transition": "slide-down" },
  "tiktok_share":     { "enabled": false, "image": "", "sound": "", "text": "{user} compartió el directo", "duration_ms": 4000, "transition": "fade" },
  "tiktok_subscribe": { "enabled": true,  "image": "", "sound": "", "text": "¡{user} se suscribió!", "duration_ms": 6000, "transition": "scale" },
  "tiktok_like":      { "enabled": false, "image": "", "sound": "", "text": "{user} dio like", "duration_ms": 3000, "transition": "fade" },
  "tiktok_member":    { "enabled": false, "image": "", "sound": "", "text": "{user} entró", "duration_ms": 3000, "transition": "fade" }
}"#;

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

    // Columnas añadidas a message_log tras la creación inicial — ignorar error si ya existen
    let _ = conn.execute(
        "ALTER TABLE message_log ADD COLUMN event_kind TEXT NOT NULL DEFAULT 'chat'",
        [],
    );
    let _ = conn.execute("ALTER TABLE message_log ADD COLUMN amount INTEGER", []);
    let _ = conn.execute("ALTER TABLE message_log ADD COLUMN dropped_reason TEXT", []);

    // Grid cell columns added to pet_state — ignore error if they already exist.
    // The pet position moved from a free pixel X (floor_x) to authoritative grid
    // cells assigned by the backend. floor_x is kept for backward compatibility.
    let _ = conn.execute(
        "ALTER TABLE pet_state ADD COLUMN cell_x INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE pet_state ADD COLUMN cell_y INTEGER NOT NULL DEFAULT 0",
        [],
    );

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
        ("animation_in", "bounce"),
        ("animation_out", "slide-up"),
        ("visible_duration_secs", "8"),
        ("idle_wiggle", "true"),
        ("idle_breathe", "false"),
        ("glow_effect", "false"),
        ("glow_color", "#00c896"),
        ("outline_effect", "true"),
        ("persona_size_px", "256"),
        ("audio_threshold", "20"),
        ("max_visible_personas", "4"),
        // ── Tamagotchi config ─────────────────────────────────────────────────
        ("tama_enabled", "true"),
        ("tama_pet_size_px", "80"),
        ("tama_floor_y", "900"),
        ("tama_walk_speed", "0.6"),
        ("tama_inactivity_mins", "5"),
        ("tama_max_pets", "8"),
        ("tama_action_check_secs", "8"),
        ("tama_action_probability", "0.15"),
        (
            "tama_enabled_actions",
            r#"["jump","popcorn","dance","fight","explode"]"#,
        ),
        ("tama_jump_on_speak", "false"),
        (
            "tama_keyword_actions",
            r#"{"pelea":"fight","baila":"dance","salta":"jump","explota":"explode","palomitas":"popcorn","agua":"drink_water","comida":"eat_food","cantar":"sing","dormir":"nap","cafe":"coffee","arcoiris":"rainbow_barf","amor":"love","boo":"ghost"}"#,
        ),
        ("tama_name_font_size_px", "11"),
        // ── Twitch config ─────────────────────────────────────────────────
        ("twitch_eventsub_enabled", "false"),
        ("twitch_chat_min_length", "0"),
        ("twitch_chat_max_length", "500"),
        ("twitch_chat_ignore_commands", "true"),
        ("twitch_chat_ignore_users", "[]"),
        ("twitch_chat_followers_only", "false"),
        ("twitch_chat_subs_only", "false"),
        ("twitch_chat_allowed_badges", "[]"),
        ("twitch_event_cheer_enabled", "true"),
        ("twitch_event_cheer_min_bits", "100"),
        ("twitch_event_sub_enabled", "true"),
        ("twitch_event_raid_enabled", "true"),
        ("twitch_event_follow_enabled", "true"),
        ("twitch_event_redemption_enabled", "true"),
        ("twitch_redemption_action_map", "{}"),
        ("twitch_event_hype_train_enabled", "true"),
        ("twitch_event_stream_status_enabled", "true"),
        ("twitch_tts_event_announcements", "true"),
        // ── TikTok config ─────────────────────────────────────────────────
        ("tiktok_api_key", ""),
        ("tiktok_ws_endpoint", "wss://api.tik.tools"),
        ("tiktok_chat_min_length", "0"),
        ("tiktok_chat_max_length", "300"),
        ("tiktok_chat_ignore_users", "[]"),
        ("tiktok_event_gift_enabled", "true"),
        ("tiktok_event_gift_min_coins", "10"),
        ("tiktok_event_gift_big_coins", "100"),
        ("tiktok_event_like_enabled", "true"),
        ("tiktok_event_like_throttle_ms", "4000"),
        ("tiktok_event_follow_enabled", "true"),
        ("tiktok_event_share_enabled", "true"),
        ("tiktok_event_subscribe_enabled", "true"),
        ("tiktok_event_member_enabled", "false"),
        ("tiktok_event_envelope_enabled", "true"),
        ("tiktok_gift_action_map", "{}"),
        ("tiktok_tts_event_announcements", "true"),
        // Per-event alert config (image/sound/text/duration/transition).
        // like + member start disabled because they are high-frequency.
        ("tiktok_alerts_config", TIKTOK_ALERTS_DEFAULT),
        // ── Anti-spam / rate-limit config (chat) ────────────────────────────
        ("twitch_chat_antispam_preset", "off"),
        ("twitch_chat_user_cooldown_ms", "0"),
        ("twitch_chat_dedup_window_ms", "0"),
        ("twitch_chat_rate_max_msgs", "0"),
        ("twitch_chat_rate_window_secs", "10"),
        ("tiktok_chat_antispam_preset", "off"),
        ("tiktok_chat_user_cooldown_ms", "0"),
        ("tiktok_chat_dedup_window_ms", "0"),
        ("tiktok_chat_rate_max_msgs", "0"),
        ("tiktok_chat_rate_window_secs", "10"),
        ("chat_global_throughput_preset", "off"),
        ("chat_global_rate_max_per_sec", "0"),
        // ── Event cooldown config ────────────────────────────────────────────
        ("twitch_event_cooldown_preset", "off"),
        ("twitch_event_cheer_user_cooldown_ms", "0"),
        ("twitch_event_sub_user_cooldown_ms", "0"),
        ("twitch_event_raid_global_cooldown_ms", "0"),
        ("twitch_event_follow_user_cooldown_ms", "0"),
        ("tiktok_event_cooldown_preset", "off"),
        ("tiktok_event_gift_user_cooldown_ms", "0"),
        ("tiktok_event_like_user_cooldown_ms", "0"),
        ("tiktok_event_follow_user_cooldown_ms", "0"),
        ("tiktok_event_share_user_cooldown_ms", "0"),
        ("tiktok_event_subscribe_user_cooldown_ms", "0"),
        ("tiktok_event_envelope_user_cooldown_ms", "0"),
        // ── Guest viewer config ──────────────────────────────────────────────
        ("tama_guests_enabled", "false"),
        ("tama_guests_twitch", "true"),
        ("tama_guests_tiktok", "true"),
        ("tama_guests_tts", "false"),
        ("tama_guests_label_prefix", ""),
        ("tama_guest_tiktok_avatar", "true"),
        // ── Grid layout config ────────────────────────────────────────────────
        ("tama_layout_mode", "dynamic"),
        ("tama_grid_high_precision", "false"),
        ("tama_grid_perspective", "true"),
        ("tama_grid_near_scale", "1.3"),
        ("tama_grid_far_scale", "0.6"),
        ("tama_grid_floor_top_frac", "0.55"),
        ("tama_grid_wander_enabled", "true"),
        // Legacy keys (no longer used by the grid system, kept for compatibility).
        ("tama_static_anchor", "left"),
        ("tama_static_spacing_px", "100"),
        // ── Streamer persona config ──────────────────────────────────────────
        ("streamer_persona_enabled", "true"),
        ("streamer_sprite_mo_eo", ""),
        ("streamer_sprite_mc_eo", ""),
        ("streamer_sprite_mo_ec", ""),
        ("streamer_sprite_mc_ec", ""),
        ("streamer_blink_interval_ms", "4000"),
        ("streamer_blink_duration_ms", "150"),
        ("streamer_talk_animation", "bounce"),
        ("streamer_size_px", "512"),
        ("streamer_anchor", "center"),
        ("streamer_mic_threshold", "20"),
        ("streamer_mic_device_id", ""),
    ];

    for (key, value) in &defaults {
        conn.execute(
            "INSERT OR IGNORE INTO config (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        )?;
    }

    // Rewrite the stale EulerStream endpoint left in existing DBs — the event
    // parser is built for TikTool, so the default must point at tik.tools.
    conn.execute(
        "UPDATE config SET value = 'wss://api.tik.tools' \
         WHERE key = 'tiktok_ws_endpoint' AND value LIKE '%eulerstream%'",
        [],
    )?;

    seed_tama_commands_v1(conn)?;

    Ok(())
}

/// One-time, gated seed that merges the v1 batch of Spanish chat commands
/// (agua, comida, cantar, dormir, cafe, arcoiris, amor, boo) into an existing
/// install's `tama_keyword_actions` map. Fresh installs already get these via the
/// default above, so this only affects databases created before the commands
/// existed. Gated by a sentinel key so it runs exactly once — a keyword the user
/// later deletes is never re-added. Existing keyword mappings are preserved.
fn seed_tama_commands_v1(conn: &Connection) -> Result<()> {
    const SENTINEL: &str = "tama_commands_seed_v1";

    let already = conn
        .query_row(
            "SELECT 1 FROM config WHERE key = ?1",
            [SENTINEL],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if already {
        return Ok(());
    }

    const NEW_COMMANDS: &[(&str, &str)] = &[
        ("agua", "drink_water"),
        ("comida", "eat_food"),
        ("cantar", "sing"),
        ("dormir", "nap"),
        ("cafe", "coffee"),
        ("arcoiris", "rainbow_barf"),
        ("amor", "love"),
        ("boo", "ghost"),
    ];

    let current: String = conn
        .query_row(
            "SELECT value FROM config WHERE key = 'tama_keyword_actions'",
            [],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or_else(|| "{}".to_string());

    let mut map: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&current).unwrap_or_default();
    for (keyword, action) in NEW_COMMANDS {
        map.entry((*keyword).to_string())
            .or_insert_with(|| serde_json::Value::String((*action).to_string()));
    }
    let merged = serde_json::to_string(&map).unwrap_or(current);

    conn.execute(
        "INSERT INTO config (key, value) VALUES ('tama_keyword_actions', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![merged],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO config (key, value) VALUES (?1, 'true')",
        rusqlite::params![SENTINEL],
    )?;

    tracing::info!("[migrations] Comandos de tamagotchi v1 sembrados en keyword map");
    Ok(())
}
