// =========================================================================================================
// CONFIG VIEW
// =========================================================================================================
// Render configuration settings and handle saves.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { invoke } from "@tauri-apps/api/core";
import { AppState, showToast } from "../state";
import { createColorPicker } from "../components/color-picker";
import { Icons } from "../icons";

// =========================================================================================================
// Render Function
// =========================================================================================================

export async function renderConfig(): Promise<void> {
  await AppState.loadConfig();
  const cfg = AppState.config;

  const container = document.getElementById("view-container")!;
  container.innerHTML = `
    <div class="view-header">
      <h1>${Icons.settings(20)} Configuración</h1>
      <p>Configura los tokens, canales y opciones del overlay.</p>
    </div>

    <!-- Discord -->
    <section class="section">
      <div class="section-title">Bot de Discord</div>
      <div class="card">
        <div class="form-group">
          <label for="cfg-discord-token">Token del Bot</label>
          <input type="password" id="cfg-discord-token"
            value="${cfg.discord_bot_token}"
            placeholder="Bot token de Discord Developer Portal" />
        </div>
        <div class="config-grid">
          <div class="form-group">
            <label for="cfg-discord-guild">Guild ID</label>
            <input type="text" id="cfg-discord-guild"
              value="${cfg.discord_guild_id}"
              placeholder="ID del servidor de Discord" />
          </div>
          <div class="form-group">
            <label for="cfg-discord-channel">Channel ID</label>
            <input type="text" id="cfg-discord-channel"
              value="${cfg.discord_channel_id}"
              placeholder="ID del canal de comandos" />
          </div>
        </div>
        <div style="display:flex; gap:12px;">
          <button id="btn-save-discord" class="btn btn-primary">Guardar</button>
          <button id="btn-restart-discord" class="btn btn-secondary">Reiniciar Bot</button>
        </div>
      </div>
    </section>

    <!-- Twitch & TikTok Shortcuts -->
    <section class="section">
      <div class="section-title">Plataformas</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="card">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <span style="font-size: 1.1rem; font-weight: 500; display:flex; align-items:center; gap:6px;">${Icons.twitch(18)} Twitch</span>
            <span class="badge ${cfg.twitch_channel ? "badge-ok" : "badge-warn"}">${cfg.twitch_channel ? "Configurado" : "Pendiente"}</span>
          </div>
          <p style="font-size: 0.9rem; color: var(--text-muted); margin: 0 0 8px;">Eventos, filtros y mapeos de recompensas</p>
          <a href="#/twitch" class="btn btn-outline btn-sm" style="width: 100%;">Configurar</a>
        </div>
        <div class="card">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <span style="font-size: 1.1rem; font-weight: 500; display:flex; align-items:center; gap:6px;">${Icons.tiktok(18)} TikTok</span>
            <span class="badge ${cfg.tiktok_username ? "badge-ok" : "badge-warn"}">${cfg.tiktok_username ? "Configurado" : "Pendiente"}</span>
          </div>
          <p style="font-size: 0.9rem; color: var(--text-muted); margin: 0 0 8px;">Eventos en directo y filtros de chat</p>
          <a href="#/tiktok" class="btn btn-outline btn-sm" style="width: 100%;">Configurar</a>
        </div>
      </div>
    </section>

    <!-- OBS Browser Source -->
    <section class="section">
      <div class="section-title">OBS Browser Source</div>
      <div class="card">
        <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px;">
          Alternativa sin chroma key. Agregá esta URL como <strong>Browser Source</strong> en OBS
          — el fondo es transparente de forma nativa.
        </p>
        <div class="form-group">
          <label>URL del Browser Source</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="text" id="obs-browser-url" readonly
              value="http://localhost:6767/overlay"
              style="flex:1;" />
            <button id="btn-copy-obs-url" class="btn btn-secondary">Copiar</button>
          </div>
        </div>
      </div>
    </section>

    <!-- Overlay -->
    <section class="section">
      <div class="section-title">Overlay</div>
      <div class="card">
        <div class="config-grid">
          <div class="form-group">
            <label for="cfg-chroma">Color Chroma Key</label>
            <div id="cfg-chroma-mount"></div>
          </div>
          <div class="form-group">
            <label>TTS (Voz)</label>
            <label class="switch" style="margin-top:8px;">
              <input type="checkbox" id="cfg-tts" ${cfg.tts_enabled ? "checked" : ""} />
              <span class="switch-track"></span>
            </label>
          </div>
        </div>
      </div>
    </section>
  `;

  // =========================================================================================================
  // Component Mounts & Listeners
  // =========================================================================================================

  // Copy OBS Browser Source URL to clipboard
  container.querySelector("#btn-copy-obs-url")!.addEventListener("click", async () => {
    const url = (container.querySelector<HTMLInputElement>("#obs-browser-url")!).value;
    try {
      await navigator.clipboard.writeText(url);
      showToast("URL copiada al portapapeles", "success");
    } catch {
      showToast("No se pudo copiar al portapapeles", "error");
    }
  });

  const chromaMount = container.querySelector<HTMLElement>("#cfg-chroma-mount")!;

  let chromaDebounce: ReturnType<typeof setTimeout> | null = null;
  const colorPicker = createColorPicker(cfg.chroma_color, (hex) => {
    if (chromaDebounce) clearTimeout(chromaDebounce);
    chromaDebounce = setTimeout(() => {
      invoke("set_chroma_color", { color: hex }).catch(e => showToast(String(e), "error"));
    }, 150);
  });
  chromaMount.appendChild(colorPicker.el);

  // Guardar Discord
  container.querySelector("#btn-save-discord")!.addEventListener("click", async () => {
    const token   = (container.querySelector<HTMLInputElement>("#cfg-discord-token")!).value.trim();
    const guild   = (container.querySelector<HTMLInputElement>("#cfg-discord-guild")!).value.trim();
    const channel = (container.querySelector<HTMLInputElement>("#cfg-discord-channel")!).value.trim();

    try {
      await invoke("set_config_cmd", { key: "discord_bot_token", value: token });
      await invoke("set_config_cmd", { key: "discord_guild_id",  value: guild });
      await invoke("set_config_cmd", { key: "discord_channel_id", value: channel });
      showToast("Configuración de Discord guardada", "success");
    } catch (e) {
      showToast(String(e), "error");
    }
  });

  // Reiniciar bot Discord
  container.querySelector("#btn-restart-discord")!.addEventListener("click", async () => {
    try {
      await invoke("restart_discord_bot");
      showToast("Bot de Discord reiniciado", "info");
    } catch (e) {
      showToast(String(e), "error");
    }
  });


  // TTS toggle — guarda al instante
  container.querySelector<HTMLInputElement>("#cfg-tts")!.addEventListener("change", async (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    try {
      await invoke("set_config_cmd", { key: "tts_enabled", value: String(checked) });
    } catch (e) {
      showToast(String(e), "error");
    }
  });

}
