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
            "chroma_color" => cfg.chroma_color = value,
            "overlay_width" => cfg.overlay_width = value.parse().unwrap_or(1920),
            "overlay_height" => cfg.overlay_height = value.parse().unwrap_or(1080),
            "tts_enabled" => cfg.tts_enabled = value == "true",
            "twitch_channel" => cfg.twitch_channel = value,
            "twitch_bot_username" => cfg.twitch_bot_username = value,
            "twitch_bot_token" => cfg.twitch_bot_token = value,
            "twitch_client_id" => cfg.twitch_client_id = value,
            "twitch_bot_user_id" => cfg.twitch_bot_user_id = value,
            "tiktok_username" => cfg.tiktok_username = value,
            "discord_bot_token" => cfg.discord_bot_token = value,
            "discord_guild_id" => cfg.discord_guild_id = value,
            "discord_channel_id" => cfg.discord_channel_id = value,
            "overlay_display_mode" => cfg.overlay_display_mode = value,
            // ── Animation config ─────────────────────────────────────────────
            "animation_in" => cfg.animation_in = value,
            "animation_out" => cfg.animation_out = value,
            "visible_duration_secs" => cfg.visible_duration_secs = value.parse().unwrap_or(8.0),
            "idle_wiggle" => cfg.idle_wiggle = value == "true",
            "idle_breathe" => cfg.idle_breathe = value == "true",
            "glow_effect" => cfg.glow_effect = value == "true",
            "glow_color" => cfg.glow_color = value,
            "outline_effect" => cfg.outline_effect = value == "true",
            "persona_size_px" => cfg.persona_size_px = value.parse().unwrap_or(256),
            "audio_threshold" => cfg.audio_threshold = value.parse().unwrap_or(20),
            "max_visible_personas" => cfg.max_visible_personas = value.parse().unwrap_or(4),
            // ── Tamagotchi config ─────────────────────────────────────────────
            "tama_enabled" => cfg.tama_enabled = value == "true",
            "tama_pet_size_px" => cfg.tama_pet_size_px = value.parse().unwrap_or(80),
            "tama_floor_y" => cfg.tama_floor_y = value.parse().unwrap_or(900),
            "tama_walk_speed" => cfg.tama_walk_speed = value.parse().unwrap_or(0.6),
            "tama_inactivity_mins" => cfg.tama_inactivity_mins = value.parse().unwrap_or(5),
            "tama_max_pets" => cfg.tama_max_pets = value.parse().unwrap_or(8),
            "tama_action_check_secs" => cfg.tama_action_check_secs = value.parse().unwrap_or(8),
            "tama_action_probability" => {
                cfg.tama_action_probability = value.parse().unwrap_or(0.15)
            }
            "tama_enabled_actions" => cfg.tama_enabled_actions = value,
            "tama_jump_on_speak" => cfg.tama_jump_on_speak = value == "true",
            "tama_keyword_actions" => cfg.tama_keyword_actions = value,
            "tama_name_font_size_px" => cfg.tama_name_font_size_px = value.parse().unwrap_or(11),
            // ── Twitch config ─────────────────────────────────────────────────
            "twitch_eventsub_enabled" => cfg.twitch_eventsub_enabled = value == "true",
            "twitch_chat_min_length" => cfg.twitch_chat_min_length = value.parse().unwrap_or(0),
            "twitch_chat_max_length" => cfg.twitch_chat_max_length = value.parse().unwrap_or(500),
            "twitch_chat_ignore_commands" => cfg.twitch_chat_ignore_commands = value == "true",
            "twitch_chat_ignore_users" => cfg.twitch_chat_ignore_users = value,
            "twitch_chat_followers_only" => cfg.twitch_chat_followers_only = value == "true",
            "twitch_chat_subs_only" => cfg.twitch_chat_subs_only = value == "true",
            "twitch_chat_allowed_badges" => cfg.twitch_chat_allowed_badges = value,
            "twitch_event_cheer_enabled" => cfg.twitch_event_cheer_enabled = value == "true",
            "twitch_event_cheer_min_bits" => {
                cfg.twitch_event_cheer_min_bits = value.parse().unwrap_or(100)
            }
            "twitch_event_sub_enabled" => cfg.twitch_event_sub_enabled = value == "true",
            "twitch_event_raid_enabled" => cfg.twitch_event_raid_enabled = value == "true",
            "twitch_event_follow_enabled" => cfg.twitch_event_follow_enabled = value == "true",
            "twitch_event_redemption_enabled" => {
                cfg.twitch_event_redemption_enabled = value == "true"
            }
            "twitch_redemption_action_map" => cfg.twitch_redemption_action_map = value,
            "twitch_event_hype_train_enabled" => {
                cfg.twitch_event_hype_train_enabled = value == "true"
            }
            "twitch_event_stream_status_enabled" => {
                cfg.twitch_event_stream_status_enabled = value == "true"
            }
            "twitch_tts_event_announcements" => {
                cfg.twitch_tts_event_announcements = value == "true"
            }
            // ── TikTok config ─────────────────────────────────────────────────
            "tiktok_api_key" => cfg.tiktok_api_key = value,
            "tiktok_ws_endpoint" => cfg.tiktok_ws_endpoint = value,
            "tiktok_chat_min_length" => cfg.tiktok_chat_min_length = value.parse().unwrap_or(0),
            "tiktok_chat_max_length" => cfg.tiktok_chat_max_length = value.parse().unwrap_or(300),
            "tiktok_chat_ignore_users" => cfg.tiktok_chat_ignore_users = value,
            "tiktok_event_gift_enabled" => cfg.tiktok_event_gift_enabled = value == "true",
            "tiktok_event_gift_min_coins" => {
                cfg.tiktok_event_gift_min_coins = value.parse().unwrap_or(10)
            }
            "tiktok_event_gift_big_coins" => {
                cfg.tiktok_event_gift_big_coins = value.parse().unwrap_or(100)
            }
            "tiktok_event_like_enabled" => cfg.tiktok_event_like_enabled = value == "true",
            "tiktok_event_like_throttle_ms" => {
                cfg.tiktok_event_like_throttle_ms = value.parse().unwrap_or(4000)
            }
            "tiktok_event_follow_enabled" => cfg.tiktok_event_follow_enabled = value == "true",
            "tiktok_event_share_enabled" => cfg.tiktok_event_share_enabled = value == "true",
            "tiktok_event_subscribe_enabled" => {
                cfg.tiktok_event_subscribe_enabled = value == "true"
            }
            "tiktok_event_member_enabled" => cfg.tiktok_event_member_enabled = value == "true",
            "tiktok_event_envelope_enabled" => cfg.tiktok_event_envelope_enabled = value == "true",
            "tiktok_gift_action_map" => cfg.tiktok_gift_action_map = value,
            "tiktok_tts_event_announcements" => {
                cfg.tiktok_tts_event_announcements = value == "true"
            }
            "alerts_config" => cfg.alerts_config = value,
            // ── Anti-spam / rate-limit config (chat) ─────────────────────────
            "twitch_chat_antispam_preset" => cfg.twitch_chat_antispam_preset = value,
            "twitch_chat_user_cooldown_ms" => {
                cfg.twitch_chat_user_cooldown_ms = value.parse().unwrap_or(0)
            }
            "twitch_chat_dedup_window_ms" => {
                cfg.twitch_chat_dedup_window_ms = value.parse().unwrap_or(0)
            }
            "twitch_chat_rate_max_msgs" => {
                cfg.twitch_chat_rate_max_msgs = value.parse().unwrap_or(0)
            }
            "twitch_chat_rate_window_secs" => {
                cfg.twitch_chat_rate_window_secs = value.parse().unwrap_or(10)
            }
            "tiktok_chat_antispam_preset" => cfg.tiktok_chat_antispam_preset = value,
            "tiktok_chat_user_cooldown_ms" => {
                cfg.tiktok_chat_user_cooldown_ms = value.parse().unwrap_or(0)
            }
            "tiktok_chat_dedup_window_ms" => {
                cfg.tiktok_chat_dedup_window_ms = value.parse().unwrap_or(0)
            }
            "tiktok_chat_rate_max_msgs" => {
                cfg.tiktok_chat_rate_max_msgs = value.parse().unwrap_or(0)
            }
            "tiktok_chat_rate_window_secs" => {
                cfg.tiktok_chat_rate_window_secs = value.parse().unwrap_or(10)
            }
            "chat_global_throughput_preset" => cfg.chat_global_throughput_preset = value,
            "chat_global_rate_max_per_sec" => {
                cfg.chat_global_rate_max_per_sec = value.parse().unwrap_or(0)
            }
            // ── Event cooldown config ─────────────────────────────────────────
            "twitch_event_cooldown_preset" => cfg.twitch_event_cooldown_preset = value,
            "twitch_event_cheer_user_cooldown_ms" => {
                cfg.twitch_event_cheer_user_cooldown_ms = value.parse().unwrap_or(0)
            }
            "twitch_event_sub_user_cooldown_ms" => {
                cfg.twitch_event_sub_user_cooldown_ms = value.parse().unwrap_or(0)
            }
            "twitch_event_raid_global_cooldown_ms" => {
                cfg.twitch_event_raid_global_cooldown_ms = value.parse().unwrap_or(0)
            }
            "twitch_event_follow_user_cooldown_ms" => {
                cfg.twitch_event_follow_user_cooldown_ms = value.parse().unwrap_or(0)
            }
            "tiktok_event_cooldown_preset" => cfg.tiktok_event_cooldown_preset = value,
            "tiktok_event_gift_user_cooldown_ms" => {
                cfg.tiktok_event_gift_user_cooldown_ms = value.parse().unwrap_or(0)
            }
            "tiktok_event_like_user_cooldown_ms" => {
                cfg.tiktok_event_like_user_cooldown_ms = value.parse().unwrap_or(0)
            }
            "tiktok_event_follow_user_cooldown_ms" => {
                cfg.tiktok_event_follow_user_cooldown_ms = value.parse().unwrap_or(0)
            }
            "tiktok_event_share_user_cooldown_ms" => {
                cfg.tiktok_event_share_user_cooldown_ms = value.parse().unwrap_or(0)
            }
            "tiktok_event_subscribe_user_cooldown_ms" => {
                cfg.tiktok_event_subscribe_user_cooldown_ms = value.parse().unwrap_or(0)
            }
            "tiktok_event_envelope_user_cooldown_ms" => {
                cfg.tiktok_event_envelope_user_cooldown_ms = value.parse().unwrap_or(0)
            }
            // ── Guest viewer config ───────────────────────────────────────────
            "tama_guests_enabled" => cfg.tama_guests_enabled = value == "true",
            "tama_guests_twitch" => cfg.tama_guests_twitch = value == "true",
            "tama_guests_tiktok" => cfg.tama_guests_tiktok = value == "true",
            "tama_guests_tts" => cfg.tama_guests_tts = value == "true",
            "tama_guests_label_prefix" => cfg.tama_guests_label_prefix = value,
            "tama_guest_mouth_open_path" => cfg.tama_guest_mouth_open_path = value,
            "tama_guest_mouth_closed_path" => cfg.tama_guest_mouth_closed_path = value,
            "tama_guest_tiktok_avatar" => cfg.tama_guest_tiktok_avatar = value == "true",
            // ── Grid layout config ────────────────────────────────────────────
            "tama_layout_mode" => cfg.tama_layout_mode = value,
            "tama_grid_high_precision" => cfg.tama_grid_high_precision = value == "true",
            "tama_grid_perspective" => cfg.tama_grid_perspective = value == "true",
            "tama_grid_near_scale" => cfg.tama_grid_near_scale = value.parse().unwrap_or(1.3),
            "tama_grid_far_scale" => cfg.tama_grid_far_scale = value.parse().unwrap_or(0.6),
            "tama_grid_floor_top_frac" => {
                cfg.tama_grid_floor_top_frac = value.parse().unwrap_or(0.55)
            }
            "tama_grid_wander_enabled" => cfg.tama_grid_wander_enabled = value == "true",
            "tama_static_anchor" => cfg.tama_static_anchor = value,
            "tama_static_spacing_px" => cfg.tama_static_spacing_px = value.parse().unwrap_or(100),
            // ── Streamer persona config ───────────────────────────────────────
            "streamer_persona_enabled" => cfg.streamer_persona_enabled = value == "true",
            "streamer_sprite_mo_eo" => cfg.streamer_sprite_mo_eo = value,
            "streamer_sprite_mc_eo" => cfg.streamer_sprite_mc_eo = value,
            "streamer_sprite_mo_ec" => cfg.streamer_sprite_mo_ec = value,
            "streamer_sprite_mc_ec" => cfg.streamer_sprite_mc_ec = value,
            "streamer_blink_interval_ms" => {
                cfg.streamer_blink_interval_ms = value.parse().unwrap_or(4000)
            }
            "streamer_blink_duration_ms" => {
                cfg.streamer_blink_duration_ms = value.parse().unwrap_or(150)
            }
            "streamer_talk_animation" => cfg.streamer_talk_animation = value,
            "streamer_size_px" => cfg.streamer_size_px = value.parse().unwrap_or(512),
            "streamer_anchor" => cfg.streamer_anchor = value,
            "streamer_mic_threshold" => cfg.streamer_mic_threshold = value.parse().unwrap_or(20),
            "streamer_mic_device_id" => cfg.streamer_mic_device_id = value,
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
    log_message_with_event(conn, platform, username, message, user_id, "chat", None)
}

