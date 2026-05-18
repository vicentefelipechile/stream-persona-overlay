# AGENTS.md — Stream Persona Overlay

> ⚠️ **CRITICAL RULE**: This file must NEVER be translated to Spanish or any other language. It must ALWAYS remain in English to preserve technical consistency for AI agents.

> Reference guide for AI agents and developers working in this repository.
> Read it **in full** before touching any file.

---

## 1. What Is This Project?

**Stream Persona Overlay** is a **Tauri v2** desktop application that displays animated viewer avatars on the streamer's overlay in real time. When a registered user types in the Twitch or TikTok LIVE chat, their "persona" (two images: mouth open / mouth closed) appears animated on a window with a configurable chroma-key background.

Users register and manage their images through a **Discord bot** (slash commands), with no direct account linking required.

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

### Frontend — Vanilla TypeScript (`src/`)

| Technology | Use |
|---|---|
| Vanilla TypeScript (no framework) | All UI for the admin panel and the overlay |
| Vite 6 | Bundler and dev server |
| `motion` (v11+) | Animation engine for avatars (replaces manual CSS transitions) |
| `@tauri-apps/api 2` | `invoke`, `listen`, `convertFileSrc` |
| `@tauri-apps/plugin-opener 2` | Opening external URLs / files |

### Frontend Design System

| Token | Value |
|---|---|
| Font — body | IBM Plex Sans |
| Font — mono / code | IBM Plex Mono |
| Accent color | `#00c896` (teal-green) |
| Border radius | ≤ 4px |

> Do **not** deviate from these tokens when writing new views or components. Consistency across the panel depends on them.

### Internal Communication

- **Frontend → Rust:** `invoke(command_name, args)` via Tauri Commands
- **Rust → Frontend:** `app_handle.emit(event_name, payload)` via Tauri Events
- **Never** use fetch/HTTP or WebSockets directly from the frontend to talk to the Rust backend.

---

## 3. System Architecture

