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

pub async fn start_server(app_state: AppState, _dist_dir: PathBuf, dev_mode: bool) {
    let state = ServerState {
        app_state,
        dev_mode,
    };

    let app = Router::new()
        .route("/overlay", get(serve_overlay))
        .route("/persona", get(serve_persona))
        .route("/ws", get(ws_handler))
        .route("/assets/{*path}", get(serve_embedded_asset))
        .with_state(state);

    let listener = match tokio::net::TcpListener::bind("127.0.0.1:6767").await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!("[server] No se pudo iniciar en 127.0.0.1:6767 — {}", e);
            return;
        }
    };

    tracing::info!("[server] OBS Browser Source disponible en http://localhost:6767/overlay");

    if let Err(e) = axum::serve(listener, app).await {
        tracing::error!("[server] Error fatal del servidor HTTP: {}", e);
    }
}

// =========================================================================================================
// GET /overlay
// =========================================================================================================

async fn serve_overlay(State(s): State<ServerState>) -> Response {
    if s.dev_mode {
        return serve_overlay_dev().await;
    }
    serve_overlay_production()
}

async fn serve_overlay_dev() -> Response {
    // In dev mode Vite serves from memory at localhost:1420 — dist/ does not exist.
    // Read overlay-browser.html from the project root and rewrite /src/* references
    // so the browser loads them from the Vite dev server instead of from axum.
    // CARGO_MANIFEST_DIR = src-tauri/ at compile time; parent = project root
    let source = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("overlay-browser.html"))
        .unwrap_or_default();

    match tokio::fs::read_to_string(&source).await {
        Ok(html) => {
            let html = html
                .replace("href=\"/src/", "href=\"http://localhost:1420/src/")
                .replace("src=\"/src/", "src=\"http://localhost:1420/src/");
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
            "overlay-browser.html not found in project root.".to_string(),
        )
            .into_response(),
    }
}

#[cfg(not(debug_assertions))]
fn serve_overlay_production() -> Response {
    match embedded::FrontendAssets::get("overlay-browser.html") {
        Some(content) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            content.data.to_vec(),
        )
            .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "text/plain")],
            "overlay-browser.html not found in embedded assets. El binario puede estar corrupto."
                .to_string(),
        )
            .into_response(),
    }
}

// In debug builds serve_overlay always takes the dev_mode branch, so this is unreachable.
#[cfg(debug_assertions)]
fn serve_overlay_production() -> Response {
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

    let app_data_dir = s.app_state.app_data_dir.as_ref();
    // Canonicalize app_data_dir too so both sides have the same \\?\ prefix on Windows
    let app_data_canonical = tokio::fs::canonicalize(app_data_dir)
        .await
        .unwrap_or_else(|_| app_data_dir.to_path_buf());
    if !canonical.starts_with(&app_data_canonical) {
        tracing::warn!("[server] Acceso denegado a persona: {:?}", canonical);
        return (StatusCode::FORBIDDEN, "Access denied").into_response();
    }

    match tokio::fs::read(&canonical).await {
        Ok(bytes) => {
            let content_type = if q.path.ends_with(".png") {
                "image/png"
            } else if q.path.ends_with(".jpg") || q.path.ends_with(".jpeg") {
                "image/jpeg"
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
            let floor_x = args["floorX"]
                .as_f64()
                .or_else(|| args["floor_x"].as_f64())
                .unwrap_or(0.0);
            let is_sleeping = args["isSleeping"]
                .as_bool()
                .or_else(|| args["is_sleeping"].as_bool())
                .unwrap_or(false);

            match state.db.lock() {
                Ok(db) => {
                    let result = db.execute(
                        "INSERT INTO pet_state (user_id, last_seen_at, floor_x, is_sleeping)
                         VALUES (?1, datetime('now'), ?2, ?3)
                         ON CONFLICT(user_id) DO UPDATE SET
                             last_seen_at = datetime('now'),
                             floor_x      = excluded.floor_x,
                             is_sleeping  = excluded.is_sleeping",
                        rusqlite::params![user_id, floor_x, is_sleeping as i64],
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

        // Remove pet state (mirrors tama_remove_pet_state Tauri command)
        "tama_remove_pet_state" => {
            let user_id = args["userId"]
                .as_i64()
                .or_else(|| args["user_id"].as_i64())
                .unwrap_or(0);
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
