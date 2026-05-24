// =========================================================================================================
// TWITCH VIEW
// =========================================================================================================
// Twitch connection, chat filters, anti-spam presets, events and EventSub configuration.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { invoke } from "@tauri-apps/api/core";
import { once } from "@tauri-apps/api/event";
import { showToast } from "../state";
import { Icons } from "../icons";

// =========================================================================================================
// Preset tables
// =========================================================================================================

interface ChatPreset { label: string; cooldown: number; dedup: number; rateMax: number; rateWindow: number; }
interface EventPreset { label: string; cooldownMs: number; }
interface GlobalPreset { label: string; cap: number; }

const CHAT_PRESETS: Record<string, ChatPreset> = {
  off:      { label: "Sin protección",  cooldown: 0,     dedup: 0,     rateMax: 0, rateWindow: 10 },
  light:    { label: "Ligero",          cooldown: 2000,  dedup: 5000,  rateMax: 8, rateWindow: 10 },
  normal:   { label: "Normal",          cooldown: 5000,  dedup: 10000, rateMax: 4, rateWindow: 10 },
  strict:   { label: "Estricto",        cooldown: 15000, dedup: 30000, rateMax: 3, rateWindow: 30 },
  lockdown: { label: "Lockdown",        cooldown: 30000, dedup: 60000, rateMax: 2, rateWindow: 60 },
};

const EVENT_PRESETS: Record<string, EventPreset> = {
  off:      { label: "Sin protección", cooldownMs: 0     },
  light:    { label: "Ligero",         cooldownMs: 3000  },
  normal:   { label: "Normal",         cooldownMs: 10000 },
  strict:   { label: "Estricto",       cooldownMs: 30000 },
  lockdown: { label: "Lockdown",       cooldownMs: 60000 },
};

const GLOBAL_PRESETS: Record<string, GlobalPreset> = {
  off:   { label: "Sin límite",    cap: 0  },
  calm:  { label: "Tranquilo",     cap: 5  },
  normal:{ label: "Normal",        cap: 15 },
  busy:  { label: "Stream activo", cap: 30 },
};

function chatPresetDescription(preset: string): string {
  if (preset === "off") return "Sin filtros de anti-spam activos.";
  if (preset === "custom") return "Configuración personalizada activa.";
  const p = CHAT_PRESETS[preset];
  if (!p) return "";
  return `Permite hasta ${p.rateMax} mensajes cada ${p.rateWindow}s por usuario. Ignora duplicados durante ${p.dedup/1000}s. Espera ${p.cooldown/1000}s entre mensajes.`;
}

function eventPresetDescription(preset: string): string {
  if (preset === "off") return "Sin cooldown entre eventos por usuario.";
  if (preset === "custom") return "Cooldown personalizado por tipo de evento.";
  const p = EVENT_PRESETS[preset];
  if (!p) return "";
  return `Cooldown de ${p.cooldownMs/1000}s entre eventos repetidos del mismo usuario.`;
}

// =========================================================================================================
// Render function
// =========================================================================================================

