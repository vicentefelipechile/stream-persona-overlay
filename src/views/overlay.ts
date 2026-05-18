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
  // State
  // =========================================================================================================

  const queue      = new PersonaQueue(animCfg.maxVisiblePersonas);
  const exitTimers = new Map<number, ReturnType<typeof setTimeout>>();

  // Queue mode state
  const msgQueue: ChatMessagePayload[] = [];
  let queueBusy = false;

  // Lip-sync state
  let activeTTSUserId: number | null = null;
  const audioDetector = new AudioLevelDetector((isSpeaking) => {
    if (activeTTSUserId !== null) {
      const persona = queue.get(activeTTSUserId);
      if (persona) persona.setMouth(isSpeaking ? "open" : "closed");
    }
  });
  
  audioDetector.setThreshold(animCfg.audioThreshold);
  audioDetector.start();

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

  await listen<string>("overlay-display-mode-changed", (event) => {
    displayMode = event.payload;
  });

  await listen<Record<string, unknown>>("animation-config-changed", (event) => {
    const raw = event.payload;
    animCfg = {
      animationIn:         (raw.animation_in          as string) as AnimationConfig["animationIn"] || "bounce",
      animationOut:        (raw.animation_out         as string) as AnimationConfig["animationOut"] || "slide-up",
      visibleDurationSecs: (raw.visible_duration_secs as number) || 8,
      idleWiggle:          Boolean(raw.idle_wiggle),
      idleBreathe:         Boolean(raw.idle_breathe),
      glowEffect:          Boolean(raw.glow_effect),
      glowColor:           (raw.glow_color            as string) || "#00c896",
      outlineEffect:       Boolean(raw.outline_effect),
      personaSizePx:       (raw.persona_size_px       as number) || 256,
      audioThreshold:      (raw.audio_threshold       as number) || 20,
      maxVisiblePersonas:  (raw.max_visible_personas  as number) || 4,
    };
    queue.setMaxVisible(animCfg.maxVisiblePersonas);
    audioDetector.setThreshold(animCfg.audioThreshold);
  });

  await listen<string>("chroma-color-changed", (event) => {
    body.style.backgroundColor = event.payload;
  });

  await listen<ChatMessagePayload>("chat-message", (event) => {
    if (displayMode === "queue") {
      handleQueue(event.payload);
    } else {
      handleParallel(event.payload);
    }
  });

  await listen<TtsStatePayload>("tts-state", (event) => {
    if (event.payload.speaking) {
      activeTTSUserId = event.payload.user_id;
    } else {
      if (activeTTSUserId === event.payload.user_id) {
        activeTTSUserId = null;
        // Force close when TTS is completely done
        const persona = queue.get(event.payload.user_id);
        if (persona) persona.setMouth("closed");
      }
    }
  });
});
