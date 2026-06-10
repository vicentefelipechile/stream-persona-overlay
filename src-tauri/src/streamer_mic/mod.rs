// =========================================================================================================
// Streamer microphone capture (native)
// =========================================================================================================
// Captures the streamer's microphone natively (cpal / WASAPI on Windows) in the
// backend, computes a smoothed 0–100 level, applies the configured threshold +
// a short "hang time", and broadcasts a single `streamer-speaking` boolean to the
// overlay whenever the speaking state flips.
//
// Why native instead of the overlay: the streamer persona overlay is an OBS
// Browser Source and should only *render* the result, never capture input —
// doing getUserMedia there made OBS pop a browser-style mic permission prompt.
// Capturing here means no webview permission prompt anywhere; only the resulting
// boolean travels over the existing WebSocket transport.
//
// Lifecycle: a single capture session lives on a dedicated thread that owns the
// cpal stream (cpal::Stream is !Send, so it never crosses the thread boundary).
// The realtime audio callback only writes the raw level into an atomic; the
// thread's own poll loop does the smoothing + threshold + emit so nothing heavy
// runs on the audio thread. `apply()` starts/stops/reconfigures from config; the
// threshold updates live without restarting the stream.
// =========================================================================================================

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use crate::state::AppState;

// How long the mouth stays "open" after the level last crossed the threshold, so
// it doesn't snap shut between syllables. Mirrors the old overlay-side hang time.
const HANG_MS: u64 = 120;
// Poll cadence for smoothing + threshold detection (~60 Hz for a responsive mouth).
const POLL_MS: u64 = 16;

/// An available audio input device. `id` is the cpal device name (used to reselect
/// it later); an empty `id` means "system default".
#[derive(Clone, serde::Serialize)]
pub struct MicDevice {
    pub id: String,
    pub name: String,
}

/// Lists the available input devices for the panel's device picker.
pub fn list_input_devices() -> Vec<MicDevice> {
    let host = cpal::default_host();
    let mut out = Vec::new();
    if let Ok(devices) = host.input_devices() {
        for device in devices {
            if let Ok(name) = device.name() {
                out.push(MicDevice {
                    id: name.clone(),
                    name,
                });
            }
        }
    }
    out
}

/// Holds the running capture session so it can be reconfigured or stopped.
struct Session {
    /// Device name this session was started for (empty = default). Used to decide
    /// whether an `apply()` needs a full restart or just a threshold update.
    device_id: String,
    /// Cleared to signal the capture thread to drop the stream and exit.
    running: Arc<AtomicBool>,
    /// Live-updatable threshold (0–100); read by the poll loop each tick.
    threshold: Arc<AtomicU32>,
    handle: Option<JoinHandle<()>>,
}

/// Owns the single active capture session (if any). Stored in `AppState`.
#[derive(Default)]
pub struct StreamerMic {
    inner: Mutex<Option<Session>>,
}

impl StreamerMic {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// Reconfigures capture from the current streamer settings. Starts when newly
    /// enabled, stops when disabled, restarts on device change, and updates the
    /// threshold live (no restart) when only that changed.
    pub fn apply(&self, state: &AppState, enabled: bool, device_id: &str, threshold: u32) {
        let Ok(mut guard) = self.inner.lock() else {
            return;
        };

        if !enabled {
            if let Some(session) = guard.take() {
                stop_session(session);
                emit_speaking(state, false); // make sure the mouth closes
            }
            return;
        }

        // Same device already running → just push the new threshold.
        if let Some(session) = guard.as_ref() {
            if session.device_id == device_id {
                session.threshold.store(threshold, Ordering::Relaxed);
                return;
            }
        }

        // (Re)start on a fresh device.
        if let Some(session) = guard.take() {
            stop_session(session);
        }
        match start_session(state.clone(), device_id.to_string(), threshold) {
            Ok(session) => *guard = Some(session),
            Err(e) => {
                tracing::error!("[streamer-mic] No se pudo iniciar la captura: {}", e);
                emit_speaking(state, false);
            }
        }
    }

    /// Stops capture (call on shutdown).
    pub fn stop(&self) {
        if let Ok(mut guard) = self.inner.lock() {
            if let Some(session) = guard.take() {
                stop_session(session);
            }
        }
    }
}

fn stop_session(mut session: Session) {
    session.running.store(false, Ordering::Relaxed);
    if let Some(handle) = session.handle.take() {
        let _ = handle.join();
    }
}

