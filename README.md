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

### Prerequisites

- **Node.js** 20+ and **Rust** (stable) with the Tauri toolchain.
- **Windows / macOS:** no extra system libraries — microphone capture uses WASAPI / CoreAudio natively.
- **Linux:** install the Tauri WebKit deps plus **ALSA** (required by the native mic capture). On Debian/Ubuntu:

  ```bash
  sudo apt-get install -y \
    libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf \
    libspeechd-dev libasound2-dev
  ```

  > `libasound2-dev` provides `alsa.pc`; without it the `alsa-sys` build fails. Running a packaged build only needs the runtime library `libasound2`, which most Linux desktops already have.

### Commands

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
| Event alerts (Twitch + TikTok) | `http://localhost:6767/overlay-alerts` |

The viewer-pet overlay can also be added as a **Window Capture**: open the overlay window from the admin panel and apply a chroma-key filter in OBS.

## TikTok LIVE Studio

TikTok LIVE Studio rejects any Browser Source URL containing `localhost`, a raw IP, or an explicit port (`:6767`) — it shows *"Introduce una URL válida"*. To work around this the app also serves the overlays on **port 80**, and you map a fake domain to your own machine via the Windows `hosts` file.

**One-time setup** — run PowerShell **as Administrator**:

```powershell
Add-Content -Path "$env:windir\System32\drivers\etc\hosts" -Value "`n127.0.0.1`teso.tilin.com`n127.0.0.1`toverlay.streampersona.app" -Encoding ASCII
ipconfig /flushdns
```

This maps both `eso.tilin.com` and `overlay.streampersona.app` to `127.0.0.1`. Now use the port-less, `localhost`-free URLs in TikTok LIVE Studio:

| Overlay | TikTok LIVE Studio URL |
|---|---|
| Viewer pets | `http://eso.tilin.com/overlay` |
| Streamer persona | `http://eso.tilin.com/overlay-streamer` |
| Event alerts (Twitch + TikTok) | `http://eso.tilin.com/overlay-alerts` |

> Use `overlay.streampersona.app` instead of `eso.tilin.com` if a viewer finds the short domain suspicious — both resolve to the same local server.

The URL passes TikTok's text validation (no `localhost`, no port) but resolves to your own PC, where the overlay renders locally and connects back to the same host over WebSocket. Nothing is exposed to the internet.

**Caveats:** port 80 must be free (IIS, Skype, or Windows `http.sys` may hold it — check with `Get-NetTCPConnection -LocalPort 80 -State Listen`), and editing `hosts` requires admin. If `http://eso.tilin.com/...` fails to load, confirm the server logged `Escuchando en 127.0.0.1:80` at startup.

## Project Structure

```
src/                   # Frontend TypeScript (admin panel + overlays)
src-tauri/             # Rust backend
index.html             # Admin panel
overlay.html           # Chroma-key overlay window (Tauri)
overlay-browser.html   # OBS Browser Source — viewer pets
overlay-streamer.html  # OBS Browser Source — streamer persona
overlay-alerts.html    # OBS Browser Source — event alerts (Twitch + TikTok)
```

See [AGENTS.md](AGENTS.md) for full architecture, conventions, and development rules.
