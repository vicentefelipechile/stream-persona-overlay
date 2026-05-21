// =========================================================================================================
// OVERLAY VIEW
// =========================================================================================================
// Runs in the "overlay" window (transparent chroma-key background).
// Listens to "chat-message", "tts-state", "chroma-color-changed", and
// "animation-config-changed" events from Rust.
//
// Display modes:
//   "parallel" (default) — each unique user gets their own slot left-to-right.
//   "queue"              — only one persona visible at a time; incoming messages
//                          queue up and play sequentially.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { listen } from "@tauri-apps/api/event";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { AnimationConfig, loadAnimationConfig } from "../overlay/animation-config";
import { PersonaController, PersonaConfig } from "../overlay/persona-controller";
import { PersonaQueue } from "../overlay/persona-queue";
import { AudioLevelDetector } from "../overlay/audio-detector";

// =========================================================================================================
// Types
// =========================================================================================================

interface ChatMessagePayload {
  platform: string;
  username: string;
  message: string;
  user_id: number;
  display_name: string;
  mouth_open_path: string;
  mouth_closed_path: string;
  voice_id: string;
}

interface TtsStatePayload {
  user_id: number;
  speaking: boolean;
}

// =========================================================================================================
// Constants
// =========================================================================================================

const PERSONA_START_X = 40;
const PERSONA_GAP     = 20;

// =========================================================================================================
// Initialization
// =========================================================================================================

