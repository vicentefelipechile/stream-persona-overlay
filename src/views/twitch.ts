import { invoke } from "@tauri-apps/api/core";
import { showToast } from "../state";
import { Icons } from "../icons";

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

  const isConnected = channel.length > 0 && token.length > 0;

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
        <div>
          <div class="tama-setting-label">Ignorar comandos (!comando)</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="twitch-ignore-commands" ${ignore_commands ? "checked" : ""}/>
          <span class="switch-track"></span>
        </label>
      </div>
      <div class="tama-setting-row">
        <div>
          <div class="tama-setting-label">Solo seguidores</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="twitch-followers-only" ${followers_only ? "checked" : ""}/>
          <span class="switch-track"></span>
        </label>
      </div>
      <div class="tama-setting-row">
        <div>
          <div class="tama-setting-label">Solo suscriptores</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="twitch-subs-only" ${subs_only ? "checked" : ""}/>
          <span class="switch-track"></span>
        </label>
      </div>
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
        <div>
          <div class="tama-setting-label">Anunciar eventos con TTS</div>
        </div>
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

  // Event handlers
  document.getElementById("btn-validate-token")?.addEventListener("click", async () => {
    const token = (document.getElementById("twitch-token") as HTMLInputElement)?.value;
    if (!token) return showToast("Token requerido", "error");
    try {
      const result = await invoke<any>("validate_twitch_token", { token });
      showToast(`Token validado: @${result.username}`, "success");
      (document.getElementById("twitch-scopes") as HTMLElement).innerHTML =
        `<strong>Scopes:</strong> ${result.scopes.join(", ")}`;
    } catch (e) {
      showToast(String(e), "error");
    }
  });

  document.getElementById("btn-connect-twitch")?.addEventListener("click", async () => {
    const channel = (document.getElementById("twitch-channel") as HTMLInputElement)?.value;
    const token = (document.getElementById("twitch-token") as HTMLInputElement)?.value;
    if (!channel || !token) return showToast("Canal y token requeridos", "error");
    try {
      await invoke("connect_twitch", { channel });
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

  // Save config on input change
  const saveConfig = async () => {
    const updates = [
      ["twitch-channel", (document.getElementById("twitch-channel") as HTMLInputElement)?.value],
      ["twitch-token", (document.getElementById("twitch-token") as HTMLInputElement)?.value],
      ["twitch-chat-min-length", (document.getElementById("twitch-chat-min-length") as HTMLInputElement)?.value],
      ["twitch-chat-max-length", (document.getElementById("twitch-chat-max-length") as HTMLInputElement)?.value],
      ["twitch-chat-ignore-commands", (document.getElementById("twitch-ignore-commands") as HTMLInputElement)?.checked ? "true" : "false"],
      ["twitch-chat-followers-only", (document.getElementById("twitch-followers-only") as HTMLInputElement)?.checked ? "true" : "false"],
      ["twitch-chat-subs-only", (document.getElementById("twitch-subs-only") as HTMLInputElement)?.checked ? "true" : "false"],
      ["twitch-event-cheer-enabled", (document.getElementById("twitch-event-cheer") as HTMLInputElement)?.checked ? "true" : "false"],
      ["twitch-event-cheer-min-bits", (document.getElementById("twitch-cheer-min-bits") as HTMLInputElement)?.value],
      ["twitch-event-sub-enabled", (document.getElementById("twitch-event-sub") as HTMLInputElement)?.checked ? "true" : "false"],
      ["twitch-event-raid-enabled", (document.getElementById("twitch-event-raid") as HTMLInputElement)?.checked ? "true" : "false"],
      ["twitch-event-follow-enabled", (document.getElementById("twitch-event-follow") as HTMLInputElement)?.checked ? "true" : "false"],
      ["twitch-event-hype-train-enabled", (document.getElementById("twitch-event-hype-train") as HTMLInputElement)?.checked ? "true" : "false"],
      ["twitch-event-stream-status-enabled", (document.getElementById("twitch-event-stream-status") as HTMLInputElement)?.checked ? "true" : "false"],
      ["twitch-tts-event-announcements", (document.getElementById("twitch-tts-announcements") as HTMLInputElement)?.checked ? "true" : "false"],
      ["twitch_eventsub_enabled", (document.getElementById("twitch-eventsub-enabled") as HTMLInputElement)?.checked ? "true" : "false"],
    ];
    for (const [key, value] of updates) {
      await invoke("set_config_cmd", { key, value });
    }
  };

  document.querySelectorAll("input").forEach(input => {
    input.addEventListener("change", saveConfig);
  });
}
