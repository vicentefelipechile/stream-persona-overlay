// =========================================================================================================
// SHARED EVENT CONFIG HELPERS
// =========================================================================================================
// Extracted from the (now slimmed) twitch.ts / tiktok.ts views so the centralized
// Eventos view can render the per-platform "event types + cooldowns + TTS + EventSub"
// blocks without duplicating the slider/preset/save plumbing for each platform.
//
// Each platform section is built by `twitchEventSection()` / `tiktokEventSection()`,
// which return the section HTML plus `bind()` (wire handlers) and `save()` (persist
// to the same config keys as before). Connection / chat filters / anti-spam stay in
// the platform views — only the event-related controls live here.
// =========================================================================================================

import { invoke } from "@tauri-apps/api/core";
import { Icons } from "../icons";

// =========================================================================================================
// Preset tables (mirror the values that used to live in twitch.ts / tiktok.ts)
// =========================================================================================================

interface EventPreset { label: string; cooldownMs: number; }

export const EVENT_PRESETS: Record<string, EventPreset> = {
  off:      { label: "Sin protección", cooldownMs: 0     },
  light:    { label: "Ligero",         cooldownMs: 3000  },
  normal:   { label: "Normal",         cooldownMs: 10000 },
  strict:   { label: "Estricto",       cooldownMs: 30000 },
  lockdown: { label: "Lockdown",       cooldownMs: 60000 },
};

export function eventPresetDescription(preset: string): string {
  if (preset === "off") return "Sin cooldown entre eventos por usuario.";
  if (preset === "custom") return "Cooldown personalizado por tipo de evento.";
  const p = EVENT_PRESETS[preset];
  if (!p) return "";
  return `Cooldown de ${p.cooldownMs / 1000}s entre eventos repetidos del mismo usuario.`;
}

// =========================================================================================================
// Small HTML / DOM helpers (shared)
// =========================================================================================================

export const msLabel = (ms: number) => (ms === 0 ? "Desactivado" : `${ms / 1000}s`);

/** A labelled range slider row (matches the old per-view `sRow`). */
export function sRow(
  id: string, value: number, min: number, max: number, step: number,
  label: string, fmt: (v: number) => string,
): string {
  return `<div class="form-group" style="gap:4px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <label style="margin:0;">${label}</label>
        <span id="${id}-val" style="font-size:0.9rem;font-weight:600;color:var(--accent);min-width:72px;text-align:right;">${fmt(value)}</span>
      </div>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" style="width:100%;margin-top:4px;"/>
    </div>`;
}

/** Radio group of cooldown presets (+ a "custom" option). */
export function presetRadios(name: string, current: string, options: string[]): string {
  const labels: Record<string, string> = {
    off: "Off", light: "Ligero", normal: "Normal", strict: "Estricto",
    lockdown: "Lockdown", custom: "Personalizado",
  };
  return [...options, "custom"].map((v) =>
    `<label class="preset-radio ${current === v ? "active" : ""}">
        <input type="radio" name="${name}" value="${v}" ${current === v ? "checked" : ""}/>
        ${labels[v] ?? v}
      </label>`).join("");
}

