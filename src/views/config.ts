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

// =========================================================================================================
// Render Function
// =========================================================================================================

export async function renderConfig(): Promise<void> {
  await AppState.loadConfig();
  const cfg = AppState.config;

  const container = document.getElementById("view-container")!;
  container.innerHTML = `
    <div class="view-header">
      <h1>⚙ Configuración</h1>
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

    <!-- Twitch -->
    <section class="section">
      <div class="section-title">Twitch IRC</div>
      <div class="card">
        <div class="form-group">
          <label for="cfg-twitch-channel">Canal de Twitch</label>
          <input type="text" id="cfg-twitch-channel"
            value="${cfg.twitch_channel}"
            placeholder="nombre_del_canal (sin #)" />
        </div>
        <div class="form-group">
          <label for="cfg-twitch-bot-token">
            Access Token
            <a href="#" id="link-twitch-token" style="font-size:11px;color:#00c896;margin-left:8px;">Obtener token ↗</a>
          </label>
          <div style="display:flex;gap:8px;">
            <input type="password" id="cfg-twitch-bot-token"
              value="${cfg.twitch_bot_token}"
              placeholder="Pegá el Access Token aquí" style="flex:1;" />
            <button id="btn-validate-twitch" class="btn btn-secondary" style="white-space:nowrap;">Validar</button>
          </div>
          <div id="twitch-token-status" style="margin-top:6px;font-size:12px;min-height:18px;"
            ${cfg.twitch_bot_username ? `style="color:#00c896;"` : ""}>
            ${cfg.twitch_bot_username ? `✓ Conectado como <strong>@${cfg.twitch_bot_username}</strong>` : ""}
          </div>
        </div>
        <button id="btn-connect-twitch" class="btn btn-primary">Conectar</button>
      </div>
    </section>

    <!-- TikTok -->
    <section class="section">
      <div class="section-title">TikTok LIVE</div>
      <div class="card">
        <div class="form-group">
          <label for="cfg-tiktok-user">Username de TikTok</label>
          <input type="text" id="cfg-tiktok-user"
            value="${cfg.tiktok_username}"
            placeholder="tu_usuario_tiktok (sin @)" />
        </div>
        <button id="btn-connect-tiktok" class="btn btn-primary">Conectar</button>
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
            <label for="cfg-display-mode">Modo de display</label>
            <select id="cfg-display-mode">
              <option value="parallel" ${cfg.overlay_display_mode !== "queue" ? "selected" : ""}>Paralelo (todos a la vez)</option>
              <option value="queue"    ${cfg.overlay_display_mode === "queue"    ? "selected" : ""}>Cola (uno por vez)</option>
            </select>
          </div>
          <div class="form-group">
            <label>TTS (Voz)</label>
            <label class="switch" style="margin-top:8px;">
              <input type="checkbox" id="cfg-tts" ${cfg.tts_enabled ? "checked" : ""} />
              <span class="switch-track"></span>
            </label>
          </div>
        </div>
        <button id="btn-save-overlay" class="btn btn-primary">Guardar</button>
      </div>
    </section>
  `;

  // =========================================================================================================
  // Component Mounts & Listeners
  // =========================================================================================================

  const chromaMount = container.querySelector<HTMLElement>("#cfg-chroma-mount")!;
  const colorPicker = createColorPicker(cfg.chroma_color);
  chromaMount.appendChild(colorPicker.el);

  // Sync picker ↔ text is handled internally by the component.

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

  // Validar token de Twitch (auto-obtiene el username via API)
  const statusEl = container.querySelector<HTMLElement>("#twitch-token-status")!;
  const validateBtn = container.querySelector<HTMLButtonElement>("#btn-validate-twitch")!;

  container.querySelector("#link-twitch-token")?.addEventListener("click", (e) => {
    e.preventDefault();
    import("@tauri-apps/plugin-opener").then(({ openUrl }) =>
      openUrl("https://twitchtokengenerator.com")
    );
  });

  validateBtn.addEventListener("click", async () => {
    const token = (container.querySelector<HTMLInputElement>("#cfg-twitch-bot-token")!).value.trim();
    if (!token) { showToast("Pegá un token primero", "error"); return; }

    validateBtn.disabled = true;
    validateBtn.textContent = "Validando...";
    statusEl.style.color = "";
    statusEl.innerHTML = "";

    try {
      const username = await invoke<string>("validate_twitch_token", { token });
      statusEl.style.color = "#00c896";
      statusEl.innerHTML = `✓ Token válido — cuenta: <strong>@${username}</strong>`;
      showToast(`Token válido para @${username}`, "success");
    } catch (e) {
      statusEl.style.color = "#ff6b6b";
      statusEl.textContent = `✗ ${String(e)}`;
    } finally {
      validateBtn.disabled = false;
      validateBtn.textContent = "Validar";
    }
  });

  // Conectar Twitch
  container.querySelector("#btn-connect-twitch")!.addEventListener("click", async () => {
    const channel = (container.querySelector<HTMLInputElement>("#cfg-twitch-channel")!).value.trim();
    if (!channel) { showToast("Ingresá un canal de Twitch", "error"); return; }
    try {
      await invoke("connect_twitch", { channel });
      showToast(`Conectando a #${channel}...`, "info");
    } catch (e) {
      showToast(String(e), "error");
    }
  });

  // Conectar TikTok
  container.querySelector("#btn-connect-tiktok")!.addEventListener("click", async () => {
    const username = (container.querySelector<HTMLInputElement>("#cfg-tiktok-user")!).value.trim();
    if (!username) { showToast("Ingresa un username de TikTok", "error"); return; }
    try {
      await invoke("connect_tiktok", { username });
      showToast(`Conectando a @${username}...`, "info");
    } catch (e) {
      showToast(String(e), "error");
    }
  });

  // Guardar overlay
  container.querySelector("#btn-save-overlay")!.addEventListener("click", async () => {
    const color       = colorPicker.getValue();
    const ttsEl       = container.querySelector<HTMLInputElement>("#cfg-tts")!;
    const displayMode = (container.querySelector<HTMLSelectElement>("#cfg-display-mode")!).value;

    try {
      await invoke("set_chroma_color", { color });
      await invoke("set_config_cmd", { key: "tts_enabled",          value: String(ttsEl.checked) });
      await invoke("set_config_cmd", { key: "overlay_display_mode", value: displayMode });
      showToast("Configuración del overlay guardada", "success");
    } catch (e) {
      showToast(String(e), "error");
    }
  });
}
