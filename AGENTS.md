# AGENTS.md — Stream Persona Overlay

> ⚠️ **CRITICAL RULE**: This file must NEVER be translated to Spanish or any other language. It must ALWAYS remain in English to preserve technical consistency for AI agents.

> Reference guide for AI agents and developers working in this repository.
> Read it **in full** before touching any file.

---

## 1. What Is This Project?

**Stream Persona Overlay** is a **Tauri v2** desktop application that displays animated Tamagotchi-style pets on the streamer's overlay in real time. When a registered user types in the Twitch or TikTok LIVE chat, their pet (built from two images: mouth open / mouth closed) appears on the overlay floor, walks around, reacts to chat events, and executes random or admin-triggered actions.

Users register and manage their images through a **Discord bot** (slash commands). The persona images (mouth open/closed) are used as the pet sprites.

---

## 2. Technology Stack

### Backend — Rust (`src-tauri/`)

| Crate | Role |
|---|---|
| `tauri 2` | Desktop application framework |
| `tokio 1` (full features) | Async runtime; all bot tasks use `tauri::async_runtime::spawn` |
| `serenity 0.12` + `poise 0.6` | Discord bot with slash commands |
| `twitch-irc 5` | IRC client for reading Twitch chat |
| `tokio-tungstenite 0.24` + `futures-util` | Native WebSocket for TikTok LIVE (via TikTool) |
| `rusqlite 0.31` (bundled) | Embedded SQLite database |
| `image 0.25` | Resizing and validation of persona images |
| `tts 0.26` | OS-native Text-to-Speech (SAPI / espeak / NSS) |
| `serde 1` + `serde_json` | Serialization of Tauri payloads |
| `anyhow 1` | Error handling in internal logic |
| `tracing 0.1` + `tracing-subscriber` | Structured logging |
| `reqwest 0.12` | HTTP client for external API validation (Twitch) |
| `once_cell 1` | Global static initialization |
| `tauri-plugin-shell` | Shell plugin (registered but not used for user-facing features — kept for potential future use) |
| `axum 0.7` (feature `ws`) | HTTP + WebSocket server for the OBS Browser Source |
| `tower-http 0.5` (feature `fs`) | Static file serving middleware (`ServeDir`) used by the axum server |

### Frontend — Vanilla TypeScript (`src/`)

| Technology | Use |
|---|---|
| Vanilla TypeScript (no framework) | All UI for the admin panel and the overlay |
| Vite 6 | Bundler and dev server (three entry points: `main`, `overlay`, `overlay_browser`) |
| `motion` (v12+) | Animation engine for Tamagotchi pet actions (DOM animate API) |
| `@tauri-apps/api 2` | `invoke`, `listen`, `convertFileSrc` — used by Tauri windows only |
| `@tauri-apps/plugin-opener 2` | Opening external URLs / files |
| `simple-icons` | Brand SVG icons (Twitch, TikTok, Discord). Consumed exclusively through `src/icons.ts` — never imported directly in views. |
| `lucide` | UI SVG icons (stroke + fill). Consumed exclusively through `src/icons.ts` — never imported directly in views. |
| `ws-transport.ts` (internal) | Drop-in replacement for Tauri API used by the OBS Browser Source overlay |

### Frontend Design System

| Token | Value |
|---|---|
| Font — body | IBM Plex Sans |
| Font — mono / code | IBM Plex Mono |
| Accent color | `#00c896` (teal-green) |
| Border radius | ≤ 4px |

> Do **not** deviate from these tokens when writing new views or components. Consistency across the panel depends on them.

### Internal Communication

- **Admin panel / Tauri overlay → Rust:** `invoke(command_name, args)` via Tauri Commands
- **Rust → Admin panel / Tauri overlay:** `app_handle.emit(event_name, payload)` via Tauri Events
- **OBS Browser Source → Rust:** `wsInvoke(command, args)` via `ws-transport.ts` (WebSocket on port 6767)
- **Rust → OBS Browser Source:** `state.broadcast_ws(event, payload)` fan-outs through `AppState.ws_tx`
- **Rule:** never use fetch/HTTP or raw WebSockets from the admin panel or Tauri overlay to talk to Rust — use `invoke`/`listen` only. The WebSocket transport is exclusively for the browser overlay.

---

## 3. System Architecture

```
TAURI PROCESS (Rust — single binary)
|
+-- tauri::async_runtime::spawn --> discord::spawn_discord_bot()
+-- tauri::async_runtime::spawn --> twitch::spawn_twitch_client()
+-- tauri::async_runtime::spawn --> tiktok::spawn_tiktok_client()
+-- tauri::async_runtime::spawn --> server::start_server()  (axum on port 6767)
|
+-- AppState --- Arc<Mutex<Connection>>              (SQLite — std::sync::Mutex)
             --- Arc<RwLock<AppConfig>>              (in-memory cache — std::sync::RwLock)
             --- Arc<Mutex<ChatFilters>>             (anti-spam rate-limiter — std::sync::Mutex)
             --- broadcast::Sender<String> (ws_tx)   (fan-out to all WS clients)

Tauri Events    --> WebView "main"      (Admin panel — index.html)
                --> WebView "overlay"   (Chroma key — overlay.html)
broadcast_ws()  --> axum WS /ws        (OBS Browser Source — overlay-browser.html)
```

### Tauri Windows (defined in `tauri.conf.json`)

| Label | File | Notes |
|---|---|---|
| `main` | `index.html` | Streamer admin panel, 1200×800, no special restrictions |
| `overlay` | `overlay.html` | 1920×1080, `transparent: true`, normal decorations, `visible: false` by default |

The `overlay` window starts hidden. The "Toggle Overlay" button in the panel calls the `toggle_overlay` command.

> ⚠️ **CRITICAL — What "overlay" means in this project:**
> The `overlay` window is **NOT a system-level overlay on top of the entire screen**.
> It is a **normal desktop window with a chroma-key (green/custom color) background**
> that the streamer adds to OBS as a **Window Capture** source.
> OBS then applies a chroma-key filter to remove the background, making the pets
> appear transparent on stream.
>
> **Do NOT set `alwaysOnTop: true`, `decorations: false`, or `skipTaskbar: true`** on this window.
> Those properties would make it impossible to interact with the rest of the PC.
> The window must behave like any other normal application window.

> **`withGlobalTauri: true`** is set in `tauri.conf.json`. This injects the Tauri API as `window.__TAURI__` globally. Import from `@tauri-apps/api/*` as usual — do not rely on the global directly. This setting also affects CSP configuration.

### Overlay Window Lifecycle

- The overlay window's `CloseRequested` event is intercepted in `lib.rs` — it calls `hide()` instead of destroying the window.
- **App exit:** Because the overlay is only hidden (never destroyed), Tauri's `ExitRequested` event would never fire on its own when the user closes the main window. To fix this, `lib.rs` handles `RunEvent::WindowEvent { label: "main", event: Destroyed }` and calls `abort_all()` + `app_handle.exit(0)` to terminate the process cleanly.

### Motion v12 Types Constraint (Critical)

`motion` v12 does **not** accept shorthand transformation properties (`x`, `y`, `scale`, `rotate`, `rotateY`, etc.) in the TypeScript type for keyframe objects targeting `HTMLElement`, even though they work fine at runtime.

**The only working solution** is to use CSS `transform` strings:
```typescript
// WRONG — causes TS error even though it runs fine:
animate(el, { y: 100, scale: 0 }, { duration: 0.3 });

// CORRECT — use CSS transform strings:
animate(el, { transform: "translateY(100px) scale(0)" }, { duration: 0.3 });
```

For opacity and filter, shorthand works fine. Only `transform`-related properties require the string form.

---

## 4. Directory Structure

