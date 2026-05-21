// =========================================================================================================
// ANIMATION CONFIG
// =========================================================================================================
// Loads animation configuration from the backend and exposes typed helpers.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { invoke } from "@tauri-apps/api/core";
import { AnimationType } from "./animation-engine";

// =========================================================================================================
// Types
// =========================================================================================================

export interface AnimationConfig {
  animationIn: AnimationType;
  animationOut: AnimationType;
  visibleDurationSecs: number;
  idleWiggle: boolean;
  idleBreathe: boolean;
  glowEffect: boolean;
  glowColor: string;
  outlineEffect: boolean;
  personaSizePx: number;
  audioThreshold: number;
  maxVisiblePersonas: number;
}

// Default config (used as fallback before the backend responds)
export const DEFAULT_ANIMATION_CONFIG: AnimationConfig = {
  animationIn: "bounce",
  animationOut: "slide-up",
  visibleDurationSecs: 8,
  idleWiggle: true,
  idleBreathe: false,
  glowEffect: false,
  glowColor: "#00c896",
  outlineEffect: true,
  personaSizePx: 256,
  audioThreshold: 20,
  maxVisiblePersonas: 4,
};

// =========================================================================================================
// Load from Backend
// =========================================================================================================

/**
 * Loads the full AppConfig from Rust and extracts the animation subset.
 * Falls back to DEFAULT_ANIMATION_CONFIG on error.
 */
export async function loadAnimationConfig(): Promise<AnimationConfig> {
  try {
    const raw = await invoke<Record<string, unknown>>("get_config_cmd");
    // NOTE: boolean config values come from SQLite as strings ("true"/"false").
    // Using Boolean(str) would always return true for non-empty strings, so we
    // must compare explicitly with the string "true".
    const parseBool = (v: unknown): boolean => String(v) === "true";
    return {
      animationIn:         (raw.animation_in          as AnimationType) || "bounce",
      animationOut:        (raw.animation_out         as AnimationType) || "slide-up",
      visibleDurationSecs: Number(raw.visible_duration_secs)            || 8,
      idleWiggle:          parseBool(raw.idle_wiggle),
      idleBreathe:         parseBool(raw.idle_breathe),
      glowEffect:          parseBool(raw.glow_effect),
      glowColor:           (raw.glow_color            as string)        || "#00c896",
      outlineEffect:       parseBool(raw.outline_effect),
      personaSizePx:       Number(raw.persona_size_px)                  || 256,
      audioThreshold:      Number(raw.audio_threshold)                  || 20,
      maxVisiblePersonas:  Number(raw.max_visible_personas)             || 4,
    };
  } catch (e) {
    console.warn("[animation-config] Error cargando config:", e);
    return { ...DEFAULT_ANIMATION_CONFIG };
  }
}