fn start_session(state: AppState, device_id: String, threshold: u32) -> Result<Session, String> {
    let running = Arc::new(AtomicBool::new(true));
    let threshold_arc = Arc::new(AtomicU32::new(threshold));

    let running_thread = running.clone();
    let threshold_thread = threshold_arc.clone();
    let device_for_session = device_id.clone();

    let handle = std::thread::Builder::new()
        .name("streamer-mic".into())
        .spawn(move || {
            if let Err(e) = run_capture(&state, &device_id, &running_thread, &threshold_thread) {
                tracing::error!("[streamer-mic] La captura terminó con error: {}", e);
            }
            // Whatever happened (clean stop or error), leave the mouth closed.
            emit_speaking(&state, false);
        })
        .map_err(|e| e.to_string())?;

    tracing::info!(
        "[streamer-mic] Captura iniciada (dispositivo='{}')",
        if device_for_session.is_empty() {
            "predeterminado"
        } else {
            &device_for_session
        }
    );

    Ok(Session {
        device_id: device_for_session,
        running,
        threshold: threshold_arc,
        handle: Some(handle),
    })
}

/// Builds the cpal input stream and runs the smoothing/threshold/emit poll loop
/// until `running` is cleared. The stream is dropped on return, stopping capture.
fn run_capture(
    state: &AppState,
    device_id: &str,
    running: &AtomicBool,
    threshold: &AtomicU32,
) -> Result<(), String> {
    let host = cpal::default_host();
    let device = pick_device(&host, device_id)?;
    let supported = device
        .default_input_config()
        .map_err(|e| format!("config de entrada no disponible: {}", e))?;
    let sample_format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();

    // Raw 0–100 level written by the realtime callback, read by the poll loop.
    let level_bits = Arc::new(AtomicU32::new(0));
    let err_fn = |e| tracing::warn!("[streamer-mic] error de stream: {}", e);

    let stream = match sample_format {
        cpal::SampleFormat::F32 => {
            let lc = level_bits.clone();
            device.build_input_stream(
                &config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    lc.store(
                        rms_to_level(data.iter().copied(), data.len()).to_bits(),
                        Ordering::Relaxed,
                    );
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let lc = level_bits.clone();
            device.build_input_stream(
                &config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    let it = data.iter().map(|s| *s as f32 / 32768.0);
                    lc.store(rms_to_level(it, data.len()).to_bits(), Ordering::Relaxed);
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let lc = level_bits.clone();
            device.build_input_stream(
                &config,
                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                    let it = data.iter().map(|s| (*s as f32 - 32768.0) / 32768.0);
                    lc.store(rms_to_level(it, data.len()).to_bits(), Ordering::Relaxed);
                },
                err_fn,
                None,
            )
        }
        other => return Err(format!("formato de muestra no soportado: {:?}", other)),
    }
    .map_err(|e| format!("no se pudo crear el stream: {}", e))?;

    stream
        .play()
        .map_err(|e| format!("no se pudo iniciar el stream: {}", e))?;

    // Smoothing + threshold + emit. Asymmetric smoothing (rise fast, fall slow) at
    // a fixed cadence so timing is independent of the audio buffer size.
    let mut smoothed = 0.0_f32;
    let mut speaking = false;
    let mut hang_until = Instant::now();

    while running.load(Ordering::Relaxed) {
        let raw = f32::from_bits(level_bits.load(Ordering::Relaxed));
        let k = if raw > smoothed { 0.5 } else { 0.15 };
        smoothed += (raw - smoothed) * k;

        let th = threshold.load(Ordering::Relaxed) as f32;
        let now = Instant::now();
        if smoothed > th {
            hang_until = now + Duration::from_millis(HANG_MS);
        }
        let now_speaking = now < hang_until;
        if now_speaking != speaking {
            speaking = now_speaking;
            emit_speaking(state, speaking);
        }

        std::thread::sleep(Duration::from_millis(POLL_MS));
    }

    Ok(())
}

/// RMS of the (already normalized to -1..1) samples, scaled into 0–100. Speech
/// rarely exceeds ~0.5 RMS, so the ×200 scale spreads typical speech across the range.
fn rms_to_level<I: Iterator<Item = f32>>(samples: I, count: usize) -> f32 {
    if count == 0 {
        return 0.0;
    }
    let mut sum_sq = 0.0_f32;
    for v in samples {
        sum_sq += v * v;
    }
    let rms = (sum_sq / count as f32).sqrt();
    (rms * 200.0).min(100.0)
}

/// Resolves the configured device by name, falling back to the system default.
fn pick_device(host: &cpal::Host, device_id: &str) -> Result<cpal::Device, String> {
    if !device_id.is_empty() {
        if let Ok(mut devices) = host.input_devices() {
            if let Some(d) = devices.find(|d| d.name().map(|n| n == device_id).unwrap_or(false)) {
                return Ok(d);
            }
        }
        tracing::warn!(
            "[streamer-mic] Dispositivo '{}' no encontrado — usando el predeterminado",
            device_id
        );
    }
    host.default_input_device()
        .ok_or_else(|| "no hay dispositivo de entrada predeterminado".to_string())
}

/// Broadcasts the speaking state to the streamer overlay (WS Browser Source only —
/// the streamer persona has no Tauri window).
fn emit_speaking(state: &AppState, speaking: bool) {
    state.broadcast_ws(
        "streamer-speaking",
        &serde_json::json!({ "speaking": speaking }),
    );
}