```
stream-persona-overlay/
+-- src/                          # Frontend TypeScript
|   +-- main.ts                   # Panel entry point (index.html)
|   +-- router.ts                 # Manual hash-based ViewRouter
|   +-- state.ts                  # AppState singleton + TS types + showToast()
|   +-- icons.ts                  # Centralized icon catalog — brand icons (simple-icons) + inline SVG UI icons
|   +-- views/
|   |   +-- config.ts             # /config view — global settings + platform shortcut cards
|   |   +-- users.ts              # /users view — user CRUD
|   |   +-- logs.ts               # /logs view — message history
|   |   +-- tamagotchi.ts         # /tamagotchi view — pet admin panel
|   |   +-- twitch.ts             # /twitch view — Twitch connection, chat filters, events, EventSub
|   |   +-- tiktok.ts             # /tiktok view — TikTok connection, chat filters, events
|   |   +-- overlay.ts            # Entry point for overlay.html (NOT a panel view)
|   |   +-- overlay-browser.ts    # Entry point for overlay-browser.html (OBS Browser Source)
|   +-- overlay/                  # Overlay-specific modules (used by overlay.ts and overlay-browser.ts)
|   |   +-- ws-transport.ts       # WebSocket transport — mirrors Tauri API for browser context
|   |   +-- tamagotchi/           # Tamagotchi pet system (see Section 16)
|   |       +-- core/             # PetStateMachine, BaseAction, ActionRegistry, PetFloor, BasePet, PetScheduler, PetManager
|   |       +-- actions/          # IdleWalkAction, JumpAction, PopcornAction, FightAction, ExplodeAction, DanceAction, SleepAction, ConfettiAction, HypeTrainAction, _template
|   |       +-- props/            # PropRenderer, PropAssetLoader
|   |       +-- eventReactions.ts # chat-event listener → maps event_kind to pet action
|   +-- components/               # Reusable frontend components
|   |   +-- color-picker.ts       # Chroma color selector component
|   +-- assets/                   # Static frontend assets
|   +-- styles/
|       +-- entry-panel.css       # Entry point for admin panel (imports design system + panel modules)
|       +-- entry-overlay.css     # Entry point for overlay windows (imports overlay modules)
|       +-- tokens.css            # CSS custom properties (colors, fonts, spacing, shadows)
|       +-- reset.css             # Reset + base typography + links + scrollbar
|       +-- buttons.css           # Button styles (.btn and variants)
|       +-- forms.css             # Form elements (inputs, selects, textarea)
|       +-- components.css        # Cards, badges, spinner, loading, toasts, divider, empty-state, utilities
|       +-- layout.css            # Sidebar, navigation, main content structure
|       +-- users.css             # Users table, avatars, config-grid
|       +-- modal.css             # Modal, backdrop, preview, persona preview
|       +-- logs.css              # Log entries
|       +-- switch.css            # Switch/toggle component
|       +-- tamagotchi-panel.css  # Tamagotchi admin panel styles (.tama-* prefix)
|       +-- overlay-base.css      # Overlay window base reset + fade-cover
|       +-- pets.css              # Pet styles (.tamagotchi-pet, .pet-*)
|
+-- src-tauri/
|   +-- tauri.conf.json           # Window config, bundle, CSP
|   +-- Cargo.toml                # Rust dependencies
|   +-- build.rs                  # Tauri build script
|   +-- src/
|       +-- main.rs               # Binary entry point (delegates to lib.rs::run())
|       +-- lib.rs                # setup_app: DB init, spawn tasks, register handlers, exit logic
|       +-- state.rs              # AppState, AppConfig, ChatMessagePayload, TtsStatePayload
|       +-- chat_platform.rs      # ChatPlatform trait abstraction for providers
|       +-- server/
|       |   +-- mod.rs            # axum HTTP+WS server on port 6767 (OBS Browser Source)
|       +-- chat_filters/
|       |   +-- mod.rs            # ChatFilters — per-user cooldown, dedup, rate window, global cap, event cooldowns
|       +-- db/
|       |   +-- mod.rs
|       |   +-- migrations.rs     # run_migrations() — creates tables and inserts defaults
|       |   +-- users.rs          # Full CRUD for users + personas + logs
|       |   +-- config.rs         # get_config() / set_config_value() / log_message_dropped()
|       +-- discord/
|       |   +-- mod.rs            # spawn_discord_bot() — reads token, starts poise::Framework
|       |   +-- commands/
|       |       +-- persona.rs    # /persona: set-username, upload-open, upload-closed, preview, remove
|       |       +-- admin.rs      # /admin commands (streamer role only): get-user, toggle-active, delete-user
|       +-- twitch/
|       |   +-- mod.rs            # spawn_twitch_client() — TwitchIRC, on_message --> emit "chat-message"
|       |   +-- eventsub.rs       # spawn_twitch_eventsub() — WS to Twitch EventSub, registers subs via Helix, emits "chat-event"
|       |   +-- handler.rs        # User lookup logic in DB
|       +-- tiktok/
|       |   +-- mod.rs            # spawn_tiktok_client() — WS to TikTool, chat+gift+like+follow+share+subscribe+envelope --> emit "chat-message"/"chat-event"
|       |   +-- handler.rs        # TikTok event parsing
|       +-- tts/
|       |   +-- mod.rs            # TTS wrapper (tts crate)
|       +-- commands/
|           +-- mod.rs
|           +-- users.rs          # get_users, get_user, update_user_cmd, delete_user_cmd, toggle_user_active_cmd, get_recent_logs_cmd
|           +-- config.rs         # get_config_cmd, set_config_cmd, get_available_voices_cmd, set_chroma_color, save_animation_config, disconnect_twitch, disconnect_tiktok
|           +-- control.rs        # restart_discord_bot, connect_twitch, validate_twitch_token, connect_tiktok, toggle_overlay, send_test_message
|
+-- index.html                    # Admin panel HTML
+-- overlay.html                  # Overlay window HTML (chroma key, Tauri window)
+-- overlay-browser.html          # OBS Browser Source HTML (transparent, no Tauri APIs)
+-- vite.config.ts                # Vite configuration (3 entry points: main, overlay, overlay_browser)
+-- tsconfig.json
+-- package.json
+-- AGENTS.md                     # This file
+-- plan-proyecto-streamoverlay.md  # Original design document (reference)
```

---

## 5. SQLite Database

The `overlay.db` file is created in `app_data_dir` (managed by Tauri — **never** inside the project directory).

### Active Pragmas

The following pragmas are set at startup in `run_migrations()` and affect all DB operations:

```sql
PRAGMA journal_mode=WAL;    -- Enables concurrent reads alongside writes
PRAGMA foreign_keys=ON;     -- Enforces FK constraints (ON DELETE CASCADE on personas)
```

### Tables

```sql
users        -- discord_id (UNIQUE), display_name, twitch_username, tiktok_username, voice_id, is_active
personas     -- user_id (UNIQUE FK), mouth_open_path, mouth_closed_path
config       -- key TEXT PRIMARY KEY, value TEXT  (key-value store)
message_log  -- platform, username, message, user_id (nullable FK), shown, event_kind (DEFAULT 'chat'), amount (nullable), dropped_reason (nullable TEXT)
pet_state    -- user_id (PK FK→users ON DELETE CASCADE), last_seen_at, floor_x, is_sleeping
```

> **`message_log.dropped_reason`**: When a chat message is filtered by the anti-spam system, `log_message_dropped()` inserts a row with `dropped_reason` set to one of `"cooldown"`, `"duplicate"`, `"rate_window"`, or `"global_rate"`. Allowed messages use the standard `log_message()` function and have `dropped_reason = NULL`. The logs view displays dropped messages with a badge and reduced opacity.

> **`personas.user_id` is UNIQUE** — there is exactly one persona per user. Uploading a new image must use an **upsert** (`INSERT OR REPLACE` / `ON CONFLICT DO UPDATE`), not a plain `INSERT`. A duplicate insert will raise a constraint violation.

### Config Keys

