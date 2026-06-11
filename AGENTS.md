# AGENTS.md — Stream Persona Overlay

> ⚠️ **CRITICAL RULE**: This file must NEVER be translated to Spanish or any other language. It must ALWAYS remain in English to preserve technical consistency for AI agents.

> Reference guide for AI agents and developers working in this repository.
> Read it **in full** before touching any file.

---

## 1. What Is This Project?

**Stream Persona Overlay** is a **Tauri v2** desktop application — a **toolkit of animated OBS overlays for streamers**, driven by the chat and live events of Twitch and TikTok. It began as a viewer-pet (Tamagotchi) overlay and has grown into a small suite of independent overlay modules that share one Rust backend, one admin panel, and one OBS Browser Source server (axum on port 6767).

### Overlay modules

| Module | Overlay page | What it does |
|---|---|---|
| **Viewer pets (Tamagotchi)** | `overlay.html` (Tauri) / `overlay-browser.html` (OBS) | When a registered viewer types in Twitch or TikTok LIVE chat, their pet (two images: mouth open / closed) appears on the overlay floor, walks around, reacts to chat events, and runs random or admin-triggered actions. See Section 16. |
| **Streamer persona** | `overlay-streamer.html` | The streamer's own animated avatar (4 sprites: mouth × eyes) with mic-driven lip-sync and automatic eye-blink. |
| **Event alerts** | `overlay-alerts.html` | Per-event on-screen alerts for **both Twitch (cheer/sub/raid/follow/hype_train) and TikTok** (gifts, follows, likes, subs…) with custom image / sound / text / transition. Served at `/overlay-alerts` (legacy `/overlay-tiktok` kept as an alias). |

### Supporting systems

- **Chat & event integrations** — Twitch IRC + EventSub, TikTok LIVE (via TikTool), and a Discord bot for registration.
- **Cross-cutting infrastructure** — anti-spam filters, per-event cooldowns, TTS lip-sync, the axum OBS Browser Source server, and a first-run onboarding tour.

Viewers register and manage their pet images through the **Discord bot** (slash commands); the two persona images (mouth open / closed) are used as the pet sprites.

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
| Vite 6 | Bundler and dev server (five entry points: `main`, `overlay`, `overlay_browser`, `overlay_alerts`, `overlay_streamer`) |
| `motion` (v12+) | Animation engine for Tamagotchi pet actions (DOM animate API) |
| `@tauri-apps/api 2` | `invoke`, `listen`, `convertFileSrc` — used by Tauri windows only |
| `@tauri-apps/plugin-opener 2` | Opening external URLs / files |
| `simple-icons` | Brand SVG icons (Twitch, TikTok, Discord). Consumed exclusively through `src/icons.ts` — never imported directly in views. |
| `lucide` | UI SVG icons (stroke + fill). Consumed exclusively through `src/icons.ts` — never imported directly in views. |
| `driver.js` (v1.4+) | Spotlight/tooltip engine for the first-run onboarding tour. Consumed exclusively through `src/onboarding/tour.ts` — never imported directly in views. See Section 18. |
| `@fontsource/ibm-plex-sans` + `@fontsource/ibm-plex-mono` | Self-hosted IBM Plex font files. Imported via `@import` in `entry-panel.css` — no Google Fonts CDN, works fully offline. |
| `ws-transport.ts` (internal) | Drop-in replacement for Tauri API used by the OBS Browser Source overlay |

### Frontend Design System

| Token | Value |
|---|---|
| Font — body | IBM Plex Sans (self-hosted via `@fontsource/ibm-plex-sans`) |
| Font — mono / code | IBM Plex Mono (self-hosted via `@fontsource/ibm-plex-mono`) |
| Accent color | `#00c896` (teal-green) |
| Border radius | ≤ 4px |

> Do **not** deviate from these tokens when writing new views or components. Consistency across the panel depends on them.

