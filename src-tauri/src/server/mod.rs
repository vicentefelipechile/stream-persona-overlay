// =========================================================================================================
// HTTP + WebSocket Server (OBS Browser Source)
// =========================================================================================================
// Axum server that runs alongside the Tauri process. Streamers add
// http://localhost:6767/overlay as a Browser Source in OBS — no chroma key needed.
//
// Routes:
//   GET /overlay          -> overlay-browser.html (embedded in binary via rust-embed)
//   GET /assets/*         -> Vite-compiled JS/CSS (embedded in binary via rust-embed)
//   GET /persona?path=... -> pet sprite images served from OS filesystem
//   GET /ws               -> bidirectional WebSocket (events + invoke)
//
// In debug builds (tauri dev) assets are NOT embedded — the HTML rewriter redirects
// /src/* references to the Vite dev server at localhost:1420, and /assets/* is unused.
// In release builds all dist/ contents are embedded via #[derive(RustEmbed)].
// =========================================================================================================

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::{
    stream::{SplitSink, SplitStream},
    SinkExt, StreamExt,
};
use serde::Deserialize;
use std::path::PathBuf;
use tokio::sync::broadcast;

use crate::state::AppState;

// =========================================================================================================
// Embedded Frontend Assets (release builds only)
// =========================================================================================================

#[cfg(not(debug_assertions))]
mod embedded {
    #[derive(rust_embed::RustEmbed)]
    #[folder = "../dist"]
    pub struct FrontendAssets;
}

#[cfg(not(debug_assertions))]
fn guess_content_type(path: &str) -> &'static str {
    if path.ends_with(".js") || path.ends_with(".mjs") {
        "application/javascript; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".woff2") {
        "font/woff2"
    } else if path.ends_with(".woff") {
        "font/woff"
    } else {
        "application/octet-stream"
    }
}

// =========================================================================================================
// Shared State
// =========================================================================================================

#[derive(Clone)]
struct ServerState {
    app_state: AppState,
    /// true when running under `tauri dev` (Vite dev server at localhost:1420)
    dev_mode: bool,
}

// =========================================================================================================
// Entry Point
// =========================================================================================================

/// Builds the route table, kept separate from `start_server` so it can be
/// constructed without any runtime state. axum panics at route *registration*
/// when the syntax is wrong (e.g. the axum 0.8 catch-all form `{*path}` used on
/// axum 0.7), so the `router_builds_without_panicking` test below turns that into
/// a `cargo test` failure instead of a silently-dead server task in release.
fn build_router() -> Router<ServerState> {
    Router::new()
        .route("/overlay", get(serve_overlay))
        .route("/overlay-alerts", get(serve_overlay_alerts))
        // Backwards-compat alias: streamers may already have /overlay-tiktok set
        // up as an OBS Browser Source. Serves the same page so it doesn't break.
        .route("/overlay-tiktok", get(serve_overlay_alerts))
        .route("/overlay-streamer", get(serve_overlay_streamer))
        .route("/persona", get(serve_persona))
        .route("/ws", get(ws_handler))
        // axum 0.7 catch-all syntax is `*path` (no braces). `{*path}` is axum 0.8
        // and panics here: "catch-all parameters are only allowed at the end".
        .route("/assets/*path", get(serve_embedded_asset))
}

