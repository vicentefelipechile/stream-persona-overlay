use async_trait::async_trait;

use crate::state::ChatMessagePayload;

// ── ChatPlatform trait ────────────────────────────────────────────────────────
//
// Abstracts any live-chat provider (Twitch, TikTok, …) behind a single
// interface so that:
//   - The core pipeline (DB lookup → emit event) never changes when a
//     provider is swapped or a new one is added.
//   - Unit tests can inject a mock platform without touching real I/O.
//
// To add a new platform:
//   1. Create a new module under `src/` (e.g. `youtube/mod.rs`).
//   2. Implement `ChatPlatform` for your struct.
//   3. `tokio::spawn` it in `lib.rs::run()`.
//   4. No changes to the core pipeline are needed.
//
// NOTE: `async_trait` is required because Rust's trait system does not yet
// natively support `async fn` in trait definitions in a dyn-safe way.
// Add it to Cargo.toml: `async-trait = "0.1"`.

/// A live-chat source that can be started as a background task.
#[async_trait]
pub trait ChatPlatform: Send + Sync {
    /// Human-readable name used in logs (e.g. "Twitch", "TikTok").
    fn name(&self) -> &'static str;

    /// Start the platform client. This method runs until the client
    /// disconnects or encounters an unrecoverable error.
    ///
    /// Implementations must:
    /// - Return immediately if the required configuration (token, channel,
    ///   username, …) is missing or empty.
    /// - Handle transient errors internally with back-off retry rather than
    ///   propagating panics.
    /// - Emit `chat-message` Tauri events via `app_handle` whenever a
    ///   registered, active user sends a message.
    async fn run(&self, state: crate::state::AppState, app_handle: tauri::AppHandle);
}

// ── Payload builder helper ────────────────────────────────────────────────────

/// Converts a matched DB user into the standard `ChatMessagePayload`.
///
/// Shared by all platform implementations so the payload shape is consistent.
pub fn build_payload(
    platform: &str,
    username: &str,
    message: &str,
    user: &crate::db::users::User,
) -> Option<ChatMessagePayload> {
    let persona = user.persona.as_ref()?;
    Some(ChatMessagePayload {
        platform: platform.to_string(),
        username: username.to_string(),
        message: message.to_string(),
        user_id: user.id,
        display_name: user.display_name.clone(),
        mouth_open_path: persona.mouth_open_path.clone(),
        mouth_closed_path: persona.mouth_closed_path.clone(),
        voice_id: user.voice_id.clone(),
    })
}
