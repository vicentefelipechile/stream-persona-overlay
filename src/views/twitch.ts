// =========================================================================================================
// TWITCH VIEW
// =========================================================================================================
// Twitch connection, chat filters, anti-spam presets, events and EventSub configuration.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { invoke } from "@tauri-apps/api/core";
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
  const followers_only = String(cfg["twitch_chat_followers_only"]) === "true";
  const subs_only = String(cfg["twitch_chat_subs_only"]) === "true";
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
      <h1 class="view-title">Twitch</h1>
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
        <label>Token OAuth</label>
        <div style="display: flex; gap: 8px; align-items: flex-start;">
          <input type="password" id="twitch-token" value="${token}" placeholder="oauth:..."/>
          <button id="btn-validate-token" class="btn btn-secondary btn-sm">Validar</button>
        </div>
        <div id="twitch-scopes" style="margin-top: 8px; font-size: 0.85rem;"></div>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 16px;">
        <button id="btn-connect-twitch" class="btn btn-primary">${isConnected ? "Reconectar" : "Conectar"}</button>
        ${isConnected ? '<button id="btn-disconnect-twitch" class="btn btn-outline">Desconectar</button>' : ""}
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
      <div class="tama-setting-row">
        <div><div class="tama-setting-label">Solo seguidores</div></div>
        <label class="switch">
          <input type="checkbox" id="twitch-followers-only" ${followers_only ? "checked" : ""}/>
          <span class="switch-track"></span>
        </label>
      </div>
      <div class="tama-setting-row">
        <div><div class="tama-setting-label">Solo suscriptores</div></div>
        <label class="switch">
          <input type="checkbox" id="twitch-subs-only" ${subs_only ? "checked" : ""}/>
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
        <summary style="cursor:pointer;font-weight:500;color:var(--accent);">Avanzado</summary>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:12px;">
          <div class="form-group">
            <label>Espera entre mensajes por usuario (ms, 0 = desactivado)</label>
            <input type="number" id="twitch-chat-cooldown" value="${chatCooldown}" min="0" step="500"/>
          </div>
          <div class="form-group">
            <label>Ventana para ignorar duplicados (ms, 0 = desactivado)</label>
            <input type="number" id="twitch-chat-dedup" value="${chatDedup}" min="0" step="500"/>
          </div>
          <div class="form-group">
            <label>Máx. mensajes por ventana (0 = desactivado)</label>
            <input type="number" id="twitch-chat-rate-max" value="${chatRateMax}" min="0"/>
          </div>
          <div class="form-group">
            <label>Ventana de tiempo (segundos)</label>
            <input type="number" id="twitch-chat-rate-window" value="${chatRateWindow}" min="1"/>
          </div>
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
        <summary style="cursor:pointer;font-weight:500;color:var(--accent);">Avanzado</summary>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:12px;">
          <div class="form-group">
            <label>Cooldown Bits/Cheers por usuario (ms)</label>
            <input type="number" id="twitch-event-cheer-cooldown" value="${eventCheerCooldown}" min="0" step="1000"/>
          </div>
          <div class="form-group">
            <label>Cooldown Suscripciones por usuario (ms)</label>
            <input type="number" id="twitch-event-sub-cooldown" value="${eventSubCooldown}" min="0" step="1000"/>
          </div>
          <div class="form-group">
            <label>Cooldown Raids (global canal, ms)</label>
            <input type="number" id="twitch-event-raid-cooldown" value="${eventRaidCooldown}" min="0" step="1000"/>
          </div>
          <div class="form-group">
            <label>Cooldown Follows por usuario (ms)</label>
            <input type="number" id="twitch-event-follow-cooldown" value="${eventFollowCooldown}" min="0" step="1000"/>
          </div>
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
        <summary style="cursor:pointer;font-weight:500;color:var(--accent);">Avanzado</summary>
        <div style="margin-top:12px;">
          <div class="form-group">
            <label>Máx. mensajes por segundo (global, 0 = desactivado)</label>
            <input type="number" id="twitch-global-cap" value="${globalCap}" min="0"/>
          </div>
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
      <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 12px;">
        Recibe subs, raids, follows y bits en tiempo real sin depender del chat IRC.
      </p>
      <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 16px;">
        <strong>Scopes requeridos en el token OAuth:</strong><br/>
        <code>bits:read</code> · <code>channel:read:subscriptions</code> · <code>channel:read:raids</code> · <code>moderator:read:followers</code>
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
    try {
      await invoke("connect_twitch", { channel: ch });
      await saveConfig();
      showToast("Conectado a Twitch", "success");
    } catch (e) {
      showToast(String(e), "error");
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

  function applyPresetValues(preset: string, table: Record<string, ChatPreset>, keys: {
    cooldown: string; dedup: string; rateMax: string; rateWindow: string;
  }) {
    const p = table[preset];
    if (!p) return;
    (document.getElementById(keys.cooldown) as HTMLInputElement).value = String(p.cooldown);
    (document.getElementById(keys.dedup) as HTMLInputElement).value = String(p.dedup);
    (document.getElementById(keys.rateMax) as HTMLInputElement).value = String(p.rateMax);
    (document.getElementById(keys.rateWindow) as HTMLInputElement).value = String(p.rateWindow);
  }

  function applyEventPresetValues(preset: string) {
    const p = EVENT_PRESETS[preset];
    if (!p) return;
    const ms = p.cooldownMs;
    (document.getElementById("twitch-event-cheer-cooldown") as HTMLInputElement).value = String(ms);
    (document.getElementById("twitch-event-sub-cooldown") as HTMLInputElement).value = String(ms);
    (document.getElementById("twitch-event-raid-cooldown") as HTMLInputElement).value = String(ms);
    (document.getElementById("twitch-event-follow-cooldown") as HTMLInputElement).value = String(ms);
  }

  function applyGlobalPreset(preset: string) {
    const p = GLOBAL_PRESETS[preset];
    if (!p) return;
    (document.getElementById("twitch-global-cap") as HTMLInputElement).value = String(p.cap);
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

  // Advanced inputs: flip preset to "custom" on edit
  ["twitch-chat-cooldown", "twitch-chat-dedup", "twitch-chat-rate-max", "twitch-chat-rate-window"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", async () => {
      const radio = document.querySelector('input[name="twitch-chat-preset"][value="custom"]') as HTMLInputElement;
      if (radio && !radio.checked) { radio.checked = true; updateRadioLabels("twitch-chat-preset", "custom"); }
      await saveConfig();
    });
  });

  ["twitch-event-cheer-cooldown", "twitch-event-sub-cooldown", "twitch-event-raid-cooldown", "twitch-event-follow-cooldown"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", async () => {
      const radio = document.querySelector('input[name="twitch-event-preset"][value="custom"]') as HTMLInputElement;
      if (radio && !radio.checked) { radio.checked = true; updateRadioLabels("twitch-event-preset", "custom"); }
      await saveConfig();
    });
  });

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
      ["twitch_chat_followers_only",      g("twitch-followers-only").checked ? "true" : "false"],
      ["twitch_chat_subs_only",           g("twitch-subs-only").checked ? "true" : "false"],
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