export async function renderTwitch(): Promise<void> {
  const container = document.getElementById("view-container")!;

  let cfg: Record<string, unknown> = {};
  try {
    cfg = await invoke<Record<string, unknown>>("get_config_cmd");
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><span class="empty-state-icon">${Icons.warning(48)}</span><p>${String(e)}</p></div>`;
    return;
  }

  const channel = String(cfg["twitch_channel"] || "");
  const token = String(cfg["twitch_bot_token"] || "");
  const chat_min_length = Number(cfg["twitch_chat_min_length"]) || 0;
  const chat_max_length = Number(cfg["twitch_chat_max_length"]) || 500;
  const ignore_commands = String(cfg["twitch_chat_ignore_commands"]) === "true";
const event_cheer_enabled = String(cfg["twitch_event_cheer_enabled"]) === "true";
  const event_cheer_min_bits = Number(cfg["twitch_event_cheer_min_bits"]) || 100;
  const event_sub_enabled = String(cfg["twitch_event_sub_enabled"]) === "true";
  const event_raid_enabled = String(cfg["twitch_event_raid_enabled"]) === "true";
  const event_follow_enabled = String(cfg["twitch_event_follow_enabled"]) === "true";
  const event_hype_train_enabled = String(cfg["twitch_event_hype_train_enabled"]) === "true";
  const event_stream_status_enabled = String(cfg["twitch_event_stream_status_enabled"]) === "true";
  const tts_announcements = String(cfg["twitch_tts_event_announcements"]) === "true";
  const eventsub_enabled = String(cfg["twitch_eventsub_enabled"]) === "true";

  // Anti-spam config
  const chatPreset = String(cfg["twitch_chat_antispam_preset"] || "off");
  const chatCooldown = Number(cfg["twitch_chat_user_cooldown_ms"]) || 0;
  const chatDedup = Number(cfg["twitch_chat_dedup_window_ms"]) || 0;
  const chatRateMax = Number(cfg["twitch_chat_rate_max_msgs"]) || 0;
  const chatRateWindow = Number(cfg["twitch_chat_rate_window_secs"]) || 10;
  const eventPreset = String(cfg["twitch_event_cooldown_preset"] || "off");
  const eventCheerCooldown = Number(cfg["twitch_event_cheer_user_cooldown_ms"]) || 0;
  const eventSubCooldown = Number(cfg["twitch_event_sub_user_cooldown_ms"]) || 0;
  const eventRaidCooldown = Number(cfg["twitch_event_raid_global_cooldown_ms"]) || 0;
  const eventFollowCooldown = Number(cfg["twitch_event_follow_user_cooldown_ms"]) || 0;
  const globalPreset = String(cfg["chat_global_throughput_preset"] || "off");
  const globalCap = Number(cfg["chat_global_rate_max_per_sec"]) || 0;

  const isConnected = channel.length > 0 && token.length > 0;

  const msLabel = (ms: number) => ms === 0 ? "Desactivado" : `${ms / 1000}s`;
  const sRow = (id: string, value: number, min: number, max: number, step: number, label: string, fmt: (v: number) => string) =>
    `<div class="form-group" style="gap:4px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <label style="margin:0;">${label}</label>
        <span id="${id}-val" style="font-size:0.9rem;font-weight:600;color:var(--accent);min-width:72px;text-align:right;">${fmt(value)}</span>
      </div>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" style="width:100%;margin-top:4px;"/>
    </div>`;

  const presetRadios = (name: string, current: string, options: string[], hasCustom = true) =>
    [...options, ...(hasCustom ? ["custom"] : [])].map(v => {
      const labels: Record<string, string> = {
        off: "Off", light: "Ligero", normal: "Normal", strict: "Estricto",
        lockdown: "Lockdown", custom: "Personalizado",
        calm: "Tranquilo", busy: "Stream activo",
      };
      return `<label class="preset-radio ${current === v ? "active" : ""}">
        <input type="radio" name="${name}" value="${v}" ${current === v ? "checked" : ""}/>
        ${labels[v] ?? v}
      </label>`;
    }).join("");

  container.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">${Icons.twitch(20)} Twitch</h1>
      <p class="view-subtitle">Configuración de eventos y filtros de chat</p>
    </div>

    <div class="card">
      <div class="card-header">
        <h2 class="section-title">Conexión</h2>
        <span class="badge ${isConnected ? "badge-ok" : "badge-warn"}">${isConnected ? "Conectado" : "Desconectado"}</span>
      </div>
      <div class="form-group">
        <label>Canal Twitch</label>
        <input type="text" id="twitch-channel" value="${channel}" placeholder="nombre_canal"/>
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;">
          Access Token
          <a href="https://twitchapps.com/tmi/" target="_blank" class="btn btn-secondary btn-sm" style="display:inline-flex;align-items:center;gap:4px;text-decoration:none;">${Icons.externalLink(12)} Obtener Access Token</a>
        </label>
        <div style="display: flex; gap: 8px; align-items: flex-start;">
          <input type="password" id="twitch-token" value="${token}" placeholder="oauth:..."/>
          <button id="btn-validate-token" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap;">${Icons.check(14)} Validar</button>
        </div>
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;font-size:0.8rem;color:var(--text-muted);">
          <div>
            <span style="display:block;margin-bottom:3px;font-weight:600;">Scopes mínimos (chat)</span>
            <div style="display:flex;flex-wrap:wrap;gap:4px;">
              <code style="background:var(--bg-3);padding:2px 6px;border-radius:4px;">chat:read</code>
              <code style="background:var(--bg-3);padding:2px 6px;border-radius:4px;">chat:edit</code>
            </div>
          </div>
          <div>
            <span style="display:block;margin-bottom:3px;font-weight:600;">Para EventSub (subs, raids, follows, bits)</span>
            <div style="display:flex;flex-wrap:wrap;gap:4px;">
              <code style="background:var(--bg-3);padding:2px 6px;border-radius:4px;">bits:read</code>
              <code style="background:var(--bg-3);padding:2px 6px;border-radius:4px;">channel:read:subscriptions</code>
              <code style="background:var(--bg-3);padding:2px 6px;border-radius:4px;">channel:read:raids</code>
              <code style="background:var(--bg-3);padding:2px 6px;border-radius:4px;">moderator:read:followers</code>
            </div>
          </div>
        </div>
        <div id="twitch-scopes" style="margin-top: 8px; font-size: 0.85rem;"></div>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 16px;">
        <button id="btn-connect-twitch" class="btn btn-primary" style="display:inline-flex;align-items:center;gap:6px;">${Icons.zap(14)} ${isConnected ? "Reconectar" : "Conectar"}</button>
        ${isConnected ? `<button id="btn-disconnect-twitch" class="btn btn-outline" style="display:inline-flex;align-items:center;gap:6px;">${Icons.unplug(14)} Desconectar</button>` : ""}
      </div>
    </div>

    <div class="card" style="margin-top: var(--space-5);">
      <div class="card-header">
        <h2 class="section-title">Filtros de Chat</h2>
      </div>
      <div class="form-group">
        <label>Longitud mínima</label>
        <input type="number" id="twitch-chat-min-length" value="${chat_min_length}" min="0"/>
      </div>
      <div class="form-group">
        <label>Longitud máxima</label>
        <input type="number" id="twitch-chat-max-length" value="${chat_max_length}" min="0"/>
      </div>
      <div class="tama-setting-row">
        <div><div class="tama-setting-label">Ignorar comandos (!comando)</div></div>
        <label class="switch">
          <input type="checkbox" id="twitch-ignore-commands" ${ignore_commands ? "checked" : ""}/>
          <span class="switch-track"></span>
        </label>
      </div>
    </div>

    <div class="card" style="margin-top: var(--space-5);">
      <div class="card-header">
        <h2 class="section-title">Anti-spam (chat)</h2>
      </div>
      <div class="preset-group" id="chat-preset-group">
        ${presetRadios("twitch-chat-preset", chatPreset, ["off", "light", "normal", "strict", "lockdown"])}
      </div>
      <p id="chat-preset-desc" style="font-size:0.85rem;color:var(--text-muted);margin:8px 0 0;">${chatPresetDescription(chatPreset)}</p>
      <details id="chat-advanced" ${chatPreset === "custom" ? "open" : ""} style="margin-top:12px;">
        <summary class="details-toggle">Avanzado</summary>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:16px;">
          ${sRow("twitch-chat-cooldown",   chatCooldown,   0, 60000, 500,  "Espera entre mensajes por usuario", msLabel)}
          ${sRow("twitch-chat-dedup",      chatDedup,      0, 60000, 1000, "Ventana para ignorar duplicados",   msLabel)}
          ${sRow("twitch-chat-rate-max",   chatRateMax,    0, 20,    1,    "Máx. mensajes por ventana",         v => v === 0 ? "Desactivado" : `${v} msg`)}
          ${sRow("twitch-chat-rate-window",chatRateWindow, 1, 60,    1,    "Ventana de tiempo",                 v => `${v}s`)}
        </div>
      </details>
    </div>

    <div class="card" style="margin-top: var(--space-5);">
      <div class="card-header">
        <h2 class="section-title">Cooldown de Eventos</h2>
      </div>
      <div class="preset-group" id="event-preset-group">
        ${presetRadios("twitch-event-preset", eventPreset, ["off", "light", "normal", "strict", "lockdown"])}
      </div>
      <p id="event-preset-desc" style="font-size:0.85rem;color:var(--text-muted);margin:8px 0 0;">${eventPresetDescription(eventPreset)}</p>
      <details id="event-advanced" ${eventPreset === "custom" ? "open" : ""} style="margin-top:12px;">
        <summary class="details-toggle">Avanzado</summary>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:16px;">
          ${sRow("twitch-event-cheer-cooldown",  eventCheerCooldown,  0, 120000, 1000, "Cooldown Bits/Cheers por usuario",    msLabel)}
          ${sRow("twitch-event-sub-cooldown",    eventSubCooldown,    0, 120000, 1000, "Cooldown Suscripciones por usuario",  msLabel)}
          ${sRow("twitch-event-raid-cooldown",   eventRaidCooldown,   0, 120000, 1000, "Cooldown Raids (global canal)",       msLabel)}
          ${sRow("twitch-event-follow-cooldown", eventFollowCooldown, 0, 120000, 1000, "Cooldown Follows por usuario",        msLabel)}
        </div>
      </details>
    </div>

    <div class="card" style="margin-top: var(--space-5);">
      <div class="card-header">
        <h2 class="section-title">Tope Global de Mensajes</h2>
      </div>
      <div class="preset-group" id="global-preset-group">
        ${presetRadios("twitch-global-preset", globalPreset, ["off", "calm", "normal", "busy"], false)}
      </div>
      <details id="global-advanced" style="margin-top:12px;">
        <summary class="details-toggle">Avanzado</summary>
        <div style="margin-top:12px;">
          ${sRow("twitch-global-cap", globalCap, 0, 50, 1, "Máx. mensajes por segundo (global)", v => v === 0 ? "Desactivado" : `${v}/s`)}
        </div>
      </details>
    </div>

    <div class="card" style="margin-top: var(--space-5);">
      <div class="card-header">
        <h2 class="section-title">Eventos</h2>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div class="tama-event-toggle">
          <label class="switch">
            <input type="checkbox" id="twitch-event-cheer" ${event_cheer_enabled ? "checked" : ""}/>
            <span class="switch-track"></span>
          </label>
          <div>
            <span class="tama-event-label">Bits (Cheers)</span>
            <input type="number" id="twitch-cheer-min-bits" value="${event_cheer_min_bits}" placeholder="Mín. bits" style="width: 100%; margin-top: 4px;"/>
          </div>
        </div>
        <div class="tama-event-toggle">
          <label class="switch">
            <input type="checkbox" id="twitch-event-sub" ${event_sub_enabled ? "checked" : ""}/>
            <span class="switch-track"></span>
          </label>
          <span class="tama-event-label">Nuevas Suscripciones</span>
        </div>
        <div class="tama-event-toggle">
          <label class="switch">
            <input type="checkbox" id="twitch-event-raid" ${event_raid_enabled ? "checked" : ""}/>
            <span class="switch-track"></span>
          </label>
          <span class="tama-event-label">Raids</span>
        </div>
        <div class="tama-event-toggle">
          <label class="switch">
            <input type="checkbox" id="twitch-event-follow" ${event_follow_enabled ? "checked" : ""}/>
            <span class="switch-track"></span>
          </label>
          <span class="tama-event-label">Nuevos Seguidores</span>
        </div>
        <div class="tama-event-toggle">
          <label class="switch">
            <input type="checkbox" id="twitch-event-hype-train" ${event_hype_train_enabled ? "checked" : ""}/>
            <span class="switch-track"></span>
          </label>
          <span class="tama-event-label">Hype Train</span>
        </div>
        <div class="tama-event-toggle">
          <label class="switch">
            <input type="checkbox" id="twitch-event-stream-status" ${event_stream_status_enabled ? "checked" : ""}/>
            <span class="switch-track"></span>
          </label>
          <span class="tama-event-label">Online/Offline</span>
        </div>
      </div>
      <div class="tama-setting-row" style="margin-top: 16px;">
        <div><div class="tama-setting-label">Anunciar eventos con TTS</div></div>
        <label class="switch">
          <input type="checkbox" id="twitch-tts-announcements" ${tts_announcements ? "checked" : ""}/>
          <span class="switch-track"></span>
        </label>
      </div>
    </div>

    <div class="card" style="margin-top: var(--space-5);">
      <div class="card-header">
        <h2 class="section-title">EventSub</h2>
      </div>
      <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 16px;">
        Recibe subs, raids, follows y bits en tiempo real sin depender del chat IRC. Requiere los scopes de EventSub listados arriba en el Access Token.
      </p>
      <div class="tama-setting-row">
        <div>
          <div class="tama-setting-label">Activar EventSub</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">Se conecta al reconectar Twitch</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="twitch-eventsub-enabled" ${eventsub_enabled ? "checked" : ""}/>
          <span class="switch-track"></span>
        </label>
      </div>
    </div>
  `;

  // =========================================================================================================
  // Event handlers
  // =========================================================================================================

  const channelInput = document.getElementById("twitch-channel") as HTMLInputElement;
  channelInput?.addEventListener("input", () => {
    const pos = channelInput.selectionStart;
    channelInput.value = channelInput.value.toLowerCase();
    channelInput.setSelectionRange(pos, pos);
  });

  document.getElementById("btn-validate-token")?.addEventListener("click", async () => {
    const tokenVal = (document.getElementById("twitch-token") as HTMLInputElement)?.value;
    if (!tokenVal) return showToast("Token requerido", "error");
    try {
      const result = await invoke<any>("validate_twitch_token", { token: tokenVal });
      showToast(`Token validado: @${result.username}`, "success");
      (document.getElementById("twitch-scopes") as HTMLElement).innerHTML =
        `<strong>Scopes:</strong> ${result.scopes.join(", ")}`;
    } catch (e) {
      showToast(String(e), "error");
    }
  });

  document.getElementById("btn-connect-twitch")?.addEventListener("click", async () => {
    const ch = (document.getElementById("twitch-channel") as HTMLInputElement)?.value;
    const tk = (document.getElementById("twitch-token") as HTMLInputElement)?.value;
    if (!ch || !tk) return showToast("Canal y token requeridos", "error");

    const btn = document.getElementById("btn-connect-twitch") as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "Conectando…";

    try {
      await invoke("connect_twitch", { channel: ch });
      await saveConfig();

      const timeout   = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Tiempo de espera agotado — verifica que el canal existe")), 5500)
      );
      const connected = new Promise<void>(resolve =>
        once("twitch-connected", () => resolve())
      );
      const error     = new Promise<never>((_, reject) =>
        once<string>("twitch-error", e => reject(new Error(e.payload)))
      );

      await Promise.race([connected, error, timeout]);
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${Icons.zap(14)} Reconectar`;
    }
  });

  document.getElementById("btn-disconnect-twitch")?.addEventListener("click", async () => {
    try {
      await invoke("disconnect_twitch");
      showToast("Desconectado de Twitch", "success");
      setTimeout(() => location.reload(), 500);
    } catch (e) {
      showToast(String(e), "error");
    }
  });

  // =========================================================================================================
  // Preset radio handlers
  // =========================================================================================================

  // Init slider fills on load
  [
    ["twitch-chat-cooldown",    msLabel],
    ["twitch-chat-dedup",       msLabel],
    ["twitch-chat-rate-max",    (v: number) => v === 0 ? "Desactivado" : `${v} msg`],
    ["twitch-chat-rate-window", (v: number) => `${v}s`],
    ["twitch-event-cheer-cooldown",  msLabel],
    ["twitch-event-sub-cooldown",    msLabel],
    ["twitch-event-raid-cooldown",   msLabel],
    ["twitch-event-follow-cooldown", msLabel],
    ["twitch-global-cap",       (v: number) => v === 0 ? "Desactivado" : `${v}/s`],
  ].forEach(([id, fmt]) => syncSlider(id as string, fmt as (v: number) => string));

  function syncSlider(id: string, fmt: (v: number) => string) {
    const el = document.getElementById(id) as HTMLInputElement;
    const lbl = document.getElementById(`${id}-val`);
    if (!el) return;
    if (lbl) lbl.textContent = fmt(Number(el.value));
    const pct = ((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100;
    el.style.setProperty("--slider-fill", `${pct}%`);
  }

  function applyPresetValues(preset: string, table: Record<string, ChatPreset>, keys: {
    cooldown: string; dedup: string; rateMax: string; rateWindow: string;
  }) {
    const p = table[preset];
    if (!p) return;
    (document.getElementById(keys.cooldown) as HTMLInputElement).value = String(p.cooldown);
    (document.getElementById(keys.dedup) as HTMLInputElement).value = String(p.dedup);
    (document.getElementById(keys.rateMax) as HTMLInputElement).value = String(p.rateMax);
    (document.getElementById(keys.rateWindow) as HTMLInputElement).value = String(p.rateWindow);
    syncSlider(keys.cooldown,   msLabel);
    syncSlider(keys.dedup,      msLabel);
    syncSlider(keys.rateMax,    v => v === 0 ? "Desactivado" : `${v} msg`);
    syncSlider(keys.rateWindow, v => `${v}s`);
  }

  function applyEventPresetValues(preset: string) {
    const p = EVENT_PRESETS[preset];
    if (!p) return;
    const ms = String(p.cooldownMs);
    ["twitch-event-cheer-cooldown", "twitch-event-sub-cooldown",
     "twitch-event-raid-cooldown",  "twitch-event-follow-cooldown"].forEach(id => {
      (document.getElementById(id) as HTMLInputElement).value = ms;
      syncSlider(id, msLabel);
    });
  }

  function applyGlobalPreset(preset: string) {
    const p = GLOBAL_PRESETS[preset];
    if (!p) return;
    (document.getElementById("twitch-global-cap") as HTMLInputElement).value = String(p.cap);
    syncSlider("twitch-global-cap", v => v === 0 ? "Desactivado" : `${v}/s`);
  }

  function updateRadioLabels(name: string, value: string) {
    document.querySelectorAll(`input[name="${name}"]`).forEach(radio => {
      const label = (radio as HTMLElement).closest(".preset-radio");
      if (label) label.classList.toggle("active", (radio as HTMLInputElement).value === value);
    });
  }

  document.querySelectorAll('input[name="twitch-chat-preset"]').forEach(radio => {
    radio.addEventListener("change", async () => {
      const val = (radio as HTMLInputElement).value;
      updateRadioLabels("twitch-chat-preset", val);
      const desc = document.getElementById("chat-preset-desc");
      if (desc) desc.textContent = chatPresetDescription(val);
      if (val !== "custom") {
        applyPresetValues(val, CHAT_PRESETS, {
          cooldown: "twitch-chat-cooldown", dedup: "twitch-chat-dedup",
          rateMax: "twitch-chat-rate-max", rateWindow: "twitch-chat-rate-window",
        });
      }
      await saveConfig();
    });
  });

  document.querySelectorAll('input[name="twitch-event-preset"]').forEach(radio => {
    radio.addEventListener("change", async () => {
      const val = (radio as HTMLInputElement).value;
      updateRadioLabels("twitch-event-preset", val);
      const desc = document.getElementById("event-preset-desc");
      if (desc) desc.textContent = eventPresetDescription(val);
      if (val !== "custom") applyEventPresetValues(val);
      await saveConfig();
    });
  });

  document.querySelectorAll('input[name="twitch-global-preset"]').forEach(radio => {
    radio.addEventListener("change", async () => {
      const val = (radio as HTMLInputElement).value;
      updateRadioLabels("twitch-global-preset", val);
      applyGlobalPreset(val);
      await saveConfig();
    });
  });

  // Sliders: update label live, flip preset to "custom" and save on release
  const chatSliders: [string, (v: number) => string][] = [
    ["twitch-chat-cooldown",    msLabel],
    ["twitch-chat-dedup",       msLabel],
    ["twitch-chat-rate-max",    v => v === 0 ? "Desactivado" : `${v} msg`],
    ["twitch-chat-rate-window", v => `${v}s`],
  ];
  chatSliders.forEach(([id, fmt]) => {
    const el = document.getElementById(id);
    el?.addEventListener("input", () => syncSlider(id, fmt));
    el?.addEventListener("change", async () => {
      const radio = document.querySelector('input[name="twitch-chat-preset"][value="custom"]') as HTMLInputElement;
      if (radio && !radio.checked) { radio.checked = true; updateRadioLabels("twitch-chat-preset", "custom"); }
      await saveConfig();
    });
  });

  const eventSliders = ["twitch-event-cheer-cooldown", "twitch-event-sub-cooldown",
                        "twitch-event-raid-cooldown",  "twitch-event-follow-cooldown"];
  eventSliders.forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener("input", () => syncSlider(id, msLabel));
    el?.addEventListener("change", async () => {
      const radio = document.querySelector('input[name="twitch-event-preset"][value="custom"]') as HTMLInputElement;
      if (radio && !radio.checked) { radio.checked = true; updateRadioLabels("twitch-event-preset", "custom"); }
      await saveConfig();
    });
  });

  document.getElementById("twitch-global-cap")?.addEventListener("input",
    () => syncSlider("twitch-global-cap", v => v === 0 ? "Desactivado" : `${v}/s`));

  // =========================================================================================================
  // Save config
  // =========================================================================================================

  const saveConfig = async () => {
    const g = (id: string) => (document.getElementById(id) as HTMLInputElement);
    const updates: [string, string][] = [
      ["twitch_channel",                  g("twitch-channel").value],
      ["twitch_bot_token",                g("twitch-token").value],
      ["twitch_chat_min_length",          g("twitch-chat-min-length").value],
      ["twitch_chat_max_length",          g("twitch-chat-max-length").value],
      ["twitch_chat_ignore_commands",     g("twitch-ignore-commands").checked ? "true" : "false"],
["twitch_event_cheer_enabled",      g("twitch-event-cheer").checked ? "true" : "false"],
      ["twitch_event_cheer_min_bits",     g("twitch-cheer-min-bits").value],
      ["twitch_event_sub_enabled",        g("twitch-event-sub").checked ? "true" : "false"],
      ["twitch_event_raid_enabled",       g("twitch-event-raid").checked ? "true" : "false"],
      ["twitch_event_follow_enabled",     g("twitch-event-follow").checked ? "true" : "false"],
      ["twitch_event_hype_train_enabled", g("twitch-event-hype-train").checked ? "true" : "false"],
      ["twitch_event_stream_status_enabled", g("twitch-event-stream-status").checked ? "true" : "false"],
      ["twitch_tts_event_announcements",  g("twitch-tts-announcements").checked ? "true" : "false"],
      ["twitch_eventsub_enabled",         g("twitch-eventsub-enabled").checked ? "true" : "false"],
      // Anti-spam
      ["twitch_chat_antispam_preset",     (document.querySelector('input[name="twitch-chat-preset"]:checked') as HTMLInputElement)?.value ?? "off"],
      ["twitch_chat_user_cooldown_ms",    g("twitch-chat-cooldown").value],
      ["twitch_chat_dedup_window_ms",     g("twitch-chat-dedup").value],
      ["twitch_chat_rate_max_msgs",       g("twitch-chat-rate-max").value],
      ["twitch_chat_rate_window_secs",    g("twitch-chat-rate-window").value],
      ["twitch_event_cooldown_preset",    (document.querySelector('input[name="twitch-event-preset"]:checked') as HTMLInputElement)?.value ?? "off"],
      ["twitch_event_cheer_user_cooldown_ms",  g("twitch-event-cheer-cooldown").value],
      ["twitch_event_sub_user_cooldown_ms",    g("twitch-event-sub-cooldown").value],
      ["twitch_event_raid_global_cooldown_ms", g("twitch-event-raid-cooldown").value],
      ["twitch_event_follow_user_cooldown_ms", g("twitch-event-follow-cooldown").value],
      ["chat_global_throughput_preset",   (document.querySelector('input[name="twitch-global-preset"]:checked') as HTMLInputElement)?.value ?? "off"],
      ["chat_global_rate_max_per_sec",    g("twitch-global-cap").value],
    ];
    for (const [key, value] of updates) {
      if (value !== undefined && value !== null) {
        await invoke("set_config_cmd", { key, value });
      }
    }
  };

  document.querySelectorAll("input").forEach(input => {
    if (!input.name?.startsWith("twitch-")) {
      input.addEventListener("change", saveConfig);
    }
  });
}