window.addEventListener("DOMContentLoaded", async () => {
  const body      = document.getElementById("overlay-body")!;
  const container = document.getElementById("personas-container")!;

  // Load initial config
  let animCfg: AnimationConfig = await loadAnimationConfig();
  let displayMode = "parallel";

  try {
    const cfg = await invoke<{ chroma_color: string; overlay_display_mode: string }>(
      "get_config_cmd"
    );
    body.style.backgroundColor = cfg.chroma_color;
    displayMode = cfg.overlay_display_mode || "parallel";
  } catch (_) {
    body.style.backgroundColor = "#00FF00";
  }

  // =========================================================================================================
  // Fade-in Cover
  // =========================================================================================================
  // resetAndTriggerFade() works for both the initial window load and every
  // subsequent show() call. Key steps:
  //  1. Disable the CSS transition temporarily so the opacity:1 reset is instant.
  //  2. Force a reflow (offsetHeight read) so the browser commits the opaque state.
  //  3. Re-enable the transition and add .fade-out to start the 2-second fade.

  function resetAndTriggerFade(): void {
    const cover = document.getElementById("fade-cover");
    if (!cover) return;

    // Remove transition so the reset to black is instant (no reverse fade)
    cover.style.transition = "none";
    cover.classList.remove("fade-out");
    cover.style.opacity    = "1";

    // Reading offsetHeight forces a synchronous layout — the browser must
    // process the opacity:1 before continuing, preventing animation batching.
    void cover.offsetHeight;

    // Restore transition and trigger the fade-out
    cover.style.transition = "";
    cover.style.opacity    = "";
    requestAnimationFrame(() => {
      cover.classList.add("fade-out");
    });
  }

  resetAndTriggerFade();

  // =========================================================================================================
  // State
  // =========================================================================================================

  const queue      = new PersonaQueue(animCfg.maxVisiblePersonas);
  const exitTimers = new Map<number, ReturnType<typeof setTimeout>>();

  // Queue mode state
  const msgQueue: ChatMessagePayload[] = [];
  let queueBusy = false;

  // Last message per user — used by the lip-sync simulator
  const lastMessages = new Map<number, string>();

  // Pending lip-sync simulation timers per user (cancelled on speaking=false)
  const lipSyncTimers = new Map<number, ReturnType<typeof setTimeout>[]>();

  // =========================================================================================================
  // Audio Status Indicator
  // =========================================================================================================
  // A small status badge in the top-right corner that shows whether the
  // AudioLevelDetector (Stereo Mix / loopback) started successfully.
  // It auto-hides after 4 s so it never interferes with the actual stream.
  const audioIndicator = document.createElement("div");
  audioIndicator.id = "audio-indicator";
  audioIndicator.style.cssText = [
    "position:fixed",
    "top:12px",
    "right:16px",
    "background:rgba(0,0,0,0.72)",
    "color:#e8eaf0",
    "font-family:'IBM Plex Sans',sans-serif",
    "font-size:12px",
    "font-weight:600",
    "padding:5px 10px",
    "border-radius:4px",
    "display:flex",
    "align-items:center",
    "gap:6px",
    "z-index:9999",
    "transition:opacity 0.5s",
    "pointer-events:none",
  ].join(";");
  audioIndicator.innerHTML = `<span id="audio-dot" style="width:8px;height:8px;border-radius:50%;background:#f0b429;display:inline-block"></span>
    <span id="audio-label">🎙️ Mic: conectando...</span>`;
  document.body.appendChild(audioIndicator);

  function setAudioStatus(ok: boolean, msg: string): void {
    const dot   = document.getElementById("audio-dot")!;
    const label = document.getElementById("audio-label")!;
    dot.style.background = ok ? "#00c896" : "#e05252";
    label.textContent    = msg;
    // Auto-hide after 4 s (keep visible on error so streamer notices)
    if (ok) {
      setTimeout(() => { audioIndicator.style.opacity = "0"; }, 4000);
    }
  }

  // Lip-sync state
  let activeTTSUserId: number | null = null;
  let audioDetectorActive = false;

  const audioDetector = new AudioLevelDetector((isSpeaking) => {
    // Audio detector provides granular syllable-level control.
    // It only runs when Stereo Mix / loopback is configured in the OS.
    if (activeTTSUserId !== null) {
      const persona = queue.get(activeTTSUserId);
      if (persona) persona.setMouth(isSpeaking ? "open" : "closed");
    }
  });

  audioDetector.setThreshold(animCfg.audioThreshold);

  // Start detector and update the status badge.
  // If getUserMedia fails (no Stereo Mix), the tts-state listener below
  // acts as primary mouth controller instead.
  audioDetector.start().then(() => {
    audioDetectorActive = true;
    setAudioStatus(true, "🎙️ Mic: activo (lip-sync granular OK)");
  }).catch(() => {
    audioDetectorActive = false;
    setAudioStatus(false, "🎙️ Sin Stereo Mix — lip-sync via TTS evento (abre/cierra por frase)");
  });

  // =========================================================================================================
  // Lip-Sync Text Simulation
  // =========================================================================================================
  // When Stereo Mix is NOT the default recording device, the AudioLevelDetector
  // gets no signal and the mouth stays static. This simulator analyzes the
  // message text and schedules open/closed transitions that mimic natural speech
  // pauses (spaces = brief close, punctuation = longer close, words = open).
  // The AudioLevelDetector overrides these timers in real time when active.

  function stopLipSyncSimulation(userId: number): void {
    const timers = lipSyncTimers.get(userId);
    if (timers) { timers.forEach(clearTimeout); lipSyncTimers.delete(userId); }
  }

  function startLipSyncSimulation(userId: number, message: string): void {
    stopLipSyncSimulation(userId);

    // Approximate speech rate: ~13 chars/second (~150 wpm, avg 5 chars/word)
    const CHARS_PER_MS = 13 / 1000;

    // Tokenize: words, spaces, and punctuation pauses
    const tokens = message.match(/[.!?]+|[,;:]+|\s+|[^\s.,!?;:]+/g) ?? [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    let cursor = 0;

    for (const token of tokens) {
      const isPunct  = /^[.!?]+$/.test(token);
      const isComma  = /^[,;:]+$/.test(token);
      const isSpace  = /^\s+$/.test(token);

      // Decide duration and mouth state for this token
      let durationMs: number;
      let open: boolean;

      if (isPunct) {
        // Sentence-ending punctuation — longer pause, mouth closed
        durationMs = 350;
        open = false;
      } else if (isComma) {
        // Mid-sentence pause
        durationMs = 180;
        open = false;
      } else if (isSpace) {
        // Brief inter-word closure
        durationMs = 80;
        open = false;
      } else {
        // Word — mouth open, duration proportional to length
        durationMs = Math.max(120, token.length / CHARS_PER_MS);
        open = true;
      }

      const t = cursor;
      const uid = userId;
      timers.push(setTimeout(() => {
        // Only act if this user is still the active TTS speaker
        if (activeTTSUserId !== uid) return;
        // Only act if audio detector is NOT providing real-time control
        if (audioDetectorActive) return;
        const p = queue.get(uid);
        if (p) p.setMouth(open ? "open" : "closed");
      }, t));

      cursor += durationMs;
    }

    lipSyncTimers.set(userId, timers);
  }

  // =========================================================================================================
  // Helpers
  // =========================================================================================================

  function getNextPositionX(): number {
    const used = queue.usedPositions();
    let x = PERSONA_START_X;
    while (used.has(x)) x += animCfg.personaSizePx + PERSONA_GAP;
    return x;
  }

  function buildConfig(payload: ChatMessagePayload, posX: number): PersonaConfig {
    return {
      userId:        payload.user_id,
      displayName:   payload.display_name,
      mouthOpenUrl:  convertFileSrc(payload.mouth_open_path),
      mouthClosedUrl: convertFileSrc(payload.mouth_closed_path),
      animationIn:   animCfg.animationIn,
      animationOut:  animCfg.animationOut,
      sizePx:        animCfg.personaSizePx,
      idleWiggle:    animCfg.idleWiggle,
      idleBreathe:   animCfg.idleBreathe,
      glowEffect:    animCfg.glowEffect,
      glowColor:     animCfg.glowColor,
      outlineEffect: animCfg.outlineEffect,
      positionX:     posX,
    };
  }

  function scheduleRemoval(userId: number, durationSecs: number): void {
    const existing = exitTimers.get(userId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      exitTimers.delete(userId);
      await queue.remove(userId);
    }, durationSecs * 1000);

    exitTimers.set(userId, timer);
  }

  // =========================================================================================================
  // Parallel Mode
  // =========================================================================================================

  async function handleParallel(payload: ChatMessagePayload): Promise<void> {
    const existing = queue.get(payload.user_id);

    if (existing) {
      existing.updateMessage(payload.message);
      scheduleRemoval(payload.user_id, animCfg.visibleDurationSecs);
    } else {
      const posX       = getNextPositionX();
      const controller = new PersonaController(container, buildConfig(payload, posX));
      controller.updateMessage(payload.message);
      await queue.add(payload.user_id, controller);
      scheduleRemoval(payload.user_id, animCfg.visibleDurationSecs);
    }
  }

  // =========================================================================================================
  // Queue Mode
  // =========================================================================================================

  async function drainQueue(): Promise<void> {
    const next = msgQueue.shift();
    if (!next) { queueBusy = false; return; }

    queueBusy = true;
    const controller = new PersonaController(container, buildConfig(next, PERSONA_START_X));
    controller.updateMessage(next.message);
    await queue.add(next.user_id, controller);

    const timer = setTimeout(async () => {
      await queue.remove(next.user_id);
      drainQueue();
    }, animCfg.visibleDurationSecs * 1000);
    exitTimers.set(next.user_id, timer);
  }

  function handleQueue(payload: ChatMessagePayload): void {
    msgQueue.push(payload);
    if (!queueBusy) drainQueue();
  }

  // =========================================================================================================
  // Tauri Event Listeners
  // =========================================================================================================

  // Rust emits this 120ms before show() — gives us time to reset the fade cover
  // to opaque black while the window is still hidden, so the user never sees the flash.
  await listen("overlay-will-show", () => {
    resetAndTriggerFade();
  });

  await listen<string>("overlay-display-mode-changed", (event) => {
    displayMode = event.payload;
  });

  await listen<Record<string, unknown>>("animation-config-changed", (event) => {
    const raw = event.payload;
    // Rust sends booleans as strings "true"/"false" — must compare explicitly
    const parseBool = (v: unknown) => String(v) === "true";
    animCfg = {
      animationIn:         (raw.animation_in  as string) as AnimationConfig["animationIn"] || "bounce",
      animationOut:        (raw.animation_out as string) as AnimationConfig["animationOut"] || "slide-up",
      visibleDurationSecs: Number(raw.visible_duration_secs) || 8,
      idleWiggle:          parseBool(raw.idle_wiggle),
      idleBreathe:         parseBool(raw.idle_breathe),
      glowEffect:          parseBool(raw.glow_effect),
      glowColor:           (raw.glow_color as string) || "#00c896",
      outlineEffect:       parseBool(raw.outline_effect),
      personaSizePx:       Number(raw.persona_size_px)       || 256,
      audioThreshold:      Number(raw.audio_threshold)       || 20,
      maxVisiblePersonas:  Number(raw.max_visible_personas)  || 4,
    };
    queue.setMaxVisible(animCfg.maxVisiblePersonas);
    audioDetector.setThreshold(animCfg.audioThreshold);
  });

  await listen<string>("chroma-color-changed", (event) => {
    body.style.backgroundColor = event.payload;
  });

  await listen<ChatMessagePayload>("chat-message", (event) => {
    // Store the message for lip-sync simulation when TTS fires
    lastMessages.set(event.payload.user_id, event.payload.message);
    if (displayMode === "queue") {
      handleQueue(event.payload);
    } else {
      handleParallel(event.payload);
    }
  });

  await listen<TtsStatePayload>("tts-state", (event) => {
    const { user_id, speaking } = event.payload;
    const persona = queue.get(user_id);

    if (speaking) {
      activeTTSUserId = user_id;
      if (persona) persona.setMouth("open");

      // Launch text-based simulation for natural pauses.
      // Runs only when audio detector is inactive (no Stereo Mix).
      // If Stereo Mix IS active, audioDetectorActive=true and each timer
      // is a no-op, so real-time audio control takes full precedence.
      const msg = lastMessages.get(user_id) ?? "";
      if (msg) startLipSyncSimulation(user_id, msg);
    } else {
      activeTTSUserId = null;
      stopLipSyncSimulation(user_id);
      if (persona) persona.setMouth("closed");
    }
  });
});
