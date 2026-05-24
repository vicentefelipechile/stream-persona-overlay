use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceInfo {
    pub id: String,
    pub name: String,
}

/// Reproduce un texto con la voz indicada usando el crate `tts`.
/// Emite eventos `tts-state` al overlay Tauri y los difunde por WebSocket.
pub async fn speak_with_events(
    text: String,
    voice_id: String,
    user_id: i64,
    app: tauri::AppHandle,
    ws_tx: tokio::sync::broadcast::Sender<String>,
) -> Result<()> {
    use tauri::Emitter;
    use tts::Tts;

    let broadcast = |speaking: bool| {
        let payload = crate::state::TtsStatePayload { user_id, speaking };
        if let Ok(json) = serde_json::to_string(&serde_json::json!({
            "event": "tts-state",
            "payload": payload
        })) {
            let _ = ws_tx.send(json);
        }
    };

    let mut tts = Tts::default()?;

    if voice_id != "default" {
        let voices = tts.voices()?;
        if let Some(v) = voices.iter().find(|v| v.id() == voice_id) {
            let _ = tts.set_voice(v);
        }
    }

    // Notifica al overlay que empieza el habla
    if let Err(e) = app.emit(
        "tts-state",
        crate::state::TtsStatePayload {
            user_id,
            speaking: true,
        },
    ) {
        tracing::warn!("[tts] Error emitiendo tts-state(speaking=true): {}", e);
    }
    broadcast(true);

    tts.speak(&text, false)?;

    // Polling hasta que termina el habla
    loop {
        match tts.is_speaking() {
            Ok(true) => tokio::time::sleep(std::time::Duration::from_millis(50)).await,
            Ok(false) => break,
            Err(e) => {
                tracing::warn!("[tts] is_speaking() error: {} — saliendo del loop", e);
                break;
            }
        }
    }

    // Notifica que terminó
    if let Err(e) = app.emit(
        "tts-state",
        crate::state::TtsStatePayload {
            user_id,
            speaking: false,
        },
    ) {
        tracing::warn!("[tts] Error emitiendo tts-state(speaking=false): {}", e);
    }
    broadcast(false);

    Ok(())
}

/// Reproduce un texto con la voz indicada (sin eventos — legado).
pub fn speak(text: &str, voice_id: &str) -> Result<()> {
    use tts::Tts;

    let mut tts = Tts::default()?;

    if voice_id != "default" {
        let voices = tts.voices()?;
        if let Some(v) = voices.iter().find(|v| v.id() == voice_id) {
            let _ = tts.set_voice(v);
        }
    }

    tts.speak(text, false)?;
    Ok(())
}

/// Devuelve las voces disponibles en el sistema operativo.
pub fn get_voices() -> Result<Vec<VoiceInfo>> {
    use tts::Tts;

    let tts = Tts::default()?;
    let voices = tts.voices()?;

    Ok(voices
        .iter()
        .map(|v| VoiceInfo {
            id: v.id().to_string(),
            name: v.name().to_string(),
        })
        .collect())
}