/// Log con event_kind y amount
pub fn log_message_with_event(
    conn: &Connection,
    platform: &str,
    username: &str,
    message: &str,
    user_id: Option<i64>,
    event_kind: &str,
    amount: Option<i64>,
) -> Result<()> {
    conn.execute(
        "INSERT INTO message_log (platform, username, message, user_id, event_kind, amount)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![platform, username, message, user_id, event_kind, amount],
    )?;
    Ok(())
}

/// Log de un mensaje bloqueado por anti-spam, con razón de descarte.
pub fn log_message_dropped(
    conn: &Connection,
    platform: &str,
    username: &str,
    message: &str,
    dropped_reason: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO message_log (platform, username, message, user_id, event_kind, dropped_reason)
         VALUES (?1, ?2, ?3, NULL, 'chat', ?4)",
        params![platform, username, message, dropped_reason],
    )?;
    Ok(())
}

pub fn get_recent_logs(conn: &Connection, limit: u32) -> Result<Vec<serde_json::Value>> {
    let mut stmt = conn.prepare(
        "SELECT id, platform, username, message, user_id, shown, event_kind, amount, created_at, dropped_reason
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
            "event_kind": row.get::<_, String>(6)?,
            "amount": row.get::<_, Option<i64>>(7)?,
            "created_at": row.get::<_, String>(8)?,
            "dropped_reason": row.get::<_, Option<String>>(9)?,
        }))
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}