| Key | Default | Description |
|---|---|---|
| `chroma_color` | `#00FF00` | Overlay background color |
| `overlay_width` | `1920` | Overlay width |
| `overlay_height` | `1080` | Overlay height |
| `tts_enabled` | `true` | Enable TTS (used for pet lip-sync via tts-state events) |
| `twitch_channel` | `""` | Twitch channel to listen to |
| `twitch_bot_username` | `""` | Authenticated Twitch bot username |
| `twitch_bot_token` | `""` | Twitch OAuth token (format: `oauth:xxx`) |
| `twitch_client_id` | `""` | Twitch Client-ID (auto-saved by `validate_twitch_token`) |
| `twitch_bot_user_id` | `""` | Twitch broadcaster user ID (auto-saved by `validate_twitch_token`) |
| `twitch_eventsub_enabled` | `"false"` | Enable EventSub WebSocket client on connect |
| `twitch_chat_min_length` | `"0"` | Minimum chat message length (chars) |
| `twitch_chat_max_length` | `"500"` | Maximum chat message length (chars) |
| `twitch_chat_ignore_commands` | `"true"` | Ignore messages starting with `!` |
| `twitch_chat_ignore_users` | `"[]"` | JSON array of Twitch usernames to silently ignore |
| `twitch_chat_allowed_badges` | `"[]"` | JSON array of badge IDs to allowlist (empty = all badges allowed) |
| `twitch_chat_followers_only` | `"false"` | Only process followers |
| `twitch_chat_subs_only` | `"false"` | Only process subscribers |
| `twitch_event_cheer_enabled` | `"true"` | Enable cheer (bits) events |
| `twitch_event_cheer_min_bits` | `"100"` | Minimum bits to trigger cheer event |
| `twitch_event_sub_enabled` | `"true"` | Enable subscription events |
| `twitch_event_raid_enabled` | `"true"` | Enable raid events |
| `twitch_event_follow_enabled` | `"true"` | Enable follow events |
| `twitch_event_redemption_enabled` | `"true"` | Enable channel point redemption events |
| `twitch_redemption_action_map` | `"{}"` | JSON map of redemption ID → tama action ID |
| `twitch_event_hype_train_enabled` | `"true"` | Enable hype train events |
| `twitch_event_stream_status_enabled` | `"true"` | Enable online/offline events |
| `twitch_tts_event_announcements` | `"true"` | Announce events via TTS |
| `tiktok_username` | `""` | TikTok LIVE username |
| `tiktok_api_key` | `""` | TikTool API key |
| `tiktok_ws_endpoint` | `"wss://ws.eulerstream.com"` | TikTool WebSocket endpoint |
| `tiktok_chat_min_length` | `"0"` | Minimum chat message length |
| `tiktok_chat_max_length` | `"300"` | Maximum chat message length |
| `tiktok_chat_ignore_users` | `"[]"` | JSON array of TikTok usernames to silently ignore |
| `tiktok_event_gift_enabled` | `"true"` | Enable gift events |
| `tiktok_event_gift_min_coins` | `"10"` | Minimum diamond value to trigger gift |
| `tiktok_event_gift_big_coins` | `"100"` | Diamond threshold for "big gift" event kind |
| `tiktok_gift_action_map` | `"{}"` | JSON map of gift name → tama action ID |
| `tiktok_event_like_enabled` | `"true"` | Enable like events |
| `tiktok_event_like_throttle_ms` | `"4000"` | **Legacy** — per-user like throttle (kept for compatibility; superseded by `tiktok_event_like_user_cooldown_ms` in the event cooldown system) |
| `tiktok_event_follow_enabled` | `"true"` | Enable follow events |
| `tiktok_event_share_enabled` | `"true"` | Enable share events |
| `tiktok_event_subscribe_enabled` | `"true"` | Enable subscribe events |
| `tiktok_event_member_enabled` | `"false"` | Enable member join events |
| `tiktok_event_envelope_enabled` | `"true"` | Enable red envelope events |
| `tiktok_tts_event_announcements` | `"true"` | Announce events via TTS |
| `discord_bot_token` | `""` | Discord bot token |
| `discord_guild_id` | `""` | Discord server ID |
| `discord_channel_id` | `""` | Discord channel ID |
| `overlay_display_mode` | `"parallel"` | Overlay persona layout mode (`"parallel"` = all visible at once) |
| **Animation / Overlay display** | | |
| `animation_in` | `"bounce"` | Persona entry animation |
| `animation_out` | `"slide-up"` | Persona exit animation |
| `visible_duration_secs` | `"8"` | Seconds a persona stays on screen before exit animation |
| `idle_wiggle` | `"true"` | Enable idle wiggle animation |
| `idle_breathe` | `"false"` | Enable idle breathe animation |
| `glow_effect` | `"false"` | Enable glow filter on persona |
| `glow_color` | `"#00c896"` | Glow color (hex) |
| `outline_effect` | `"true"` | Enable outline filter on persona |
| `persona_size_px` | `"256"` | Persona sprite display size in pixels |
| `audio_threshold` | `"20"` | Audio level threshold for mouth open/close detection |
| `max_visible_personas` | `"4"` | Maximum simultaneous personas on overlay |
| `tama_enabled` | `"true"` | Enable/disable Tamagotchi pet system |
| `tama_pet_size_px` | `"80"` | Pet sprite size in pixels |
| `tama_floor_y` | `"900"` | Y pixel position of the pet floor |
| `tama_walk_speed` | `"0.6"` | Horizontal walk speed (px per frame) |
| `tama_inactivity_mins` | `"5"` | Minutes before a pet falls asleep |
| `tama_max_pets` | `"8"` | Maximum simultaneous pets on screen |
| `tama_action_check_secs` | `"8"` | Interval between random action rolls |
| `tama_action_probability` | `"0.15"` | Probability per interval of triggering a random action |
| `tama_enabled_actions` | `'["jump","popcorn","dance","fight","explode"]'` | JSON array of action IDs in the random pool |
| `tama_jump_on_speak` | `"false"` | When `"true"`, pets execute a `jump` action in place when their owner sends a chat message instead of walking to the center |
| `tama_guests_enabled` | `"false"` | Master toggle — enables guest viewer pets globally |
| `tama_guests_twitch` | `"true"` | Allow guest pets from Twitch (only effective when master is on) |
| `tama_guests_tiktok` | `"true"` | Allow guest pets from TikTok (only effective when master is on) |
| `tama_guests_tts` | `"false"` | Enable TTS for guest messages |
| `tama_guests_label_prefix` | `""` | Optional prefix prepended to the guest display name (e.g. `"[G] "`) |
| `tama_layout_mode` | `"dynamic"` | `"dynamic"` = pets walk freely; `"static"` = pets queue at a fixed anchor edge |
| `tama_static_anchor` | `"left"` | Which edge the queue starts from (`"left"` or `"right"`). Only used when `tama_layout_mode = "static"` |
| `tama_static_spacing_px` | `"100"` | Pixel gap between consecutive pet slots in static mode |
| **Anti-spam — Twitch chat** | | |
| `twitch_chat_antispam_preset` | `"off"` | Named preset: `off`, `light`, `normal`, `strict`, `lockdown`, `custom` |
| `twitch_chat_user_cooldown_ms` | `"0"` | Min ms between two messages from the same Twitch user (0 = disabled) |
| `twitch_chat_dedup_window_ms` | `"0"` | Suppress exact duplicate messages within this window in ms (0 = disabled) |
| `twitch_chat_rate_max_msgs` | `"0"` | Max messages per user within the rate window (0 = disabled) |
| `twitch_chat_rate_window_secs` | `"10"` | Sliding window size in seconds for per-user Twitch rate limit |
| **Anti-spam — TikTok chat** | | |
| `tiktok_chat_antispam_preset` | `"off"` | Named preset: same options as Twitch |
| `tiktok_chat_user_cooldown_ms` | `"0"` | Min ms between two messages from the same TikTok user |
| `tiktok_chat_dedup_window_ms` | `"0"` | Duplicate suppression window in ms |
| `tiktok_chat_rate_max_msgs` | `"0"` | Max messages per user within the rate window |
| `tiktok_chat_rate_window_secs` | `"10"` | Sliding window size in seconds for per-user TikTok rate limit |
| **Anti-spam — Global throughput** | | |
| `chat_global_throughput_preset` | `"off"` | Named preset controlling global cap |
| `chat_global_rate_max_per_sec` | `"0"` | Max total chat messages per second across all platforms (0 = disabled) |
| **Event cooldowns — Twitch** | | |
| `twitch_event_cooldown_preset` | `"off"` | Named preset for Twitch event cooldowns |
| `twitch_event_cheer_user_cooldown_ms` | `"0"` | Min ms between cheer events from the same user |
| `twitch_event_sub_user_cooldown_ms` | `"0"` | Min ms between sub events from the same user |
| `twitch_event_raid_global_cooldown_ms` | `"0"` | Global cooldown between any two raid events (keyed on `""` not user) |
| `twitch_event_follow_user_cooldown_ms` | `"0"` | Min ms between follow events from the same user |
| **Event cooldowns — TikTok** | | |
| `tiktok_event_cooldown_preset` | `"off"` | Named preset for TikTok event cooldowns |
| `tiktok_event_gift_user_cooldown_ms` | `"0"` | Min ms between gift events from the same user |
| `tiktok_event_like_user_cooldown_ms` | `"0"` | Min ms between like events from the same user |
| `tiktok_event_follow_user_cooldown_ms` | `"0"` | Min ms between follow events from the same user |
| `tiktok_event_share_user_cooldown_ms` | `"0"` | Min ms between share events from the same user |
| `tiktok_event_subscribe_user_cooldown_ms` | `"0"` | Min ms between subscribe events from the same user |
| `tiktok_event_envelope_user_cooldown_ms` | `"0"` | Min ms between envelope events from the same user |

> **Important:** The bot token and API keys are stored in the local SQLite `config` table. Never hardcode them in source code or plain-text files.
>
> **Boolean Config Parsing:** All config values are stored as strings. Do NOT use `Boolean(value)` — `Boolean("false") === true`. Always use `String(value) === "true"` for explicit comparison. The same applies when reading booleans emitted in Tauri events from Rust (they arrive as `"true"`/`"false"` strings).

### Migrations