export function syncSlider(id: string, fmt: (v: number) => string): void {
  const el = document.getElementById(id) as HTMLInputElement | null;
  const lbl = document.getElementById(`${id}-val`);
  if (!el) return;
  if (lbl) lbl.textContent = fmt(Number(el.value));
  const pct = ((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100;
  el.style.setProperty("--slider-fill", `${pct}%`);
}

export function updateRadioLabels(name: string, value: string): void {
  document.querySelectorAll(`input[name="${name}"]`).forEach((radio) => {
    const label = (radio as HTMLElement).closest(".preset-radio");
    if (label) label.classList.toggle("active", (radio as HTMLInputElement).value === value);
  });
}

const g = (id: string) => document.getElementById(id) as HTMLInputElement;

async function setKey(key: string, value: string): Promise<void> {
  await invoke("set_config_cmd", { key, value });
}

// =========================================================================================================
// Public type returned by each section builder
// =========================================================================================================

export interface EventSection {
  /** Section HTML to inject into the page. */
  html: string;
  /** Wire up handlers (call after the HTML is in the DOM). */
  bind: () => void;
  /** Persist every control in this section to its config keys. */
  save: () => Promise<void>;
}

// =========================================================================================================
// Twitch event section (types + cooldowns + TTS + EventSub)
// =========================================================================================================

export function twitchEventSection(cfg: Record<string, unknown>): EventSection {
  const cheerEnabled = String(cfg["twitch_event_cheer_enabled"]) === "true";
  const cheerMinBits = Number(cfg["twitch_event_cheer_min_bits"]) || 100;
  const subEnabled = String(cfg["twitch_event_sub_enabled"]) === "true";
  const raidEnabled = String(cfg["twitch_event_raid_enabled"]) === "true";
  const followEnabled = String(cfg["twitch_event_follow_enabled"]) === "true";
  const hypeTrainEnabled = String(cfg["twitch_event_hype_train_enabled"]) === "true";
  const streamStatusEnabled = String(cfg["twitch_event_stream_status_enabled"]) === "true";
  const ttsAnnouncements = String(cfg["twitch_tts_event_announcements"]) === "true";
  const eventsubEnabled = String(cfg["twitch_eventsub_enabled"]) === "true";

  const eventPreset = String(cfg["twitch_event_cooldown_preset"] || "off");
  const cheerCd = Number(cfg["twitch_event_cheer_user_cooldown_ms"]) || 0;
  const subCd = Number(cfg["twitch_event_sub_user_cooldown_ms"]) || 0;
  const raidCd = Number(cfg["twitch_event_raid_global_cooldown_ms"]) || 0;
  const followCd = Number(cfg["twitch_event_follow_user_cooldown_ms"]) || 0;

  const cdIds = ["tw-ev-cheer-cd", "tw-ev-sub-cd", "tw-ev-raid-cd", "tw-ev-follow-cd"];

  const html = `
    <div class="card">
      <div class="card-header"><h2 class="section-title">Tipos de evento</h2></div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div class="tama-event-toggle">
          <label class="switch"><input type="checkbox" id="tw-ev-cheer" ${cheerEnabled ? "checked" : ""}/><span class="switch-track"></span></label>
          <div>
            <span class="tama-event-label">Bits (Cheers)</span>
            <input type="number" id="tw-cheer-min-bits" value="${cheerMinBits}" placeholder="Mín. bits" style="width: 100%; margin-top: 4px;"/>
          </div>
        </div>
        <div class="tama-event-toggle">
          <label class="switch"><input type="checkbox" id="tw-ev-sub" ${subEnabled ? "checked" : ""}/><span class="switch-track"></span></label>
          <span class="tama-event-label">Nuevas Suscripciones</span>
        </div>
        <div class="tama-event-toggle">
          <label class="switch"><input type="checkbox" id="tw-ev-raid" ${raidEnabled ? "checked" : ""}/><span class="switch-track"></span></label>
          <span class="tama-event-label">Raids</span>
        </div>
        <div class="tama-event-toggle">
          <label class="switch"><input type="checkbox" id="tw-ev-follow" ${followEnabled ? "checked" : ""}/><span class="switch-track"></span></label>
          <span class="tama-event-label">Nuevos Seguidores</span>
        </div>
        <div class="tama-event-toggle">
          <label class="switch"><input type="checkbox" id="tw-ev-hype-train" ${hypeTrainEnabled ? "checked" : ""}/><span class="switch-track"></span></label>
          <span class="tama-event-label">Hype Train</span>
        </div>
        <div class="tama-event-toggle">
          <label class="switch"><input type="checkbox" id="tw-ev-stream-status" ${streamStatusEnabled ? "checked" : ""}/><span class="switch-track"></span></label>
          <span class="tama-event-label">Online/Offline</span>
        </div>
      </div>
      <div class="tama-setting-row" style="margin-top: 16px;">
        <div><div class="tama-setting-label">Anunciar eventos con TTS</div></div>
        <label class="switch"><input type="checkbox" id="tw-tts" ${ttsAnnouncements ? "checked" : ""}/><span class="switch-track"></span></label>
      </div>
    </div>

    <div class="card" style="margin-top: var(--space-5);">
      <div class="card-header"><h2 class="section-title">Cooldown de eventos</h2></div>
      <div class="preset-group" id="tw-event-preset-group">
        ${presetRadios("tw-event-preset", eventPreset, ["off", "light", "normal", "strict", "lockdown"])}
      </div>
      <p id="tw-event-preset-desc" style="font-size:0.85rem;color:var(--text-muted);margin:8px 0 0;">${eventPresetDescription(eventPreset)}</p>
      <details id="tw-event-advanced" ${eventPreset === "custom" ? "open" : ""} style="margin-top:12px;">
        <summary class="details-toggle">Avanzado</summary>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:16px;">
          ${sRow("tw-ev-cheer-cd",  cheerCd,  0, 120000, 1000, "Cooldown Bits/Cheers por usuario",   msLabel)}
          ${sRow("tw-ev-sub-cd",    subCd,    0, 120000, 1000, "Cooldown Suscripciones por usuario", msLabel)}
          ${sRow("tw-ev-raid-cd",   raidCd,   0, 120000, 1000, "Cooldown Raids (global canal)",      msLabel)}
          ${sRow("tw-ev-follow-cd", followCd, 0, 120000, 1000, "Cooldown Follows por usuario",       msLabel)}
        </div>
      </details>
    </div>

    <div class="card" style="margin-top: var(--space-5);">
      <div class="card-header"><h2 class="section-title">EventSub</h2></div>
      <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 16px;">
        Recibe subs, raids, follows y bits en tiempo real sin depender del chat IRC. Requiere los scopes de EventSub en el Access Token (vista Twitch).
      </p>
      <div class="tama-setting-row">
        <div>
          <div class="tama-setting-label">Activar EventSub</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">Se conecta al reconectar Twitch</div>
        </div>
        <label class="switch"><input type="checkbox" id="tw-eventsub" ${eventsubEnabled ? "checked" : ""}/><span class="switch-track"></span></label>
      </div>
    </div>`;

  const save = async (): Promise<void> => {
    const updates: [string, string][] = [
      ["twitch_event_cheer_enabled",          g("tw-ev-cheer").checked ? "true" : "false"],
      ["twitch_event_cheer_min_bits",         g("tw-cheer-min-bits").value],
      ["twitch_event_sub_enabled",            g("tw-ev-sub").checked ? "true" : "false"],
      ["twitch_event_raid_enabled",           g("tw-ev-raid").checked ? "true" : "false"],
      ["twitch_event_follow_enabled",         g("tw-ev-follow").checked ? "true" : "false"],
      ["twitch_event_hype_train_enabled",     g("tw-ev-hype-train").checked ? "true" : "false"],
      ["twitch_event_stream_status_enabled",  g("tw-ev-stream-status").checked ? "true" : "false"],
      ["twitch_tts_event_announcements",      g("tw-tts").checked ? "true" : "false"],
      ["twitch_eventsub_enabled",             g("tw-eventsub").checked ? "true" : "false"],
      ["twitch_event_cooldown_preset",        (document.querySelector('input[name="tw-event-preset"]:checked') as HTMLInputElement)?.value ?? "off"],
      ["twitch_event_cheer_user_cooldown_ms",  g("tw-ev-cheer-cd").value],
      ["twitch_event_sub_user_cooldown_ms",    g("tw-ev-sub-cd").value],
      ["twitch_event_raid_global_cooldown_ms", g("tw-ev-raid-cd").value],
      ["twitch_event_follow_user_cooldown_ms", g("tw-ev-follow-cd").value],
    ];
    for (const [key, value] of updates) await setKey(key, value);
  };

  const bind = (): void => {
    for (const id of cdIds) syncSlider(id, msLabel);

    // Toggle + number inputs → save on change.
    ["tw-ev-cheer", "tw-cheer-min-bits", "tw-ev-sub", "tw-ev-raid", "tw-ev-follow",
     "tw-ev-hype-train", "tw-ev-stream-status", "tw-tts", "tw-eventsub"].forEach((id) => {
      g(id)?.addEventListener("change", () => void save());
    });

    // Preset radios.
    document.querySelectorAll('input[name="tw-event-preset"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        const val = (radio as HTMLInputElement).value;
        updateRadioLabels("tw-event-preset", val);
        const desc = document.getElementById("tw-event-preset-desc");
        if (desc) desc.textContent = eventPresetDescription(val);
        if (val !== "custom") {
          const ms = String(EVENT_PRESETS[val]?.cooldownMs ?? 0);
          cdIds.forEach((id) => { g(id).value = ms; syncSlider(id, msLabel); });
        }
        void save();
      });
    });

    // Cooldown sliders → flip to "custom" and save on release.
    cdIds.forEach((id) => {
      const el = g(id);
      el?.addEventListener("input", () => syncSlider(id, msLabel));
      el?.addEventListener("change", () => {
        const radio = document.querySelector('input[name="tw-event-preset"][value="custom"]') as HTMLInputElement;
        if (radio && !radio.checked) { radio.checked = true; updateRadioLabels("tw-event-preset", "custom"); }
        void save();
      });
    });
  };

  return { html, bind, save };
}