pub async fn start_server(app_state: AppState, _dist_dir: PathBuf, dev_mode: bool) {
    let state = ServerState {
        app_state,
        dev_mode,
    };

    // Read once at startup: when LAN access is on we bind 0.0.0.0:6767 so other
    // devices on the local network (e.g. a phone) can reach the overlay. Toggling
    // it in the panel therefore requires an app restart.
    let lan_access = state
        .app_state
        .config_cache
        .read()
        .map(|cfg| cfg.lan_access_enabled)
        .unwrap_or(false);

    let app = build_router().with_state(state);

    // Addresses we try to listen on. Both IPv4 (127.0.0.1) and IPv6 (::1) loopback are bound
    // because on Windows 'localhost' may resolve to either.
    //   :6767 — historical port used by the OBS Browser Source (http://localhost:6767/overlay).
    //           When LAN access is enabled this becomes 0.0.0.0:6767 (all interfaces) so the
    //           overlay is reachable from other devices on the network.
    //   :80   — standard HTTP port, required for the "eso.tilin.com" trick. TikTok LIVE Studio rejects
    //           any URL containing "localhost", a raw IP, or an explicit port, but accepts
    //           http://eso.tilin.com/ . Mapping eso.tilin.com -> 127.0.0.1 in the hosts file plus this
    //           port-80 listener makes that URL resolve to this same server. Port 80 is often taken
    //           (IIS, Skype, http.sys); if the bind fails we skip it and keep serving on :6767.
    let primary_addr = if lan_access {
        "0.0.0.0:6767"
    } else {
        "127.0.0.1:6767"
    };
    let addrs = [primary_addr, "[::1]:6767", "127.0.0.1:80", "[::1]:80"];

    let mut listeners = Vec::new();
    for addr in addrs {
        // The primary IPv4 :6767 listener retries in case a previous instance left it in TIME_WAIT.
        let listener = if addr == primary_addr {
            bind_with_retry(addr).await
        } else {
            match tokio::net::TcpListener::bind(addr).await {
                Ok(l) => Some(l),
                Err(e) => {
                    tracing::warn!("[server] No se pudo escuchar en {} (se omite): {}", addr, e);
                    None
                }
            }
        };
        if let Some(l) = listener {
            tracing::info!("[server] Escuchando en {}", addr);
            listeners.push(l);
        }
    }

    if listeners.is_empty() {
        tracing::error!(
            "[server] No se pudo iniciar el servidor en ninguna dirección — ¿puertos 6767 y 80 en uso?"
        );
        return;
    }

    tracing::info!(
        "[server] OBS: http://localhost:6767/overlay — TikTok LIVE: http://eso.tilin.com/overlay (requiere entrada en hosts y puerto 80 libre)"
    );

    // Serve on every bound listener: spawn all but the last as background tasks and await the last
    // so this function lives for the whole server lifetime.
    let main = listeners.pop().expect("listeners is non-empty");
    for l in listeners {
        let app = app.clone();
        tokio::spawn(async move {
            if let Err(e) = axum::serve(l, app).await {
                tracing::error!("[server] Error en listener secundario: {}", e);
            }
        });
    }
    if let Err(e) = axum::serve(main, app).await {
        tracing::error!("[server] Error fatal del servidor HTTP: {}", e);
    }
}

// Attempts to bind addr up to 3 times with 1 s between retries.
// This recovers from the port being in TIME_WAIT after a previous instance closed.
async fn bind_with_retry(addr: &str) -> Option<tokio::net::TcpListener> {
    for attempt in 0..3u8 {
        match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => return Some(l),
            Err(e) => {
                if attempt < 2 {
                    tracing::warn!(
                        "[server] Puerto ocupado, reintentando en 1 s ({}/2): {}",
                        attempt + 1,
                        e
                    );
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                } else {
                    tracing::error!("[server] No se pudo iniciar en {}: {}", addr, e);
                }
            }
        }
    }
    None
}

// =========================================================================================================
// GET /overlay
// =========================================================================================================

async fn serve_overlay(State(s): State<ServerState>, headers: header::HeaderMap) -> Response {
    serve_overlay_file(&s, "overlay-browser.html", &headers).await
}

/// GET /overlay-alerts — the dedicated event-alert browser source (Twitch + TikTok).
/// Also served at the legacy /overlay-tiktok path for backwards compatibility.
async fn serve_overlay_alerts(State(s): State<ServerState>, headers: header::HeaderMap) -> Response {
    serve_overlay_file(&s, "overlay-alerts.html", &headers).await
}

/// GET /overlay-streamer — the streamer persona browser source.
async fn serve_overlay_streamer(
    State(s): State<ServerState>,
    headers: header::HeaderMap,
) -> Response {
    serve_overlay_file(&s, "overlay-streamer.html", &headers).await
}

/// Serves one of the overlay HTML pages, choosing the dev (Vite rewrite) or
/// production (embedded) path based on `dev_mode`.
async fn serve_overlay_file(s: &ServerState, filename: &str, headers: &header::HeaderMap) -> Response {
    if s.dev_mode {
        return serve_overlay_dev(filename, headers).await;
    }
    serve_overlay_production(filename)
}

