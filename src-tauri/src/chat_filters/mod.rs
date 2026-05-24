use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::state::AppConfig;

// =========================================================================================================
// Drop reason & filter decision
// =========================================================================================================

#[derive(Debug, Clone, PartialEq)]
pub enum DropReason {
    Cooldown,
    Duplicate,
    RateWindow,
    GlobalRate,
}

impl DropReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            DropReason::Cooldown => "cooldown",
            DropReason::Duplicate => "duplicate",
            DropReason::RateWindow => "rate_window",
            DropReason::GlobalRate => "global_rate",
        }
    }
}

pub enum FilterDecision {
    Allow,
    Drop(DropReason),
}

// =========================================================================================================
// Per-user chat state
// =========================================================================================================

struct UserChatState {
    last_seen: Option<Instant>,
    last_text: Option<String>,
    last_text_at: Option<Instant>,
    timestamps: Vec<Instant>,
}

// =========================================================================================================
// ChatFilters
// =========================================================================================================

#[derive(Default)]
pub struct ChatFilters {
    chat: HashMap<(String, String), UserChatState>,
    events: HashMap<(String, String, String), Instant>,
    global_timestamps: Vec<Instant>,
}

impl ChatFilters {
    /// Check whether a chat message should be forwarded to the overlay.
    /// Call this BEFORE the DB lookup — if dropped, log with dropped_reason and skip.
    pub fn check_chat(
        &mut self,
        platform: &str,
        user: &str,
        text: &str,
        cfg: &AppConfig,
    ) -> FilterDecision {
        let now = Instant::now();
        let (cooldown_ms, dedup_ms, rate_max, rate_window_secs, global_cap) =
            Self::chat_limits(platform, cfg);

        // 1. Global throughput cap
        if global_cap > 0 {
            self.global_timestamps
                .retain(|&t| now.duration_since(t) < Duration::from_secs(1));
            if self.global_timestamps.len() >= global_cap as usize {
                return FilterDecision::Drop(DropReason::GlobalRate);
            }
        }

        let state = self
            .chat
            .entry((platform.to_string(), user.to_string()))
            .or_insert(UserChatState {
                last_seen: None,
                last_text: None,
                last_text_at: None,
                timestamps: Vec::new(),
            });

        // 2. Per-user cooldown
        if cooldown_ms > 0 {
            if let Some(last) = state.last_seen {
                if now.duration_since(last) < Duration::from_millis(cooldown_ms as u64) {
                    return FilterDecision::Drop(DropReason::Cooldown);
                }
            }
        }

        // 3. Duplicate suppression (case-insensitive, whitespace-normalised)
        if dedup_ms > 0 {
            if let (Some(last_text), Some(last_at)) = (&state.last_text, state.last_text_at) {
                if now.duration_since(last_at) < Duration::from_millis(dedup_ms as u64)
                    && text.trim().to_lowercase() == last_text.trim().to_lowercase()
                {
                    return FilterDecision::Drop(DropReason::Duplicate);
                }
            }
        }

        // 4. Sliding-window rate limit
        if rate_max > 0 && rate_window_secs > 0 {
            let window = Duration::from_secs(rate_window_secs as u64);
            state.timestamps.retain(|&t| now.duration_since(t) < window);
            if state.timestamps.len() >= rate_max as usize {
                return FilterDecision::Drop(DropReason::RateWindow);
            }
        }

        // Allow — update state
        state.last_seen = Some(now);
        state.last_text = Some(text.to_string());
        state.last_text_at = Some(now);
        if rate_max > 0 {
            state.timestamps.push(now);
        }
        if global_cap > 0 {
            self.global_timestamps.push(now);
        }

        FilterDecision::Allow
    }

    /// Check whether a chat event (cheer, sub, gift, like, etc.) should be forwarded.
    pub fn check_event(
        &mut self,
        platform: &str,
        user: &str,
        event_kind: &str,
        cfg: &AppConfig,
    ) -> FilterDecision {
        let cooldown_ms = Self::event_cooldown(platform, event_kind, cfg);
        if cooldown_ms == 0 {
            return FilterDecision::Allow;
        }

        let now = Instant::now();
        let key = (
            platform.to_string(),
            user.to_string(),
            event_kind.to_string(),
        );

        if let Some(&last) = self.events.get(&key) {
            if now.duration_since(last) < Duration::from_millis(cooldown_ms as u64) {
                return FilterDecision::Drop(DropReason::Cooldown);
            }
        }

        self.events.insert(key, now);
        FilterDecision::Allow
    }

    // =========================================================================================================
    // Helpers
    // =========================================================================================================

    fn chat_limits(platform: &str, cfg: &AppConfig) -> (u32, u32, u32, u32, u32) {
        // (cooldown_ms, dedup_ms, rate_max_msgs, rate_window_secs, global_cap_per_sec)
        let global = cfg.chat_global_rate_max_per_sec;
        match platform {
            "twitch" => (
                cfg.twitch_chat_user_cooldown_ms,
                cfg.twitch_chat_dedup_window_ms,
                cfg.twitch_chat_rate_max_msgs,
                cfg.twitch_chat_rate_window_secs,
                global,
            ),
            "tiktok" => (
                cfg.tiktok_chat_user_cooldown_ms,
                cfg.tiktok_chat_dedup_window_ms,
                cfg.tiktok_chat_rate_max_msgs,
                cfg.tiktok_chat_rate_window_secs,
                global,
            ),
            _ => (0, 0, 0, 0, 0),
        }
    }

