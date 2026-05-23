import { invoke } from "@tauri-apps/api/core";
import { showToast } from "../state";

export async function renderTiktok(): Promise<void> {
  const container = document.getElementById("view-container")!;

  let cfg: Record<string, unknown> = {};
  try {
    cfg = await invoke<Record<string, unknown>>("get_config_cmd");
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><span class="empty-state-icon">⚠</span><p>${String(e)}</p></div>`;
    return;
  }

  const username = String(cfg["tiktok_username"] || "");
  const api_key = String(cfg["tiktok_api_key"] || "");
  const ws_endpoint = String(cfg["tiktok_ws_endpoint"] || "wss://ws.eulerstream.com");
  const chat_min_length = Number(cfg["tiktok_chat_min_length"]) || 0;
  const chat_max_length = Number(cfg["tiktok_chat_max_length"]) || 300;
  const event_gift_enabled = String(cfg["tiktok_event_gift_enabled"]) === "true";
  const event_gift_min_coins = Number(cfg["tiktok_event_gift_min_coins"]) || 10;
  const event_gift_big_coins = Number(cfg["tiktok_event_gift_big_coins"]) || 100;
  const event_like_enabled = String(cfg["tiktok_event_like_enabled"]) === "true";
  const event_like_throttle_ms = Number(cfg["tiktok_event_like_throttle_ms"]) || 4000;
  const event_follow_enabled = String(cfg["tiktok_event_follow_enabled"]) === "true";
  const event_share_enabled = String(cfg["tiktok_event_share_enabled"]) === "true";
  const event_subscribe_enabled = String(cfg["tiktok_event_subscribe_enabled"]) === "true";
  const event_envelope_enabled = String(cfg["tiktok_event_envelope_enabled"]) === "true";
  const tts_announcements = String(cfg["tiktok_tts_event_announcements"]) === "true";

  const isConnected = username.length > 0;

  container.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">TikTok</h1>
      <p class="view-subtitle">Configuración de eventos en directo</p>
    </div>

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
        <label>API Key (TikTool)</label>
        <input type="password" id="tiktok-api-key" value="${api_key}" placeholder="API key"/>
      </div>
      <details style="margin-top: 12px;">
        <summary style="cursor: pointer; font-weight: 500; margin-bottom: 8px;">Avanzado</summary>
        <div class="form-group">
          <label>Endpoint WebSocket</label>
          <input type="text" id="tiktok-ws-endpoint" value="${ws_endpoint}" placeholder="wss://..."/>
        </div>
      </details>
      <div style="display: flex; gap: 8px; margin-top: 16px;">
        <button id="btn-connect-tiktok" class="btn btn-primary">${isConnected ? "Reconectar" : "Conectar"}</button>
        ${isConnected ? '<button id="btn-disconnect-tiktok" class="btn btn-outline">Desconectar</button>' : ""}
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
        <h2 class="section-title">Eventos</h2>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div class="tama-event-toggle">
          <label class="switch">
            <input type="checkbox" id="tiktok-event-gift" ${event_gift_enabled ? "checked" : ""}/>
            <span class="switch-track"></span>
          </label>
          <div>
            <span class="tama-event-label">Regalos</span>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 4px;">
              <input type="number" id="tiktok-gift-min-coins" value="${event_gift_min_coins}" placeholder="Min coins" style="font-size: 0.85rem;"/>
              <input type="number" id="tiktok-gift-big-coins" value="${event_gift_big_coins}" placeholder="Big coins" style="font-size: 0.85rem;"/>
            </div>
          </div>
        </div>
        <div class="tama-event-toggle">
          <label class="switch">
            <input type="checkbox" id="tiktok-event-like" ${event_like_enabled ? "checked" : ""}/>
            <span class="switch-track"></span>
          </label>
          <div>
            <span class="tama-event-label">Likes</span>
            <input type="number" id="tiktok-like-throttle" value="${event_like_throttle_ms}" placeholder="Throttle ms" style="width: 100%; margin-top: 4px; font-size: 0.85rem;"/>
          </div>
        </div>
        <div class="tama-event-toggle">
          <label class="switch">
            <input type="checkbox" id="tiktok-event-follow" ${event_follow_enabled ? "checked" : ""}/>
            <span class="switch-track"></span>
          </label>
          <span class="tama-event-label">Nuevos Seguidores</span>
        </div>
        <div class="tama-event-toggle">
          <label class="switch">
            <input type="checkbox" id="tiktok-event-share" ${event_share_enabled ? "checked" : ""}/>
            <span class="switch-track"></span>
          </label>
          <span class="tama-event-label">Comparticiones</span>
        </div>
        <div class="tama-event-toggle">
          <label class="switch">
            <input type="checkbox" id="tiktok-event-subscribe" ${event_subscribe_enabled ? "checked" : ""}/>
            <span class="switch-track"></span>
          </label>
          <span class="tama-event-label">Suscripciones</span>
        </div>
        <div class="tama-event-toggle">
          <label class="switch">
            <input type="checkbox" id="tiktok-event-envelope" ${event_envelope_enabled ? "checked" : ""}/>
            <span class="switch-track"></span>
          </label>
          <span class="tama-event-label">Sobres (Rojo)</span>
        </div>
      </div>
      <div class="tama-setting-row" style="margin-top: 16px;">
        <div>
          <div class="tama-setting-label">Anunciar eventos con TTS</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="tiktok-tts-announcements" ${tts_announcements ? "checked" : ""}/>
          <span class="switch-track"></span>
        </label>
      </div>
    </div>
  `;

  const saveConfig = async () => {
    const updates = [
      ["tiktok_username", (document.getElementById("tiktok-username") as HTMLInputElement)?.value],
      ["tiktok_api_key", (document.getElementById("tiktok-api-key") as HTMLInputElement)?.value],
      ["tiktok_ws_endpoint", (document.getElementById("tiktok-ws-endpoint") as HTMLInputElement)?.value],
      ["tiktok_chat_min_length", (document.getElementById("tiktok-chat-min-length") as HTMLInputElement)?.value],
      ["tiktok_chat_max_length", (document.getElementById("tiktok-chat-max-length") as HTMLInputElement)?.value],
      ["tiktok_event_gift_enabled", (document.getElementById("tiktok-event-gift") as HTMLInputElement)?.checked ? "true" : "false"],
      ["tiktok_event_gift_min_coins", (document.getElementById("tiktok-gift-min-coins") as HTMLInputElement)?.value],
      ["tiktok_event_gift_big_coins", (document.getElementById("tiktok-gift-big-coins") as HTMLInputElement)?.value],
      ["tiktok_event_like_enabled", (document.getElementById("tiktok-event-like") as HTMLInputElement)?.checked ? "true" : "false"],
      ["tiktok_event_like_throttle_ms", (document.getElementById("tiktok-like-throttle") as HTMLInputElement)?.value],
      ["tiktok_event_follow_enabled", (document.getElementById("tiktok-event-follow") as HTMLInputElement)?.checked ? "true" : "false"],
      ["tiktok_event_share_enabled", (document.getElementById("tiktok-event-share") as HTMLInputElement)?.checked ? "true" : "false"],
      ["tiktok_event_subscribe_enabled", (document.getElementById("tiktok-event-subscribe") as HTMLInputElement)?.checked ? "true" : "false"],
      ["tiktok_event_envelope_enabled", (document.getElementById("tiktok-event-envelope") as HTMLInputElement)?.checked ? "true" : "false"],
      ["tiktok_tts_event_announcements", (document.getElementById("tiktok-tts-announcements") as HTMLInputElement)?.checked ? "true" : "false"],
    ];
    for (const [key, value] of updates) {
      await invoke("set_config_cmd", { key, value });
    }
  };

  document.getElementById("btn-connect-tiktok")?.addEventListener("click", async () => {
    const username = (document.getElementById("tiktok-username") as HTMLInputElement)?.value;
    if (!username) return showToast("Nombre de usuario requerido", "error");
    try {
      await invoke("connect_tiktok", { username });
      await saveConfig();
      showToast("Conectado a TikTok", "success");
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

  document.querySelectorAll("input").forEach(input => {
    input.addEventListener("change", saveConfig);
  });
}
