use rusqlite::Connection;
use tauri::Manager;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

pub mod chat_platform;
pub mod commands;
pub mod db;
pub mod discord;
pub mod state;
pub mod tiktok;
pub mod tts;
pub mod twitch;

use commands::config::{get_available_voices_cmd, get_config_cmd, save_animation_config, set_chroma_color, set_config_cmd};
use commands::control::{connect_tiktok, connect_twitch, restart_discord_bot, send_test_message, toggle_overlay, validate_twitch_token};
use commands::users::{delete_user_cmd, get_recent_logs_cmd, get_user, get_users, toggle_user_active_cmd, update_user_cmd};
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

            let conn = Connection::open(&db_path)
                .expect("No se pudo abrir la base de datos SQLite");

            db::migrations::run_migrations(&conn)
                .expect("Error ejecutando migraciones");

            // Cargar config inicial
            let config = db::config::get_config(&conn).unwrap_or_default();

            let app_state = AppState::new(conn, app_data_dir.clone());

            // Actualizar caché de config
            if let Ok(mut cache) = app_state.config_cache.write() {
                *cache = config;
            }

            app.manage(app_state.clone());

            // Spawn bots en background (solo si están configurados)
            let app_handle = app.handle().clone();
            let state_for_discord = app_state.clone();
            let state_for_twitch = app_state.clone();
            let state_for_tiktok = app_state.clone();
            let handle_for_twitch = app_handle.clone();
            let handle_for_tiktok = app_handle.clone();

            let discord_h = tauri::async_runtime::spawn(async move {
                discord::spawn_discord_bot(state_for_discord, app_handle.clone()).await;
            });

            let twitch_h = tauri::async_runtime::spawn(async move {
                twitch::spawn_twitch_client(state_for_twitch, handle_for_twitch).await;
            });

            let tiktok_h = tauri::async_runtime::spawn(async move {
                tiktok::spawn_tiktok_client(state_for_tiktok, handle_for_tiktok).await;
            });

            // Guardar handles para poder abortarlos al reiniciar o cerrar
            if let Ok(mut h) = app_state.discord_handle.lock() { *h = Some(discord_h); }
            if let Ok(mut h) = app_state.twitch_handle.lock()  { *h = Some(twitch_h);  }
            if let Ok(mut h) = app_state.tiktok_handle.lock()  { *h = Some(tiktok_h);  }

            // Interceptar el cierre de la ventana overlay para ocultarla en lugar
            // de destruirla. Si se destruye, get_webview_window("overlay") devuelve
            // None y el botón "Mostrar ventana" deja de funcionar.
            if let Some(overlay) = app.get_webview_window("overlay") {
                let overlay_hide = overlay.clone();
                overlay.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = overlay_hide.hide();
                        tracing::info!("[overlay] Cierre interceptado — ventana ocultada (no destruida)");
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
            // Control
            restart_discord_bot,
            connect_twitch,
            validate_twitch_token,
            connect_tiktok,
            toggle_overlay,
            send_test_message,
        ])
        .build(tauri::generate_context!())
        .expect("Error iniciando la aplicación Tauri")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Abortar todas las tareas de background antes de salir
                // para cerrar limpiamente la conexión con Discord, Twitch y TikTok
                let state = app_handle.state::<AppState>();
                state.abort_all();
                tracing::info!("Todas las tareas de background detenidas — cerrando");
            }
        });
}