/// Returns the hostname (no port) the client used to reach us, taken from the
/// request `Host` header. Used to point the Vite dev rewrite at the same machine
/// the page was loaded from — so a phone on the LAN fetches /src/* from
/// http://<pc-ip>:1420 instead of localhost (which would be the phone itself).
/// Falls back to "localhost" when the header is missing or unparseable.
fn request_hostname(headers: &header::HeaderMap) -> String {
    headers
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        // Strip the port: "192.168.1.42:6767" -> "192.168.1.42". IPv6 literals in
        // a Host header are bracketed ("[::1]:6767"), so splitting on the last ':'
        // outside brackets is enough for the loopback/LAN cases we serve.
        .map(|host| host.rsplit_once(':').map(|(h, _)| h).unwrap_or(host).to_string())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "localhost".to_string())
}

async fn serve_overlay_dev(filename: &str, headers: &header::HeaderMap) -> Response {
    // In dev mode Vite serves from memory at <host>:1420 — dist/ does not exist.
    // Read the overlay HTML from the project root and rewrite /src/* references
    // so the browser loads them from the Vite dev server instead of from axum.
    // The Vite host mirrors the request host (see request_hostname) so LAN devices
    // load assets from this PC, not from their own localhost.
    // CARGO_MANIFEST_DIR = src-tauri/ at compile time; parent = project root
    let source = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join(filename))
        .unwrap_or_default();

    let vite_base = format!("http://{}:1420", request_hostname(headers));

    match tokio::fs::read_to_string(&source).await {
        Ok(html) => {
            let html = html
                .replace("href=\"/src/", &format!("href=\"{}/src/", vite_base))
                .replace("src=\"/src/", &format!("src=\"{}/src/", vite_base));
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
                html,
            )
                .into_response()
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "text/plain")],
            format!("{} not found in project root.", filename),
        )
            .into_response(),
    }
}

#[cfg(not(debug_assertions))]
fn serve_overlay_production(filename: &str) -> Response {
    match embedded::FrontendAssets::get(filename) {
        Some(content) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            content.data.to_vec(),
        )
            .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "text/plain")],
            format!(
                "{} not found in embedded assets. El binario puede estar corrupto.",
                filename
            ),
        )
            .into_response(),
    }
}

// In debug builds serve_overlay always takes the dev_mode branch, so this is unreachable.
#[cfg(debug_assertions)]
fn serve_overlay_production(_filename: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        [(header::CONTENT_TYPE, "text/plain")],
        "Ejecuta `npm run tauri dev` para usar el servidor de desarrollo.".to_string(),
    )
        .into_response()
}

// =========================================================================================================
// GET /assets/{*path}
// =========================================================================================================

#[cfg(not(debug_assertions))]
async fn serve_embedded_asset(
    axum::extract::Path(asset_path): axum::extract::Path<String>,
) -> Response {
    let path = format!("assets/{}", asset_path);
    match embedded::FrontendAssets::get(&path) {
        Some(content) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, guess_content_type(&asset_path))],
            content.data.to_vec(),
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// In debug mode the HTML rewriter redirects /src/* to Vite, so /assets/* is never requested.
#[cfg(debug_assertions)]
async fn serve_embedded_asset(_: axum::extract::Path<String>) -> Response {
    StatusCode::NOT_FOUND.into_response()
}

// =========================================================================================================
// GET /persona?path=...
// =========================================================================================================

#[derive(Deserialize)]
struct PersonaQuery {
    path: String,
}