Migrations are inline in `db/migrations.rs` via `run_migrations(&conn)`. They use `CREATE TABLE IF NOT EXISTS` — they are idempotent. To add columns, use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` or add a new sequential migration.

---

## 6. AppState (Rust)

```rust
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,                         // std::sync::Mutex (NOT tokio::sync::Mutex)
    pub config_cache: Arc<RwLock<AppConfig>>,               // std::sync::RwLock
    pub app_data_dir: Arc<PathBuf>,
    pub discord_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    pub twitch_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    pub twitch_eventsub_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    pub tiktok_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    pub ws_tx: broadcast::Sender<String>,                   // tokio broadcast — fan-out to WS clients
    pub server_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    pub chat_filters: Arc<Mutex<ChatFilters>>,              // std::sync::Mutex — anti-spam state
}
```

- **`AppState` is `Clone`** — clone it freely to pass to tokio tasks.
- **`db` uses `std::sync::Mutex`** (not `tokio::sync::Mutex` and not `RwLock`). Lock with `state.db.lock().map_err(map_err)?`. Do not `.await` it — it is synchronous.
- **Do not create additional connections.** All DB access goes through this single `Arc<Mutex<Connection>>`.
- **`config_cache` uses `std::sync::RwLock`** — this is intentional so it can be written in `setup()` before the Tokio runtime starts. Use `.read().map_err(...)` / `.write().map_err(...)`.
- **`chat_filters` uses `std::sync::Mutex`** — holds `ChatFilters` (per-user cooldown, dedup, rate window, global cap, event cooldowns). Lock order is always: `config_cache` read lock → `chat_filters` mutex. **Never reverse this order** to avoid deadlock. Accept `&AppConfig` in `check_chat` / `check_event` so the config lock is already held before acquiring `chat_filters`.
- **`ws_tx`** is a `tokio::sync::broadcast::Sender<String>`. Call `state.broadcast_ws(event, &payload)` every time you call `app.emit(event, &payload)` so the OBS Browser Source receives the same data. It's safe to ignore if there are no receivers.
- Background tasks can be safely aborted via `state.abort_discord()`, `abort_twitch()`, `abort_twitch_eventsub()`, `abort_tiktok()`, `abort_server()`, `abort_all()`.
- Always update `config_cache` after every `set_config_value` call. The `set_config_cmd` command does this for individual keys.

---

## 7. Tauri Commands (Internal API)

All commands are registered in `lib.rs` via `tauri::generate_handler![]`.

### Users (`commands/users.rs`)

| Command | TS Signature | Description |
|---|---|---|
| `get_users` | `invoke<User[]>("get_users")` | List all users with their persona |
| `get_user` | `invoke<User>("get_user", { id })` | Single user by ID |
| `update_user_cmd` | `invoke("update_user_cmd", { id, twitch_username, tiktok_username, display_name, voice_id })` | Edit user data |
| `delete_user_cmd` | `invoke("delete_user_cmd", { id })` | Delete user and persona |
| `toggle_user_active_cmd` | `invoke("toggle_user_active_cmd", { id })` | Enable / disable user |
| `get_recent_logs_cmd` | `invoke<LogEntry[]>("get_recent_logs_cmd", { limit? })` | Recent chat logs |

### Config (`commands/config.rs`)

| Command | TS Signature | Description |
|---|---|---|
| `get_config_cmd` | `invoke<AppConfig>("get_config_cmd")` | Full config |
| `set_config_cmd` | `invoke("set_config_cmd", { key, value })` | Save a single key-value pair |
| `get_available_voices_cmd` | `invoke<VoiceInfo[]>("get_available_voices_cmd")` | System TTS voices |
| `set_chroma_color` | `invoke("set_chroma_color", { color })` | Update color and emit `chroma-color-changed` |
| `save_animation_config` | `invoke("save_animation_config", { animation_in, animation_out, visible_duration_secs, idle_wiggle, idle_breathe, glow_effect, glow_color, outline_effect, persona_size_px, audio_threshold, max_visible_personas })` | Persist all animation fields at once and emit `animation-config-changed` |
| `disconnect_twitch` | `invoke("disconnect_twitch")` | Abort Twitch IRC + EventSub clients |
| `disconnect_tiktok` | `invoke("disconnect_tiktok")` | Abort TikTok WS client |

### Tamagotchi (`commands/tamagotchi.rs`)

| Command | TS Signature | Description |
|---|---|---|
| `tama_trigger_action` | `invoke("tama_trigger_action", { user_id, action_id, input })` | Emit `tama-action` event to overlay so PetManager forwards it to the target pet |
| `tama_set_enabled` | `invoke("tama_set_enabled", { enabled })` | Persist `tama_enabled` config key |
| `tama_get_pet_states` | `invoke<PetStateRow[]>("tama_get_pet_states")` | Return all active pet rows joined with display_name from users |
| `tama_upsert_pet_state` | `invoke("tama_upsert_pet_state", { user_id, display_name, floor_x, is_sleeping })` | Sync pet position/state to DB (called by overlay on spawn and state change) |
| `tama_remove_pet_state` | `invoke("tama_remove_pet_state", { user_id })` | Delete pet row from DB (called by overlay on despawn) |

### Control (`commands/control.rs`)

| Command | TS Signature | Description |
|---|---|---|
| `restart_discord_bot` | `invoke("restart_discord_bot")` | Re-spawn the Discord bot |
| `connect_twitch` | `invoke("connect_twitch", { channel })` | Save channel and reconnect IRC + EventSub clients |
| `validate_twitch_token` | `invoke<{ username: string, scopes: string[] }>("validate_twitch_token", { token })` | Validates OAuth token against Twitch API. Returns `{ username, scopes }`. Saves `twitch_bot_token`, `twitch_bot_username`, `twitch_client_id`, `twitch_bot_user_id` to DB. |
| `connect_tiktok` | `invoke("connect_tiktok", { username })` | Save username and reconnect WS |
| `toggle_overlay` | `invoke("toggle_overlay")` | Show / hide the overlay window |
| `send_test_message` | `invoke("send_test_message", { display_name, mouth_open_path, mouth_closed_path })` | Emit a test `chat-message` to spawn a test pet |

---

## 8. Tauri Events

### Rust → Frontend

All events marked **WS** are also broadcast to OBS Browser Source clients via `state.broadcast_ws()`.

| Event | Payload | Emitter | Tauri Listener | WS |
|---|---|---|---|---|
| `chat-message` | `ChatMessagePayload` | `twitch/`, `tiktok/`, `control.rs` (test) | `PetManager` (overlay.ts) | Yes |
| `chat-event` | `ChatEventPayload` | `twitch/eventsub.rs`, `tiktok/mod.rs` | `eventReactions.ts` (overlay.ts) | Yes |
| `animation-config-changed` | `AppConfig` (full) | `commands/config.rs` (`save_animation_config`) | overlay — reload animation params | No |
| `tama-config-changed` | `AppConfig` (full) | `commands/config.rs` (`set_config_cmd` when key starts with `tama_`) | `PetManager._onTamaConfigChanged` — applies all tama settings live | Yes |
| `tts-state` | `TtsStatePayload` | `tts/mod.rs` | `PetManager` (lip-sync + returnToFloor) | Yes |
| `chroma-color-changed` | `string` (hex color) | `commands/config.rs` | `overlay.ts` | Yes |
| `overlay-will-show` | `()` | `commands/control.rs` | `overlay.ts` (fade cover reset) | Yes |
| `tama-action` | `{ user_id, action_id, input }` | `commands/tamagotchi.rs` | `PetManager` (overlay.ts) | Yes |
| `twitch-connected` | `string` (channel) | `twitch/mod.rs` (on RoomState) | `main.ts` | No |
| `twitch-error` | `string` (error msg) | `twitch/mod.rs` | `main.ts` | No |
| `tiktok-connected` | `string` (username) | `commands/control.rs` | `main.ts` | No |
| `discord-ready` | `string` (bot username) | `discord/mod.rs` | `main.ts` | No |
| `discord-error` | `string` (error msg) | `discord/mod.rs` | `main.ts` | No |

> **Rule:** Every time you add a new event that the overlay reacts to, you must also call `state.broadcast_ws(event, &payload)` right after `app.emit(event, &payload)` so the OBS Browser Source receives it.

### `ChatMessagePayload`

```typescript
interface ChatMessagePayload {
  platform: string;         // "twitch" | "tiktok" | "test"
  username: string;         // Platform username
  message: string;          // Message text
  user_id: number;          // DB ID (i64 in Rust, number in TS — 0 for test messages)
  display_name: string;     // Pet name label
  mouth_open_path: string;  // Absolute OS filesystem path
  mouth_closed_path: string;
  voice_id: string;
}
```

### `ChatEventPayload`

```typescript
interface ChatEventPayload {
  platform: string;       // "twitch" | "tiktok"
  event_kind: string;     // "cheer" | "sub" | "raid" | "follow" | "tiktok_gift" | "tiktok_gift_big" | "tiktok_like" | "tiktok_follow" | "tiktok_share" | "tiktok_subscribe" | "tiktok_envelope"
  username: string;
  user_id: number | null; // null if user not in DB
  display_name: string;
  amount: number | null;  // bits for cheer, viewers for raid, diamonds for gift
  text: string | null;    // cheer message
  extra: Record<string, unknown>;
}
```

> `eventReactions.ts` maps `event_kind` to a tama action via `ACTION_MAP` and calls `pet.executeAction()`. Raid and hype_train fire on a random pet regardless of user_id.

### `TtsStatePayload`

```typescript
interface TtsStatePayload {
  user_id: number;   // Matches ChatMessagePayload.user_id
  speaking: boolean; // true = TTS started, false = TTS finished
}
```

> **Important:** `mouth_open_path` / `mouth_closed_path` are absolute OS paths. To use them as `<img>` `src` in the frontend, you **must** convert them using `convertFileSrc(path)` from `@tauri-apps/api/core`. This transforms the path into Tauri's `asset://localhost/` protocol.

---

## 9. Frontend — Patterns and Conventions

### Icons