```
TAURI PROCESS (Rust — single binary)
│
├── tauri::async_runtime::spawn → discord::spawn_discord_bot()
├── tauri::async_runtime::spawn → twitch::spawn_twitch_client()
├── tauri::async_runtime::spawn → tiktok::spawn_tiktok_client()
│
└── AppState  ─── Arc<RwLock<Connection>>  (SQLite)
               ─── Arc<RwLock<AppConfig>>  (in-memory cache)

Tauri Events ──→ WebView "main"    (Admin panel — index.html)
             ──→ WebView "overlay"  (Chroma key — overlay.html)
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
> OBS then applies a chroma-key filter to remove the background, making the avatars
> appear transparent on stream.
>
> **Do NOT set `alwaysOnTop: true`, `decorations: false`, or `skipTaskbar: true`** on this window.
> Those properties would make it impossible to interact with the rest of the PC.
> The window must behave like any other normal application window.

> **`withGlobalTauri: true`** is set in `tauri.conf.json`. This injects the Tauri API as `window.__TAURI__` globally. Import from `@tauri-apps/api/*` as usual — do not rely on the global directly. This setting also affects CSP configuration.

### 🧠 Animation and Lip-Sync System Architecture (New)

The animation and lip-sync system works as follows:

#### The Lip-Sync Pipeline (Voice to Mouth Movement)
1. **Message Detection**: Rust detects a message on Twitch/TikTok.
2. **Event Emission**: Rust emits `chat-message` to the overlay frontend.
3. **Load in Overlay**: The overlay creates a `PersonaController` and puts it in the `PersonaQueue`.
4. **TTS Execution**: Rust executes the TTS asynchronously using `speak_with_events`.
5. **Signaling**: When starting to speak, Rust emits the Tauri event `tts-state` with `speaking: true` and the `user_id`. When finished, it emits `speaking: false`.
6. **Audio Analysis (Frontend)**:
   - The `overlay.ts` file instantiates an `AudioLevelDetector` (Web Audio API).
   - This detector listens to the system's default recording device (which must be "Stereo Mix" or a virtual cable to capture the TTS audio).
   - The detector calculates the amplitude in real time. If it exceeds the configured `audioThreshold`, it calls `persona.setMouth("open")`, otherwise `"closed"`.
   - **Important**: The `tts-state` event only tells the frontend **who** is speaking. The `AudioLevelDetector` is what tells it **when** to open the mouth based on the actual sound.

#### The Animation Engine (`AnimationEngine`)
- The `motion` library is used (formerly Framer Motion but for vanilla JS).
- It supports 10 entry and exit animation styles: `bounce`, `slide-up`, `slide-left`, `slide-right`, `pop`, `flip`, `shake`, `rubber`, `glitch`, `float`.

#### ⚠️ Motion v11 Types Gotcha (Very Important)
Version 11 of `motion` has a severe bug or restriction in its TypeScript types for `ObjectTarget<HTMLElement>`. It does not recognize shorthand transformation properties like `x`, `y`, `scale`, `rotateY`, etc., even though they work perfectly at runtime.
- **Solution implemented**: In `animation-engine.ts` and `persona-controller.ts` a wrapper called `animEl()` is used that casts the element and arguments to `any` before calling `animate()`. **Do not attempt to remove these casts or you will break the project's typing**.

---

## 4. Directory Structure

```
stream-persona-overlay/
├── src/                          # Frontend TypeScript
│   ├── main.ts                   # Panel entry point (index.html)
│   ├── router.ts                 # Manual hash-based ViewRouter
│   ├── state.ts                  # AppState singleton + TS types + showToast()
│   ├── styles.css                # Global panel styles
│   ├── views/
│   │   ├── config.ts             # /config view — global settings
│   │   ├── users.ts              # /users view — user CRUD
│   │   ├── preview.ts            # /preview view — overlay preview
│   │   ├── logs.ts               # /logs view — message history
│   │   └── animations.ts         # /animations view — configure effects
│   ├── overlay/                  # Overlay-specific modules
│   │   ├── animation-config.ts   # Loading and mapping of animation config
│   │   ├── animation-engine.ts   # Motion.js engine with the 10 effects
│   │   ├── audio-detector.ts     # Web Audio API analyzer for Lip-Sync
│   │   ├── persona-controller.ts # Lifecycle controller of an avatar in the DOM
│   │   └── persona-queue.ts      # Capacity manager (prevents avatar saturation)
│   ├── components/               # Reusable frontend components
│   │   ├── persona-card.ts       # Visual persona card component
│   │   └── color-picker.ts       # Chroma color selector component
│   ├── assets/                   # Static frontend assets
│   └── styles/                   # Additional CSS (overlay, panel)
│
├── src-tauri/
│   ├── tauri.conf.json           # Window config, bundle, CSP
│   ├── Cargo.toml                # Rust dependencies
│   ├── build.rs                  # Tauri build script
│   └── src/
│       ├── main.rs               # Binary entry point (delegates to lib.rs::run())
│       ├── lib.rs                # setup_app: DB init, spawn tasks, register handlers
│       ├── state.rs              # AppState, AppConfig, ChatMessagePayload
│       ├── chat_platform.rs      # ChatPlatform trait abstraction for providers
│       ├── db/
│       │   ├── mod.rs
│       │   ├── migrations.rs     # run_migrations() — creates tables and inserts defaults
│       │   ├── users.rs          # Full CRUD for users + personas + logs
│       │   └── config.rs         # get_config() / set_config_value()
│       ├── discord/
│       │   ├── mod.rs            # spawn_discord_bot() — reads token, starts poise::Framework
│       │   └── commands/
│       │       ├── persona.rs    # /persona: set-username, upload-open, upload-closed, preview, remove
│       │       └── admin.rs      # /admin commands (streamer role only): get-user, toggle-active, delete-user
│       ├── twitch/
│       │   ├── mod.rs            # spawn_twitch_client() — TwitchIRC, on_message → emit "chat-message"
│       │   └── handler.rs        # User lookup logic in DB
│       ├── tiktok/
│       │   ├── mod.rs            # spawn_tiktok_client() — WS to TikTool, on_chat_event → emit
│       │   └── handler.rs        # TikTok event parsing
│       ├── tts/
│       │   └── mod.rs            # TTS wrapper (tts crate)
│       └── commands/
│           ├── mod.rs
│           ├── users.rs          # get_users, get_user, update_user_cmd, delete_user_cmd, toggle_user_active_cmd, get_recent_logs_cmd
│           ├── config.rs         # get_config_cmd, set_config_cmd, get_available_voices_cmd, set_chroma_color
│           └── control.rs        # restart_discord_bot, connect_twitch, connect_tiktok, toggle_overlay, send_test_message
│
├── index.html                    # Admin panel HTML
├── overlay.html                  # Overlay window HTML (chroma key)
├── vite.config.ts                # Vite configuration
├── tsconfig.json
├── package.json
└── plan-proyecto-streamoverlay.md  # Original design document (reference)
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
```

> **`personas.user_id` is UNIQUE** — there is exactly one persona per user. Uploading a new image must use an **upsert** (`INSERT OR REPLACE` / `ON CONFLICT DO UPDATE`), not a plain `INSERT`. A duplicate insert will raise a constraint violation.

### Config Keys

| Key | Default | Description |
|---|---|---|
| `chroma_color` | `#00FF00` | Overlay background color |
| `overlay_width` | `1920` | Overlay width |
| `overlay_height` | `1080` | Overlay height |
| `tts_enabled` | `true` | Enable TTS |
| `twitch_channel` | `""` | Twitch channel to listen to |
| `twitch_bot_username` | `""` | Authenticated Twitch bot username |
| `twitch_bot_token` | `""` | Twitch OAuth token (format: `oauth:xxx`) |
| `tiktok_username` | `""` | TikTok LIVE username |
| `discord_bot_token` | `""` | Discord bot token |
| `discord_guild_id` | `""` | Discord server ID |
| `discord_channel_id` | `""` | Discord channel ID |

> **Important:** The bot token and API keys are stored in the local SQLite `config` table. Never hardcode them in source code or plain-text files.

### Migrations

Migrations are inline in `db/migrations.rs` via `run_migrations(&conn)`. They use `CREATE TABLE IF NOT EXISTS` — they are idempotent. To add columns, use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` or add a new sequential migration.

---

## 6. AppState (Rust)

```rust
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,           // Synchronous Mutex for SQLite connection
    pub config_cache: Arc<RwLock<AppConfig>>, // In-memory config cache
    pub app_data_dir: Arc<PathBuf>,           // Shared data directory path
    pub discord_handle: Arc<Mutex<Option<JoinHandle<()>>>>, // Task handles for lifecycle
    pub twitch_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    pub tiktok_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
}
```

- **`AppState` is `Clone`** — clone it freely to pass to tokio tasks.
- **DB Access is synchronous:** Use `state.db.lock()` (or handle poisoning). Do not `await` it.
- **Do not create additional connections.** All DB access goes through this single `Arc<Mutex<Connection>>`.
- Background tasks can be safely aborted via `state.abort_discord()`, `abort_twitch()`, etc., to prevent stale connections during restarts.
- Always update `config_cache` after every `set_config_value` call.

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
| `set_config_cmd` | `invoke("set_config_cmd", { key, value })` | Save a key-value pair |
| `get_available_voices_cmd` | `invoke<VoiceInfo[]>("get_available_voices_cmd")` | System TTS voices |
| `set_chroma_color` | `invoke("set_chroma_color", { color })` | Update color and emit `chroma-color-changed` |

### Control (`commands/control.rs`)

| Command | TS Signature | Description |
|---|---|---|
| `restart_discord_bot` | `invoke("restart_discord_bot")` | Re-spawn the Discord bot |
| `connect_twitch` | `invoke("connect_twitch", { channel })` | Save channel and reconnect IRC client |
| `validate_twitch_token` | `invoke<string>("validate_twitch_token", { token })` | Validates OAuth token and returns username |
| `connect_tiktok` | `invoke("connect_tiktok", { username })` | Save username and reconnect WS |
| `toggle_overlay` | `invoke("toggle_overlay")` | Show / hide the overlay window |
| `send_test_message` | `invoke("send_test_message", { display_name, mouth_open_path, mouth_closed_path })` | Emit a test `chat-message` |

---

## 8. Tauri Events

### Rust → Frontend

| Event | Payload | Emitter | Listener |
|---|---|---|---|
| `chat-message` | `ChatMessagePayload` | `twitch/`, `tiktok/`, `control.rs` (test) | `overlay.ts`, `preview.ts` |
| `chroma-color-changed` | `string` (hex color) | `commands/config.rs` | `overlay.ts` |
| `twitch-connected` | `string` (channel) | `twitch/mod.rs` (on RoomState) | `main.ts` |
| `twitch-error` | `string` (error msg) | `twitch/mod.rs` | `main.ts` |
| `tiktok-connected` | `string` (username) | `commands/control.rs` | `main.ts` |
| `discord-ready` | `string` (bot username)| `discord/mod.rs` | `main.ts` |
| `discord-error` | `string` (error msg) | `discord/mod.rs` | `main.ts` |

### `ChatMessagePayload`

```typescript
interface ChatMessagePayload {
  platform: string;         // "twitch" | "tiktok" | "test"
  username: string;         // Platform username
  message: string;          // Message text
  user_id: number;          // DB ID (0 for test messages)
  display_name: string;     // Name to display on the overlay
  mouth_open_path: string;  // Absolute OS filesystem path
  mouth_closed_path: string;
  voice_id: string;
}
```

> **Important:** `mouth_open_path` / `mouth_closed_path` are absolute OS paths. To use them as `<img>` `src` in the frontend, you **must** convert them using `convertFileSrc(path)` from `@tauri-apps/api/core`. This transforms the path into Tauri's `asset://localhost/` protocol.

---

## 9. Frontend — Patterns and Conventions

### ViewRouter

The router in `router.ts` is manual, hash-based (`#/config`, `#/users`, etc.).

```typescript
export type ViewId = "config" | "users" | "preview" | "logs";
```

- To add a new view: add an entry in `routes`, create the file under `src/views/`, and add `data-view="new-view"` to the sidebar in `index.html`.
- Each view exports a function `render<Name>(): Promise<void>` that writes into `#view-container`.

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

### Overlay Window (`overlay.ts`)

- Runs in `overlay.html` (separate window).
- Manages `activePersonas: Map<user_id, PersonaBubble>`.
- The `PersonaBubble` class handles positioning, mouth animation, and auto-exit after 6 seconds of inactivity.
- Horizontal positioning: `PERSONA_START_X=40`, `PERSONA_WIDTH=200`, `PERSONA_GAP=20` — bubbles stack left-to-right as different users appear.
- **Display Mode:** Managed by `AppConfig.overlay_display_mode`.
  - `parallel`: bubbles stack left-to-right (`PERSONA_START_X`, `PERSONA_GAP`).
  - `queue`: bubbles appear one at a time centrally.

---

## 10. Rust Modules — Responsibilities

### `discord/`

- `spawn_discord_bot(state)`: reads `discord_bot_token` from DB. If empty, returns immediately (no panic).
- Registers `poise` commands globally in the framework setup.
- Slash commands in `commands/persona.rs`: `set_username`, `upload_open`, `upload_closed`, `preview`, `remove`.
- Images downloaded from Discord are saved to `{app_data_dir}/personas/{discord_id}/mouth_open.png` and `mouth_closed.png`.
- **Image upload validation checklist** (must be enforced before saving):
  1. MIME type must be `image/png` or `image/jpeg`
  2. File size ≤ 2 MB
  3. Minimum source dimensions must be validated (reject tiny/corrupt images)
  4. Resize to **512×512 PNG** with transparency using the `image` crate (using `Lanczos3` filter for high-quality downscaling, avoiding `Nearest` which causes pixelation).
- Persona images use an **upsert** pattern — see Section 5 (personas UNIQUE FK note).

### `twitch/`

- `spawn_twitch_client(state, app_handle)`: connects via `twitch-irc` to the configured channel.
- Uses **authenticated** connection if `twitch_bot_username` and `twitch_bot_token` are set (required to receive messages when the stream is offline). If empty, falls back to an anonymous connection (only works when the channel is live).
- `twitch_bot_token` is validated against Twitch's API (`id.twitch.tv/oauth2/validate`) before saving to automatically fetch the `twitch_bot_username`.
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

### `tts/`

- Wrapper over the `tts` crate abstracting SAPI (Windows), NSSpeechSynthesizer (macOS), and espeak (Linux).
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
# Windows → .msi / NSIS installer in src-tauri/target/release/bundle/
# macOS   → .dmg / .app in src-tauri/target/release/bundle/

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

1. **Do not break the `ViewRouter` pattern**: every view goes in `src/views/`, exports `render<Name>()`, and is registered in `router.ts`.
2. **Do not add CSS frameworks** (Tailwind, Bootstrap, etc.) without explicit user approval. The project uses vanilla CSS.
3. **Do not create additional DB connections** — all DB access goes through `AppState.db: Arc<RwLock<Connection>>`.
4. **Do not use `unwrap()`** in production Rust code. Use `?` with `anyhow::Result` or map errors to `CmdResult<T>` via `map_err`.
5. **Do not store tokens/secrets in source code.** Tokens go in the `config` SQLite table.
6. **Add `#[tauri::command]` to every new command** and register it in `lib.rs → tauri::generate_handler![]`.
7. **Emit `tracing::info!` / `tracing::warn!` / `tracing::error!`** for important operations — do not use `println!`.
8. **For images in the overlay:** always use `convertFileSrc(path)` before assigning to `img.src` so Tauri can serve the local file via the asset protocol.
9. **The Discord bot and chat clients are tolerant of empty config** — if the token/channel/username is empty, they return without error.
10. **TikTok LIVE** has no official public API. The current integration depends on the external TikTool service (`wss://api.tik.tools`). If the service fails, the module must handle the error and retry with backoff — never crash the process.

---

## 13. Complete Data Flow

### User Registration (Discord)

```
User runs /persona upload-open [image]
  → Bot validates: PNG/JPG, ≤2MB
  → Downloads image → resizes to 512×512 → saves as PNG
  → Path: {app_data_dir}/personas/{discord_id}/mouth_open.png
  → Inserts/updates personas table in SQLite
  → Responds with a confirmation embed

User runs /persona set-username twitch:myuser tiktok:myuser2
  → Updates users table (twitch_username, tiktok_username)
  → Bot confirms
```

### Stream Message → Overlay

```
Twitch/TikTok chat: message from "myuser"
  → Rust looks up DB: users JOIN personas WHERE twitch_username = 'myuser' AND is_active = 1
  → On match: builds ChatMessagePayload
  → app_handle.emit("chat-message", payload)  →  WebView "overlay"
  → overlay.ts: PersonaBubble.update(payload)
      → img.src = convertFileSrc(mouth_open_path)   (300ms)
      → img.src = convertFileSrc(mouth_closed_path)
      → auto-exit after 6s of inactivity
  → (parallel) TTS reads the message with the user's assigned voice
```

---

## 14. Security Considerations

- `tauri.conf.json` has `"csp": null` in development. **Before production**, configure a restrictive CSP.
- Discord and TikTool tokens are stored in SQLite in `app_data_dir`. Consider migrating to the `keyring` crate (OS Credential Manager) for stronger security.
- Persona images come from Discord — validate MIME type and size before saving.
- The overlay window is a **normal window** — it must NOT use `skipTaskbar`, `alwaysOnTop`, or `decorations: false`. It is captured by OBS via Window Capture, not rendered on top of the OS desktop.

---

## 15. MVP Scope & Implementation Status

The project plan defines a phased roadmap. The table below tracks what is implemented vs. pending so agents do not accidentally treat TODO items as existing features.

| Phase | Feature | Status |
|---|---|---|
| 0 | Project setup, SQLite, AppState, logging | ✅ Done |
| 1 | Discord bot — `/persona` slash commands | ✅ Done |
| 2 | Twitch IRC client — message detection & emit | ✅ Done |
| 3 | TikTok LIVE client (TikTool WebSocket) | ✅ Done |
| 4 | Overlay window — chroma key + PersonaBubble animation | ✅ Done |
| 5 | TTS — read messages with per-user voice | ✅ Done |
| 6 | Admin panel — config, users CRUD, preview, logs views | ✅ Done |
| — | Discord `/admin` commands (streamer role) | ✅ Done |
| — | `src/components/` refactor (persona-card, color-picker) | ✅ Done |
| — | Configurable overlay display mode (parallel vs queue) | ✅ Done |
| — | `ChatPlatform` trait abstraction | ✅ Done |

### Minimum Viable Product (MVP) Definition

The MVP required for a functional stream session:
1. Discord bot (persona registration)
2. Twitch IRC (message detection)
3. Overlay with chroma key + mouth open/closed animation
4. Minimal config panel (set channel, view users)

**All four MVP components are implemented.** TikTok, TTS, and the full admin panel are post-MVP enhancements that are also complete in the current codebase.

---

*Generated 2026-05-18 — Stream Persona Overlay v0.1*