// =========================================================================================================
// TikTok event section (types + cooldowns + TTS)
// =========================================================================================================

export function tiktokEventSection(cfg: Record<string, unknown>): EventSection {
  const giftEnabled = String(cfg["tiktok_event_gift_enabled"]) === "true";
  const giftMinCoins = Number(cfg["tiktok_event_gift_min_coins"]) || 10;
  const giftBigCoins = Number(cfg["tiktok_event_gift_big_coins"]) || 100;
  const likeEnabled = String(cfg["tiktok_event_like_enabled"]) === "true";
  const followEnabled = String(cfg["tiktok_event_follow_enabled"]) === "true";
  const shareEnabled = String(cfg["tiktok_event_share_enabled"]) === "true";
  const subscribeEnabled = String(cfg["tiktok_event_subscribe_enabled"]) === "true";
  const envelopeEnabled = String(cfg["tiktok_event_envelope_enabled"]) === "true";
  const ttsAnnouncements = String(cfg["tiktok_tts_event_announcements"]) === "true";

  const eventPreset = String(cfg["tiktok_event_cooldown_preset"] || "off");
  const giftCd = Number(cfg["tiktok_event_gift_user_cooldown_ms"]) || 0;
  const likeCd = Number(cfg["tiktok_event_like_user_cooldown_ms"]) || 0;
  const followCd = Number(cfg["tiktok_event_follow_user_cooldown_ms"]) || 0;
  const shareCd = Number(cfg["tiktok_event_share_user_cooldown_ms"]) || 0;
  const subscribeCd = Number(cfg["tiktok_event_subscribe_user_cooldown_ms"]) || 0;
  const envelopeCd = Number(cfg["tiktok_event_envelope_user_cooldown_ms"]) || 0;

  const cdIds = ["tt-ev-gift-cd", "tt-ev-like-cd", "tt-ev-follow-cd", "tt-ev-share-cd", "tt-ev-subscribe-cd", "tt-ev-envelope-cd"];

  const html = `
    <div class="card">
      <div class="card-header"><h2 class="section-title">Tipos de evento</h2></div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div class="tama-event-toggle">
          <label class="switch"><input type="checkbox" id="tt-ev-gift" ${giftEnabled ? "checked" : ""}/><span class="switch-track"></span></label>
          <div>
            <span class="tama-event-label">Regalos</span>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 4px;">
              <input type="number" id="tt-gift-min-coins" value="${giftMinCoins}" placeholder="Min coins" style="font-size: 0.85rem;"/>
              <input type="number" id="tt-gift-big-coins" value="${giftBigCoins}" placeholder="Big coins" style="font-size: 0.85rem;"/>
            </div>
          </div>
        </div>
        <div class="tama-event-toggle">
          <label class="switch"><input type="checkbox" id="tt-ev-like" ${likeEnabled ? "checked" : ""}/><span class="switch-track"></span></label>
          <span class="tama-event-label">Likes</span>
        </div>
        <div class="tama-event-toggle">
          <label class="switch"><input type="checkbox" id="tt-ev-follow" ${followEnabled ? "checked" : ""}/><span class="switch-track"></span></label>
          <span class="tama-event-label">Nuevos Seguidores</span>
        </div>
        <div class="tama-event-toggle">
          <label class="switch"><input type="checkbox" id="tt-ev-share" ${shareEnabled ? "checked" : ""}/><span class="switch-track"></span></label>
          <span class="tama-event-label">Comparticiones</span>
        </div>
        <div class="tama-event-toggle">
          <label class="switch"><input type="checkbox" id="tt-ev-subscribe" ${subscribeEnabled ? "checked" : ""}/><span class="switch-track"></span></label>
          <span class="tama-event-label">Suscripciones</span>
        </div>
        <div class="tama-event-toggle">
          <label class="switch"><input type="checkbox" id="tt-ev-envelope" ${envelopeEnabled ? "checked" : ""}/><span class="switch-track"></span></label>
          <span class="tama-event-label">Sobres (Rojo)</span>
        </div>
      </div>
      <div class="tama-setting-row" style="margin-top: 16px;">
        <div><div class="tama-setting-label">Anunciar eventos con TTS</div></div>
        <label class="switch"><input type="checkbox" id="tt-tts" ${ttsAnnouncements ? "checked" : ""}/><span class="switch-track"></span></label>
      </div>
    </div>

    <div class="card" style="margin-top: var(--space-5);">
      <div class="card-header"><h2 class="section-title">Cooldown de eventos</h2></div>
      <div class="preset-group" id="tt-event-preset-group">
        ${presetRadios("tt-event-preset", eventPreset, ["off", "light", "normal", "strict", "lockdown"])}
      </div>
      <p id="tt-event-preset-desc" style="font-size:0.85rem;color:var(--text-muted);margin:8px 0 0;">${eventPresetDescription(eventPreset)}</p>
      <details id="tt-event-advanced" ${eventPreset === "custom" ? "open" : ""} style="margin-top:12px;">
        <summary class="details-toggle">Avanzado</summary>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:16px;">
          ${sRow("tt-ev-gift-cd",      giftCd,      0, 120000, 1000, "Cooldown Regalos por usuario",        msLabel)}
          ${sRow("tt-ev-like-cd",      likeCd,      0, 120000, 1000, "Cooldown Likes por usuario",          msLabel)}
          ${sRow("tt-ev-follow-cd",    followCd,    0, 120000, 1000, "Cooldown Follows por usuario",        msLabel)}
          ${sRow("tt-ev-share-cd",     shareCd,     0, 120000, 1000, "Cooldown Comparticiones por usuario", msLabel)}
          ${sRow("tt-ev-subscribe-cd", subscribeCd, 0, 120000, 1000, "Cooldown Suscripciones por usuario",  msLabel)}
          ${sRow("tt-ev-envelope-cd",  envelopeCd,  0, 120000, 1000, "Cooldown Sobres por usuario",         msLabel)}
        </div>
      </details>
    </div>`;

  const save = async (): Promise<void> => {
    const updates: [string, string][] = [
      ["tiktok_event_gift_enabled",      g("tt-ev-gift").checked ? "true" : "false"],
      ["tiktok_event_gift_min_coins",    g("tt-gift-min-coins").value],
      ["tiktok_event_gift_big_coins",    g("tt-gift-big-coins").value],
      ["tiktok_event_like_enabled",      g("tt-ev-like").checked ? "true" : "false"],
      ["tiktok_event_follow_enabled",    g("tt-ev-follow").checked ? "true" : "false"],
      ["tiktok_event_share_enabled",     g("tt-ev-share").checked ? "true" : "false"],
      ["tiktok_event_subscribe_enabled", g("tt-ev-subscribe").checked ? "true" : "false"],
      ["tiktok_event_envelope_enabled",  g("tt-ev-envelope").checked ? "true" : "false"],
      ["tiktok_tts_event_announcements", g("tt-tts").checked ? "true" : "false"],
      ["tiktok_event_cooldown_preset",   (document.querySelector('input[name="tt-event-preset"]:checked') as HTMLInputElement)?.value ?? "off"],
      ["tiktok_event_gift_user_cooldown_ms",      g("tt-ev-gift-cd").value],
      ["tiktok_event_like_user_cooldown_ms",      g("tt-ev-like-cd").value],
      ["tiktok_event_follow_user_cooldown_ms",    g("tt-ev-follow-cd").value],
      ["tiktok_event_share_user_cooldown_ms",     g("tt-ev-share-cd").value],
      ["tiktok_event_subscribe_user_cooldown_ms", g("tt-ev-subscribe-cd").value],
      ["tiktok_event_envelope_user_cooldown_ms",  g("tt-ev-envelope-cd").value],
    ];
    for (const [key, value] of updates) await setKey(key, value);
  };

  const bind = (): void => {
    for (const id of cdIds) syncSlider(id, msLabel);

    ["tt-ev-gift", "tt-gift-min-coins", "tt-gift-big-coins", "tt-ev-like", "tt-ev-follow",
     "tt-ev-share", "tt-ev-subscribe", "tt-ev-envelope", "tt-tts"].forEach((id) => {
      g(id)?.addEventListener("change", () => void save());
    });

    document.querySelectorAll('input[name="tt-event-preset"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        const val = (radio as HTMLInputElement).value;
        updateRadioLabels("tt-event-preset", val);
        const desc = document.getElementById("tt-event-preset-desc");
        if (desc) desc.textContent = eventPresetDescription(val);
        if (val !== "custom") {
          const ms = String(EVENT_PRESETS[val]?.cooldownMs ?? 0);
          cdIds.forEach((id) => { g(id).value = ms; syncSlider(id, msLabel); });
        }
        void save();
      });
    });

    cdIds.forEach((id) => {
      const el = g(id);
      el?.addEventListener("input", () => syncSlider(id, msLabel));
      el?.addEventListener("change", () => {
        const radio = document.querySelector('input[name="tt-event-preset"][value="custom"]') as HTMLInputElement;
        if (radio && !radio.checked) { radio.checked = true; updateRadioLabels("tt-event-preset", "custom"); }
        void save();
      });
    });
  };

  return { html, bind, save };
}

// Re-export the platform brand icon helpers used by the section headers, so the
// caller doesn't need to import them separately.
export const PlatformIcons = { twitch: Icons.twitch, tiktok: Icons.tiktok };
