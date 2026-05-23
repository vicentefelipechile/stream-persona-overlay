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
|   +-- views/
|   |   +-- config.ts             # /config view — global settings (includes OBS Browser Source URL)
|   |   +-- users.ts              # /users view — user CRUD
|   |   +-- logs.ts               # /logs view — message history
|   |   +-- tamagotchi.ts         # /tamagotchi view — pet admin panel
|   |   +-- overlay.ts            # Entry point for overlay.html (NOT a panel view)
|   |   +-- overlay-browser.ts    # Entry point for overlay-browser.html (OBS Browser Source)
|   +-- overlay/                  # Overlay-specific modules (used by overlay.ts and overlay-browser.ts)
|   |   +-- ws-transport.ts       # WebSocket transport — mirrors Tauri API for browser context
|   |   +-- tamagotchi/           # Tamagotchi pet system (see Section 16)
|   |       +-- core/             # PetStateMachine, BaseAction, ActionRegistry, PetFloor, BasePet, PetScheduler, PetManager
|   |       +-- actions/          # IdleWalkAction, JumpAction, PopcornAction, FightAction, ExplodeAction, DanceAction, SleepAction, _template
|   |       +-- props/            # PropRenderer, PropAssetLoader
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
|       +-- db/
|       |   +-- mod.rs
|       |   +-- migrations.rs     # run_migrations() — creates tables and inserts defaults
|       |   +-- users.rs          # Full CRUD for users + personas + logs
|       |   +-- config.rs         # get_config() / set_config_value()
|       +-- discord/
|       |   +-- mod.rs            # spawn_discord_bot() — reads token, starts poise::Framework
|       |   +-- commands/
|       |       +-- persona.rs    # /persona: set-username, upload-open, upload-closed, preview, remove
|       |       +-- admin.rs      # /admin commands (streamer role only): get-user, toggle-active, delete-user
|       +-- twitch/
|       |   +-- mod.rs            # spawn_twitch_client() — TwitchIRC, on_message --> emit "chat-message"
|       |   +-- handler.rs        # User lookup logic in DB
|       +-- tiktok/
|       |   +-- mod.rs            # spawn_tiktok_client() — WS to TikTool, on_chat_event --> emit
|       |   +-- handler.rs        # TikTok event parsing
|       +-- tts/
|       |   +-- mod.rs            # TTS wrapper (tts crate)
|       +-- commands/
|           +-- mod.rs
|           +-- users.rs          # get_users, get_user, update_user_cmd, delete_user_cmd, toggle_user_active_cmd, get_recent_logs_cmd
|           +-- config.rs         # get_config_cmd, set_config_cmd, get_available_voices_cmd, set_chroma_color, save_animation_config
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
message_log  -- platform, username, message, user_id (nullable FK), shown
pet_state    -- user_id (PK FK→users ON DELETE CASCADE), last_seen_at, floor_x, is_sleeping
```

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
| `tiktok_username` | `""` | TikTok LIVE username |
| `discord_bot_token` | `""` | Discord bot token |
| `discord_guild_id` | `""` | Discord server ID |
| `discord_channel_id` | `""` | Discord channel ID |
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

> **Important:** The bot token and API keys are stored in the local SQLite `config` table. Never hardcode them in source code or plain-text files.
>
> **Boolean Config Parsing:** All config values are stored as strings. Do NOT use `Boolean(value)` — `Boolean("false") === true`. Always use `String(value) === "true"` for explicit comparison. The same applies when reading booleans emitted in Tauri events from Rust (they arrive as `"true"`/`"false"` strings).

### Migrations

Migrations are inline in `db/migrations.rs` via `run_migrations(&conn)`. They use `CREATE TABLE IF NOT EXISTS` — they are idempotent. To add columns, use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` or add a new sequential migration.

---

## 6. AppState (Rust)

```rust
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,                    // std::sync::Mutex (NOT tokio::sync::Mutex)
    pub config_cache: Arc<RwLock<AppConfig>>,          // std::sync::RwLock
    pub app_data_dir: Arc<PathBuf>,
    pub discord_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    pub twitch_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    pub tiktok_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    pub ws_tx: broadcast::Sender<String>,              // tokio broadcast — fan-out to WS clients
    pub server_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
}
```

- **`AppState` is `Clone`** — clone it freely to pass to tokio tasks.
- **`db` uses `std::sync::Mutex`** (not `tokio::sync::Mutex` and not `RwLock`). Lock with `state.db.lock().map_err(map_err)?`. Do not `.await` it — it is synchronous.
- **Do not create additional connections.** All DB access goes through this single `Arc<Mutex<Connection>>`.
- **`config_cache` uses `std::sync::RwLock`** — this is intentional so it can be written in `setup()` before the Tokio runtime starts. Use `.read().map_err(...)` / `.write().map_err(...)`.
- **`ws_tx`** is a `tokio::sync::broadcast::Sender<String>`. Call `state.broadcast_ws(event, &payload)` every time you call `app.emit(event, &payload)` so the OBS Browser Source receives the same data. It's safe to ignore if there are no receivers.
- Background tasks can be safely aborted via `state.abort_discord()`, `abort_twitch()`, `abort_tiktok()`, `abort_server()`, `abort_all()`.
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
| `connect_twitch` | `invoke("connect_twitch", { channel })` | Save channel and reconnect IRC client |
| `validate_twitch_token` | `invoke<string>("validate_twitch_token", { token })` | Validates OAuth token against Twitch API and returns username. Also saves `twitch_bot_token` and `twitch_bot_username` to DB. |
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

