// =========================================================================================================
// TIKTOK VIEW
// =========================================================================================================
// TikTok connection, chat filters and chat anti-spam presets. Event types, event
// cooldowns and TTS now live in the centralized Eventos view.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { invoke } from "@tauri-apps/api/core";
import { showToast, isPlatformConnected } from "../state";
import { Icons } from "../icons";

// =========================================================================================================
// Preset tables
// =========================================================================================================

interface ChatPreset { label: string; cooldown: number; dedup: number; rateMax: number; rateWindow: number; }

const CHAT_PRESETS: Record<string, ChatPreset> = {
  off:      { label: "Sin protección",  cooldown: 0,     dedup: 0,     rateMax: 0, rateWindow: 10 },
  light:    { label: "Ligero",          cooldown: 2000,  dedup: 5000,  rateMax: 8, rateWindow: 10 },
  normal:   { label: "Normal",          cooldown: 5000,  dedup: 10000, rateMax: 4, rateWindow: 10 },
  strict:   { label: "Estricto",        cooldown: 15000, dedup: 30000, rateMax: 3, rateWindow: 30 },
  lockdown: { label: "Lockdown",        cooldown: 30000, dedup: 60000, rateMax: 2, rateWindow: 60 },
};

function chatPresetDescription(preset: string): string {
  if (preset === "off") return "Sin filtros de anti-spam activos.";
  if (preset === "custom") return "Configuración personalizada activa.";
  const p = CHAT_PRESETS[preset];
  if (!p) return "";
  return `Permite hasta ${p.rateMax} mensajes cada ${p.rateWindow}s por usuario. Ignora duplicados durante ${p.dedup/1000}s. Espera ${p.cooldown/1000}s entre mensajes.`;
}

// =========================================================================================================
// Render function
// =========================================================================================================