async fn serve_persona(
    State(s): State<ServerState>,
    Query(q): Query<PersonaQuery>,
) -> impl IntoResponse {
    let requested = PathBuf::from(&q.path);

    // Canonicalize to prevent path traversal (e.g. "../../etc/passwd")
    let canonical = match tokio::fs::canonicalize(&requested).await {
        Ok(p) => p,
        Err(_) => return (StatusCode::NOT_FOUND, "Image not found").into_response(),
    };

    // Allowed roots: app_data_dir (custom guest images saved via set_guest_image)
    // and resource_dir (bundled default sprites guest_open.png / guest_closed.png,
    // which live next to the binary — outside app_data_dir). Without resource_dir
    // here, guests using the default sprite get a 403 in the OBS Browser Source
    // (the Tauri overlay window is unaffected: it loads via the asset: protocol).
    // Canonicalize each root so both sides share the same \\?\ prefix on Windows.
    let mut allowed = Vec::with_capacity(2);
    for root in [
        s.app_state.app_data_dir.as_ref(),
        s.app_state.resource_dir.as_ref(),
    ] {
        let c = tokio::fs::canonicalize(root)
            .await
            .unwrap_or_else(|_| root.to_path_buf());
        allowed.push(c);
    }
    if !allowed.iter().any(|root| canonical.starts_with(root)) {
        tracing::warn!("[server] Acceso denegado a persona: {:?}", canonical);
        return (StatusCode::FORBIDDEN, "Access denied").into_response();
    }

    match tokio::fs::read(&canonical).await {
        Ok(bytes) => {
            // Images and alert sounds both flow through this route (paths under
            // app_data_dir). Audio needs a correct Content-Type for the browser
            // overlay's <audio>/Audio() to play it.
            let p = q.path.to_lowercase();
            let content_type = if p.ends_with(".png") {
                "image/png"
            } else if p.ends_with(".jpg") || p.ends_with(".jpeg") {
                "image/jpeg"
            } else if p.ends_with(".gif") {
                "image/gif"
            } else if p.ends_with(".webp") {
                "image/webp"
            } else if p.ends_with(".mp3") {
                "audio/mpeg"
            } else if p.ends_with(".ogg") {
                "audio/ogg"
            } else if p.ends_with(".wav") {
                "audio/wav"
            } else {
                "application/octet-stream"
            };
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, content_type)],
                bytes,
            )
                .into_response()
        }
        Err(_) => (StatusCode::NOT_FOUND, "Image not found").into_response(),
    }
}

// =========================================================================================================
// GET /ws  (WebSocket upgrade)
// =========================================================================================================

async fn ws_handler(ws: WebSocketUpgrade, State(s): State<ServerState>) -> Response {
    ws.on_upgrade(move |socket| handle_ws(socket, s.app_state))
}

