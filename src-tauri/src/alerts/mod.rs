// =========================================================================================================
// Event Alerts (shared by Twitch + TikTok)
// =========================================================================================================
// Resolves the per-event alert config (`alerts_config` JSON) into a fully-formatted
// `EventAlertPayload` and emits it as the `event-alert` Tauri event (+ WS broadcast)
// so the dedicated alert overlay (overlay-alerts.html) can render it.
//
// This lives in its own module — not under `tiktok/` — because both the TikTok
// client (`tiktok/mod.rs`) and the Twitch EventSub client (`twitch/eventsub.rs`)
// emit alerts through it. Keeping the logic here avoids duplicating it per platform.
// =========================================================================================================

use tauri::{AppHandle, Emitter};

use crate::state::{AppConfig, AppState, EventAlertPayload};

/// Builds a fully-formatted alert payload from the per-event config, regardless
/// of the `enabled` flag. Returns `None` only when the JSON is invalid or has no
/// entry for `event_kind`. `user_label` fills `{user}`; `amount` fills `{amount}`.
pub fn resolve_alert(
    alerts_config: &str,
    event_kind: &str,
    user_label: &str,
    amount: Option<i64>,
) -> Option<EventAlertPayload> {
    let alerts = serde_json::from_str::<serde_json::Value>(alerts_config).ok()?;
    let entry = alerts.get(event_kind)?;

    let amount_str = amount.map(|a| a.to_string()).unwrap_or_default();
    let text = entry
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .replace("{user}", user_label)
        .replace("{amount}", &amount_str);

    Some(EventAlertPayload {
        event_kind: event_kind.to_string(),
        image_path: entry
            .get("image")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        sound_path: entry
            .get("sound")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        text,
        duration_ms: entry
            .get("duration_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(4000) as u32,
        transition: entry
            .get("transition")
            .and_then(|v| v.as_str())
            .unwrap_or("fade")
            .to_string(),
    })
}

/// Emits a fully-resolved `event-alert` (Tauri + WS broadcast).
pub fn emit_alert(state: &AppState, app_handle: &AppHandle, payload: &EventAlertPayload) {
    let _ = app_handle.emit("event-alert", payload);
    state.broadcast_ws("event-alert", payload);
}

/// Resolves the configured alert for `event_kind` and, if its `enabled` flag is
/// set, emits it so the dedicated alert overlay can render it.
pub fn maybe_emit_alert(
    state: &AppState,
    app_handle: &AppHandle,
    cfg: &AppConfig,
    event_kind: &str,
    user_label: &str,
    amount: Option<i64>,
) {
    let enabled = serde_json::from_str::<serde_json::Value>(&cfg.alerts_config)
        .ok()
        .and_then(|v| {
            v.get(event_kind)
                .and_then(|e| e.get("enabled"))
                .and_then(|b| b.as_bool())
        })
        .unwrap_or(false);
    if !enabled {
        return;
    }

    if let Some(payload) = resolve_alert(&cfg.alerts_config, event_kind, user_label, amount) {
        emit_alert(state, app_handle, &payload);
    }
}

/// Forces an alert for `event_kind` using sample data, ignoring the `enabled`
/// flag — used by the `test_event_alert` command so the streamer can preview the
/// alert on the overlay. Returns false if no alert is configured for the kind.
pub fn emit_test_alert(state: &AppState, app_handle: &AppHandle, event_kind: &str) -> bool {
    let alerts_config = {
        let Ok(cfg) = state.config_cache.read() else {
            return false;
        };
        cfg.alerts_config.clone()
    };
    // Events carrying an amount (TikTok gifts, Twitch cheers/raids) get a sample
    // value so {amount} renders in the preview.
    let amount = if event_kind.contains("gift") || event_kind == "cheer" || event_kind == "raid" {
        Some(100)
    } else {
        None
    };
    match resolve_alert(&alerts_config, event_kind, "TestUser", amount) {
        Some(payload) => {
            emit_alert(state, app_handle, &payload);
            true
        }
        None => false,
    }
}