export async function renderTiktok(): Promise<void> {
  const container = document.getElementById("view-container")!;

  let cfg: Record<string, unknown> = {};
  try {
    cfg = await invoke<Record<string, unknown>>("get_config_cmd");
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><span class="empty-state-icon">${Icons.warning(48)}</span><p>${String(e)}</p></div>`;
    return;
  }

  const username = String(cfg["tiktok_username"] || "");
  const api_key = String(cfg["tiktok_api_key"] || "");
  const ws_endpoint = String(cfg["tiktok_ws_endpoint"] || "wss://api.tik.tools");
  const chat_min_length = Number(cfg["tiktok_chat_min_length"]) || 0;
  const chat_max_length = Number(cfg["tiktok_chat_max_length"]) || 300;
  // Anti-spam config
  const chatPreset = String(cfg["tiktok_chat_antispam_preset"] || "off");
  const chatCooldown = Number(cfg["tiktok_chat_user_cooldown_ms"]) || 0;
  const chatDedup = Number(cfg["tiktok_chat_dedup_window_ms"]) || 0;
  const chatRateMax = Number(cfg["tiktok_chat_rate_max_msgs"]) || 0;
  const chatRateWindow = Number(cfg["tiktok_chat_rate_window_secs"]) || 10;

  // Real connection state (TikTok does NOT auto-connect at launch — the user must
  // press Conectar). Don't infer "connected" from a saved username.
  const isConnected = isPlatformConnected("tiktok");

  const msLabel = (ms: number) => ms === 0 ? "Desactivado" : `${ms / 1000}s`;
  const sRow = (id: string, value: number, min: number, max: number, step: number, label: string, fmt: (v: number) => string) =>
    `<div class="form-group" style="gap:4px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <label style="margin:0;">${label}</label>
        <span id="${id}-val" style="font-size:0.9rem;font-weight:600;color:var(--accent);min-width:72px;text-align:right;">${fmt(value)}</span>
      </div>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" style="width:100%;margin-top:4px;"/>
    </div>`;

  const presetRadios = (name: string, current: string, options: string[]) =>
    [...options, "custom"].map(v => {
      const labels: Record<string, string> = {
        off: "Off", light: "Ligero", normal: "Normal", strict: "Estricto",
        lockdown: "Lockdown", custom: "Personalizado",
      };
      return `<label class="preset-radio ${current === v ? "active" : ""}">
        <input type="radio" name="${name}" value="${v}" ${current === v ? "checked" : ""}/>
        ${labels[v] ?? v}
      </label>`;
    }).join("");

  container.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">${Icons.tiktok(20)} TikTok</h1>
      <p class="view-subtitle">Configuración de eventos en directo</p>
    </div>

    ${isConnected ? "" : `
    <div class="conn-banner">
      ${Icons.tiktok(18)}
      <div>
        <strong>TikTok no está conectado.</strong> No se reciben mensajes ni eventos hasta que pulses
        <strong>Conectar</strong>. No se conecta solo al abrir la app para no gastar la cuota diaria de TikTool.
      </div>
    </div>`}

    <div class="card">
      <div class="card-header">
        <h2 class="section-title">Conexión</h2>
        <span class="badge ${isConnected ? "badge-ok" : "badge-warn"}">${isConnected ? "Conectado" : "Desconectado"}</span>
      </div>
      <div class="form-group">
        <label>Nombre de usuario TikTok</label>
        <input type="text" id="tiktok-username" value="${username}" placeholder="@nombre_usuario"/>
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;">
          API Key
          <a href="https://tik.tools/" target="_blank" class="btn btn-secondary btn-sm" style="display:inline-flex;align-items:center;gap:4px;text-decoration:none;">${Icons.externalLink(12)} Obtener en TikTool</a>
        </label>
        <input type="password" id="tiktok-api-key" value="${api_key}" placeholder="API key"/>
        <p style="margin:6px 0 0;font-size:0.8rem;color:var(--text-muted);">
          <strong>Obligatoria.</strong> TikTok LIVE no tiene API pública: la conexión se hace vía TikTool, que requiere una API key (tiene plan gratuito). Sin ella no se reciben ni los mensajes de chat.
        </p>
      </div>
      <details style="margin-top: 12px;">
        <summary class="details-toggle">Avanzado</summary>
        <div class="form-group">
          <label>Endpoint WebSocket</label>
          <input type="text" id="tiktok-ws-endpoint" value="${ws_endpoint}" placeholder="wss://..."/>
        </div>
      </details>
      <div style="display: flex; gap: 8px; margin-top: 16px;">
        <button id="btn-connect-tiktok" class="btn btn-primary" style="display:inline-flex;align-items:center;gap:6px;">${Icons.zap(14)} ${isConnected ? "Reconectar" : "Conectar"}</button>
        ${isConnected ? `<button id="btn-disconnect-tiktok" class="btn btn-outline" style="display:inline-flex;align-items:center;gap:6px;">${Icons.unplug(14)} Desconectar</button>` : ""}
      </div>
    </div>

    <div class="card" style="margin-top: var(--space-5);">
      <div class="card-header">
        <h2 class="section-title">Filtros de Chat</h2>
      </div>
      <div class="form-group">
        <label>Longitud mínima</label>
        <input type="number" id="tiktok-chat-min-length" value="${chat_min_length}" min="0"/>
      </div>
      <div class="form-group">
        <label>Longitud máxima</label>
        <input type="number" id="tiktok-chat-max-length" value="${chat_max_length}" min="0"/>
      </div>
    </div>

    <div class="card" style="margin-top: var(--space-5);">
      <div class="card-header">
        <h2 class="section-title">Anti-spam (chat)</h2>
      </div>
      <div class="preset-group" id="tiktok-chat-preset-group">
        ${presetRadios("tiktok-chat-preset", chatPreset, ["off", "light", "normal", "strict", "lockdown"])}
      </div>
      <p id="tiktok-chat-preset-desc" style="font-size:0.85rem;color:var(--text-muted);margin:8px 0 0;">${chatPresetDescription(chatPreset)}</p>
      <details id="tiktok-chat-advanced" ${chatPreset === "custom" ? "open" : ""} style="margin-top:12px;">
        <summary class="details-toggle">Avanzado</summary>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:16px;">
          ${sRow("tiktok-chat-cooldown",    chatCooldown,   0, 60000, 500,  "Espera entre mensajes por usuario", msLabel)}
          ${sRow("tiktok-chat-dedup",       chatDedup,      0, 60000, 1000, "Ventana para ignorar duplicados",   msLabel)}
          ${sRow("tiktok-chat-rate-max",    chatRateMax,    0, 20,    1,    "Máx. mensajes por ventana",         v => v === 0 ? "Desactivado" : `${v} msg`)}
          ${sRow("tiktok-chat-rate-window", chatRateWindow, 1, 60,    1,    "Ventana de tiempo",                 v => `${v}s`)}
        </div>
      </details>
    </div>

    <div class="card" style="margin-top: var(--space-5);">
      <p style="margin:0;font-size:0.9rem;color:var(--text-muted);">
        Los <strong>tipos de evento</strong>, <strong>cooldowns de evento</strong> y <strong>TTS</strong> se configuran ahora en la vista <strong>Eventos</strong>.
      </p>
    </div>
  `;

  // =========================================================================================================
  // Preset radio handlers
  // =========================================================================================================

  // Init slider fills on load
  [
    ["tiktok-chat-cooldown",    msLabel],
    ["tiktok-chat-dedup",       msLabel],
    ["tiktok-chat-rate-max",    (v: number) => v === 0 ? "Desactivado" : `${v} msg`],
    ["tiktok-chat-rate-window", (v: number) => `${v}s`],
  ].forEach(([id, fmt]) => syncSlider(id as string, fmt as (v: number) => string));

  function updateRadioLabels(name: string, value: string) {
    document.querySelectorAll(`input[name="${name}"]`).forEach(radio => {
      const label = (radio as HTMLElement).closest(".preset-radio");
      if (label) label.classList.toggle("active", (radio as HTMLInputElement).value === value);
    });
  }

  function syncSlider(id: string, fmt: (v: number) => string) {
    const el = document.getElementById(id) as HTMLInputElement;
    const lbl = document.getElementById(`${id}-val`);
    if (!el) return;
    if (lbl) lbl.textContent = fmt(Number(el.value));
    const pct = ((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100;
    el.style.setProperty("--slider-fill", `${pct}%`);
  }

  function applyTiktokChatPreset(preset: string) {
    const p = CHAT_PRESETS[preset];
    if (!p) return;
    (document.getElementById("tiktok-chat-cooldown") as HTMLInputElement).value = String(p.cooldown);
    (document.getElementById("tiktok-chat-dedup") as HTMLInputElement).value = String(p.dedup);
    (document.getElementById("tiktok-chat-rate-max") as HTMLInputElement).value = String(p.rateMax);
    (document.getElementById("tiktok-chat-rate-window") as HTMLInputElement).value = String(p.rateWindow);
    syncSlider("tiktok-chat-cooldown",    msLabel);
    syncSlider("tiktok-chat-dedup",       msLabel);
    syncSlider("tiktok-chat-rate-max",    v => v === 0 ? "Desactivado" : `${v} msg`);
    syncSlider("tiktok-chat-rate-window", v => `${v}s`);
  }

  document.querySelectorAll('input[name="tiktok-chat-preset"]').forEach(radio => {
    radio.addEventListener("change", async () => {
      const val = (radio as HTMLInputElement).value;
      updateRadioLabels("tiktok-chat-preset", val);
      const desc = document.getElementById("tiktok-chat-preset-desc");
      if (desc) desc.textContent = chatPresetDescription(val);
      if (val !== "custom") applyTiktokChatPreset(val);
      await saveConfig();
    });
  });

  // Sliders: update label live, flip preset to "custom" and save on release
  const chatSliders: [string, (v: number) => string][] = [
    ["tiktok-chat-cooldown",    msLabel],
    ["tiktok-chat-dedup",       msLabel],
    ["tiktok-chat-rate-max",    v => v === 0 ? "Desactivado" : `${v} msg`],
    ["tiktok-chat-rate-window", v => `${v}s`],
  ];
  chatSliders.forEach(([id, fmt]) => {
    const el = document.getElementById(id);
    el?.addEventListener("input", () => syncSlider(id, fmt));
    el?.addEventListener("change", async () => {
      const radio = document.querySelector('input[name="tiktok-chat-preset"][value="custom"]') as HTMLInputElement;
      if (radio && !radio.checked) { radio.checked = true; updateRadioLabels("tiktok-chat-preset", "custom"); }
      await saveConfig();
    });
  });

  // =========================================================================================================
  // Connection handlers
  // =========================================================================================================

  document.getElementById("btn-connect-tiktok")?.addEventListener("click", async () => {
    const uname = (document.getElementById("tiktok-username") as HTMLInputElement)?.value;
    const key = (document.getElementById("tiktok-api-key") as HTMLInputElement)?.value;
    if (!uname) return showToast("Nombre de usuario requerido", "error");
    if (!key) return showToast("API key requerida (obtén una gratis en tik.tools)", "error");
    try {
      // Persist config (api key + endpoint) BEFORE connecting — the backend
      // client reads the api key from the DB when it spawns.
      await saveConfig();
      await invoke("connect_tiktok", { username: uname });
      // Don't claim success here — the real outcome arrives via the
      // "tiktok-connected" / "tiktok-error" events once the WS handshake resolves.
      showToast("Conectando a TikTok…", "info");
    } catch (e) {
      showToast(String(e), "error");
    }
  });

  document.getElementById("btn-disconnect-tiktok")?.addEventListener("click", async () => {
    try {
      await invoke("disconnect_tiktok");
      showToast("Desconectado de TikTok", "success");
      setTimeout(() => location.reload(), 500);
    } catch (e) {
      showToast(String(e), "error");
    }
  });

  // =========================================================================================================
  // Save config
  // =========================================================================================================

  const saveConfig = async () => {
    const g = (id: string) => (document.getElementById(id) as HTMLInputElement);
    const updates: [string, string][] = [
      ["tiktok_username",           g("tiktok-username").value],
      ["tiktok_api_key",            g("tiktok-api-key").value],
      ["tiktok_ws_endpoint",        g("tiktok-ws-endpoint")?.value ?? ""],
      ["tiktok_chat_min_length",    g("tiktok-chat-min-length").value],
      ["tiktok_chat_max_length",    g("tiktok-chat-max-length").value],
      // Anti-spam
      ["tiktok_chat_antispam_preset",  (document.querySelector('input[name="tiktok-chat-preset"]:checked') as HTMLInputElement)?.value ?? "off"],
      ["tiktok_chat_user_cooldown_ms", g("tiktok-chat-cooldown").value],
      ["tiktok_chat_dedup_window_ms",  g("tiktok-chat-dedup").value],
      ["tiktok_chat_rate_max_msgs",    g("tiktok-chat-rate-max").value],
      ["tiktok_chat_rate_window_secs", g("tiktok-chat-rate-window").value],
    ];
    for (const [key, value] of updates) {
      if (value !== undefined && value !== null) {
        await invoke("set_config_cmd", { key, value });
      }
    }
  };

  document.querySelectorAll("input").forEach(input => {
    if (!input.name?.startsWith("tiktok-")) {
      input.addEventListener("change", saveConfig);
    }
  });
}