> **Text color hierarchy:** `--color-text` (`#e8eaf0`) is foreground/primary; `--color-text-muted` (`#7a8099`) is secondary copy; `--color-text-dim` (`#4a5168`) is the faintest. **Foreground UI controls must use `--color-text`** — form `<label>`s, sidebar `.nav-link`s, and slider labels are all `--color-text` so they never read fainter than the input/description next to them. Reserve `--color-text-muted` for genuinely secondary text (hints, descriptions, timestamps, the resting state of de-emphasised items). A control label that looks darker than its own value/description is a bug.

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
+-- tauri::async_runtime::spawn --> discord::spawn_discord_bot()   (auto-start at launch)
+-- tauri::async_runtime::spawn --> server::start_server()  (axum on port 6767, auto-start)
|   (twitch::spawn_twitch_client / tiktok::spawn_tiktok_client are NOT auto-started —
|    they spawn only when the user clicks Connect via connect_twitch / connect_tiktok.
|    Rationale: TikTool has a very low daily request quota, so launching the app must
|    not consume quota until the user explicitly connects.)
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
|   +-- router.ts                 # Manual hash-based ViewRouter — one cached persistent pane per view (render once, toggle visibility), router.invalidate() to re-render
|   +-- state.ts                  # AppState singleton + TS types + showToast()
|   +-- icons.ts                  # Centralized icon catalog — brand icons (simple-icons) + inline SVG UI icons
|   +-- views/
|   |   +-- config.ts             # /config view — global settings + platform shortcut cards
|   |   +-- users.ts              # /users view — user CRUD
|   |   +-- logs.ts               # /logs view — message history
|   |   +-- tamagotchi.ts         # /tamagotchi view — pet admin panel
|   |   +-- twitch.ts             # /twitch view — Twitch connection, chat filters, chat anti-spam, global cap (events moved to /eventos)
|   |   +-- tiktok.ts             # /tiktok view — TikTok connection, chat filters, chat anti-spam (events moved to /eventos)
|   |   +-- eventos.ts            # /eventos view — unified live feed (Twitch+TikTok) + event types/cooldowns/TTS/EventSub + per-event alert config
|   |   +-- _eventConfig.ts       # Shared event-config helpers (presets/sliders/save) for the Twitch + TikTok sections of /eventos
|   |   +-- streamer.ts           # /streamer view — streamer persona config (sprites, blink, talk anim, mic)
|   |   +-- overlay.ts            # Entry point for overlay.html (NOT a panel view)
|   |   +-- overlay-browser.ts    # Entry point for overlay-browser.html (OBS Browser Source — pets)
|   |   +-- overlay-alerts.ts     # Entry point for overlay-alerts.html (OBS Browser Source — event alerts, Twitch + TikTok)
|   |   +-- overlay-streamer.ts   # Entry point for overlay-streamer.html (OBS Browser Source — streamer persona)
|   +-- overlay/                  # Overlay-specific modules (used by overlay.ts and overlay-browser.ts)
|   |   +-- ws-transport.ts       # WebSocket transport — mirrors Tauri API for browser context
|   |   +-- overlay-notifications.ts # Pill toasts for overlay-notification events (Tauri + WS), used by all overlay views
|   |   +-- alerts/               # Event-alert overlay system
|   |   |   +-- AlertManager.ts   # Queues + renders event-alert payloads (image/text/sound/transition)
|   |   +-- streamer/             # Streamer persona overlay system
|   |   |   +-- BlinkScheduler.ts # Timestamp-based eye-blink state machine (no per-frame recompute)
|   |   |   +-- StreamerPersona.ts# 4-sprite renderer + rAF loop (mouth from streamer-speaking event, eyes from scheduler)
|   |   +-- tamagotchi/           # Tamagotchi pet system (see Section 16)
|   |       +-- core/             # PetStateMachine, BaseAction, ActionRegistry, Grid2D, BasePet, PetScheduler, PetManager
|   |       +-- actions/          # IdleWalkAction, JumpAction, PopcornAction, FightAction, ExplodeAction, DanceAction, SleepAction, ConfettiAction, HypeTrainAction, _template
|   |       +-- props/            # PropRenderer, PropAssetLoader
|   |       +-- eventReactions.ts # chat-event listener → maps event_kind to pet action
|   +-- onboarding/               # First-run onboarding tour (see Section 18)
|   |   +-- tour.ts               # driver.js wrapper — step definitions, cross-view navigation, first-run flag
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
|       +-- eventos.css           # Eventos view — live feed + alert config cards (.evt-* prefix)
|       +-- streamer-panel.css     # Streamer persona admin view (.str-* prefix) + preview keyframes
|       +-- onboarding.css        # Onboarding tour popover theming (driver.js, .spo-tour scope)
|       +-- overlay-base.css      # Overlay window base reset + fade-cover
|       +-- pets.css              # Pet styles (.tamagotchi-pet, .pet-*)
|       +-- alerts.css            # Alert overlay styles (.spo-alert*) — used by entry-alerts.css
|       +-- entry-alerts.css      # Entry point for overlay-alerts.html (imports alerts.css)
|       +-- streamer-overlay.css  # Streamer persona overlay styles + talk-animation keyframes
|       +-- entry-streamer.css    # Entry point for overlay-streamer.html (imports streamer-overlay.css)
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
|       +-- streamer_mic/
|       |   +-- mod.rs            # Native mic capture (cpal/WASAPI) — StreamerMic, list_input_devices(), broadcasts streamer-speaking
|       +-- grid/
|       |   +-- mod.rs            # GridManager — backend-authoritative 2D pet grid; assigns cells, wander tick, broadcasts tama-grid-*
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
|           +-- alerts.rs         # set_event_alert_asset, clear_event_alert_asset, test_event_alert
|       +-- alerts/
|       |   +-- mod.rs            # Shared event-alert logic (resolve/maybe_emit/emit_test) used by twitch/eventsub.rs + tiktok/mod.rs
|           +-- streamer.rs       # set_streamer_sprite, reset_streamer_sprite, streamer_list_mics, streamer_mic_apply
|
+-- index.html                    # Admin panel HTML
+-- overlay.html                  # Overlay window HTML (chroma key, Tauri window)
+-- overlay-browser.html          # OBS Browser Source HTML — pets (transparent, no Tauri APIs)
+-- overlay-alerts.html           # OBS Browser Source HTML — event alerts, Twitch + TikTok (transparent, no Tauri APIs)
+-- overlay-streamer.html         # OBS Browser Source HTML — streamer persona (transparent, no Tauri APIs)
+-- vite.config.ts                # Vite configuration (5 entry points: main, overlay, overlay_browser, overlay_tiktok, overlay_streamer)
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
pet_state    -- user_id (PK FK→users ON DELETE CASCADE), last_seen_at, floor_x (legacy), cell_x, cell_y, is_sleeping
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
| `tiktok_ws_endpoint` | `"wss://api.tik.tools"` | TikTool WebSocket endpoint |
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
| `alerts_config` | *(JSON)* | Per-event alert settings map (`event_kind` → `{ enabled, image, sound, text, duration_ms, transition }`), for **both Twitch (`cheer`/`sub`/`raid`/`follow`/`hype_train`) and TikTok** kinds. Drives the dedicated alert overlay (`overlay-alerts.html`). `text` supports `{user}`/`{amount}` tokens; `transition` ∈ `fade`/`slide-down`/`slide-up`/`scale`/`none`. `tiktok_like` and `tiktok_member` default to disabled (high-frequency). Asset paths are written by `set_event_alert_asset`; the rest is saved via `set_config_cmd`. **Migration:** the old TikTok-only key `tiktok_alerts_config` is copied to `alerts_config` on first run (then deleted) by `migrate_alerts_config_key` in `db/migrations.rs`. |
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
| `tama_keyword_actions` | *(JSON)* | JSON map of chat keyword → tama action ID (e.g. `{"pelea":"fight","baila":"dance"}`). When a pet's owner types a keyword (whole-word, case-insensitive), that action is forced, taking priority over `tama_jump_on_speak` / walk-to-center. Edited in the Tamagotchi admin view; applied live via `tama-config-changed`. |
| `tama_name_font_size_px` | `"11"` | Pet name label font size in pixels. Applied live via `tama-config-changed`. |
| `tama_guests_enabled` | `"false"` | Master toggle — enables guest viewer pets globally |
| `tama_guests_twitch` | `"true"` | Allow guest pets from Twitch (only effective when master is on) |
| `tama_guests_tiktok` | `"true"` | Allow guest pets from TikTok (only effective when master is on) |
| `tama_guests_tts` | `"false"` | Enable TTS for guest messages |
| `tama_guests_label_prefix` | `""` | Optional prefix prepended to the guest display name (e.g. `"[G] "`) |
| `tama_guest_mouth_open_path` | `""` | Absolute path to a custom guest mouth-open PNG (empty = use bundled `guest_open.png`) |
| `tama_guest_mouth_closed_path` | `""` | Absolute path to a custom guest mouth-closed PNG (empty = use bundled `guest_closed.png`) |
| `tama_guest_tiktok_avatar` | `"true"` | When `"true"`, TikTok guest pets use the chatter's TikTok profile picture (`data.user.profilePictureUrl`) as their sprite, taking priority over the bundled/custom guest sprite. The avatar is an `https` URL passed straight to the `<img>` (PetManager skips `convertFileSrc` for `http(s)` paths). |
| `tama_layout_mode` | `"dynamic"` | Reinterpreted for the 2D grid: `"static"` => small floor grid (6×1), anything else (incl. legacy `"dynamic"`) => normal grid (150×30). Changing it rebuilds the grid live (`GridManager::reconfigure`). |
| `tama_grid_high_precision` | `"false"` | Doubles both grid axes (the "Matriz de alta precisión" toggle: 6×1→12×2, 150×30→300×60). Rebuilds the grid live. |
| `tama_grid_perspective` | `"true"` | Front rows (higher `cellY`) render larger, back rows smaller. Applied live by the overlay (`Grid2D`). |
| `tama_grid_near_scale` | `"1.3"` | Sprite scale on the front-most row when perspective is on. |
| `tama_grid_far_scale` | `"0.6"` | Sprite scale on the back-most row when perspective is on. |
| `tama_grid_floor_top_frac` | `"0.55"` | Fraction of viewport height where the floor band starts (0–1). |
| `tama_grid_wander_enabled` | `"true"` | When on, the backend periodically nudges pets to a free neighbor cell (wander tick on a tokio interval). Requires an overlay reload to start/stop the task. |
| `tama_static_anchor` | `"left"` | **Legacy** — no longer used by the grid system (kept so get/set config don't drop it). |
| `tama_static_spacing_px` | `"100"` | **Legacy** — no longer used by the grid system. |
| **Streamer persona** | | |
| `streamer_persona_enabled` | `"true"` | Master toggle for the streamer persona overlay (`overlay-streamer.html`) |
| `streamer_sprite_mo_eo` | `""` | Path to the mouth-open / eyes-open sprite (saved by `set_streamer_sprite`) |
| `streamer_sprite_mc_eo` | `""` | Path to the mouth-closed / eyes-open sprite |
| `streamer_sprite_mo_ec` | `""` | Path to the mouth-open / eyes-closed sprite |
| `streamer_sprite_mc_ec` | `""` | Path to the mouth-closed / eyes-closed sprite |
| `streamer_blink_interval_ms` | `"4000"` | Time the eyes stay open between blinks (ms) |
| `streamer_blink_duration_ms` | `"150"` | Duration of a single blink, eyes closed (ms) |
| `streamer_talk_animation` | `"bounce"` | Talk animation: `none`/`bounce`/`abs-bounce`/`tremor`/`sway`/`pulse`/`squash`/`jelly` (`abs-bounce` = dry/abs(sin) bouncing-ball jump; `squash` = squash & stretch; `jelly` = skew wobble) |
| `streamer_size_px` | `"512"` | Sprite display size in pixels |
| `streamer_anchor` | `"center"` | Horizontal anchor: `left`/`center`/`right` |
| `streamer_mic_threshold` | `"20"` | Mic level (0–100) above which the mouth opens |
| `streamer_mic_device_id` | `""` | Selected cpal input device name (empty = system default). Captured natively in Rust — see `streamer_mic/` |
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
| `disconnect_tiktok` | `invoke("disconnect_tiktok")` | Abort TikTok WS client and emit an `info`-level `overlay-notification` ("TikTok desconectado") via `notify_overlay` |

### Tamagotchi (`commands/tamagotchi.rs`)

| Command | TS Signature | Description |
|---|---|---|
| `tama_trigger_action` | `invoke("tama_trigger_action", { user_id, action_id, input })` | Emit `tama-action` event to overlay so PetManager forwards it to the target pet |
| `tama_set_enabled` | `invoke("tama_set_enabled", { enabled })` | Persist `tama_enabled` config key |
| `tama_get_pet_states` | `invoke<PetStateRow[]>("tama_get_pet_states")` | Return all active pet rows (incl. `cell_x`/`cell_y`) joined with display_name from users |
| `tama_upsert_pet_state` | `invoke("tama_upsert_pet_state", { user_id, display_name, cell_x, cell_y, is_sleeping })` | Sync a pet's cell + sleep state to DB (called by overlay on spawn / state change) |
| `tama_remove_pet_state` | `invoke("tama_remove_pet_state", { user_id })` | Free the pet's grid cell (broadcasts `tama-grid-remove`) and delete its DB row (overlay on despawn) |
| `tama_grid_ensure` | `invoke("tama_grid_ensure", { user_id })` | Ensure the pet has a grid cell (allocating one on first call) and broadcast `tama-grid-update`. Called by the overlay when a pet spawns. The backend is authoritative for placement. |
| `tama_grid_get_state` | `invoke<GridSnapshot>("tama_grid_get_state")` | Returns `{ cols, rows, cells: GridUpdatePayload[] }` so a client connecting after pets exist can rehydrate dims + every cell. |
| `tama_grid_move` | `invoke("tama_grid_move", { user_id, cell_x, cell_y })` | Move a pet to the free cell nearest a target (the grid resolves it) and broadcast the update. Used by actions (e.g. fight) instead of hard-coded screen positions. |
| `set_guest_image` | `invoke("set_guest_image", { imageType: "open" \| "closed", imageData: number[] })` | Upload a custom PNG/JPEG sprite for guest pets (max 2 MB). Resizes to 512×512 PNG, saves to `{app_data_dir}/guest_open\|closed.png`, updates `tama_guest_mouth_open\|closed_path` config key and emits `tama-config-changed`. |
| `reset_guest_image` | `invoke("reset_guest_image", { imageType: "open" \| "closed" })` | Clear the custom guest image, reverting to the bundled default. |

### Control (`commands/control.rs`)

| Command | TS Signature | Description |
|---|---|---|
| `restart_discord_bot` | `invoke("restart_discord_bot")` | Re-spawn the Discord bot |
| `connect_twitch` | `invoke("connect_twitch", { channel })` | Save channel and reconnect IRC + EventSub clients |
| `validate_twitch_token` | `invoke<{ username: string, scopes: string[] }>("validate_twitch_token", { token })` | Validates OAuth token against Twitch API. Returns `{ username, scopes }`. Saves `twitch_bot_token`, `twitch_bot_username`, `twitch_client_id`, `twitch_bot_user_id` to DB. |
| `connect_tiktok` | `invoke("connect_tiktok", { username })` | Save username and reconnect WS |
| `toggle_overlay` | `invoke("toggle_overlay")` | Show / hide the overlay window |
| `send_test_message` | `invoke("send_test_message", { display_name, mouth_open_path, mouth_closed_path })` | Emit a test `chat-message` to spawn a test pet |

### Event Alerts (`commands/alerts.rs`)

Cover both Twitch (`cheer`/`sub`/`raid`/`follow`/`hype_train`) and TikTok event kinds. Validated against `ALERT_EVENT_KINDS`.

| Command | TS Signature | Description |
|---|---|---|
| `set_event_alert_asset` | `invoke<string>("set_event_alert_asset", { eventKind, assetType: "image" \| "sound", fileName, data: number[] })` | Save a custom alert image (png/jpg/gif/webp) or sound (mp3/ogg/wav), max 5 MB, **no resize** (preserves animated GIFs), to `{app_data_dir}/alerts/`. Writes the path into `alerts_config`, refreshes cache, emits `event-alerts-changed`. Returns the saved path. |
| `clear_event_alert_asset` | `invoke("clear_event_alert_asset", { eventKind, assetType: "image" \| "sound" })` | Clear an event's image/sound reference in `alerts_config` (file left on disk). |
| `test_event_alert` | `invoke("test_event_alert", { eventKind })` | Emit a preview `event-alert` for `eventKind` using sample data (`user="TestUser"`, `amount=100` for gift/cheer/raid kinds), ignoring the `enabled` flag. |

### Streamer Persona (`commands/streamer.rs`)

| Command | TS Signature | Description |
|---|---|---|
| `set_streamer_sprite` | `invoke("set_streamer_sprite", { slot: "mo_eo" \| "mc_eo" \| "mo_ec" \| "mc_ec", imageData: number[] })` | Save a streamer persona sprite for the given mouth×eyes slot. These are the streamer's own assets, so bytes are written **verbatim at full quality** (png/jpg/webp/gif, max 25 MB, **no resize / no re-encode** — only the header is sniffed to validate + pick the extension) to `{app_data_dir}/streamer_{slot}.{ext}`. Writes the path into the matching `streamer_sprite_*` key, refreshes cache, emits `streamer-config-changed`. |
| `reset_streamer_sprite` | `invoke("reset_streamer_sprite", { slot })` | Clear the slot's `streamer_sprite_*` key (file left on disk). |
| `streamer_list_mics` | `invoke<MicDevice[]>("streamer_list_mics")` | List native audio input devices (`{ id, name }`, `id` = cpal device name, empty = system default) for the panel's device picker. Replaces the old browser `navigator.mediaDevices.enumerateDevices()`. |
| `streamer_mic_apply` | `invoke("streamer_mic_apply")` | (Re)configure native mic capture from the current `streamer_persona_enabled` / `streamer_mic_device_id` / `streamer_mic_threshold` config. Called by the panel after toggling the persona, changing device, or moving the threshold; also called once at startup in `lib.rs`. |

---

## 8. Tauri Events

### Rust → Frontend

All events marked **WS** are also broadcast to OBS Browser Source clients via `state.broadcast_ws()`.

| Event | Payload | Emitter | Tauri Listener | WS |
|---|---|---|---|---|
| `chat-message` | `ChatMessagePayload` | `twitch/`, `tiktok/`, `control.rs` (test) | `PetManager` (overlay.ts) | Yes |
| `chat-event` | `ChatEventPayload` | `twitch/eventsub.rs`, `tiktok/mod.rs` | `eventReactions.ts` (overlay.ts) | Yes |
| `event-alert` | `EventAlertPayload` | `alerts/mod.rs` (resolved per-event, called from `twitch/eventsub.rs` + `tiktok/mod.rs`), `commands/alerts.rs` (test) | `AlertManager` (overlay-alerts.ts) | Yes |
| `event-alerts-changed` | `AppConfig` (full) | `commands/alerts.rs` (asset set/clear) | `eventos.ts` (admin panel) | No |
| `animation-config-changed` | `AppConfig` (full) | `commands/config.rs` (`save_animation_config`) | overlay — reload animation params | No |
| `tama-config-changed` | `AppConfig` (full) | `commands/config.rs` (`set_config_cmd` when key starts with `tama_`) | `PetManager._onTamaConfigChanged` — applies all tama settings live | Yes |
| `streamer-config-changed` | `AppConfig` (full) | `commands/config.rs` (`set_config_cmd` when key starts with `streamer_`), `commands/streamer.rs` (sprite set/reset) | `StreamerPersona.applyConfig` (overlay-streamer.ts) — applies sprites/timing/anim live | Yes |
| `tts-state` | `TtsStatePayload` | `tts/mod.rs` | `PetManager` (lip-sync only) | Yes |
| `chroma-color-changed` | `string` (hex color) | `commands/config.rs` | `overlay.ts` | Yes |
| `overlay-will-show` | `()` | `commands/control.rs` | `overlay.ts` (fade cover reset) | Yes |
| `tama-action` | `{ user_id, action_id, input }` | `commands/tamagotchi.rs` | `PetManager` (overlay.ts) | Yes |
| `tama-grid-config` | `{ cols, rows }` | `grid/mod.rs` (`reconfigure`) | `PetManager` → `Grid2D.setDimensions` | Yes |
| `tama-grid-update` | `GridUpdatePayload` | `grid/mod.rs` (assign / move / wander) | `PetManager` → `BasePet.applyCell` | Yes |
| `tama-grid-remove` | `{ user_id }` | `grid/mod.rs` (`release`) | `PetManager` (drops local cell) | Yes |
| `twitch-connected` | `string` (channel) | `twitch/mod.rs` (on RoomState) | `main.ts` | No |
| `twitch-error` | `string` (error msg) | `twitch/mod.rs` | `main.ts` | No |
| `tiktok-connected` | `string` (username) | `tiktok/mod.rs` (on handshake success), via `emit_tiktok_status` | `main.ts` | No |
| `tiktok-error` | `string` (error msg) | `tiktok/mod.rs` (on connect failure **or** mid-stream WS read error), via `emit_tiktok_status` | `main.ts` | No |
| `overlay-notification` | `{ level: "success" \| "error" \| "info", message: string }` | `tiktok/mod.rs` (`notify_overlay`, called from `emit_tiktok_status` and `disconnect_tiktok`) | `overlay-notifications.ts` (all overlay views, via `app.emit_to("overlay", ...)` for the Tauri window) | Yes |
| `streamer-speaking` | `{ speaking: boolean }` | `streamer_mic/mod.rs` (native cpal capture, threshold + hang-time) | `overlay-streamer.ts` → `StreamerPersona.setSpeaking()` | Yes (WS only — no Tauri window for this overlay) |
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
  event_kind: string;     // "cheer" | "sub" | "raid" | "follow" | "tiktok_gift" | "tiktok_gift_big" | "tiktok_like" | "tiktok_follow" | "tiktok_share" | "tiktok_subscribe" | "tiktok_envelope" | "tiktok_member"
  username: string;
  user_id: number | null; // null if user not in DB
  display_name: string;
  amount: number | null;  // bits for cheer, viewers for raid, diamonds for gift
  text: string | null;    // cheer message
  extra: Record<string, unknown>;
}
```

> `eventReactions.ts` maps `event_kind` to a tama action via `ACTION_MAP` and calls `pet.executeAction()`. Raid and hype_train fire on a random pet regardless of user_id.

### `EventAlertPayload`

```typescript
interface EventAlertPayload {
  event_kind: string;   // Twitch: "cheer"/"sub"/"raid"/"follow"/"hype_train"; TikTok: "tiktok_gift", "tiktok_follow", …
  image_path: string;   // absolute OS path (convert via convertFileSrc/browserConvertFileSrc); empty = no image
  sound_path: string;   // absolute OS path; empty = no sound
  text: string;         // already-formatted ({user}/{amount} resolved by the backend)
  duration_ms: number;
  transition: string;   // "fade" | "slide-down" | "slide-up" | "scale" | "none"
}
```

> Emitted as `event-alert`. The backend resolves the per-event alert config (text tokens, asset paths) before emitting, so the overlay (`AlertManager`) only renders + queues. Real events emit only when the event's `enabled` flag is set and after the per-event cooldown filter passes; `test_event_alert` emits regardless of `enabled` for previewing. The resolve/emit logic lives in `src-tauri/src/alerts/mod.rs` and is shared by `twitch/eventsub.rs` and `tiktok/mod.rs`.

### `TtsStatePayload`

```typescript
interface TtsStatePayload {
  user_id: number;   // Matches ChatMessagePayload.user_id
  speaking: boolean; // true = TTS started, false = TTS finished
}
```

### `GridUpdatePayload` (2D pet grid)

```typescript
interface GridUpdatePayload {
  user_id: number;
  cell_x: number;   // column, 0 = left
  cell_y: number;   // row, 0 = back of the floor band (far/small), higher = front (near/large)
}
```

> **Backend-authoritative pet positioning.** `grid/mod.rs` (`GridManager`, an `Arc` in `AppState`, modeled on `streamer_mic`) owns every pet's cell and the occupancy set. It assigns cells, runs a wander tick (tokio interval), and resolves the nearest free cell for fight/actions, broadcasting `tama-grid-*` over BOTH `app.emit` and `broadcast_ws`. The overlay only translates cell → pixels via `src/overlay/tamagotchi/core/Grid2D.ts` (floor band + perspective scale). There is no local idle-walk loop in `BasePet` anymore — it just renders the cell the backend assigns. Dimensions are fixed per mode: small 6×1 (`tama_layout_mode="static"`) / normal 150×30, doubled by `tama_grid_high_precision`.

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

### OBS Browser Source URL block (mandatory for every browser-source overlay)

Every admin view that owns a browser-source overlay (`overlay-browser`, `overlay-alerts`, `overlay-streamer`, …) must expose its URL with the **same standard block**, placed **inside a `.card`**: a `.section-title` (inside the card) titled exactly **"OBS Browser Source"** with the `externalLink` icon, a `view-subtitle` description, then a read-only input holding the full URL plus a **"Copiar"** button on the same row. No `<label>` above the input (it's redundant), and do **not** inline the URL inside a `<code>` tag or prose. This keeps every overlay discoverable in the same place/shape across views (config / eventos / streamer all use the identical block).

```typescript
// In the view's innerHTML (inside a `.card`):
`<div class="section-title" style="display:flex;align-items:center;gap:6px;">${Icons.externalLink(16)} OBS Browser Source</div>
 <p class="view-subtitle" style="margin:8px 0;">Agregá esta URL como <strong>Browser Source</strong> en OBS:</p>
 <div style="display:flex;gap:8px;">
   <input id="xxx-obs-url" type="text" readonly value="http://localhost:6767/overlay-xxx" style="flex:1;"/>
   <button id="xxx-copy-url" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;">${Icons.copy(14)} Copiar</button>
 </div>`

