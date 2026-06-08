# Stream Persona Overlay

A desktop app (Tauri v2) that gives streamers a **toolkit of animated OBS overlays**, driven by the chat and live events of Twitch and TikTok. It began as a viewer-pet overlay and has grown into a small suite of overlay modules that share one backend, one admin panel, and one OBS Browser Source server.

## Overlays

- **Viewer pets (Tamagotchi)** — when a registered viewer chats on Twitch or TikTok LIVE, their pet (two custom images: mouth open/closed) appears on the overlay, walks around, reacts to events, and lip-syncs via TTS.
- **Streamer persona** — your own animated avatar (mouth × eyes sprites) with mic-driven lip-sync and automatic blinking.
- **Event alerts** — on-screen alerts for gifts, follows, likes, subs and more, each with a custom image / sound / text / transition.

Viewers register their pet images through a **Discord bot** (`/persona` slash commands).

## Stack

- **Backend:** Rust, Tauri 2, tokio, serenity/poise (Discord), twitch-irc, rusqlite (SQLite), axum (OBS Browser Source server on port 6767)
- **Frontend:** Vanilla TypeScript, Vite 6, Motion v12

## Download

Pre-built binaries are available on the [Releases](../../releases) page.

## Building from Source

```bash
# Dev (panel + Rust)
npm run tauri dev

# Frontend only (no Rust)
npm run dev

# Production build
npm run tauri build
```

> Vite dev server runs on port **1420**.

## OBS Integration

Each overlay is available as an **OBS Browser Source** (native transparency, no chroma key needed):

| Overlay | Browser Source URL |
|---|---|
| Viewer pets | `http://localhost:6767/overlay` |
| Streamer persona | `http://localhost:6767/overlay-streamer` |
| Event alerts | `http://localhost:6767/overlay-tiktok` |

The viewer-pet overlay can also be added as a **Window Capture**: open the overlay window from the admin panel and apply a chroma-key filter in OBS.

## Project Structure

```
src/                   # Frontend TypeScript (admin panel + overlays)
src-tauri/             # Rust backend
index.html             # Admin panel
overlay.html           # Chroma-key overlay window (Tauri)
overlay-browser.html   # OBS Browser Source — viewer pets
overlay-streamer.html  # OBS Browser Source — streamer persona
overlay-tiktok.html    # OBS Browser Source — event alerts
```

See [AGENTS.md](AGENTS.md) for full architecture, conventions, and development rules.