All icons used in the admin panel come from `src/icons.ts`. **Never import `simple-icons` directly in a view file.**

```typescript
import { Icons } from "../icons";

// Brand icons (colored — use in cards and labels):
Icons.twitch(18)     // Twitch logo, brand color #9146ff
Icons.tiktok(18)     // TikTok logo, brand color
Icons.discord(18)    // Discord logo, brand color

// Brand icons (monochrome — use in nav where active/hover color must inherit):
Icons.twitchMono(16)
Icons.tiktokMono(16)

// UI icons — stroke-based (lucide), inherit currentColor:
Icons.settings(20)   Icons.users(20)   Icons.person(16)
Icons.logs(20)       Icons.warning(48) Icons.pencil()
Icons.pause()        Icons.trash()     Icons.refresh()

// UI icons — fill-based (lucide), inherit currentColor:
Icons.paw(20)        Icons.play()
```

All functions accept an optional `size` parameter (px). Default sizes are set per icon type (16 for nav/inline, 14 for button icons). Nav icons are injected by `injectNavIcons()` called from `main.ts` — HTML uses `<span class="nav-icon" data-icon="twitch"></span>` and is never hardcoded with emoji.

Do **not** use emoji or Unicode symbol characters (⚙ 👤 📋 ▶ ✕ etc.) in the admin panel. Use `Icons.*` instead.

---

### Slider inputs for millisecond/numeric config

Use `sRow()` (defined locally inside each render function) instead of `<input type="number">` for ms/numeric config values. The pattern:

```typescript
const msLabel = (ms: number) => ms === 0 ? "Desactivado" : `${ms / 1000}s`;
const sRow = (id, value, min, max, step, label, fmt) =>
  `<div class="form-group" style="gap:4px;">
     <div style="display:flex;justify-content:space-between;align-items:center;">
       <label style="margin:0;">${label}</label>
       <span id="${id}-val" ...>${fmt(value)}</span>
     </div>
     <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" style="width:100%;margin-top:4px;"/>
   </div>`;
```

After rendering, call `syncSlider(id, fmt)` for every slider to set the initial fill. On every `input` event, call `syncSlider` to update label + fill. `syncSlider` sets `--slider-fill` as a CSS custom property on the element — `forms.css` reads it via a `linear-gradient` background to colour the track left of the thumb.

```typescript
function syncSlider(id: string, fmt: (v: number) => string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const lbl = document.getElementById(`${id}-val`);
  if (!el) return;
  if (lbl) lbl.textContent = fmt(Number(el.value));
  const pct = ((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100;
  el.style.setProperty("--slider-fill", `${pct}%`);
}
```

---

### `<details>` / `<summary>` toggle button

Use `<summary class="details-toggle">` for all collapsible "Avanzado" sections. Never use inline styles on `<summary>`. The `.details-toggle` class (defined in `buttons.css`) renders it as a secondary button with a rotating triangle indicator.

---

### Connecting to Twitch — async result via events

`invoke("connect_twitch", { channel })` returns immediately (`Ok(())`). The actual IRC connection result arrives as a Tauri event. After invoking, race three promises with a 10 s timeout:

```typescript
import { once } from "@tauri-apps/api/event";

const timeout   = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error("Tiempo de espera agotado")), 10000)
);
const connected = new Promise<void>(resolve => once("twitch-connected", () => resolve()));
const error     = new Promise<never>((_, reject) =>
  once<string>("twitch-error", e => reject(new Error(e.payload)))
);
await Promise.race([connected, error, timeout]);
```

Disable the connect button and show "Conectando…" while waiting; re-enable in `finally`. Do NOT show a success toast in the frontend — the global `main.ts` listener already does it when `twitch-connected` fires.

---

### Section titles (`.section-title`)

`.section-title` renders at **20 px / bold / `var(--color-text)`**. Do not revert to uppercase + muted color — that pattern was removed for readability.

---

### ViewRouter

The router in `router.ts` is manual, hash-based (`#/config`, `#/users`, etc.).

```typescript
export type ViewId = "config" | "users" | "logs" | "tamagotchi" | "twitch" | "tiktok";
```

- To add a new view: add an entry in `routes`, create the file under `src/views/`, and add `data-view="new-view"` to the sidebar in `index.html`.
- Each view exports a function `render<Name>(): Promise<void>` that writes into `#view-container`.

> **Note:** `src/views/overlay.ts` is NOT a panel view — it runs in the `overlay` window (`overlay.html`) and is never loaded by the router.

### AppState (Frontend Singleton)

```typescript
import { AppState } from "./state";

await AppState.loadConfig();         // Cache AppConfig
await AppState.loadUsers();          // Cache User[]
await AppState.loadVoices();         // Cache VoiceInfo[]
await AppState.setConfig(key, value); // Save and reload cache
```

- Always reload fresh state with `load*()` methods when entering a view.
- Use `showToast(message, "success" | "error" | "info")` for notifications.

### Overlay Window (`src/views/overlay.ts`)

- Runs in `overlay.html` (separate window, not loaded by the router).
- Sets the chroma-key background color from config.
- Manages the fade-cover mechanism: `#fade-cover` starts opaque black. `resetAndTriggerFade()` is called on init and on every `overlay-will-show` event to prevent chroma flashbang when the window opens.
- Calls `PetManager.init(tamagotchiContainer)` — PetManager then registers its own listeners for `chat-message`, `tts-state`, and `tama-action` internally.
- Listens to `chroma-color-changed` to update the background color live.

---

## 10. Rust Modules — Responsibilities

### `chat_filters/`

- `ChatFilters` is a plain `struct` with `#[derive(Default)]` — no async, no `Arc` inside.
- **`check_chat(platform, user, text, cfg)`** applies four filters in order: global throughput cap → per-user cooldown → duplicate suppression (case-insensitive, whitespace-normalised) → sliding-window rate limit. Returns `FilterDecision::Allow` or `FilterDecision::Drop(DropReason)`.
- **`check_event(platform, user, event_kind, cfg)`** applies a per-event cooldown keyed on `(platform, user, event_kind)`. Raids use `""` as user to share a single global cooldown slot.
- **Call site pattern**: read `config_cache` first, then lock `chat_filters`, call `check_*`, release both. If `Drop(reason)` → call `log_message_dropped()` and skip emit. If `Allow` → proceed with DB lookup and emit.
- All timekeeping uses `std::time::Instant` — no allocations, no OS timer overhead.

### `discord/`

- `spawn_discord_bot(state)`: reads `discord_bot_token` from DB. If empty, returns immediately (no panic).
- Registers `poise` commands globally in the framework setup.
- Slash commands in `commands/persona.rs`: `set_username`, `upload_open`, `upload_closed`, `preview`, `remove`.
- Images downloaded from Discord are saved to `{app_data_dir}/personas/{discord_id}/mouth_open.png` and `mouth_closed.png`. These images are used as pet sprites by the Tamagotchi system.
- **Image upload validation checklist** (must be enforced before saving):
  1. MIME type must be `image/png` or `image/jpeg`
  2. File size ≤ 2 MB
  3. Minimum source dimensions must be validated (reject tiny/corrupt images)
  4. Resize to **512×512 PNG** with transparency using the `image` crate (using `Lanczos3` filter for high-quality downscaling, avoiding `Nearest` which causes pixelation).
- Persona images use an **upsert** pattern — see Section 5 (personas UNIQUE FK note).

### `twitch/`

- `spawn_twitch_client(state, app_handle)`: connects via `twitch-irc` to the configured channel.
- Uses **authenticated** connection if `twitch_bot_username` and `twitch_bot_token` are set (required to receive messages when the stream is offline). If empty, falls back to an anonymous connection (only works when the channel is live).
- `validate_twitch_token` calls `id.twitch.tv/oauth2/validate`, saves `twitch_bot_token`, `twitch_bot_username`, `twitch_client_id`, and `twitch_bot_user_id` to the DB. Returns `{ username, scopes }` to the frontend.
- For each incoming IRC message: looks up in DB whether the `twitch_username` is registered and active.
- Emits `twitch-connected` to the frontend only upon receiving a successful `RoomState` from the server.
- On match: emits `chat-message` to the frontend with the `ChatMessagePayload`.
- Logs the message in `message_log`.

**EventSub (`twitch/eventsub.rs`)**
- `spawn_twitch_eventsub(state, app_handle)`: spawned alongside the IRC client by `connect_twitch`. Skips immediately if `twitch_eventsub_enabled = false` or if `twitch_client_id` / `twitch_bot_user_id` are empty (must validate token first).
- Connects to `wss://eventsub.wss.twitch.tv/ws`.
- On `session_welcome`: calls `register_subscriptions()` which POSTs to `https://api.twitch.tv/helix/eventsub/subscriptions` for each event type (`channel.cheer`, `channel.subscribe`, `channel.raid`, `channel.follow`).
- Required OAuth scopes: `bits:read`, `channel:read:subscriptions`, `channel:read:raids`, `moderator:read:followers`.
- On `notification`: calls `handle_twitch_event()` which emits `chat-event` + `broadcast_ws` using `ChatEventPayload`.