// After render — copy handler with toast:
container.querySelector("#xxx-copy-url")?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText("http://localhost:6767/overlay-xxx");
    showToast("URL copiada al portapapeles", "success");
  } catch {
    showToast("No se pudo copiar al portapapeles", "error");
  }
});
```

The port is always `6767` (the axum server, Section 14 / `server/mod.rs`); the path matches the route registered in `build_router()` for that overlay.

---

### ViewRouter

The router in `router.ts` is manual, hash-based (`#/config`, `#/users`, etc.).

```typescript
export type ViewId = "config" | "users" | "logs" | "tamagotchi" | "twitch" | "tiktok" | "eventos" | "streamer";
```

- **Cached, persistent panes — render once, no "loading" flash.** Each view lives in its own `<div class="view-pane">` appended to `#view-container`. A view is rendered **exactly once** (lazily, the first time it is shown); navigating afterwards only toggles `display` between panes. This is a local desktop app, so there is no loading spinner and no full re-render on navigation — switching views (or returning to one) preserves scroll position, form state, collapsed cards and live listeners. Do **not** reintroduce a `container.innerHTML = "...loading..."` step.
- Each view exports `render<Name>(pane: HTMLElement): Promise<void>` and paints into the `pane` it is given (`const container = pane;`). Never grab `#view-container` directly — multiple panes coexist, so writing to the shared container would clobber other views. View-internal control ids must stay unique across views (they already use per-view prefixes: `evt-`, `twitch-`, `tiktok-`, `tama-`, `cfg-`, …).
- **Re-rendering after a state change:** call `router.invalidate(view)` — it re-renders that view now if it's the active one, otherwise marks it to re-render next time it's shown, without touching other cached panes. Used by `main.ts` on connection events (`*-connected`/`*-error`) and by views after a mutating action (user edit, sprite upload). `router.navigate(view)` is only for switching the visible view.
- To add a new view: add an entry in `routes`, create `src/views/<name>.ts` exporting `render<Name>(pane)`, and add `data-view="new-view"` to the sidebar in `index.html`.

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
- `showToast` is **focus-aware**: if `document.hasFocus()` is false, the toast is queued (`toastQueue`, capped at `MAX_QUEUED = 8`) instead of rendered, so it isn't missed while the user is looking at the overlay/OBS instead of the panel. The queue is flushed via `flushToastQueue()` on the panel's `"focus"` and first `"pointerdown"` events (`wireFocusFlush()`, wired once).
- For notifications that the streamer should see even when the panel isn't focused (e.g. TikTok connection state), also emit `overlay-notification` (see `notify_overlay` in `tiktok/mod.rs`) — it is rendered by `overlay-notifications.ts` directly on the overlay/OBS Browser Source.

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