async fn handle_ws(socket: WebSocket, state: AppState) {
    let mut rx = state.ws_tx.subscribe();
    let (mut sender, mut receiver): (SplitSink<WebSocket, Message>, SplitStream<WebSocket>) =
        socket.split();

    loop {
        tokio::select! {
            // Forward broadcast events to this WS client
            result = rx.recv() => {
                match result {
                    Ok(msg) => {
                        if sender.send(Message::Text(msg)).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("[server/ws] Cliente demasiado lento — {} mensajes perdidos", n);
                        continue;
                    }
                    Err(_) => break,
                }
            }

            // Handle commands arriving from the browser overlay
            result = receiver.next() => {
                match result {
                    Some(Ok(Message::Text(text))) => {
                        if let Some(response) = process_ws_command(&text, &state) {
                            if sender.send(Message::Text(response)).await.is_err() {
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
}

// =========================================================================================================
// Incoming WS command dispatch
// =========================================================================================================

fn process_ws_command(text: &str, state: &AppState) -> Option<String> {
    #[derive(Deserialize)]
    struct WsCommand {
        id: String,
        command: String,
        args: Option<serde_json::Value>,
    }

    let cmd: WsCommand = match serde_json::from_str(text) {
        Ok(c) => c,
        Err(_) => return None,
    };

    let args = cmd.args.unwrap_or(serde_json::Value::Null);

    let response = match cmd.command.as_str() {
        // Read full config and return it (mirrors get_config_cmd Tauri command)
        "get_config_cmd" | "get_config" => match state.db.lock() {
            Ok(db) => match crate::db::config::get_config(&db) {
                Ok(cfg) => serde_json::json!({ "id": cmd.id, "result": cfg }),
                Err(e) => serde_json::json!({ "id": cmd.id, "error": e.to_string() }),
            },
            Err(_) => serde_json::json!({ "id": cmd.id, "error": "DB lock failed" }),
        },

        // Upsert pet state (mirrors tama_upsert_pet_state Tauri command)
        // Accepts both camelCase (from JS via Tauri) and snake_case
        "tama_upsert_pet_state" => {
            let user_id = args["userId"]
                .as_i64()
                .or_else(|| args["user_id"].as_i64())
                .unwrap_or(0);
            let display_name = args["displayName"]
                .as_str()
                .or_else(|| args["display_name"].as_str())
                .unwrap_or("")
                .to_string();
            let cell_x = args["cellX"]
                .as_i64()
                .or_else(|| args["cell_x"].as_i64())
                .unwrap_or(0);
            let cell_y = args["cellY"]
                .as_i64()
                .or_else(|| args["cell_y"].as_i64())
                .unwrap_or(0);
            let is_sleeping = args["isSleeping"]
                .as_bool()
                .or_else(|| args["is_sleeping"].as_bool())
                .unwrap_or(false);

            match state.db.lock() {
                Ok(db) => {
                    let result = db.execute(
                        "INSERT INTO pet_state (user_id, last_seen_at, cell_x, cell_y, is_sleeping)
                         VALUES (?1, datetime('now'), ?2, ?3, ?4)
                         ON CONFLICT(user_id) DO UPDATE SET
                             last_seen_at = datetime('now'),
                             cell_x       = excluded.cell_x,
                             cell_y       = excluded.cell_y,
                             is_sleeping  = excluded.is_sleeping",
                        rusqlite::params![user_id, cell_x, cell_y, is_sleeping as i64],
                    );
                    let _ = display_name; // lives in users table
                    match result {
                        Ok(_) => serde_json::json!({ "id": cmd.id, "result": null }),
                        Err(e) => serde_json::json!({ "id": cmd.id, "error": e.to_string() }),
                    }
                }
                Err(_) => serde_json::json!({ "id": cmd.id, "error": "DB lock failed" }),
            }
        }

        // Snapshot of grid dims + every pet cell (mirrors tama_grid_get_state).
        "tama_grid_get_state" => {
            let snapshot = state.grid.snapshot();
            serde_json::json!({ "id": cmd.id, "result": snapshot })
        }

        // Assign/return a pet's grid cell and broadcast it (mirrors tama_grid_ensure).
        "tama_grid_ensure" => {
            let user_id = args["userId"]
                .as_i64()
                .or_else(|| args["user_id"].as_i64())
                .unwrap_or(0);
            state.grid.ensure_ws(state, user_id);
            serde_json::json!({ "id": cmd.id, "result": null })
        }

        // Move a pet to the free cell nearest a target (mirrors tama_grid_move).
        "tama_grid_move" => {
            let user_id = args["userId"]
                .as_i64()
                .or_else(|| args["user_id"].as_i64())
                .unwrap_or(0);
            let cell_x = args["cellX"]
                .as_u64()
                .or_else(|| args["cell_x"].as_u64())
                .unwrap_or(0) as u16;
            let cell_y = args["cellY"]
                .as_u64()
                .or_else(|| args["cell_y"].as_u64())
                .unwrap_or(0) as u16;
            state
                .grid
                .move_to_nearest_free_ws(state, user_id, (cell_x, cell_y));
            serde_json::json!({ "id": cmd.id, "result": null })
        }

        // Remove pet state (mirrors tama_remove_pet_state Tauri command)
        "tama_remove_pet_state" => {
            let user_id = args["userId"]
                .as_i64()
                .or_else(|| args["user_id"].as_i64())
                .unwrap_or(0);
            state.grid.release_ws(state, user_id);
            match state.db.lock() {
                Ok(db) => {
                    let result = db.execute(
                        "DELETE FROM pet_state WHERE user_id = ?1",
                        rusqlite::params![user_id],
                    );
                    match result {
                        Ok(_) => serde_json::json!({ "id": cmd.id, "result": null }),
                        Err(e) => serde_json::json!({ "id": cmd.id, "error": e.to_string() }),
                    }
                }
                Err(_) => serde_json::json!({ "id": cmd.id, "error": "DB lock failed" }),
            }
        }

        unknown => {
            tracing::warn!("[server/ws] Comando WS desconocido: {}", unknown);
            serde_json::json!({ "id": cmd.id, "error": format!("Unknown command: {}", unknown) })
        }
    };

    serde_json::to_string(&response).ok()
}

// =========================================================================================================
// Tests
// =========================================================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // Regression guard for the "OBS overlay refuses connection in release" bug.
    // An invalid route string panics when axum registers it, which killed the
    // spawned server task before it could bind port 6767 — visible only as
    // ERR_CONNECTION_REFUSED in a release binary (the panic in the detached task
    // was swallowed). Constructing the router here makes any such mistake fail at
    // `cargo test` time instead.
    #[test]
    fn router_builds_without_panicking() {
        let _ = build_router();
    }
}