### `tiktok/`

- `spawn_tiktok_client(state, app_handle)`: connects via WebSocket to `wss://ws.tiktok.eulerstream.com/chat?uniqueId={username}`.
- If `tiktok_username` is empty, returns without connecting.
- Handles multiple event types with per-event config gates:
  - `chat` → user lookup → emit `chat-message` (with min/max length filter + TTS)
  - `gift` → emit `chat-event` with `event_kind: "tiktok_gift"` or `"tiktok_gift_big"` (only when `repeatEnd = true`)
  - `like` → emit `chat-event` with `event_kind: "tiktok_like"`
  - `social` → emit `chat-event` with `event_kind: "tiktok_follow"` or `"tiktok_share"` (based on `displayType`)
  - `subscribe` → emit `chat-event` with `event_kind: "tiktok_subscribe"`
  - `envelope` → emit `chat-event` with `event_kind: "tiktok_envelope"`
- All non-chat events also call `state.broadcast_ws("chat-event", &payload)`.
- **Risk:** TikTool's free sandbox is limited (50 req/day, 1 WS connection). Production requires a paid plan (~$7/week).
- **Local dev/testing:** When TikTool is unavailable, simulate chat events with a local WebSocket mock server that emits the same JSON structure as TikTool's `chat` events.

### `server/`

- `start_server(app_state, dist_dir, dev_mode)`: spawns an axum HTTP server on `127.0.0.1:6767`.
- Routes: `GET /overlay` (serves `overlay-browser.html`), `GET /assets/*` (Vite-compiled JS/CSS), `GET /persona?path=` (pet sprite images from OS filesystem, path-traversal-protected), `GET /ws` (WebSocket).
- **Dev mode** (`dev_mode = true`): reads `overlay-browser.html` from the project root (not `dist/`) and rewrites `/src/*` references to `http://localhost:1420/src/*` so assets are served by the Vite dev server. Enabled automatically when compiled in debug mode (`cfg(debug_assertions)`).
- **Production mode**: reads all files from `dist/` (Vite build output bundled alongside the binary).
- The WebSocket handler subscribes to `AppState.ws_tx` and forwards broadcast messages to each connected client. It also receives commands from the browser overlay (`get_config_cmd`, `tama_upsert_pet_state`, `tama_remove_pet_state`) and executes them against the DB.
- **Security:** `/persona` canonicalizes both the requested path and `app_data_dir` before calling `starts_with` — this handles the Windows `\\?\` extended-path prefix and prevents path traversal.

### `tts/`

- Wrapper over the `tts` crate abstracting SAPI (Windows), NSSpeechSynthesizer (macOS), and espeak (Linux).
- `speak_with_events(text, voice_id, user_id, app_handle, ws_tx)` emits `tts-state { user_id, speaking: true }` before speaking and `speaking: false` after finishing. Also broadcasts both events via `ws_tx` so the OBS Browser Source overlay receives lip-sync events.
- TTS events are consumed by `PetManager._onTtsState()` to drive pet lip-sync and trigger `returnToFloor()`.
- TTS may not be available in all environments — handle errors with `tracing::warn!` without propagating panics.

### `db/`

- All SQLite interaction goes through functions in `db/users.rs` and `db/config.rs`.
- **Do not run raw SQL inside Tauri commands.** Use the `db` module functions.
- Migrations are idempotent (`IF NOT EXISTS`).

---

## 11. Development Commands

```bash
# Dev (panel + Rust together)
npm run tauri dev

# Frontend only (no Rust, for iterating UI)
npm run dev

# Production build (outputs installer + binary)
npm run tauri build
# Windows --> .msi / NSIS installer in src-tauri/target/release/bundle/
# macOS   --> .dmg / .app in src-tauri/target/release/bundle/

# Compile Rust only
cd src-tauri && cargo build

# Type-check TypeScript
npx tsc --noEmit

# Verbose Rust logs in dev
RUST_LOG=debug npm run tauri dev
```

> The Vite dev server port is **1420** (configured in `tauri.conf.json > build.devUrl`).

### Simulating TikTok Events Locally

TikTool requires an internet connection and an API key. For offline TikTok development, run a local WebSocket server that mimics TikTool's `chat` JSON format and point `tiktok_username` to a dummy value so the client connects to `ws://localhost:{port}` instead. The event shape expected is:

```json
{ "event": "chat", "data": { "uniqueId": "username", "comment": "message text" } }
```

---

## 12. Rules and Restrictions for Agents

1. **Do not break the `ViewRouter` pattern**: every panel view goes in `src/views/`, exports `render<Name>()`, and is registered in `router.ts`. Exception: `src/views/overlay.ts` is the overlay entry point and is not a router view.
2. **Do not add CSS frameworks** (Tailwind, Bootstrap, etc.) without explicit user approval. The project uses vanilla CSS.
3. **Do not create additional DB connections** — all DB access goes through `AppState.db: Arc<Mutex<Connection>>`.
4. **Do not use `unwrap()`** in production Rust code. Use `?` with `anyhow::Result` or map errors to `CmdResult<T>` via `map_err`.
5. **Do not store tokens/secrets in source code.** Tokens go in the `config` SQLite table.
6. **Add `#[tauri::command]` to every new command** and register it in `lib.rs → tauri::generate_handler![]`.
7. **Emit `tracing::info!` / `tracing::warn!` / `tracing::error!`** for important operations — do not use `println!`.
8. **For images in the overlay:** always use `convertFileSrc(path)` before assigning to `img.src` so Tauri can serve the local file via the asset protocol.
9. **The Discord bot and chat clients are tolerant of empty config** — if the token/channel/username is empty, they return without error.
10. **TikTok LIVE** has no official public API. The current integration depends on the external TikTool service (`wss://api.tik.tools`). If the service fails, the module must handle the error and retry with backoff — never crash the process.
11. **NEVER use box-drawing characters** (`─`, `│`, `├`, `└`, `┌`, `┐`, `┘`, `┤`, `┬`, `┴`, `┼`, etc.) in code comments or section headers in new code you write. These characters are invisible or corrupt on many terminals and editors. The only allowed section-separator style in TypeScript/Rust source files is:
    ```typescript
    // =========================================================================================================
    // Section Name
    // =========================================================================================================
    ```
    Violating this rule **will require a fix** before the code is accepted.
12. **Overlay Lifecycle**: Do not destroy the overlay window from user-facing code. `lib.rs` intercepts `CloseRequested` and calls `hide()` instead. When showing the overlay, `toggle_overlay` emits `overlay-will-show` and delays 120ms so `overlay.ts` can set a black fade-cover to prevent bright chroma-key flashes. App exit is handled by detecting `RunEvent::WindowEvent { label: "main", Destroyed }` in the `.run()` callback, which calls `abort_all()` and `app_handle.exit(0)`.
13. **Motion v12 — use CSS transform strings**: Do NOT use shorthand properties (`x`, `y`, `scale`, `rotate`, etc.) as keyframe keys when calling `animate()` on an `HTMLElement`. Use CSS `transform` strings instead (see Section 3 for details). Opacity and filter properties work fine as shorthands.
14. **Boolean Config Parsing**: SQLite config values are retrieved as strings. Do not use `Boolean(value)` since `Boolean("false") === true`. Use explicit string comparison: `String(value) === "true"`.

---

## 13. Complete Data Flow

### User Registration (Discord)

```
User runs /persona upload-open [image]
  --> Bot validates: PNG/JPG, <=2MB
  --> Downloads image --> resizes to 512x512 --> saves as PNG
  --> Path: {app_data_dir}/personas/{discord_id}/mouth_open.png
  --> Inserts/updates personas table in SQLite
  --> Responds with a confirmation embed

User runs /persona set-username twitch:myuser tiktok:myuser2
  --> Updates users table (twitch_username, tiktok_username)
  --> Bot confirms
```

### Stream Message --> Tamagotchi Pet

```
Twitch/TikTok chat: message from "myuser"
  --> Rust looks up DB: users JOIN personas WHERE twitch_username = 'myuser' AND is_active = 1
  --> On match: builds ChatMessagePayload
  --> app_handle.emit("chat-message", payload)  -->  WebView "overlay"
  --> PetManager._onChatMessage():
      --> If pet does not exist: BasePet constructed at floorY, spawn() animation
      --> if tama_jump_on_speak=true: pet.executeAction("jump") in place, done
      --> else: pet.onChatMessage() --> FSM "approaching" --> pet walks to center (floor level, 200 px/s)
      --> FSM "talking"
  --> (parallel) TTS reads the message
      --> tts-state { speaking: true }  --> pet opens mouth
      --> tts-state { speaking: false } --> pet closes mouth, returnFromFocus()
      --> FSM "returning" --> pet walks back to originX at 200 px/s --> "idle", idle-walk resumes
```

---

## 14. Security Considerations

