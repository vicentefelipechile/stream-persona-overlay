// =========================================================================================================
// OVERLAY STREAMER VIEW
// =========================================================================================================
// Entry point for overlay-streamer.html — the streamer persona OBS Browser Source.
// Uses the WebSocket transport (like overlay-browser.ts / overlay-tiktok.ts) so it
// runs in a plain browser without any Tauri dependency. Reads config once, then
// applies live updates from `streamer-config-changed`.
// =========================================================================================================

import { wsListen, wsInvoke, browserConvertFileSrc } from "../overlay/ws-transport";
import { StreamerPersona, type StreamerConfig } from "../overlay/streamer/StreamerPersona";
import { initOverlayNotifications } from "../overlay/overlay-notifications";

// Config values arrive from Rust serialized with their real types, but events and
// older callers may send strings. Read defensively (same pattern as the panel).
function toStreamerConfig(raw: Record<string, unknown>): StreamerConfig {
  const str = (k: string) => String(raw[k] ?? "");
  const num = (k: string, d: number) => {
    const n = Number(raw[k]);
    return Number.isFinite(n) ? n : d;
  };
  return {
    streamer_persona_enabled: String(raw["streamer_persona_enabled"]) === "true",
    streamer_sprite_mo_eo: str("streamer_sprite_mo_eo"),
    streamer_sprite_mc_eo: str("streamer_sprite_mc_eo"),
    streamer_sprite_mo_ec: str("streamer_sprite_mo_ec"),
    streamer_sprite_mc_ec: str("streamer_sprite_mc_ec"),
    streamer_blink_interval_ms: num("streamer_blink_interval_ms", 4000),
    streamer_blink_duration_ms: num("streamer_blink_duration_ms", 150),
    streamer_talk_animation: str("streamer_talk_animation") || "bounce",
    streamer_size_px: num("streamer_size_px", 512),
    streamer_anchor: str("streamer_anchor") || "center",
    streamer_mic_threshold: num("streamer_mic_threshold", 20),
    streamer_mic_device_id: str("streamer_mic_device_id"),
  };
}

window.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("streamer-container")!;
  const persona = new StreamerPersona(container, browserConvertFileSrc);

  let raw: Record<string, unknown> = {};
  try {
    raw = await wsInvoke<Record<string, unknown>>("get_config_cmd");
  } catch (err) {
    console.warn("[streamer] No se pudo leer la config inicial:", err);
  }

  await persona.init(toStreamerConfig(raw));

  // Apply live config edits from the admin panel.
  wsListen<Record<string, unknown>>("streamer-config-changed", (e) => {
    persona.applyConfig(toStreamerConfig(e.payload));
  });

  // Mouth sync: the backend captures the mic natively and broadcasts only the
  // speaking state, so this overlay never touches getUserMedia.
  wsListen<{ speaking: boolean }>("streamer-speaking", (e) => {
    persona.setSpeaking(!!e.payload?.speaking);
  });

  // Surface connection notices (e.g. TikTok connected / connection lost) on-overlay.
  initOverlayNotifications(wsListen);
});