### ViewRouter

The router in `router.ts` is manual, hash-based (`#/config`, `#/users`, etc.).

```typescript
export type ViewId = "config" | "users" | "logs" | "tamagotchi";
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
- `twitch_bot_token` is validated against Twitch's API (`id.twitch.tv/oauth2/validate`) via `validate_twitch_token` command before saving to automatically fetch the `twitch_bot_username`.
- For each incoming message: looks up in DB whether the `twitch_username` is registered and active.
- Emits `twitch-connected` to the frontend only upon receiving a successful `RoomState` from the server.
- On match: emits `chat-message` to the frontend with the `ChatMessagePayload`.
- Logs the message in `message_log`.

### `tiktok/`

- `spawn_tiktok_client(state, app_handle)`: connects via WebSocket to `wss://api.tik.tools?uniqueId={username}&apiKey={key}`.
- Same pipeline as Twitch: parse `chat` event → user lookup → emit `chat-message`.
- **Risk:** TikTool's free sandbox is limited (50 req/day, 1 WS connection). Production requires a paid plan (~$7/week).
- If `tiktok_username` is empty, returns without connecting.
- **Architecture:** Abstracted behind the `ChatPlatform` trait (`chat_platform.rs`). This trait standardizes event handling and message parsing across all chat providers (Twitch, TikTok, etc.).
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

## 15. Implementation Status

| Feature | Status |
|---|---|
| Project setup, SQLite, AppState, logging | Done |
| Discord bot — `/persona` slash commands | Done |
| Twitch IRC client — message detection & emit | Done |
| TikTok LIVE client (TikTool WebSocket) | Done |
| TTS — read messages with per-user voice + tts-state events | Done |
| Admin panel — config, users CRUD, logs views | Done |
| Discord `/admin` commands (streamer role) | Done |
| `color-picker` component | Done |
| `ChatPlatform` trait abstraction | Done |
| Overlay fade-cover (prevents chroma flashbang on window show) | Done |
| Tamagotchi pet system — persistent chat-user pets walking on overlay floor | Done |
| Proper process exit when main window closes | Done |
| OBS Browser Source — axum HTTP+WS server, no chroma key required | Done |

---

## 16. Tamagotchi Pet System

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
```

### Core modules (`src/overlay/tamagotchi/core/`)

| File | Role |
|---|---|
| `PetStateMachine.ts` | FSM with transition(), onEnter(), canDo(). Valid states: spawning → idle ↔ approaching → talking → returning ↔ approaching (re-focus), returning → idle, idle → action → idle, idle → sleeping → despawning |
| `BaseAction.ts` | Abstract base for all actions. Uses `import type { BasePet }` (avoids circular dep). Provides `wait(ms)`, `cancelled` flag, `onCancel()` hook |
| `ActionRegistry.ts` | Static singleton. Actions self-register at module load via `ActionRegistry.register(MyAction)`. Exposes `get()`, `getAllMeta()`, `getRandomId()` (weighted by `probability`) |
| `PetFloor.ts` | Manages the floor Y and per-pet X position slots with collision avoidance (20-attempt fallback) |
| `BasePet.ts` | Concrete pet class. Manages DOM, FSM transitions, idle-walk loop (delta-time, `WALK_SPEED_PX_PER_S = 36`), mouth images, focus approach/return (`FOCUS_SPEED_PX_PER_S = 200`, stays on floor, returns to `originX`), sleep, despawn, and DB persistence via `tama_upsert_pet_state` / `tama_remove_pet_state`. Exposes `configureBasePetInvoke()` for browser transport injection. `markTtsFinished()` handles the race where TTS ends before pet reaches center. |
| `PetScheduler.ts` | `setInterval` at `tama_action_check_secs`. Rolls a random action for a random idle pet; excludes `"idle_walk"` and `"sleep"` from the pool |
| `PetManager.ts` | Static singleton. Owns the `Map<userId, BasePet>`. Bootstraps PetFloor + PetScheduler. Routes events to pets |

### Actions (`src/overlay/tamagotchi/actions/`)

Each action file calls `ActionRegistry.register(MyAction)` at the bottom — importing the file triggers registration (side-effect import pattern).

| Action ID | Class | Description |
|---|---|---|
| `idle_walk` | `IdleWalkAction` | No-op placeholder; excluded from random pool |
| `jump` | `JumpAction` | Squash-and-stretch jump loop |
| `popcorn` | `PopcornAction` | Pet holds a popcorn bucket and watches chat |
| `fight` | `FightAction` | Two pets charge toward each other, shake, show a fight cloud, bounce away |
| `explode` | `ExplodeAction` | Tremor, flash, particle burst, then respawn with spring |
| `dance` | `DanceAction` | Rhythmic rotate + translateY loop |
| `sleep` | `SleepAction` | Pet tilts + ZZZ props; cancelled on next chat message |

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

## 17. OBS Browser Source

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

---

*Updated 2026-05-22 — Stream Persona Overlay v0.1*

---

## 18. Focus Animation (chat-message response)

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

`PetManager` reads this config at `init()`. When set, `_onChatMessage` calls `pet.executeAction("jump")` instead of `pet.onChatMessage()`. The pet jumps in place — no approach, no center movement. The `jumpOnSpeak` flag is stored as a static property on `PetManager`; changes take effect only after the overlay reloads.