- `tauri.conf.json` has `"csp": null` in development. **Before production**, configure a restrictive CSP.
- Discord and TikTool tokens are stored in SQLite in `app_data_dir`. Consider migrating to the `keyring` crate (OS Credential Manager) for stronger security.
- Persona images come from Discord — validate MIME type and size before saving.
- The overlay window is a **normal window** — it must NOT use `skipTaskbar`, `alwaysOnTop`, or `decorations: false`. It is captured by OBS via Window Capture, not rendered on top of the OS desktop.

---

## 15. Tamagotchi Pet System

Persistent chat-user pets that walk along the bottom of the overlay window. Each registered viewer who sends a chat message spawns a small pet (their persona images). Pets idle-walk across the floor, react to chat events, execute random or admin-triggered actions, sleep after inactivity, and eventually despawn.

### Architecture

```
overlay.ts
  --> PetManager.init(container)  (static singleton, src/overlay/tamagotchi/core/)
        |
        +-- listen("chat-message")  --> _onChatMessage  --> spawn / wake BasePet
        +-- listen("tts-state")     --> _onTtsState     --> lip-sync mouth + returnToFloor
        +-- listen("tama-action")   --> _onTamaAction   --> pet.executeAction()
        |
        +-- PetScheduler  (random action roll every 8 s at 15% probability)
        +-- PetFloor      (floor Y + collision-free spawn X)

  --> setupEventReactions()  (src/overlay/tamagotchi/eventReactions.ts)
        |
        +-- listen("chat-event")  --> ACTION_MAP[event_kind] --> pet.executeAction()
              raid / hype_train   --> PetManager.getRandomPet(-1).executeAction("jump")
              other events        --> PetManager.get(user_id).executeAction(ACTION_MAP[event_kind])
```

### Core modules (`src/overlay/tamagotchi/core/`)

| File | Role |
|---|---|
| `PetStateMachine.ts` | FSM with transition(), onEnter(), canDo(). Valid states: spawning → idle ↔ approaching → talking → returning ↔ approaching (re-focus), returning → idle, idle → action → idle, idle → sleeping → despawning |
| `BaseAction.ts` | Abstract base for all actions. Uses `import type { BasePet }` (avoids circular dep). Provides `wait(ms)`, `cancelled` flag, `onCancel()` hook |
| `ActionRegistry.ts` | Static singleton. Actions self-register at module load via `ActionRegistry.register(MyAction)`. Exposes `get()`, `getAllMeta()`, `getRandomId()` (weighted by `probability`) |
| `PetFloor.ts` | Manages the floor Y and per-pet X position slots with collision avoidance (20-attempt fallback) — used in `"dynamic"` layout mode |
| `StaticFloor.ts` | Queue-based slot system for `"static"` layout mode. Assigns incrementing slot indices from a left/right anchor; slots are never compacted on release |
| `BasePet.ts` | Concrete pet class. Manages DOM, FSM transitions, idle-walk loop (delta-time, `walkSpeedBase = 36` static mutable; each pet gets a random multiplier 0.6×–1.5× at construction), mouth images, focus approach/return (`FOCUS_SPEED_PX_PER_S = 200`, stays on floor, returns to `originX`), sleep, despawn, and DB persistence via `tama_upsert_pet_state` / `tama_remove_pet_state`. The idle-walk loop uses a decision timer (1–8 s) that randomly pauses the pet, changes direction, or continues walking. Boundary hits clamp `pos.x` and flip direction. `resumeIdleWalk()` restarts the idle RAF loop without FSM re-entry (used by `FightAction`). `markTtsFinished()` handles the TTS-before-arrival race. `updateSize(px)` and `updateWalkSpeed(base)` apply runtime config changes to existing pets. `BasePet.walkSpeedBase` and `BasePet.inactivityMs` are static mutable — changing them affects all pets from the next cycle onward. |
| `PetScheduler.ts` | `setInterval` at `tama_action_check_secs`. Rolls a random action for a random idle pet; excludes `"idle_walk"` and `"sleep"` from the pool. `enabledActionIds` further restricts the pool to the actions listed in `tama_enabled_actions`. `update(checkSecs, probability, enabledActions?)` restarts the interval with new parameters. |
| `PetManager.ts` | Static singleton. Owns the `Map<userId, BasePet>`. Bootstraps PetFloor + PetScheduler. Routes events to pets. `_onTamaConfigChanged()` handles `tama-config-changed` events and applies all settings live: enabled, maxPets, petSizePx (resizes existing pets), walkSpeed, inactivityMs, scheduler interval/probability/pool. |

### Actions (`src/overlay/tamagotchi/actions/`)

Each action file calls `ActionRegistry.register(MyAction)` at the bottom — importing the file triggers registration (side-effect import pattern).

| Action ID | Class | Description |
|---|---|---|
| `idle_walk` | `IdleWalkAction` | No-op placeholder; excluded from random pool |
| `jump` | `JumpAction` | Squash-and-stretch jump loop |
| `popcorn` | `PopcornAction` | Pet holds a popcorn bucket and watches chat |
| `fight` | `FightAction` | Two pets charge toward each other, shake, show a fight cloud, bounce away. **Blocked in static layout mode** (guard at start of `execute()`). Cloud is positioned at `top: floorY - 80px` (NOT `bottom`). After all WAAPI animations complete, `el.style.transform` is explicitly cleared on both pets to prevent residual translateX from desynchronising `pos.x` and visual position. Rival's idle walk is restarted via `rival.resumeIdleWalk()` (FSM re-entry is not possible since rival never left "idle"). |
| `explode` | `ExplodeAction` | Tremor, flash, particle burst, then respawn with spring |
| `dance` | `DanceAction` | Rhythmic rotate + translateY loop |
| `sleep` | `SleepAction` | Pet tilts + ZZZ props; cancelled on next chat message |
| `confetti` | `ConfettiAction` | 10 colored DOM particles burst from pet position; probability 0 (event-triggered only) |
| `hype_train` | `HypeTrainAction` | 🚂 emoji text scrolls across the floor from left to right; probability 0 (event-triggered only). **Blocked in static layout mode** (guard at start of `execute()`). |

To add a new action, copy `_template.ts`, implement `execute()`, set `meta.id` and `meta.probability`, and call `ActionRegistry.register()` at the bottom. Import the file in `PetManager.ts` to activate it.

### Props (`src/overlay/tamagotchi/props/`)

- **`PropRenderer`** — creates and animates DOM prop elements (ZZZ bubbles, speech bubbles, etc.). Constructor takes no arguments; `parentEl` is passed to each method.
- **`PropAssetLoader`** — static blob-URL cache for external asset URLs.

### Pet lifecycle

```
chat-message (new user)
  --> BasePet constructed  (DOM element placed at floorY, initial X from PetFloor)
  --> pet.spawn()          (pop-in animation, then FSM → "idle")
  --> if jumpOnSpeak: pet.executeAction("jump") in place, done
  --> else: pet.onChatMessage()
        --> saves originX = pos.x
        --> FSM → "approaching" → walks to center at floor level (200 px/s)
        --> FSM → "talking"
  --> tts-state speaking=false
  --> pet.returnFromFocus()  (FSM → "returning" → walks back to originX at 200 px/s → "idle", idle-walk resumes)

note: if tts-state speaking=false arrives while still approaching,
      pet.markTtsFinished() sets pendingReturn=true; _doApproach() triggers
      returnFromFocus() immediately upon arrival instead of entering "talking".

5 min inactivity
  --> FSM → "sleeping"  (PropRenderer shows ZZZ, DB persists is_sleeping=true)
  --> 30 s later: FSM → "despawning"  (fade-out, el.remove(), DB row deleted)

chat-message (returning user while sleeping)
  --> _resetInactivityTimer(), onChatMessage() wakes the pet
```

### Admin panel (`src/views/tamagotchi.ts`)

**Layout & Components:**
- **Header** — Tamagotchi title with system ON/OFF toggle (teal accent, status text)
- **Config card** — 2-column grid of custom-styled range sliders (pet size, max visible, walk speed, inactivity, action interval, probability)
  - Each slider has `.tama-slider-item` with label + teal value display
  - Custom range input styling (`.tama-range`) with teal thumb and glow on focus
  - **"Saltar al hablar" toggle** (`.tama-setting-row`) — pets jump in place instead of walking to chat message
- **Guest Viewers card** — master enable/disable toggle in the card header; collapsible `<details>` "Avanzado" section (gated by `.details-toggle`) with per-platform toggles (Twitch / TikTok), TTS toggle, and a text input for the display-name prefix. The advanced section is visually disabled (`opacity:0.4`, `pointer-events:none`) when the master toggle is off.
- **Actions card** — 2-column grid of action cards (`.tama-action-card`)
  - Each card shows: emoji icon + name + description (wraps to 2 lines) + checkmark
  - Teal border/background when enabled (`tama-action-card--on`)
  - Resets inherited `label` styles (no uppercase, proper text color)
  - Grid items have `min-width: 0` to prevent overflow
  - Live badge count shows enabled actions
- **Fire action card** — flexbox row: user select + action select + fire button
- **Active pets card** — list of `.tama-pet-row` with avatar (🐾), name, position, status badge, delete button

