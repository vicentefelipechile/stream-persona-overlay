use tauri::{AppHandle, Emitter, Manager};

use crate::state::{guest_resource_dir, guest_user_id, AppState, ChatMessagePayload};

type CmdResult<T> = Result<T, String>;

// =========================================================================================================
// Demo (fake) pets
// =========================================================================================================
// Lets a first-time user populate the overlay with synthetic pets without a live
// stream connection. Each demo pet reuses the exact `chat-message` path real chat
// uses, so it spawns, gets a grid cell, shows bubbles, jumps on speak and reacts to
// keywords for free — in both the Tauri overlay and the OBS Browser Source (the
// payloads are emitted AND broadcast over the WS). Demo pets use negative user_ids
// (via `guest_user_id`) and the guest sprite, exactly like real guest viewers.
//
// A background loop keeps them alive: pets despawn after the inactivity timeout, so
// the loop periodically re-messages random pets with random text so they keep
// moving and never fall asleep while the demo is on.
// =========================================================================================================

/// Display names for the demo pets, cycled when more than this many are requested.
const DEMO_NAMES: &[&str] = &[
    "Pixel", "Bit", "Nova", "Luna", "Ziggy", "Mochi", "Taco", "Pep", "Boop", "Kiwi",
    "Mango", "Suki", "Rex", "Coco", "Gizmo", "Toby", "Maya", "Zelda", "Olive", "Remy",
];

/// Sample chat lines the loop sends so bubbles and jump-on-speak look alive.
const DEMO_LINES: &[&str] = &[
    "hola!",
    "GG",
    "jajaja",
    "que buena stream",
    "pog",
    "wii",
    "hello chat",
    "<3",
    "primera vez aquí!",
    "saludos!",
    "vamos!",
    "epico",
];

/// Builds the `ChatMessagePayload` for demo pet `idx` with the given message text.
fn demo_payload(app: &AppHandle, idx: usize, message: &str) -> ChatMessagePayload {
    let name = DEMO_NAMES[idx % DEMO_NAMES.len()];
    // Disambiguate names past one full cycle (e.g. "Pixel 2") so user_ids stay unique.
    let display = if idx >= DEMO_NAMES.len() {
        format!("{} {}", name, idx / DEMO_NAMES.len() + 1)
    } else {
        name.to_string()
    };

    let state = app.state::<AppState>();
    let (open_cfg, closed_cfg) = state
        .config_cache
        .read()
        .map(|c| {
            (
                c.tama_guest_mouth_open_path.clone(),
                c.tama_guest_mouth_closed_path.clone(),
            )
        })
        .unwrap_or_default();

    let (mouth_open, mouth_closed) = if !open_cfg.is_empty() && !closed_cfg.is_empty() {
        (open_cfg, closed_cfg)
    } else {
        let res_dir = guest_resource_dir(app);
        (
            res_dir.join("guest_open.png").to_string_lossy().to_string(),
            res_dir
                .join("guest_closed.png")
                .to_string_lossy()
                .to_string(),
        )
    };

    ChatMessagePayload {
        platform: "demo".to_string(),
        username: display.clone(),
        message: message.to_string(),
        user_id: guest_user_id("demo", &display),
        display_name: display,
        mouth_open_path: mouth_open,
        mouth_closed_path: mouth_closed,
        voice_id: String::new(), // demo pets never trigger TTS
    }
}

/// Emits (Tauri + WS) a `chat-message` for demo pet `idx`.
fn send_demo_message(app: &AppHandle, idx: usize, message: &str) {
    let payload = demo_payload(app, idx, message);
    let _ = app.emit("chat-message", &payload);
    let state = app.state::<AppState>();
    state.broadcast_ws("chat-message", &payload);
}

/// Spawns `count` demo pets and starts a background loop that keeps them moving by
/// re-messaging random pets with random text. Re-callable: stops any existing demo
/// first, so changing the count just restarts cleanly.
#[tauri::command]
pub async fn tama_demo_start(count: u32, app: AppHandle) -> CmdResult<()> {
    let count = count.clamp(1, 20) as usize;

    let state = app.state::<AppState>();
    // Restart cleanly if a demo is already running.
    state.abort_demo();

    tracing::info!("[demo] Generando {} mascotas de prueba", count);

    let app_loop = app.clone();
    let handle = tauri::async_runtime::spawn(async move {
        // Stagger the initial spawn so pets pop in one by one (reads better than all
        // appearing at once) — each message spawns the pet on the overlay side.
        for idx in 0..count {
            send_demo_message(&app_loop, idx, DEMO_LINES[idx % DEMO_LINES.len()]);
            tokio::time::sleep(std::time::Duration::from_millis(350)).await;
        }

        // Keep them alive: every few seconds, message a random pet so it jumps / shows
        // a bubble and its inactivity timer resets before it can sleep + despawn.
        let mut tick: u64 = 0;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(2500)).await;
            tick = tick.wrapping_add(1);
            // Cheap deterministic pseudo-random pick (no rng dep needed): mix the tick.
            let idx = (tick.wrapping_mul(2_654_435_761) >> 16) as usize % count;
            let line = DEMO_LINES[(tick as usize).wrapping_add(idx) % DEMO_LINES.len()];
            send_demo_message(&app_loop, idx, line);
        }
    });

    if let Ok(mut guard) = state.demo_handle.lock() {
        *guard = Some(handle);
    }

    Ok(())
}

/// Stops the demo loop and despawns every demo pet (so they leave the overlay
/// cleanly instead of fading out via the inactivity timeout).
#[tauri::command]
pub async fn tama_demo_stop(app: AppHandle) -> CmdResult<()> {
    let state = app.state::<AppState>();
    state.abort_demo();

    // Tell every overlay to despawn each demo pet by its (deterministic) user_id.
    // `tama-despawn` runs the pet's normal remove() path (despawn animation + frees
    // the backend grid cell); a plain `tama-action`/"despawn" is a no-op because
    // "despawn" is a lifecycle state, not a registered Action.
    #[derive(serde::Serialize, Clone)]
    struct DespawnPayload {
        user_id: i64,
    }
    for idx in 0..20usize {
        let name = DEMO_NAMES[idx % DEMO_NAMES.len()];
        let display = if idx >= DEMO_NAMES.len() {
            format!("{} {}", name, idx / DEMO_NAMES.len() + 1)
        } else {
            name.to_string()
        };
        let user_id = guest_user_id("demo", &display);

        let payload = DespawnPayload { user_id };
        let _ = app.emit("tama-despawn", &payload);
        state.broadcast_ws("tama-despawn", &payload);
    }

    tracing::info!("[demo] Mascotas de prueba detenidas");
    Ok(())
}
