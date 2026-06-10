use rusqlite::Connection;
use tauri::Manager;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

pub mod chat_filters;
pub mod chat_platform;
pub mod commands;
pub mod db;
pub mod discord;
pub mod grid;
pub mod server;
pub mod state;
pub mod streamer_mic;
pub mod tiktok;
pub mod tts;
pub mod twitch;

use commands::alerts::{clear_tiktok_alert_asset, set_tiktok_alert_asset, tiktok_test_alert};
use commands::config::{
    disconnect_tiktok, disconnect_twitch, get_available_voices_cmd, get_config_cmd,
    save_animation_config, set_chroma_color, set_config_cmd,
};
use commands::control::{
    connect_tiktok, connect_twitch, restart_discord_bot, send_test_message, toggle_overlay,
    validate_twitch_token,
};
use commands::streamer::{
    reset_streamer_sprite, set_streamer_sprite, streamer_list_mics, streamer_mic_apply,
};
use commands::tamagotchi::{
    reset_guest_image, set_guest_image, tama_get_pet_states, tama_grid_ensure, tama_grid_get_state,
    tama_grid_move, tama_remove_pet_state, tama_reset_all, tama_set_enabled, tama_trigger_action,
    tama_upsert_pet_state,
};
use commands::users::{
    delete_user_cmd, get_recent_logs_cmd, get_user, get_users, toggle_user_active_cmd,
    update_user_cmd,
};
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Setup logging
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Iniciando Stream Persona Overlay");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Inicializar base de datos
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("No se pudo obtener app_data_dir");

            std::fs::create_dir_all(&app_data_dir)?;

            let db_path = app_data_dir.join("overlay.db");
            tracing::info!("Base de datos: {:?}", db_path);

            let conn =
                Connection::open(&db_path).expect("No se pudo abrir la base de datos SQLite");

            db::migrations::run_migrations(&conn).expect("Error ejecutando migraciones");

            // Cargar config inicial
            let config = db::config::get_config(&conn).unwrap_or_default();

            let resource_dir = state::guest_resource_dir(app.handle());
            let app_state = AppState::new(conn, app_data_dir.clone(), resource_dir);

            // Actualizar caché de config
            if let Ok(mut cache) = app_state.config_cache.write() {
                *cache = config;
            }

            app.manage(app_state.clone());

            // Start native mic capture if the streamer persona is enabled. Runs in
            // the backend (no browser permission prompt); broadcasts only the
            // resulting speaking state to the overlay.
            {
                let (enabled, device_id, threshold) = {
                    let cfg = app_state
                        .config_cache
                        .read()
                        .expect("config cache poisoned");
                    (
                        cfg.streamer_persona_enabled,
                        cfg.streamer_mic_device_id.clone(),
                        cfg.streamer_mic_threshold,
                    )
                };
                app_state
                    .streamer_mic
                    .apply(&app_state, enabled, &device_id, threshold);
            }

            // Build the authoritative pet grid from the current layout config and,
            // if wander is enabled, start a tick that nudges pets to free neighbor
            // cells. The grid is backend-authoritative: it broadcasts cell
            // coordinates so the Tauri overlay and OBS Browser Source stay in sync.
            {
                let (small_mode, high_precision, wander_enabled) = {
                    let cfg = app_state
                        .config_cache
                        .read()
                        .expect("config cache poisoned");
                    (
                        cfg.tama_layout_mode == "static",
                        cfg.tama_grid_high_precision,
                        cfg.tama_grid_wander_enabled,
                    )
                };
                let grid_handle = app.handle().clone();
                app_state
                    .grid
                    .reconfigure(&grid_handle, small_mode, high_precision);

                if wander_enabled {
                    // Wander runs on its own cadence (NOT tama_action_check_secs, which
                    // paces random *actions*). Each tick may send a pet on a long walk
                    // to a far cell; the overlay glides there over several seconds at a
                    // constant slow speed. The interval is longer than a walk so the pet
                    // finishes, pauses, then picks a new destination — not a hop-pause.
                    let grid = app_state.grid.clone();
                    let wander_handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        let mut interval =
                            tokio::time::interval(std::time::Duration::from_millis(6000));
                        loop {
                            interval.tick().await;
                            grid.wander_tick(&wander_handle);
                        }
                    });
                }
            }

            // Spawn bots en background.
            // IMPORTANTE: solo Discord arranca automáticamente. Twitch y TikTok NO
            // se conectan al inicio — el usuario debe pulsar "Conectar" en cada vista
            // (`connect_twitch` / `connect_tiktok`). TikTool tiene un límite diario de
            // peticiones muy bajo, así que abrir/cerrar la app no debe gastar cuota
            // sin que el usuario lo pida explícitamente.
            let app_handle = app.handle().clone();
            let state_for_discord = app_state.clone();

            let discord_h = tauri::async_runtime::spawn(async move {
                discord::spawn_discord_bot(state_for_discord, app_handle.clone()).await;
            });

            // Spawn the OBS Browser Source HTTP/WebSocket server
            let state_for_server = app_state.clone();
            // In dev mode Vite serves assets from memory — dist/ doesn't exist.
            // The server uses dev_mode to read source HTML and rewrite Vite URLs instead.
            let dev_mode = cfg!(debug_assertions);
            let dist_dir = if dev_mode {
                std::env::current_dir().unwrap_or_default().join("dist")
            } else {
                std::env::current_exe()
                    .ok()
                    .and_then(|p| p.parent().map(|d| d.join("dist")))
                    .unwrap_or_default()
            };
            let server_h = tauri::async_runtime::spawn(async move {
                // The server runs in a detached task, so a panic here would otherwise
                // vanish silently (the symptom: OBS gets ERR_CONNECTION_REFUSED on
                // :6767 because the task died before binding). Catch and log it.
                use futures_util::FutureExt;
                let outcome = std::panic::AssertUnwindSafe(server::start_server(
                    state_for_server,
                    dist_dir,
                    dev_mode,
                ))
                .catch_unwind()
                .await;
                if let Err(panic) = outcome {
                    let msg = panic
                        .downcast_ref::<&str>()
                        .map(|s| s.to_string())
                        .or_else(|| panic.downcast_ref::<String>().cloned())
                        .unwrap_or_else(|| "panic sin mensaje".to_string());
                    tracing::error!(
                        "[server] La tarea del servidor paniqueó y se detuvo: {}",
                        msg
                    );
                }
            });

            // Guardar handles para poder abortarlos al reiniciar o cerrar.
            // Twitch/TikTok no se arrancan aquí; sus handles se rellenan cuando el
            // usuario pulsa conectar (connect_twitch / connect_tiktok).
            if let Ok(mut h) = app_state.discord_handle.lock() {
                *h = Some(discord_h);
            }
            if let Ok(mut h) = app_state.server_handle.lock() {
                *h = Some(server_h);
            }

            // Interceptar el cierre de la ventana overlay para ocultarla en lugar
            // de destruirla. Si se destruye, get_webview_window("overlay") devuelve
            // None y el botón "Mostrar ventana" deja de funcionar.
            if let Some(overlay) = app.get_webview_window("overlay") {
                let overlay_hide = overlay.clone();
                overlay.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = overlay_hide.hide();
                        tracing::info!(
                            "[overlay] Cierre interceptado — ventana ocultada (no destruida)"
                        );
                    }
                });
            }

            tracing::info!("Setup completado — todos los módulos iniciados");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Usuarios
            get_users,
            get_user,
            update_user_cmd,
            delete_user_cmd,
            toggle_user_active_cmd,
            get_recent_logs_cmd,
            // Config
            get_config_cmd,
            set_config_cmd,
            get_available_voices_cmd,
            set_chroma_color,
            save_animation_config,
            disconnect_twitch,
            disconnect_tiktok,
            // Control
            restart_discord_bot,
            connect_twitch,
            validate_twitch_token,
            connect_tiktok,
            toggle_overlay,
            send_test_message,
            // Tamagotchi
            tama_trigger_action,
            tama_reset_all,
            tama_set_enabled,
            tama_get_pet_states,
            tama_upsert_pet_state,
            tama_remove_pet_state,
            tama_grid_ensure,
            tama_grid_get_state,
            tama_grid_move,
            set_guest_image,
            reset_guest_image,
            // Streamer persona
            set_streamer_sprite,
            reset_streamer_sprite,
            streamer_list_mics,
            streamer_mic_apply,
            // TikTok alerts
            set_tiktok_alert_asset,
            clear_tiktok_alert_asset,
            tiktok_test_alert,
        ])
        .build(tauri::generate_context!())
        .expect("Error iniciando la aplicación Tauri")
        .run(|app_handle, event| {
            match event {
                // ExitRequested fires only when all windows are truly gone.
                // Abort background tasks so tokio threads don't outlive the process.
                tauri::RunEvent::ExitRequested { .. } => {
                    let state = app_handle.state::<AppState>();
                    state.abort_all();
                    tracing::info!("Todas las tareas de background detenidas — cerrando");
                }
                // The overlay window is only *hidden* on close (never destroyed), so
                // Tauri never sees zero open windows and ExitRequested never fires.
                // Detect the main window being destroyed and force a clean exit here.
                tauri::RunEvent::WindowEvent {
                    label,
                    event: tauri::WindowEvent::Destroyed,
                    ..
                } if label == "main" => {
                    let state = app_handle.state::<AppState>();
                    state.abort_all();
                    tracing::info!(
                        "Ventana principal cerrada — abortando tareas y cerrando proceso"
                    );
                    app_handle.exit(0);
                }
                _ => {}
            }
        });
}