- `spawn_tiktok_client(state, app_handle)`: connects via WebSocket to TikTool, building the URL from config as `{tiktok_ws_endpoint}/?uniqueId={username}&apiKey={tiktok_api_key}` (a leading `@` in the username is stripped). The `/` before the query string is **required** — without a path the handshake request line is malformed and Cloudflare (fronting `api.tik.tools`) returns 400.
- If `tiktok_username` or `tiktok_api_key` is empty, returns without connecting.
- Connection state changes (connect success, connect failure, mid-stream WS read error) all route through `emit_tiktok_status(app, state, status)` with `TiktokStatus::Connected(username)` or `TiktokStatus::Error(message)`. This single function emits the legacy `tiktok-connected`/`tiktok-error` events for `main.ts` **and** calls `notify_overlay` so the streamer also sees the connection state change on the overlay (not just the panel) — this fixed a previously-silent mid-stream disconnect that only logged to the terminal.
- `notify_overlay(app, state, level, message)` emits `overlay-notification` to the Tauri "overlay" window and broadcasts it over WS, so every overlay view (Tauri + OBS Browser Source) shows the toast via `overlay-notifications.ts`.
- Each frame is JSON `{ "event": "<type>", "data": { ... } }`. **The username is nested at `data.user.uniqueId`** (TikTool's real shape); use the `extract_unique_id(data)` helper, which falls back to a flat `data.uniqueId`. The chat text is `data.comment`.
- Every raw frame is logged at `info!` as `[tiktok/raw] {...}` (diagnostic — lower to `debug!` if too noisy), and each event as `[tiktok] evento recibido: '<type>'`.
- Handles multiple event types with per-event config gates:
  - `chat` → user lookup → emit `chat-message` (length filter counts **chars**, not bytes, + TTS)
  - `gift` → emit `chat-event` with `event_kind: "tiktok_gift"` or `"tiktok_gift_big"` (only when `repeatEnd = true`)
  - `like` → emit `chat-event` with `event_kind: "tiktok_like"`
  - `social` → emit `chat-event` with `event_kind: "tiktok_follow"` or `"tiktok_share"` (based on `displayType`)
  - `subscribe` → emit `chat-event` with `event_kind: "tiktok_subscribe"`
  - `envelope` → emit `chat-event` with `event_kind: "tiktok_envelope"`
  - `member` → emit `chat-event` with `event_kind: "tiktok_member"` (gated by `tiktok_event_member_enabled`, default off — high-frequency)
- After emitting `chat-event`, each gift/like/social/subscribe/member handler calls `alerts::maybe_emit_alert(...)`, which reads `alerts_config` from the cache and, if the event's alert is `enabled`, emits a fully-resolved `event-alert` (text tokens `{user}`/`{amount}` filled; `{user}` = nickname when present, else uniqueId). The shared `alerts/mod.rs` module holds `resolve_alert` (builds the payload) and `emit_test_alert` (used by `test_event_alert`, forces it regardless of `enabled`). The Twitch EventSub handler (`twitch/eventsub.rs`) calls the same `alerts::maybe_emit_alert` for `cheer`/`sub`/`raid`/`follow`.
- All non-chat events also call `state.broadcast_ws("chat-event", &payload)`.
- **Risk:** TikTool's free sandbox is limited (50 req/day, 1 WS connection). Production requires a paid plan (~$7/week).
- **Local dev/testing:** When TikTool is unavailable, simulate chat events with a local WebSocket mock server that emits the same JSON structure as TikTool's `chat` events.

### `server/`

- `start_server(app_state, dist_dir, dev_mode)`: spawns an axum HTTP server on port 6767 (and best-effort on port 80 for the TikTok LIVE `eso.tilin.com` trick — see §16). Routes are built by `build_router()` (split out so the `router_builds_without_panicking` test can validate route syntax — see §16 "axum route syntax + silent panics"). **Uses axum 0.7 route syntax** (`/assets/*path`, not the 0.8 `{*path}`).
- Routes: `GET /overlay` (serves `overlay-browser.html`), `GET /overlay-alerts` (serves `overlay-alerts.html` — the dedicated event-alert browser source for Twitch + TikTok; `GET /overlay-tiktok` is kept as a backwards-compat alias serving the same page), `GET /overlay-streamer`, `GET /assets/*` (Vite-compiled JS/CSS), `GET /persona?path=` (pet sprites **and alert images/sounds** from OS filesystem, path-traversal-protected), `GET /ws` (WebSocket). `serve_overlay_file(filename)` is shared by all overlay routes (dev rewrite vs embedded prod).
- **Bind strategy**: tries `127.0.0.1:6767` (IPv4 loopback) with up to 3 attempts and 1 s between retries to recover from TIME_WAIT left by a previous instance. Also binds `[::1]:6767` (IPv6 loopback) concurrently — on Windows 10 `localhost` often resolves to `::1` first, so without the IPv6 listener the browser gets connection refused even when the IPv4 server is healthy. If only one address is available the server runs on that address alone; if neither is available the task logs an error and exits.
- **Dev mode** (`dev_mode = true`): reads `overlay-browser.html` from the project root (not `dist/`) and rewrites `/src/*` references to `http://localhost:1420/src/*` so assets are served by the Vite dev server. Enabled automatically when compiled in debug mode (`cfg(debug_assertions)`).
- **Production mode**: all frontend assets are embedded at compile time via `rust-embed` (`#[folder = "../dist"]`) — no external `dist/` folder is needed next to the binary.
- The WebSocket handler subscribes to `AppState.ws_tx` and forwards broadcast messages to each connected client. It also receives commands from the browser overlay (`get_config_cmd`, `tama_upsert_pet_state`, `tama_remove_pet_state`) and executes them against the DB.
- **Security:** `/persona` canonicalizes both the requested path and `app_data_dir` before calling `starts_with` — this handles the Windows `\\?\` extended-path prefix and prevents path traversal. It sets `Content-Type` by extension and now also serves audio (`mp3`/`ogg`/`wav`) and `gif`/`webp`, since alert assets live under `{app_data_dir}/alerts/`.

### `tts/`

- Wrapper over the `tts` crate abstracting SAPI (Windows), NSSpeechSynthesizer (macOS), and espeak (Linux).
- `speak_with_events(text, voice_id, user_id, app_handle, ws_tx)` emits `tts-state { user_id, speaking: true }` before speaking and `speaking: false` after finishing. Also broadcasts both events via `ws_tx` so the OBS Browser Source overlay receives lip-sync events.
- TTS events are consumed by `PetManager._onTtsState()` to drive pet lip-sync (mouth open/closed). Positioning is unrelated — it is owned by the backend grid.
- TTS may not be available in all environments — handle errors with `tracing::warn!` without propagating panics.

### `streamer_mic/`

- Captures the streamer's microphone **natively** (cpal/WASAPI on Windows) in the backend — the `overlay-streamer.html` OBS Browser Source never calls `getUserMedia` and never triggers a mic permission prompt.
- `list_input_devices()` enumerates cpal input devices for the panel's picker (`streamer_list_mics` command).
- `StreamerMic::apply(state, enabled, device_id, threshold)` (re)configures capture: starts a dedicated `"streamer-mic"` thread when enabled, stops it when disabled, restarts on device change, and updates the threshold live via an `AtomicU32` (no restart) when only the threshold changed. Called from `streamer_mic_apply`, from `lib.rs` at startup, and indirectly whenever the panel saves `streamer_persona_enabled` / `streamer_mic_device_id` / `streamer_mic_threshold`.
- `cpal::Stream` is `!Send`, so the stream is owned entirely by its capture thread; only atomics (`running: AtomicBool`, `threshold: AtomicU32`, raw level) cross the thread boundary.
- The capture thread runs a ~60 Hz poll loop: asymmetric smoothing (rises fast, falls slow) on the RMS level (`rms_to_level`, RMS × 200 clamped to 0–100), compares against `threshold`, and applies a 120 ms hang time so the mouth doesn't snap shut between syllables.
- Only emits `streamer-speaking { speaking: bool }` via `state.broadcast_ws(...)` when the speaking state actually flips — no audio data ever leaves the backend.

### `db/`

- All SQLite interaction goes through functions in `db/users.rs` and `db/config.rs`.
- **Do not run raw SQL inside Tauri commands.** Use the `db` module functions.
- Migrations are idempotent (`IF NOT EXISTS`).

---

## 11. Development Commands

### Linux build prerequisite (ALSA)

The native mic capture (`cpal`, see `streamer_mic/`) links `alsa-sys` on Linux, which needs the ALSA dev library at build time. Without it `cargo build`/`clippy` panics with *"Package alsa was not found in the pkg-config search path"*. Install it alongside the Tauri WebKit deps:

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf \
  libspeechd-dev libasound2-dev
```

Windows (WASAPI) and macOS (CoreAudio) need no extra audio libraries. The CI and release workflows install `libasound2-dev` in their Linux dependency step for the same reason.

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

TikTool requires an internet connection and an API key. For offline TikTok development, run a local WebSocket server that mimics TikTool's `chat` JSON format and point `tiktok_ws_endpoint` to `ws://localhost:{port}` (the client appends `/?uniqueId=...&apiKey=...`). The event shape expected is:

```json
{ "event": "chat", "data": { "user": { "uniqueId": "username", "nickname": "Display" }, "comment": "message text" } }
```

(The parser also accepts a flat `data.uniqueId` for simpler mocks.)

---

## 12. Rules and Restrictions for Agents

1. **Do not break the `ViewRouter` pattern**: every panel view goes in `src/views/`, exports `render<Name>(pane: HTMLElement)`, paints into its given `pane` (cached/persistent — render once, no loading flash), and is registered in `router.ts`. Exception: `src/views/overlay.ts` is the overlay entry point and is not a router view.
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
      --> If pet does not exist: BasePet constructed + spawn() animation, then tama_grid_ensure
          (backend assigns a cell, broadcasts tama-grid-update, pet snaps/glides to it)
      --> if tama_jump_on_speak=true: pet.executeAction("jump") in place
      --> else: pet.onChatMessage() (resets inactivity timer / wakes if asleep)
  --> (parallel) TTS reads the message
      --> tts-state { speaking: true }  --> pet opens mouth (lip-sync only)
      --> tts-state { speaking: false } --> pet closes mouth
```

---

## 14. Security Considerations

- `tauri.conf.json` has `"csp": null` in development. **Before production**, configure a restrictive CSP.
- Discord and TikTool tokens are stored in SQLite in `app_data_dir`. Consider migrating to the `keyring` crate (OS Credential Manager) for stronger security.
- Persona images come from Discord — validate MIME type and size before saving.
- The overlay window is a **normal window** — it must NOT use `skipTaskbar`, `alwaysOnTop`, or `decorations: false`. It is captured by OBS via Window Capture, not rendered on top of the OS desktop.

---

## 15. Tamagotchi Pet System

Persistent chat-user pets placed on a backend-authoritative 2D grid over the bottom of the overlay window. Each registered viewer who sends a chat message spawns a small pet (their persona images). The Rust grid assigns each pet a cell; pets wander between free cells, react to chat events, execute random or admin-triggered actions, sleep after inactivity, and eventually despawn. See §17 for the grid model.

### Architecture

```
overlay.ts
  --> PetManager.init(container)  (static singleton, src/overlay/tamagotchi/core/)
        |
        +-- listen("chat-message")    --> _onChatMessage  --> spawn / wake BasePet, then tama_grid_ensure
        +-- listen("tts-state")       --> _onTtsState     --> lip-sync mouth
        +-- listen("tama-action")     --> _onTamaAction   --> pet.executeAction()
        +-- listen("tama-grid-config")--> Grid2D.setDimensions + re-translate all pets
        +-- listen("tama-grid-update")--> pet.applyCell(cell -> Grid2D.cellToPx)
        +-- listen("tama-grid-remove")--> drop local cell
        |
        +-- PetScheduler  (random action roll every 8 s at 15% probability)
        +-- Grid2D        (cell -> px translator + perspective; backend owns the cells)

  --> setupEventReactions()  (src/overlay/tamagotchi/eventReactions.ts)
        |
        +-- listen("chat-event")  --> ACTION_MAP[event_kind] --> pet.executeAction()
              raid / hype_train   --> PetManager.getRandomPet(-1).executeAction("jump")
              other events        --> PetManager.get(user_id).executeAction(ACTION_MAP[event_kind])
```

### Core modules (`src/overlay/tamagotchi/core/`)

| File | Role |
|---|---|
| `PetStateMachine.ts` | FSM with transition(), onEnter(), canDo(). Valid states: spawning → idle, idle → action → idle, idle → sleeping → despawning. (The old approaching/talking/returning focus states are gone — pets no longer walk to a center; the backend places them.) |
| `BaseAction.ts` | Abstract base for all actions. Uses `import type { BasePet }` (avoids circular dep). Provides `wait(ms)`, `cancelled` flag, `onCancel()` hook |
| `ActionRegistry.ts` | Static singleton. Actions self-register at module load via `ActionRegistry.register(MyAction)`. Exposes `get()`, `getAllMeta()`, `getRandomId()` (weighted by `probability`) |
| `Grid2D.ts` | Pure cell → pixel translator. Holds the grid dimensions + perspective config received from the backend (`tama-grid-config` / `get_config`). `cellToPx(cellX, cellY, petSizePx)` maps a cell onto the floor band (`floorTopFrac`..bottom) and returns `{ left, top, scale, z }`. Perspective: `scale = lerp(farScale, nearScale, cellY/(rows-1))`. Holds NO authoritative pet state. |
| `BasePet.ts` | Concrete pet class. Manages DOM, FSM transitions, mouth images, sleep, despawn, and DB persistence via `tama_upsert_pet_state` (now `cellX`/`cellY`) / `tama_remove_pet_state`. **No local walk loop** — `applyCell(cell, cellPx, animateMove)` is called by PetManager to glide/snap the pet to the backend-assigned cell. The perspective `scale()` + horizontal flip live on `.pet-inner` (combined transform), leaving the outer `.el` transform free for actions. `updateSize(px)` / `updateNameFontSize(px)` apply runtime config to existing pets. `BasePet.inactivityMs` is static mutable. |
| `PetScheduler.ts` | `setInterval` at `tama_action_check_secs`. Rolls a random action for a random idle pet; excludes `"idle_walk"` and `"sleep"` from the pool. `enabledActionIds` further restricts the pool to `tama_enabled_actions`. `update(checkSecs, probability, enabledActions?)` restarts the interval. |
| `PetManager.ts` | Static singleton. Owns `Map<userId, BasePet>` + a `Map<userId, cell>` mirror + the shared `Grid2D`. Listens to chat-message/tts-state/tama-action and the `tama-grid-*` events; on spawn it calls `tama_grid_ensure` so the backend assigns a cell. `getCell()`, `getGrid()`, `requestMove(userId, cellX, cellY)` (→ `tama_grid_move`) are used by actions (fight). Re-translates every pet's cell → px on window resize (cells stay authoritative). `_onTamaConfigChanged()` applies enabled/maxPets/petSizePx/perspective/floorTopFrac/inactivity/scheduler live. |

### Actions (`src/overlay/tamagotchi/actions/`)

Each action file calls `ActionRegistry.register(MyAction)` at the bottom — importing the file triggers registration (side-effect import pattern).

| Action ID | Class | Description |
|---|---|---|
| `idle_walk` | `IdleWalkAction` | No-op placeholder; excluded from random pool |
| `jump` | `JumpAction` | Squash-and-stretch jump loop |
| `popcorn` | `PopcornAction` | Pet holds a popcorn bucket and watches chat |
| `fight` | `FightAction` | Two pets converge on a meeting cell (the grid's free cell nearest their midpoint via `PetManager.requestMove` → `tama_grid_move`), shake, show a fight cloud, bounce away, then request a move back to their original cells. Movement is backend-authoritative; only the shake/cloud/impact FX run locally. After WAAPI FX, `el.style.transform` is cleared on both pets so it doesn't fight the cell transform. |
| `explode` | `ExplodeAction` | Tremor, flash, particle burst, then respawn with spring |
| `dance` | `DanceAction` | Rhythmic rotate + translateY loop |
| `sleep` | `SleepAction` | Pet tilts + ZZZ props; cancelled on next chat message |
| `confetti` | `ConfettiAction` | 10 colored DOM particles burst from pet position; probability 0 (event-triggered only) |
| `hype_train` | `HypeTrainAction` | 🚂 emoji text scrolls across the floor from left to right; probability 0 (event-triggered only). |

To add a new action, copy `_template.ts`, implement `execute()`, set `meta.id` and `meta.probability`, and call `ActionRegistry.register()` at the bottom. Import the file in `PetManager.ts` to activate it.

### Props (`src/overlay/tamagotchi/props/`)

- **`PropRenderer`** — creates and animates DOM prop elements (ZZZ bubbles, speech bubbles, etc.). Constructor takes no arguments; `parentEl` is passed to each method.
- **`PropAssetLoader`** — static blob-URL cache for external asset URLs.

### Pet lifecycle

```
chat-message (new user)
  --> BasePet constructed   (DOM element; position applied later from the grid)
  --> pet.spawn()           (pop-in animation, then FSM → "idle")
  --> PetManager calls tama_grid_ensure(user_id)
        --> backend assigns a free cell, broadcasts tama-grid-update
        --> PetManager.applyCell(...) snaps/glides the pet to its cell px
  --> if jumpOnSpeak: pet.executeAction("jump") in place
  --> else: pet.onChatMessage()  (just resets the inactivity timer / wakes if asleep)

backend wander tick (fixed 6 s interval, if tama_grid_wander_enabled)
  --> each pet ticks its own randomized cooldown; when it elapses the pet
      strolls to a far free cell that ideally has personal space
  --> tama-grid-update --> pet.applyCell(..., animateMove=true) glides it

tts-state speaking=true/false --> pet.setMouth(open/closed)  (lip-sync only)

5 min inactivity
  --> FSM → "sleeping"  (PropRenderer shows ZZZ, DB persists is_sleeping=true)
  --> 30 s later: FSM → "despawning"  (fade-out, el.remove(), DB row deleted)

chat-message (returning user while sleeping)
  --> _resetInactivityTimer(), onChatMessage() wakes the pet
```

### Admin panel (`src/views/tamagotchi.ts`)

**Layout & Components:**
- **Header** — Tamagotchi title with system ON/OFF toggle (teal accent, status text)
- **Config card** — grid of custom-styled range sliders (pet size, max visible, inactivity, action interval, probability, name size) + grid controls: matrix size mode (Piso estático 6×1 / Normal 150×30), "Matriz de alta precisión" toggle, "Movimiento ambiental" toggle, "Efecto de perspectiva" toggle with near/far scale sliders, and the floor-band start slider
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

### TikTok LIVE Studio (port 80 + `hosts` trick)

TikTok LIVE Studio's Browser Source field runs a **client-side regex** that rejects any URL containing `localhost`, a raw IP, or an explicit port (it renders the source locally, like OBS — it does *not* fetch the URL server-side). So `http://localhost:6767/overlay` is refused, but `http://eso.tilin.com/overlay` is accepted.

Two pieces make a fully **local** overlay pass that filter:

1. **`start_server` also binds port 80** (`127.0.0.1:80` + `[::1]:80`) in addition to `:6767`, so the URL needs no port. The bind is best-effort — if port 80 is taken (IIS, Skype, `http.sys`) it logs a warning and keeps serving on `:6767` only. See `server/mod.rs`.
2. **A `hosts` entry** maps a real-looking domain to loopback (one-time, requires admin):

   ```powershell
   Add-Content -Path "$env:windir\System32\drivers\etc\hosts" -Value "`n127.0.0.1`teso.tilin.com`n127.0.0.1`toverlay.streampersona.app" -Encoding ASCII
   ipconfig /flushdns
   ```

The streamer then uses `http://eso.tilin.com/overlay`, `…/overlay-streamer`, `…/overlay-alerts` (legacy `…/overlay-tiktok` still works) (or `overlay.streampersona.app` if the short domain looks suspicious). The URL resolves to the local server; nothing is exposed to the internet. `ws-transport.ts` derives its WS/HTTP base from `window.location` (not a hardcoded `localhost:6767`), so the overlay connects back to whatever host it was served from — `localhost:6767` in OBS or `eso.tilin.com:80` in TikTok.

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
{ "event": "tama-grid-config", "payload": { "cols": 150, "rows": 30 } }
{ "event": "tama-grid-update", "payload": { "user_id": 1, "cell_x": 80, "cell_y": 20 } }
{ "event": "tama-grid-remove", "payload": { "user_id": 1 } }
{ "event": "chroma-color-changed", "payload": "#00FF00" }
{ "event": "overlay-will-show",    "payload": null }
```

**Client → Server (commands):**
```json
{ "id": "uuid-v4", "command": "get_config_cmd" }
{ "id": "uuid-v4", "command": "tama_upsert_pet_state", "args": { "userId": 1, "cellX": 80, "cellY": 20, "isSleeping": false, "displayName": "..." } }
{ "id": "uuid-v4", "command": "tama_remove_pet_state", "args": { "userId": 1 } }
{ "id": "uuid-v4", "command": "tama_grid_ensure",   "args": { "userId": 1 } }
{ "id": "uuid-v4", "command": "tama_grid_move",     "args": { "userId": 1, "cellX": 75, "cellY": 18 } }
{ "id": "uuid-v4", "command": "tama_grid_get_state" }
```

> The grid WS commands have AppState-only variants in `grid/mod.rs` (`ensure_ws` / `move_to_nearest_free_ws` / `release_ws`) because the WS dispatcher has an `AppState` but no `AppHandle` — they broadcast over the WS fan-out only (the OBS Browser Source has no Tauri window to `emit` to).

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

### ⚠️ Critical: axum route syntax + silent panics in the server task

**Symptom:** the OBS Browser Source shows `ERR_CONNECTION_REFUSED` on `http://localhost:6767/overlay` in a **release `.exe`**, while `tauri dev` works fine — "as if the server never started."

**Root cause (real incident):** the catch-all route was written `/assets/{*path}` — that is **axum 0.8** syntax. This project is pinned to **axum 0.7** (`Cargo.lock` → axum 0.7.9 / matchit 0.7.3), where the catch-all form is `/assets/*path` (asterisk, no braces). axum validates routes at **registration time** and *panics*:

```
panicked at src/server/mod.rs: Invalid route "/assets/{*path}":
catch-all parameters are only allowed at the end of a route
```

That panic fires inside `start_server` **before the socket `bind`**. Because the server runs in a detached `tauri::async_runtime::spawn` task, the panic was swallowed — the task just died and port 6767 was never opened. It only surfaced in release because `tauri dev` loads the overlay from the Tauri window / Vite (`:1420`), not from the axum server on `:6767`; only the OBS Browser Source depends 100% on axum.

**Why it's guarded now:**
- `build_router()` is split out from `start_server`, and the `router_builds_without_panicking` test in `server/mod.rs` constructs it — any invalid route syntax now fails `cargo test`/CI instead of a shipped binary.
- The server task in `lib.rs` is wrapped in `catch_unwind`, so any future panic is logged (`[server] La tarea del servidor paniqueó...`) instead of disappearing.

**Rule:** when touching routes, use axum **0.7** syntax (`*name` catch-all, `:name` params). If you upgrade to axum 0.8, switch to `{*name}` / `{name}` *and* bump the version in `Cargo.toml`/`Cargo.lock` together. Never rely on a release build to catch a route-syntax mistake.

### Adding a New Event to the Browser Source

1. Emit via Tauri as usual: `app.emit("my-event", &payload)`
2. Immediately after, broadcast: `state.broadcast_ws("my-event", &payload)`
3. In `overlay-browser.ts` or wherever needed: `wsListen("my-event", handler)`

## 17. Pet positioning — backend-authoritative 2D grid

Pet placement is owned entirely by Rust (`grid/mod.rs`, modeled on `streamer_mic`). The overlay never decides where a pet stands; it renders the cell the backend assigns. See §8 (`GridUpdatePayload`) and §16 (core modules / lifecycle) for the full flow.

- **Grid model** — the screen is a `cols × rows` grid laid over a floor band. Cell `(0,0)` is the back-left (far/small); higher `cellY` is the front (near/large). Dimensions are fixed per mode: small `6×1` (`tama_layout_mode = "static"`) / normal `150×30`, doubled when `tama_grid_high_precision` is on.
- **Assignment** — on spawn the overlay calls `tama_grid_ensure(user_id)`; the backend allocates a free cell (front-center bias, **two-pass**: first only cells with personal space, then any free cell) and broadcasts `tama-grid-update`. The overlay **snaps** the pet to its first cell (never walks it from the `(0,0)` corner — that read as a bug); subsequent updates animate. The pet `applyCell`s to the resolved pixels.
- **Wander** — if `tama_grid_wander_enabled`, a tokio interval task (`GridManager::wander_tick`, fixed 6 s period) drives **asynchronous** movement: each pet has its own randomized cooldown (`wander_wait`, 1–5 ticks) so they don't all step on the same beat. When a pet's cooldown elapses it strolls to a far free cell (`WANDER_MIN/MAX_STEP`, mostly horizontal) that ideally has **personal space** — `random_free_step` tries several candidates and prefers one with no occupied cell inside an *anisotropic* spacing rectangle (wider in X than Y via `SPACING_FRAC_X/Y`, since a sprite spans more columns than rows on screen). Only moved pets emit an update.
- **Actions** — fight (and any movement action) call `PetManager.requestMove(userId, cellX, cellY)` → `tama_grid_move`, which resolves the free cell nearest the target via an expanding ring search and resets that pet's wander cooldown so it doesn't immediately stroll off. The overlay animates the resulting `tama-grid-update`.
- **Perspective** — `Grid2D.cellToPx` applies `scale = lerp(farScale, nearScale, cellY/(rows-1))` when `tama_grid_perspective` is on, so front-row pets are larger. The scale lives on `.el` via the individual `scale` CSS property (so it scales the sprite, the name label, AND action props together and composes with the `transform` strings actions animate); only the horizontal flip lives on `.pet-inner`.
- **Resize** — `PetManager` re-translates each pet's authoritative cell to new pixels on window resize; cells never change, only their pixel projection.
- **Rehydration** — a client connecting after pets exist calls `tama_grid_get_state` to get dims + every cell.

### Jump-on-speak mode (`tama_jump_on_speak = "true"`)

`PetManager` reads this config at `init()` and updates it live on every `tama-config-changed` event. When set, `_onChatMessage` calls `pet.executeAction("jump")` instead of `pet.onChatMessage()`. The pet jumps in place — no approach, no center movement.

### Live config updates (`tama-config-changed`)

Every call to `set_config_cmd` with a key that starts with `tama_` causes Rust to emit `tama-config-changed` (payload: full `AppConfig`) to the overlay window and broadcast it via WebSocket to the OBS Browser Source. `PetManager._onTamaConfigChanged()` then applies all changes immediately:

| Config key | Live effect |
|---|---|
| `tama_enabled` | Stops/resumes processing chat messages |
| `tama_max_pets` | New limit enforced on next spawn |
| `tama_pet_size_px` | Resizes all existing pets |
| `tama_inactivity_mins` | Updates `BasePet.inactivityMs`; takes effect on next timer reset |
| `tama_action_check_secs` | Restarts PetScheduler interval |
| `tama_action_probability` | Restarts PetScheduler with new probability |
| `tama_enabled_actions` | Updates PetScheduler action pool immediately |
| `tama_jump_on_speak` | Applies on the next chat message |
| `tama_grid_perspective` / `tama_grid_near_scale` / `tama_grid_far_scale` / `tama_grid_floor_top_frac` | Applied live by `Grid2D` + a re-translate of all pets |
| `tama_layout_mode` / `tama_grid_high_precision` | Rebuild the grid live in the backend (`GridManager::reconfigure`) — re-emits config + cells; no overlay reload needed |
| `tama_grid_wander_enabled` | Requires overlay reload to start/stop the wander task (admin panel shows info toast) |

---

## 18. Onboarding Tour

A guided, first-run setup walkthrough for the admin panel, built on `driver.js`. It exists because first-time users did not know where to start: it walks the streamer through the full getting-started flow (connect Twitch, register personas via the Discord bot, add the overlay to OBS, enable the Tamagotchi pets) and doubles as a reference tour of every sidebar section.

> **Scope:** the tour lives **only** in the admin panel (`main.ts` / `index.html`). It is never loaded by the overlay windows (`overlay.ts`, `overlay-browser.ts`) — those have no Tauri/router context.

### Files

| File | Role |
|---|---|
| `src/onboarding/tour.ts` | Engine wrapper. Owns the `STEPS` array, cross-view navigation, the first-run flag, and exports `startTour()` + `maybeAutoStartTour()`. |
| `src/styles/onboarding.css` | Themes the driver.js popover with design tokens (scoped via `popoverClass: "spo-tour"`). Imported in `entry-panel.css` together with `driver.js/dist/driver.css`. |
| `src/icons.ts` | `Icons.help` (lucide `CircleHelp`) — used by the sidebar button. |
| `index.html` | `#btn-onboarding` ("¿Cómo empezar?") button in the sidebar footer. |
| `src/main.ts` | Injects the button icon, wires the click to `startTour()`, and calls `maybeAutoStartTour()` on load. |

### How it works

- **Cross-view steps:** the panel is a hash-based SPA whose views render lazily into their own cached pane under `#view-container`. Each `TourStep` may declare a `view` (`ViewId`). Before driver.js highlights a step, `prepareStep()` drives the `router` to that view (`router.navigate`, which shows — and on first visit renders — that pane) and `waitForElement()` polls (via `requestAnimationFrame`, ~2.5 s budget) until the target exists. Sidebar/nav targets (`#sidebar`, `#nav-*`, `#btn-*`) need no view change.
- **Navigation ownership:** `onNextClick` / `onPrevClick` are overridden so step changes go through `prepareStep()` + `moveTo()`. **`allowKeyboardControl: false`** is set deliberately — keyboard nav calls driver's `moveNext()`/`movePrevious()` directly and would bypass the view-switch prep, landing on a step whose element does not exist yet.
- **First-run trigger:** `maybeAutoStartTour()` launches the tour the first time the panel is ever opened, gated by the `localStorage` flag `spo_onboarding_seen`. The flag is set in driver's `onDestroyed` (so closing via the X also counts as seen). The "¿Cómo empezar?" button calls `startTour()` directly and ignores the flag, so it is always replayable.

### Adding or editing steps

- Edit the `STEPS` array in `tour.ts`. Each step is a driver.js `DriveStep` plus an optional `view`.
- **Target stable, visible elements** (existing IDs like `#twitch-channel`, `#cfg-discord-token`, `#obs-browser-url`, or a unique class like `.tama-system-toggle`). If a view renames the ID a step points at, update `STEPS`.
- **⚠️ Never target a `.switch` checkbox input.** `switch.css` has `.switch input { display: none }`, so the real `<input>` has a zero-size bounding box at `0,0` and driver.js dumps the popover in the top-left corner. Point at the visible wrapper instead (e.g. the Tamagotchi enable step targets `.tama-system-toggle`, not `#tama-enabled`). The same applies to any element hidden with `display:none` / `visibility:hidden` or sitting inside a collapsed `<details>`.
- Comments in English per the project convention; user-facing popover strings stay Spanish (same as the rest of the panel UI).