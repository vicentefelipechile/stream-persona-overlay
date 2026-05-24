# Stream Persona Overlay

Desktop app (Tauri v2) that displays animated Tamagotchi-style pets on a streamer's OBS overlay. When a registered viewer chats on Twitch or TikTok LIVE, their pet (two custom images: mouth open/closed) appears on the overlay floor, walks around, reacts to events, and lip-syncs via TTS.

Users register their persona images through a **Discord bot** (`/persona` slash commands).

## Stack

- **Backend:** Rust — Tauri 2, tokio, serenity/poise (Discord), twitch-irc, rusqlite (SQLite), axum (OBS Browser Source server on port 6767)
- **Frontend:** Vanilla TypeScript, Vite 6, Motion v12

## Download

Pre-built installers are available on the [Releases](../../releases) page — no Rust toolchain required. Download the `.msi` (Windows) or `.dmg` (macOS) and run it directly.

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

Two options:

1. **Window Capture** — open the overlay window from the admin panel, apply chroma-key filter in OBS.
2. **Browser Source** — add `http://localhost:6767/overlay` directly in OBS (native transparency, no chroma key needed).

## Project Structure

```
src/               # Frontend TypeScript (admin panel + overlay)
src-tauri/         # Rust backend
index.html         # Admin panel
overlay.html        # Chroma-key overlay window
overlay-browser.html # OBS Browser Source entry
```

See [AGENTS.md](AGENTS.md) for full architecture, conventions, and development rules.