    fn event_cooldown(platform: &str, event_kind: &str, cfg: &AppConfig) -> u32 {
        match (platform, event_kind) {
            ("twitch", "cheer") => cfg.twitch_event_cheer_user_cooldown_ms,
            ("twitch", "sub") => cfg.twitch_event_sub_user_cooldown_ms,
            ("twitch", "raid") => cfg.twitch_event_raid_global_cooldown_ms,
            ("twitch", "follow") => cfg.twitch_event_follow_user_cooldown_ms,
            ("tiktok", "tiktok_gift") | ("tiktok", "tiktok_gift_big") => {
                cfg.tiktok_event_gift_user_cooldown_ms
            }
            ("tiktok", "tiktok_like") => cfg.tiktok_event_like_user_cooldown_ms,
            ("tiktok", "tiktok_follow") => cfg.tiktok_event_follow_user_cooldown_ms,
            ("tiktok", "tiktok_share") => cfg.tiktok_event_share_user_cooldown_ms,
            ("tiktok", "tiktok_subscribe") => cfg.tiktok_event_subscribe_user_cooldown_ms,
            ("tiktok", "tiktok_envelope") => cfg.tiktok_event_envelope_user_cooldown_ms,
            _ => 0,
        }
    }
}

// =========================================================================================================
// Unit tests
// =========================================================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg_with_cooldown(ms: u32) -> AppConfig {
        AppConfig {
            twitch_chat_user_cooldown_ms: ms,
            ..Default::default()
        }
    }

    fn cfg_with_dedup(ms: u32) -> AppConfig {
        AppConfig {
            twitch_chat_dedup_window_ms: ms,
            ..Default::default()
        }
    }

    fn cfg_with_rate(max: u32, secs: u32) -> AppConfig {
        AppConfig {
            twitch_chat_rate_max_msgs: max,
            twitch_chat_rate_window_secs: secs,
            ..Default::default()
        }
    }

    fn cfg_with_global(cap: u32) -> AppConfig {
        AppConfig {
            chat_global_rate_max_per_sec: cap,
            ..Default::default()
        }
    }

    #[test]
    fn cooldown_blocks_second_message() {
        let mut f = ChatFilters::default();
        let cfg = cfg_with_cooldown(60_000);
        assert!(matches!(
            f.check_chat("twitch", "alice", "hi", &cfg),
            FilterDecision::Allow
        ));
        assert!(matches!(
            f.check_chat("twitch", "alice", "hi again", &cfg),
            FilterDecision::Drop(DropReason::Cooldown)
        ));
    }

    #[test]
    fn cooldown_allows_different_users() {
        let mut f = ChatFilters::default();
        let cfg = cfg_with_cooldown(60_000);
        assert!(matches!(
            f.check_chat("twitch", "alice", "hi", &cfg),
            FilterDecision::Allow
        ));
        assert!(matches!(
            f.check_chat("twitch", "bob", "hi", &cfg),
            FilterDecision::Allow
        ));
    }

    #[test]
    fn dedup_blocks_same_text() {
        let mut f = ChatFilters::default();
        let cfg = cfg_with_dedup(60_000);
        assert!(matches!(
            f.check_chat("twitch", "alice", "hello", &cfg),
            FilterDecision::Allow
        ));
        assert!(matches!(
            f.check_chat("twitch", "alice", "HELLO", &cfg),
            FilterDecision::Drop(DropReason::Duplicate)
        ));
    }

    #[test]
    fn dedup_allows_different_text() {
        let mut f = ChatFilters::default();
        let cfg = cfg_with_dedup(60_000);
        assert!(matches!(
            f.check_chat("twitch", "alice", "hello", &cfg),
            FilterDecision::Allow
        ));
        assert!(matches!(
            f.check_chat("twitch", "alice", "world", &cfg),
            FilterDecision::Allow
        ));
    }

    #[test]
    fn rate_limit_blocks_excess() {
        let mut f = ChatFilters::default();
        let cfg = cfg_with_rate(2, 60);
        assert!(matches!(
            f.check_chat("twitch", "alice", "a", &cfg),
            FilterDecision::Allow
        ));
        assert!(matches!(
            f.check_chat("twitch", "alice", "b", &cfg),
            FilterDecision::Allow
        ));
        assert!(matches!(
            f.check_chat("twitch", "alice", "c", &cfg),
            FilterDecision::Drop(DropReason::RateWindow)
        ));
    }

    #[test]
    fn global_rate_blocks_all_users() {
        let mut f = ChatFilters::default();
        let cfg = cfg_with_global(1);
        assert!(matches!(
            f.check_chat("twitch", "alice", "a", &cfg),
            FilterDecision::Allow
        ));
        assert!(matches!(
            f.check_chat("twitch", "bob", "b", &cfg),
            FilterDecision::Drop(DropReason::GlobalRate)
        ));
    }

    #[test]
    fn event_cooldown_blocks_repeat() {
        let mut f = ChatFilters::default();
        let cfg = AppConfig {
            tiktok_event_like_user_cooldown_ms: 60_000,
            ..Default::default()
        };
        assert!(matches!(
            f.check_event("tiktok", "alice", "tiktok_like", &cfg),
            FilterDecision::Allow
        ));
        assert!(matches!(
            f.check_event("tiktok", "alice", "tiktok_like", &cfg),
            FilterDecision::Drop(DropReason::Cooldown)
        ));
    }
}