**Styling notes:**
- CSS classes use `tama-` prefix for all tamagotchi-specific styles
- Design tokens: IBM Plex Sans, teal accent (#00c896), ≤4px radius
- No text-transform on action cards (resets global label styles)
- Description text uses `-webkit-line-clamp: 2` for proper wrapping instead of truncation

### Motion v12 in actions

All transform animations in actions **must** use CSS transform strings, same rule as the rest of the overlay (see Section 3). Springs use `{ type: "spring", stiffness, damping }` in the options object.

### ⚠️ Critical: Never use `animate(el, { left })` for horizontal pet movement

**DO NOT** use `animate(el, { left: "Xpx" })` from Motion v12/WAAPI to move a pet horizontally. This causes pets to teleport to a wrong position when the next action starts:

- WAAPI may keep a `fill: "forwards"` on `left` that overrides the walk loop's `el.style.left` updates.
- Motion v12 may internally convert `left` animations to `transform: translateX()` for GPU acceleration, leaving a residual `translateX` on the element after the animation ends. When the next action resets `transform`, the pet visually snaps to a different horizontal position.

**The rule:** `el.style.left` and `pos.x` must ALWAYS be the sole source of truth for horizontal position and must be updated directly via `requestAnimationFrame` — never through WAAPI.

`BasePet.moveTo()` is implemented as a RAF loop:
```typescript
// Each frame: update pos.x and el.style.left directly.
// No WAAPI animation on `left` — avoids fill/commit race and translateX leakage.
this.pos.x = startX + (targetX - startX) * t;
this.el.style.left = `${this.pos.x}px`;
```

`BasePet` also holds a `moveToAbort` callback so any in-progress `moveTo()` is cleanly cancelled by `_stopCurrentAction()` when a new action starts or the pet is interrupted.

### ⚠️ Critical: Clear inline styles after `spawn()`

`spawn()` sets `el.style.transform = "translateY(40px) scale(0.8)"` before the animation to define the starting keyframe. After the animation completes, Motion v12 may or may not commit the final keyframe value back to the inline style. To guarantee a clean state, `spawn()` always explicitly resets both properties after the animation:

```typescript
this.el.style.opacity   = "1";
this.el.style.transform = "";
```

Without this, subsequent action animations start from a polluted inline transform that corrupts squash/stretch or other keyframe interpolations.

---

---

## 16. OBS Browser Source

An alternative to the chroma-key Window Capture workflow. The streamer adds `http://localhost:6767/overlay` as a **Browser Source** in OBS — the background is natively transparent, no chroma key or filters needed.

### How it works

```
OBS Browser Source  -->  GET http://localhost:6767/overlay
                              |
                         axum server (server/mod.rs)
                              |-- serves overlay-browser.html
                              |-- GET /assets/* (Vite-compiled JS/CSS)
                              |-- GET /persona?path=... (pet images)
                              |-- GET /ws (bidirectional WebSocket)
                                       |
                              broadcast channel (AppState.ws_tx)
                                       |
                              Rust event emitters
                              (twitch, tiktok, tts, config, control, tamagotchi)
```

### WebSocket Protocol

**Server → Client (events):**
```json
{ "event": "chat-message", "payload": { ...ChatMessagePayload } }
{ "event": "tts-state",    "payload": { "user_id": 1, "speaking": true } }
{ "event": "tama-action",  "payload": { "user_id": 1, "action_id": "jump", "input": {} } }
{ "event": "chroma-color-changed", "payload": "#00FF00" }
{ "event": "overlay-will-show",    "payload": null }
```

**Client → Server (commands):**
```json
{ "id": "uuid-v4", "command": "get_config_cmd" }
{ "id": "uuid-v4", "command": "tama_upsert_pet_state", "args": { "userId": 1, "floorX": 200, "isSleeping": false, "displayName": "..." } }
{ "id": "uuid-v4", "command": "tama_remove_pet_state", "args": { "userId": 1 } }
```

**Server → Client (responses):**
```json
{ "id": "uuid-v4", "result": { ...AppConfig } }
{ "id": "uuid-v4", "error": "DB lock failed" }
```

The server accepts both camelCase and snake_case arg keys to match Tauri's automatic casing conversion.

### TypeScript Transport (`src/overlay/ws-transport.ts`)

Exports three functions that mirror the Tauri API surface:
- `wsListen<T>(event, handler)` → `Promise<() => void>` — same signature as `listen` from `@tauri-apps/api/event`
- `wsInvoke<T>(command, args?)` → `Promise<T>` — same signature as `invoke` from `@tauri-apps/api/core`
- `browserConvertFileSrc(path)` → `string` — returns `http://localhost:6767/persona?path=<encoded>`

The transport auto-reconnects (1.5 s backoff) and queues `wsInvoke` calls with a 5 s timeout.

### PetManager Transport Injection

`PetManager.init(container, transport?)` accepts an optional `PetTransport` interface:

```typescript
export interface PetTransport {
  listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<() => void>;
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  convertFileSrc(path: string): string;
}
```

- Default (no argument): uses Tauri APIs — existing `overlay.ts` works unchanged.
- With browser transport: `overlay-browser.ts` passes `wsListen`/`wsInvoke`/`browserConvertFileSrc`.

`BasePet` also has a module-level invoke override: `configureBasePetInvoke(fn)` — called by `PetManager.init()` when a browser transport is provided, so pet DB persistence (`tama_upsert_pet_state` / `tama_remove_pet_state`) goes through the WS channel.

### Dev vs Production

| Mode | HTML served from | Assets served from |
|---|---|---|
| `tauri dev` (debug) | Project root `overlay-browser.html` with `/src/*` rewritten to `http://localhost:1420/src/*` | Vite dev server (port 1420) |
| `tauri build` (release) | `dist/overlay-browser.html` | `dist/assets/*` via axum `ServeDir` |

No build step is required in dev — the server adapts automatically based on `cfg(debug_assertions)`.

### Adding a New Event to the Browser Source

1. Emit via Tauri as usual: `app.emit("my-event", &payload)`
2. Immediately after, broadcast: `state.broadcast_ws("my-event", &payload)`
3. In `overlay-browser.ts` or wherever needed: `wsListen("my-event", handler)`

## 17. Focus Animation (chat-message response)

When a user sends a chat message and TTS is enabled, the pet executes a "focus" cycle:

1. **originX saved** — `BasePet` records `pos.x` at the moment `onChatMessage()` is first called. Subsequent messages while already focused do not overwrite it.
2. **Approach** — pet walks to `window.innerWidth / 2 - sizePx / 2` on the floor at `FOCUS_SPEED_PX_PER_S = 200 px/s`. No vertical movement — the pet stays on `floorY` throughout.
3. **Talking** — FSM state while TTS plays. `setMouth(true/false)` drives lip-sync.
4. **Return** — `returnFromFocus()` walks the pet back to `originX` at the same 200 px/s speed, then clears `originX` and transitions to `idle`.

### Race condition guard (`pendingReturn`)

If `tts-state { speaking: false }` arrives before the pet finishes walking to center:
- `PetManager._onTtsState` calls `pet.markTtsFinished()` which sets `pendingReturn = true`.
- When `_doApproach()` arrives at center, it detects `pendingReturn`, skips entering "talking", and immediately calls `returnFromFocus()`.

### Re-focus on new message while returning

`PetStateMachine` allows `returning → approaching`. `onChatMessage()` handles this case: it aborts the current `moveTo`, keeps `originX` intact, and re-runs `_doApproach()`.

### Jump-on-speak mode (`tama_jump_on_speak = "true"`)

`PetManager` reads this config at `init()` and updates it live on every `tama-config-changed` event. When set, `_onChatMessage` calls `pet.executeAction("jump")` instead of `pet.onChatMessage()`. The pet jumps in place — no approach, no center movement.

### Live config updates (`tama-config-changed`)

Every call to `set_config_cmd` with a key that starts with `tama_` causes Rust to emit `tama-config-changed` (payload: full `AppConfig`) to the overlay window and broadcast it via WebSocket to the OBS Browser Source. `PetManager._onTamaConfigChanged()` then applies all changes immediately:

| Config key | Live effect |
|---|---|
| `tama_enabled` | Stops/resumes processing chat messages |
| `tama_max_pets` | New limit enforced on next spawn |
| `tama_pet_size_px` | Resizes all existing pets and recalculates floor Y |
| `tama_walk_speed` | Updates `BasePet.walkSpeedBase`; existing pets reroll their per-pet speed |
| `tama_inactivity_mins` | Updates `BasePet.inactivityMs`; takes effect on next timer reset |
| `tama_action_check_secs` | Restarts PetScheduler interval |
| `tama_action_probability` | Restarts PetScheduler with new probability |
| `tama_enabled_actions` | Updates PetScheduler action pool immediately |
| `tama_jump_on_speak` | Applies on the next chat message |
| `tama_layout_mode` / `tama_static_anchor` / `tama_static_spacing_px` | Require overlay reload (admin panel shows info toast) |