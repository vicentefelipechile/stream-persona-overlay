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

export async function renderConfig(pane: HTMLElement): Promise<void> {
  await AppState.loadConfig();
  const cfg = AppState.config;

  const container = pane;
  container.innerHTML = `
    <div class="view-header">
      <h1>${Icons.settings(20)} Configuración</h1>
      <p>Configura los tokens, canales y opciones del overlay.</p>
    </div>

    <!-- Discord -->
    <section class="section">
      <div class="section-title" style="display:flex;align-items:center;gap:6px;">${Icons.discord(16)} Bot de Discord</div>
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
          <button id="btn-save-discord" class="btn btn-primary" style="display:inline-flex;align-items:center;gap:6px;">${Icons.save(14)} Guardar</button>
          <button id="btn-restart-discord" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;">${Icons.bot(14)} Reiniciar Bot</button>
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
    <div class="card">
      <div class="section-title" style="display:flex;align-items:center;gap:6px;">${Icons.externalLink(16)} OBS Browser Source</div>
      <p class="view-subtitle" style="margin:8px 0;">
        Alternativa sin chroma key. Agregá esta URL como <strong>Browser Source</strong> en OBS — el fondo es transparente de forma nativa.
      </p>
      <div style="display:flex;gap:8px;">
        <input id="obs-browser-url" type="text" readonly value="http://localhost:6767/overlay" style="flex:1;"/>
        <button id="btn-copy-obs-url" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;">${Icons.copy(14)} Copiar</button>
      </div>

      <div class="divider"></div>

      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div style="flex:1;">
          <label style="font-weight:500;">Acceso desde la red local (celular)</label>
          <p class="view-subtitle" style="margin:4px 0 0;">
            Permite abrir el overlay desde otros dispositivos en tu misma red WiFi (como tu celular).
            Requiere <strong>reiniciar la app</strong> para aplicarse. El firewall de Windows puede pedir permiso la primera vez.
          </p>
        </div>
        <label class="switch" style="flex-shrink:0;margin-top:2px;">
          <input type="checkbox" id="cfg-lan-access" ${cfg.lan_access_enabled ? "checked" : ""} />
          <span class="switch-track"></span>
        </label>
      </div>
      <div id="cfg-lan-url-row" style="${cfg.lan_access_enabled ? "" : "display:none;"}margin-top:10px;">
        <label style="font-size:0.9rem;color:var(--text-muted);">URL para tu celular (misma WiFi)</label>
        <div style="display:flex;gap:8px;margin-top:4px;">
          <input id="lan-browser-url" type="text" readonly value="" placeholder="Detectando IP..." style="flex:1;"/>
          <button id="btn-copy-lan-url" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;">${Icons.copy(14)} Copiar</button>
        </div>
      </div>
    </div>

    <!-- Overlay -->
    <section class="section" style="margin-top:24px;">
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

        <div class="divider"></div>

        <div class="section-title" style="display:flex;align-items:center;gap:6px;font-size:1rem;">${Icons.image(16)} Fondo del overlay</div>
        <p class="view-subtitle" style="margin:6px 0 12px;">
          Detrás de las mascotas. En modo <strong>Color</strong> el fondo es transparente en OBS (o el chroma en la ventana). En modo <strong>Imagen</strong> se muestra la imagen subida.
        </p>
        <div class="form-group">
          <label>Modo de fondo</label>
          <div id="cfg-bg-mode" style="display:flex;gap:8px;">
            <button data-bg-mode="color" class="btn ${cfg.overlay_bg_mode !== "image" ? "btn-primary" : "btn-outline"}" style="flex:1;">Color</button>
            <button data-bg-mode="image" class="btn ${cfg.overlay_bg_mode === "image" ? "btn-primary" : "btn-outline"}" style="flex:1;">Imagen</button>
          </div>
        </div>
        <div id="cfg-bg-image-section" style="${cfg.overlay_bg_mode === "image" ? "" : "display:none;"}">
          <div class="form-group">
            <label>Imagen de fondo</label>
            <div style="display:flex;gap:8px;align-items:center;">
              <button id="cfg-bg-upload" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;">${Icons.image(16)} Subir imagen</button>
              <button id="cfg-bg-clear" class="btn btn-outline" style="display:inline-flex;align-items:center;gap:6px;">${Icons.trash(16)} Quitar</button>
              <span id="cfg-bg-name" style="font-size:0.9rem;color:var(--color-text-muted);">${cfg.overlay_bg_image_path ? "Imagen cargada" : "Sin imagen"}</span>
            </div>
            <input type="file" id="cfg-bg-file" accept="image/png,image/jpeg,image/gif,image/webp" style="display:none;" />
          </div>
          <div class="form-group">
            <label>Calidad de imagen</label>
            <div id="cfg-bg-quality" style="display:flex;gap:8px;">
              ${["original", "media", "baja"].map(q =>
                `<button data-bg-quality="${q}" class="btn ${(cfg.overlay_bg_quality || "original") === q ? "btn-primary" : "btn-outline"}" style="flex:1;">${q === "original" ? "Original" : q === "media" ? "Media" : "Baja"}</button>`
              ).join("")}
            </div>
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

  // ── LAN access (acceso desde el celular) ────────────────────────────────────
  const lanUrlRow = container.querySelector<HTMLElement>("#cfg-lan-url-row")!;
  const lanUrlInput = container.querySelector<HTMLInputElement>("#lan-browser-url")!;

  // Fills the LAN URL input with http://<lan-ip>:6767/overlay (or a hint if the IP
  // can't be resolved). The server only listens on the LAN once the app restarts.
  const refreshLanUrl = async () => {
    try {
      const ip = await invoke<string | null>("get_lan_ip_cmd");
      lanUrlInput.value = ip ? `http://${ip}:6767/overlay` : "";
      lanUrlInput.placeholder = ip ? "" : "No se pudo detectar la IP de red";
    } catch {
      lanUrlInput.value = "";
      lanUrlInput.placeholder = "No se pudo detectar la IP de red";
    }
  };
  if (cfg.lan_access_enabled) void refreshLanUrl();

  container.querySelector<HTMLInputElement>("#cfg-lan-access")!.addEventListener("change", async (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    try {
      await invoke("set_config_cmd", { key: "lan_access_enabled", value: String(checked) });
      lanUrlRow.style.display = checked ? "" : "none";
      if (checked) {
        await refreshLanUrl();
        showToast("Reinicia la app para activar el acceso desde la red local", "info");
      }
    } catch (err) {
      showToast(String(err), "error");
    }
  });

  container.querySelector("#btn-copy-lan-url")!.addEventListener("click", async () => {
    const url = lanUrlInput.value;
    if (!url) {
      showToast("Aún no hay una URL de red disponible", "error");
      return;
    }
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

  // ── Overlay background ──────────────────────────────────────────────────────
  const bgImageSection = container.querySelector<HTMLElement>("#cfg-bg-image-section")!;

  // Generic helper to repaint a button group's active state.
  const setActive = (selector: string, attr: string, value: string) => {
    container.querySelectorAll<HTMLButtonElement>(selector).forEach(btn => {
      const on = btn.getAttribute(attr) === value;
      btn.classList.toggle("btn-primary", on);
      btn.classList.toggle("btn-outline", !on);
    });
  };

  // Background mode (Color / Imagen)
  container.querySelectorAll<HTMLButtonElement>("#cfg-bg-mode button").forEach(btn => {
    btn.addEventListener("click", async () => {
      const mode = btn.getAttribute("data-bg-mode")!;
      setActive("#cfg-bg-mode button", "data-bg-mode", mode);
      bgImageSection.style.display = mode === "image" ? "" : "none";
      try {
        await invoke("set_config_cmd", { key: "overlay_bg_mode", value: mode });
      } catch (e) {
        showToast(String(e), "error");
      }
    });
  });

  // Background quality (Original / Media / Baja)
  container.querySelectorAll<HTMLButtonElement>("#cfg-bg-quality button").forEach(btn => {
    btn.addEventListener("click", async () => {
      const quality = btn.getAttribute("data-bg-quality")!;
      setActive("#cfg-bg-quality button", "data-bg-quality", quality);
      try {
        await invoke("set_config_cmd", { key: "overlay_bg_quality", value: quality });
      } catch (e) {
        showToast(String(e), "error");
      }
    });
  });

  // Background image upload
  const bgFile = container.querySelector<HTMLInputElement>("#cfg-bg-file")!;
  container.querySelector("#cfg-bg-upload")!.addEventListener("click", () => bgFile.click());
  bgFile.addEventListener("change", async () => {
    const file = bgFile.files?.[0];
    if (!file) return;
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      await invoke("set_overlay_background", { fileName: file.name, data: bytes });
      container.querySelector("#cfg-bg-name")!.textContent = "Imagen cargada";
      // Uploading switches mode to "image" in the backend; reflect it in the UI.
      setActive("#cfg-bg-mode button", "data-bg-mode", "image");
      bgImageSection.style.display = "";
      showToast("Fondo guardado", "success");
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      bgFile.value = "";
    }
  });

  // Clear background image
  container.querySelector("#cfg-bg-clear")!.addEventListener("click", async () => {
    try {
      await invoke("clear_overlay_background");
      container.querySelector("#cfg-bg-name")!.textContent = "Sin imagen";
      setActive("#cfg-bg-mode button", "data-bg-mode", "color");
      bgImageSection.style.display = "none";
      showToast("Fondo eliminado", "info");
    } catch (e) {
      showToast(String(e), "error");
    }
  });

}
