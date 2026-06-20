// =========================================================================================================
// TAMAGOTCHI VIEW
// =========================================================================================================
// Admin panel view at #/tamagotchi.
// Controls the Tamagotchi system: global ON/OFF, size/speed config,
// enabled-actions pool, manual action trigger, and active pets list.
// =========================================================================================================

import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { showToast } from "../state";
import { Icons } from "../icons";
import { ActionRegistry } from "../overlay/tamagotchi/core/ActionRegistry";

// Import all actions so ActionRegistry is populated (needed for the panel's action list)
import "../overlay/tamagotchi/actions/IdleWalkAction";
import "../overlay/tamagotchi/actions/JumpAction";
import "../overlay/tamagotchi/actions/PopcornAction";
import "../overlay/tamagotchi/actions/FightAction";
import "../overlay/tamagotchi/actions/ExplodeAction";
import "../overlay/tamagotchi/actions/DanceAction";
import "../overlay/tamagotchi/actions/SleepAction";
import "../overlay/tamagotchi/actions/ConfettiAction";
import "../overlay/tamagotchi/actions/HypeTrainAction";
import "../overlay/tamagotchi/actions/DrinkWaterAction";
import "../overlay/tamagotchi/actions/EatFoodAction";
import "../overlay/tamagotchi/actions/SingAction";
import "../overlay/tamagotchi/actions/NapAction";
import "../overlay/tamagotchi/actions/CoffeeAction";
import "../overlay/tamagotchi/actions/RainbowBarfAction";
import "../overlay/tamagotchi/actions/LoveAction";
import "../overlay/tamagotchi/actions/GhostAction";

// =========================================================================================================
// Types
// =========================================================================================================

interface PetStateRow {
  user_id:      number;
  display_name: string;
  last_seen_at: string;
  floor_x:      number;
  is_sleeping:  boolean;
}

interface User {
  id:           number;
  display_name: string;
  is_active:    boolean;
}

// =========================================================================================================
// renderTamagotchi
// =========================================================================================================

export async function renderTamagotchi(pane: HTMLElement): Promise<void> {
  const container = pane;

  let cfg: Record<string, unknown> = {};
  let users: User[] = [];
  let pets:  PetStateRow[] = [];

  try {
    [cfg, users, pets] = await Promise.all([
      invoke<Record<string, unknown>>("get_config_cmd"),
      invoke<User[]>("get_users"),
      invoke<PetStateRow[]>("tama_get_pet_states"),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><span class="empty-state-icon">${Icons.warning(48)}</span><p>${String(e)}</p></div>`;
    return;
  }

  const enabled         = String(cfg["tama_enabled"])              === "true";
  const petSizePx       = Number(cfg["tama_pet_size_px"])          || 80;
  const maxPets         = Number(cfg["tama_max_pets"])             || 8;
  const inactivityMins  = Number(cfg["tama_inactivity_mins"])      || 5;
  const actionCheckSecs = Number(cfg["tama_action_check_secs"])    || 8;
  const actionProb      = Number(cfg["tama_action_probability"])   || 0.15;
  const jumpOnSpeak     = String(cfg["tama_jump_on_speak"])        === "true";
  const nameFontSize    = Number(cfg["tama_name_font_size_px"])    || 11;
  const guestsEnabled   = String(cfg["tama_guests_enabled"])       === "true";
  const guestTiktokAvatar = String(cfg["tama_guest_tiktok_avatar"] ?? "true") === "true";
  const guestsTwitch    = String(cfg["tama_guests_twitch"])        === "true";
  const guestsTiktok    = String(cfg["tama_guests_tiktok"])        === "true";
  const guestsTts       = String(cfg["tama_guests_tts"])           === "true";
  const guestsPrefix    = String(cfg["tama_guests_label_prefix"]   ?? "");
  const guestOpenPath   = String(cfg["tama_guest_mouth_open_path"]   ?? "");
  const guestClosedPath = String(cfg["tama_guest_mouth_closed_path"] ?? "");
  const placementMode   = String(cfg["tama_placement_mode"]        ?? "free") === "row" ? "row" : "free";
  const rowAnchor       = String(cfg["tama_row_anchor"]            ?? "left") === "right" ? "right" : "left";
  const gridHighPrec    = String(cfg["tama_grid_high_precision"]   ?? "false") === "true";
  const gridPerspective = String(cfg["tama_grid_perspective"]      ?? "true")  === "true";
  const gridPerspType   = String(cfg["tama_grid_perspective_type"] ?? "plano");
  const gridNearScale   = Number(cfg["tama_grid_near_scale"])      || 1.3;
  const gridFarScale    = Number(cfg["tama_grid_far_scale"])       || 0.6;
  const gridFloorTop    = Number(cfg["tama_grid_floor_top_frac"])  || 0.55;
  const gridWander      = String(cfg["tama_grid_wander_enabled"]   ?? "true")  === "true";
  const gridGuideAlpha  = Number(cfg["tama_grid_guide_alpha"])     || 0;
  const bubbleEnabled   = String(cfg["tama_chat_bubble_enabled"]   ?? "false") === "true";
  const bubbleMaxChars  = Number(cfg["tama_chat_bubble_max_chars"]) || 40;

  let enabledActions: string[] = [];
  try {
    enabledActions = JSON.parse(String(cfg["tama_enabled_actions"] ?? "[]"));
  } catch (_) {
    enabledActions = ["jump", "popcorn", "dance", "fight", "explode"];
  }

  let keywordActions: Record<string, string> = {};
  try {
    keywordActions = JSON.parse(String(cfg["tama_keyword_actions"] ?? "{}"));
  } catch (_) {
    keywordActions = {};
  }

  const allActionMeta = ActionRegistry.getAllMeta().filter(m => m.probability > 0 || enabledActions.includes(m.id));
  const activeUsers   = users.filter(u => u.is_active);

  // =========================================================================================================
  // HTML
  // =========================================================================================================

  container.innerHTML = `
    <div class="view-header">
      <div class="tama-view-header-row">
        <div>
          <h1 class="view-title">${Icons.paw(20)} Tamagotchi</h1>
          <p class="view-subtitle">Mascotas persistentes de los usuarios del chat</p>
        </div>
        <div class="tama-system-toggle">
          <span id="tama-status-text" class="tama-system-status${enabled ? " tama-system-status--on" : ""}">${enabled ? "Activo" : "Inactivo"}</span>
          <label class="switch">
            <input type="checkbox" id="tama-enabled" ${enabled ? "checked" : ""}/>
            <span class="switch-track"></span>
          </label>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2 class="section-title">Modo de disposición</h2>
      </div>
      <div class="tama-setting-row">
        <div>
          <div class="tama-setting-label">Fila estática</div>
          <div class="tama-setting-desc">En vez de moverse libremente por la pantalla, las mascotas se quedan en fila en una esquina inferior. Entran al hablar y se acomodan solas cuando una entra o se va.</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="cfg-placement-row" ${placementMode === "row" ? "checked" : ""}/>
          <span class="switch-track"></span>
        </label>
      </div>
      <div id="row-anchor-options" class="tama-setting-row" style="margin-top:var(--space-4);${placementMode !== "row" ? "opacity:.4;pointer-events:none;" : ""}">
        <div>
          <div class="tama-setting-label">Esquina de la fila</div>
          <div class="tama-setting-desc">A qué borde de la pantalla se pega la fila. Las mascotas se apilan desde ese borde hacia el centro.</div>
        </div>
        <select id="cfg-row-anchor" style="width:160px;">
          <option value="left"  ${rowAnchor === "left"  ? "selected" : ""}>Izquierda</option>
          <option value="right" ${rowAnchor === "right" ? "selected" : ""}>Derecha</option>
        </select>
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-5);">
      <div class="card-header">
        <h2 class="section-title">Configuración Global</h2>
      </div>
      <div class="tama-sliders-grid">
        ${_slider("cfg-size",       "cfg-size-val",       "Tamaño mascota",              petSizePx,       "px",   40,   200, 10)}
        ${_slider("cfg-max-pets",   "cfg-max-pets-val",   "Máx. mascotas visibles",       maxPets,         "",     1,    20,  1)}
        ${_slider("cfg-inactivity", "cfg-inactivity-val", "Inactividad antes de dormir",  inactivityMins,  " min", 1,    30,  1)}
        ${_slider("cfg-check",      "cfg-check-val",      "Intervalo acciones aleatorias",actionCheckSecs, "s",    3,    30,  1)}
        ${_slider("cfg-prob",       "cfg-prob-val",       "Probabilidad por intervalo",   actionProb,      "",     0,    1,   0.05)}
        ${_slider("cfg-name-font",  "cfg-name-font-val",  "Tamaño nombre",                nameFontSize,    "px",   8,    32,  1)}
      </div>
      <div class="tama-setting-row">
        <div>
          <div class="tama-setting-label">Saltar al hablar</div>
          <div class="tama-setting-desc">La mascota salta en lugar cuando su dueño escribe en el chat</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="cfg-jump-on-speak" ${jumpOnSpeak ? "checked" : ""}/>
          <span class="switch-track"></span>
        </label>
      </div>

      <div class="tama-setting-row" style="margin-top:var(--space-4);">
        <div>
          <div class="tama-setting-label">Matriz de alta precisión</div>
          <div class="tama-setting-desc">Duplica el tamaño de la matriz (más mascotas en pantalla cuando se llena).</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="cfg-grid-high-precision" ${gridHighPrec ? "checked" : ""}/>
          <span class="switch-track"></span>
        </label>
      </div>

      <div class="tama-setting-row" style="margin-top:var(--space-4);">
        <div>
          <div class="tama-setting-label">Movimiento ambiental</div>
          <div class="tama-setting-desc">Las mascotas se desplazan suavemente a celdas vecinas libres cada cierto tiempo.</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="cfg-grid-wander" ${gridWander ? "checked" : ""}/>
          <span class="switch-track"></span>
        </label>
      </div>

      <div class="tama-setting-row" style="margin-top:var(--space-4);">
        <div>
          <div class="tama-setting-label">Efecto de perspectiva</div>
          <div class="tama-setting-desc">Las mascotas más cercanas (abajo) se ven más grandes y las del fondo (arriba) más pequeñas.</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="cfg-grid-perspective" ${gridPerspective ? "checked" : ""}/>
          <span class="switch-track"></span>
        </label>
      </div>

      <div id="grid-perspective-options" style="${!gridPerspective ? "opacity:.4;pointer-events:none;" : ""}display:flex;flex-direction:column;gap:var(--space-6);margin-top:var(--space-5);padding:var(--space-5);background:var(--color-bg-elevated, rgba(255,255,255,0.02));border-radius:6px;border-left:3px solid var(--color-accent);">
        <div class="form-group" style="margin:0;">
          <label for="cfg-grid-persp-type" style="margin-bottom:6px;">Tipo de perspectiva</label>
          <select id="cfg-grid-persp-type" style="width:100%;">
            <option value="plano"        ${gridPerspType === "plano"        ? "selected" : ""}>Plano (trapecio recto)</option>
            <option value="colina_abajo" ${gridPerspType === "colina_abajo" ? "selected" : ""}>Colina abajo (lados curvos)</option>
            <option value="horizonte"    ${gridPerspType === "horizonte"    ? "selected" : ""}>Horizonte (fondo arqueado)</option>
          </select>
        </div>
        ${_slider("cfg-grid-near", "cfg-grid-near-val", "Escala frontal (cerca)", gridNearScale, "×", 1, 2.5, 0.1)}
        ${_slider("cfg-grid-far",  "cfg-grid-far-val",  "Escala de fondo (lejos)", gridFarScale,  "×", 0.3, 1, 0.05)}
      </div>

      <div class="divider" style="margin:var(--space-6) 0;"></div>

      <div style="display:flex;flex-direction:column;gap:var(--space-6);">
        ${_slider("cfg-grid-floor-top", "cfg-grid-floor-top-val", "Inicio de la banda de piso", gridFloorTop, "", 0.1, 0.9, 0.05)}

        <div style="display:flex;flex-direction:column;gap:var(--space-3);">
          ${_slider("cfg-grid-guide", "cfg-grid-guide-val", "Cuadrícula de perspectiva (guía)", gridGuideAlpha, "", 0, 1, 0.05)}
          <div class="tama-setting-desc">Líneas blancas en forma de trapecio para alinear la perspectiva. 0 = oculta. Súbela mientras ajustas y bájala a 0 al terminar.</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-5);">
      <div class="card-header">
        <h2 class="section-title">Mensajes sobre la mascota</h2>
      </div>
      <div class="tama-setting-row">
        <div>
          <div class="tama-setting-label">Mostrar mensaje al hablar</div>
          <div class="tama-setting-desc">Cuando un usuario escribe, su mascota muestra el mensaje en una burbuja (se trunca al máximo de caracteres).</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="cfg-bubble-enabled" ${bubbleEnabled ? "checked" : ""}/>
          <span class="switch-track"></span>
        </label>
      </div>
      <div id="bubble-options" style="${!bubbleEnabled ? "opacity:.4;pointer-events:none;" : ""}margin-top:var(--space-4);">
        ${_slider("cfg-bubble-max", "cfg-bubble-max-val", "Máximo de caracteres", bubbleMaxChars, "", 10, 100, 1)}
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-5);">
      <div class="card-header" style="justify-content:space-between;">
        <h2 class="section-title">Visores Invitados</h2>
        <label class="switch">
          <input type="checkbox" id="guests-enabled" ${guestsEnabled ? "checked" : ""}/>
          <span class="switch-track"></span>
        </label>
      </div>
      <p style="font-size:13px;color:var(--color-text-muted);margin:0 0 var(--space-4);">
        Genera una mascota genérica para usuarios del chat que no están registrados en el sistema.
      </p>
      <details id="guests-advanced"${!guestsEnabled ? " style=\"pointer-events:none;opacity:.4;\"" : ""}>
        <summary class="details-toggle">Avanzado</summary>
        <div class="tama-guests-advanced">
          <div class="tama-setting-row">
            <div>
              <div class="tama-setting-label">${Icons.twitch(14)}Invitados de Twitch</div>
              <div class="tama-setting-desc">Genera mascotas para chatters de Twitch no registrados</div>
            </div>
            <label class="switch">
              <input type="checkbox" id="guests-twitch" ${guestsTwitch ? "checked" : ""}/>
              <span class="switch-track"></span>
            </label>
          </div>
          <div class="tama-setting-row">
            <div>
              <div class="tama-setting-label">${Icons.tiktok(14)}Invitados de TikTok</div>
              <div class="tama-setting-desc">Genera mascotas para chatters de TikTok no registrados</div>
            </div>
            <label class="switch">
              <input type="checkbox" id="guests-tiktok" ${guestsTiktok ? "checked" : ""}/>
              <span class="switch-track"></span>
            </label>
          </div>
          <div class="tama-setting-row">
            <div>
              <div class="tama-setting-label">Activar TTS para invitados</div>
              <div class="tama-setting-desc">Permite que los mensajes de invitados sean leídos por el sistema de voz</div>
            </div>
            <label class="switch">
              <input type="checkbox" id="guests-tts" ${guestsTts ? "checked" : ""}/>
              <span class="switch-track"></span>
            </label>
          </div>
          <div class="tama-setting-row">
            <div>
              <div class="tama-setting-label">${Icons.tiktok(14)}Usar foto de perfil de TikTok</div>
              <div class="tama-setting-desc">Los invitados de TikTok usan su foto de perfil como sprite (tiene prioridad sobre el sprite por defecto/personalizado)</div>
            </div>
            <label class="switch">
              <input type="checkbox" id="guests-tiktok-avatar" ${guestTiktokAvatar ? "checked" : ""}/>
              <span class="switch-track"></span>
            </label>
          </div>

          <div class="tama-guests-section">
            <div class="form-group">
              <label for="guests-prefix">Prefijo del nombre</label>
              <input type="text" id="guests-prefix" value="${guestsPrefix}" placeholder="[G] " style="max-width:200px;"/>
              <small style="color:var(--color-text-muted);">Se antepone al nombre de usuario del invitado en la etiqueta de la mascota</small>
            </div>
          </div>

          <div class="tama-guests-section">
            <div class="tama-guests-section-title">Sprite personalizado de invitado</div>
            <div class="tama-guests-section-desc">Imagen PNG/JPEG que reemplaza el sprite genérico. Vacío = usar el sprite por defecto incluido.</div>
            <div class="tama-sprite-grid">
              <div class="tama-sprite-card">
                <span class="tama-sprite-card-label">Boca abierta</span>
                <div class="tama-sprite-preview">
                  ${guestOpenPath
                    ? `<img src="${convertFileSrc(guestOpenPath)}" />`
                    : `<span class="tama-sprite-preview-empty">Default</span>`}
                </div>
                <div class="tama-sprite-card-actions">
                  <button class="btn btn-secondary btn-sm" id="btn-guest-img-open">Cambiar</button>
                  ${guestOpenPath ? `<button class="btn btn-outline btn-sm" id="btn-guest-img-open-reset">Restablecer</button>` : ""}
                </div>
              </div>
              <div class="tama-sprite-card">
                <span class="tama-sprite-card-label">Boca cerrada</span>
                <div class="tama-sprite-preview">
                  ${guestClosedPath
                    ? `<img src="${convertFileSrc(guestClosedPath)}" />`
                    : `<span class="tama-sprite-preview-empty">Default</span>`}
                </div>
                <div class="tama-sprite-card-actions">
                  <button class="btn btn-secondary btn-sm" id="btn-guest-img-closed">Cambiar</button>
                  ${guestClosedPath ? `<button class="btn btn-outline btn-sm" id="btn-guest-img-closed-reset">Restablecer</button>` : ""}
                </div>
              </div>
            </div>
          </div>
        </div>
      </details>
    </div>

    <div class="card" style="margin-top:var(--space-5);">
      <div class="card-header">
        <h2 class="section-title">Pool de Acciones Aleatorias</h2>
        <span id="tama-actions-badge" class="badge badge-active">${enabledActions.length} activa${enabledActions.length !== 1 ? "s" : ""}</span>
      </div>
      <div class="tama-actions-grid" id="action-toggles">
        ${allActionMeta.map(m => `
          <label class="tama-action-card${enabledActions.includes(m.id) ? " tama-action-card--on" : ""}">
            <input type="checkbox" class="action-checkbox" data-id="${m.id}" ${enabledActions.includes(m.id) ? "checked" : ""}/>
            <span class="tama-action-icon">${m.icon}</span>
            <div class="tama-action-info">
              <span class="tama-action-name">${m.label}</span>
              <span class="tama-action-desc">${m.description}</span>
            </div>
            <span class="tama-action-check">${Icons.check(14)}</span>
          </label>
        `).join("")}
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-5);">
      <div class="card-header">
        <h2 class="section-title">Palabras Clave → Acción</h2>
        <span id="kw-badge" class="badge badge-active">${Object.keys(keywordActions).length}</span>
      </div>
      <p style="font-size:13px;color:var(--color-text-muted);margin:0 0 var(--space-4);">
        Cuando el dueño de una mascota escribe una de estas palabras en el chat, se fuerza la acción indicada (coincidencia por palabra completa, sin distinguir mayúsculas).
      </p>
      <div id="kw-rows" style="display:flex;flex-direction:column;gap:var(--space-3);">
        ${_renderKeywordRows(keywordActions, allActionMeta)}
      </div>
      <button class="btn btn-secondary btn-sm" id="kw-add" style="margin-top:var(--space-4);display:inline-flex;align-items:center;gap:6px;">${Icons.plus(14)} Añadir palabra</button>
    </div>

    <div class="card" style="margin-top:var(--space-5);">
      <div class="card-header">
        <h2 class="section-title">Disparar Acción Manual</h2>
      </div>
      <div class="tama-fire-row">
        <div class="form-group">
          <label>Usuario</label>
          <select id="fire-user">
            <option value="">— Seleccionar usuario —</option>
            ${activeUsers.map(u => `<option value="${u.id}">${u.display_name}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label>Acción</label>
          <select id="fire-action">
            <option value="">— Seleccionar acción —</option>
            ${allActionMeta
              .map(m => `<option value="${m.id}">${m.icon} ${m.label}</option>`)
              .join("")}
          </select>
        </div>
        <button class="btn btn-primary" id="btn-fire" style="display:inline-flex;align-items:center;gap:6px;">${Icons.zap(14)} Disparar</button>
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-5);">
      <div class="card-header">
        <h2 class="section-title">Mascotas de prueba</h2>
      </div>
      <p style="font-size:13px;color:var(--color-text-muted);margin:0 0 var(--space-4);">
        Genera mascotas ficticias para probar el overlay sin necesidad de un stream en vivo. Se mueven y hablan solas; recuerda activar el sistema Tamagotchi arriba.
      </p>
      <div class="tama-sliders-grid" style="grid-template-columns:1fr;">
        ${_slider("demo-count", "demo-count-val", "Cantidad a generar", 5, "", 1, 20, 1)}
      </div>
      <div style="display:flex;gap:var(--space-3);margin-top:var(--space-5);">
        <button class="btn btn-primary" id="btn-demo-start" style="display:inline-flex;align-items:center;gap:6px;">${Icons.paw(14)} Generar mascotas</button>
        <button class="btn btn-outline" id="btn-demo-stop" style="display:inline-flex;align-items:center;gap:6px;">${Icons.trash()} Quitar de prueba</button>
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-5);margin-bottom:var(--space-8);">
      <div class="card-header">
        <h2 class="section-title">Mascotas Activas</h2>
        <div style="display:inline-flex;gap:var(--space-2);">
          <button class="btn btn-outline btn-sm" id="btn-reset-pets" style="display:inline-flex;align-items:center;gap:4px;" title="Destruye y recrea todas las mascotas (recupera las que se quedaron congeladas) sin reiniciar la conexión.">${Icons.reset()} Reiniciar todos</button>
          <button class="btn btn-outline btn-sm" id="btn-refresh-pets" style="display:inline-flex;align-items:center;gap:4px;">${Icons.refresh()} Actualizar</button>
        </div>
      </div>
      <div id="pets-list">
        ${_renderPetsList(pets)}
      </div>
    </div>
  `;

  // =========================================================================================================
  // Event Handlers
  // =========================================================================================================

  const tamaToggle = container.querySelector<HTMLInputElement>("#tama-enabled")!;
  tamaToggle.addEventListener("change", async () => {
    try {
      await invoke("tama_set_enabled", { enabled: tamaToggle.checked });
      const statusEl = container.querySelector<HTMLSpanElement>("#tama-status-text")!;
      statusEl.textContent = tamaToggle.checked ? "Activo" : "Inactivo";
      statusEl.className = `tama-system-status${tamaToggle.checked ? " tama-system-status--on" : ""}`;
      showToast(`Tamagotchi ${tamaToggle.checked ? "activado" : "desactivado"}`, "success");
    } catch (e) {
      showToast(`Error: ${String(e)}`, "error");
    }
  });

  // Guest Viewers toggles
  const guestsEnabledEl = container.querySelector<HTMLInputElement>("#guests-enabled")!;
  const guestsAdvanced  = container.querySelector<HTMLDetailsElement>("#guests-advanced")!;

  function _setGuestsAdvancedState(on: boolean): void {
    guestsAdvanced.style.pointerEvents = on ? "" : "none";
    guestsAdvanced.style.opacity       = on ? "" : "0.4";
  }

  guestsEnabledEl.addEventListener("change", () => {
    const value = guestsEnabledEl.checked ? "true" : "false";
    _setGuestsAdvancedState(guestsEnabledEl.checked);
    invoke("set_config_cmd", { key: "tama_guests_enabled", value })
      .catch(err => showToast(String(err), "error"));
  });

  container.querySelector<HTMLInputElement>("#guests-twitch")!.addEventListener("change", (e) => {
    invoke("set_config_cmd", { key: "tama_guests_twitch", value: (e.target as HTMLInputElement).checked ? "true" : "false" })
      .catch(err => showToast(String(err), "error"));
  });

  container.querySelector<HTMLInputElement>("#guests-tiktok")!.addEventListener("change", (e) => {
    invoke("set_config_cmd", { key: "tama_guests_tiktok", value: (e.target as HTMLInputElement).checked ? "true" : "false" })
      .catch(err => showToast(String(err), "error"));
  });

  container.querySelector<HTMLInputElement>("#guests-tts")!.addEventListener("change", (e) => {
    invoke("set_config_cmd", { key: "tama_guests_tts", value: (e.target as HTMLInputElement).checked ? "true" : "false" })
      .catch(err => showToast(String(err), "error"));
  });

  container.querySelector<HTMLInputElement>("#guests-tiktok-avatar")!.addEventListener("change", (e) => {
    invoke("set_config_cmd", { key: "tama_guest_tiktok_avatar", value: (e.target as HTMLInputElement).checked ? "true" : "false" })
      .catch(err => showToast(String(err), "error"));
  });

  // Keyword → action editor
  const kwRowsEl = container.querySelector<HTMLElement>("#kw-rows")!;
  const kwBadge  = container.querySelector<HTMLElement>("#kw-badge")!;

  function _saveKeywords(): void {
    const map: Record<string, string> = {};
    kwRowsEl.querySelectorAll<HTMLElement>(".kw-row").forEach(row => {
      const kw     = row.querySelector<HTMLInputElement>(".kw-keyword")!.value.trim().toLowerCase();
      const action = row.querySelector<HTMLSelectElement>(".kw-action")!.value;
      if (kw && action) map[kw] = action;
    });
    kwBadge.textContent = String(Object.keys(map).length);
    invoke("set_config_cmd", { key: "tama_keyword_actions", value: JSON.stringify(map) })
      .catch(err => showToast(String(err), "error"));
  }

  container.querySelector("#kw-add")!.addEventListener("click", () => {
    kwRowsEl.querySelector(".kw-empty")?.remove();
    const firstAction = allActionMeta[0]?.id ?? "jump";
    kwRowsEl.insertAdjacentHTML("beforeend", _keywordRowHtml("", firstAction, allActionMeta));
    kwRowsEl.querySelector<HTMLInputElement>(".kw-row:last-child .kw-keyword")?.focus();
  });

  kwRowsEl.addEventListener("change", () => _saveKeywords());
  kwRowsEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".kw-remove");
    if (!btn) return;
    btn.closest(".kw-row")?.remove();
    if (!kwRowsEl.querySelector(".kw-row")) {
      kwRowsEl.innerHTML = `<p class="kw-empty" style="color:var(--color-text-muted);font-size:13px;">No hay palabras clave configuradas.</p>`;
    }
    _saveKeywords();
  });

  container.querySelector<HTMLInputElement>("#guests-prefix")!.addEventListener("change", (e) => {
    invoke("set_config_cmd", { key: "tama_guests_label_prefix", value: (e.target as HTMLInputElement).value })
      .catch(err => showToast(String(err), "error"));
  });

  function _pickGuestImage(imageType: "open" | "closed"): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const buffer = await file.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buffer));
      try {
        await invoke("set_guest_image", { imageType, imageData: bytes });
        showToast("Imagen de invitado actualizada", "success");
        await renderTamagotchi(container);
      } catch (e) {
        showToast(String(e), "error");
      }
    };
    input.click();
  }

  container.querySelector("#btn-guest-img-open")?.addEventListener("click", () => _pickGuestImage("open"));
  container.querySelector("#btn-guest-img-closed")?.addEventListener("click", () => _pickGuestImage("closed"));

  container.querySelector("#btn-guest-img-open-reset")?.addEventListener("click", async () => {
    try {
      await invoke("reset_guest_image", { imageType: "open" });
      showToast("Imagen restablecida al default", "success");
      await renderTamagotchi(container);
    } catch (e) {
      showToast(String(e), "error");
    }
  });

  container.querySelector("#btn-guest-img-closed-reset")?.addEventListener("click", async () => {
    try {
      await invoke("reset_guest_image", { imageType: "closed" });
      showToast("Imagen restablecida al default", "success");
      await renderTamagotchi(container);
    } catch (e) {
      showToast(String(e), "error");
    }
  });

  _bindRange("cfg-size",       "cfg-size-val",       "px");
  _bindRange("cfg-max-pets",   "cfg-max-pets-val",   "");
  _bindRange("cfg-inactivity", "cfg-inactivity-val", " min");
  _bindRange("cfg-check",      "cfg-check-val",      "s");
  _bindRange("cfg-prob",       "cfg-prob-val",       "");
  _bindRange("cfg-name-font",  "cfg-name-font-val",  "px");

  container.querySelector<HTMLInputElement>("#cfg-jump-on-speak")!.addEventListener("change", (e) => {
    const value = (e.target as HTMLInputElement).checked ? "true" : "false";
    invoke("set_config_cmd", { key: "tama_jump_on_speak", value }).catch(err => showToast(String(err), "error"));
  });

  // Placement mode (Free grid <-> Static row). The backend rebuilds the grid live on
  // this key (GridManager::reconfigure re-emits config + cells), so no overlay reload.
  const placementRowEl  = container.querySelector<HTMLInputElement>("#cfg-placement-row")!;
  const rowAnchorOptsEl = container.querySelector<HTMLDivElement>("#row-anchor-options")!;
  placementRowEl.addEventListener("change", () => {
    const on = placementRowEl.checked;
    rowAnchorOptsEl.style.opacity       = on ? "" : "0.4";
    rowAnchorOptsEl.style.pointerEvents = on ? "" : "none";
    invoke("set_config_cmd", { key: "tama_placement_mode", value: on ? "row" : "free" })
      .catch(err => showToast(String(err), "error"));
  });

  const rowAnchorEl = container.querySelector<HTMLSelectElement>("#cfg-row-anchor")!;
  rowAnchorEl.addEventListener("change", () => {
    invoke("set_config_cmd", { key: "tama_row_anchor", value: rowAnchorEl.value })
      .catch(err => showToast(String(err), "error"));
  });

  container.querySelector<HTMLInputElement>("#cfg-grid-high-precision")!.addEventListener("change", (e) => {
    const value = (e.target as HTMLInputElement).checked ? "true" : "false";
    invoke("set_config_cmd", { key: "tama_grid_high_precision", value })
      .catch(err => showToast(String(err), "error"));
  });

  container.querySelector<HTMLInputElement>("#cfg-grid-wander")!.addEventListener("change", (e) => {
    const value = (e.target as HTMLInputElement).checked ? "true" : "false";
    invoke("set_config_cmd", { key: "tama_grid_wander_enabled", value })
      .catch(err => showToast(String(err), "error"));
    showToast("Recarga el overlay para aplicar el cambio de movimiento ambiental", "info");
  });

  const perspectiveOptionsEl = container.querySelector<HTMLDivElement>("#grid-perspective-options")!;
  container.querySelector<HTMLInputElement>("#cfg-grid-perspective")!.addEventListener("change", (e) => {
    const on = (e.target as HTMLInputElement).checked;
    perspectiveOptionsEl.style.opacity       = on ? "" : "0.4";
    perspectiveOptionsEl.style.pointerEvents = on ? "" : "none";
    invoke("set_config_cmd", { key: "tama_grid_perspective", value: on ? "true" : "false" })
      .catch(err => showToast(String(err), "error"));
  });

  container.querySelector<HTMLSelectElement>("#cfg-grid-persp-type")!.addEventListener("change", (e) => {
    const value = (e.target as HTMLSelectElement).value;
    invoke("set_config_cmd", { key: "tama_grid_perspective_type", value })
      .catch(err => showToast(String(err), "error"));
  });

  _bindRange("cfg-grid-near",      "cfg-grid-near-val",      "×");
  _bindRange("cfg-grid-far",       "cfg-grid-far-val",       "×");
  _bindRange("cfg-grid-floor-top", "cfg-grid-floor-top-val", "");
  _bindRange("cfg-grid-guide",     "cfg-grid-guide-val",     "");
  _bindRange("cfg-bubble-max",     "cfg-bubble-max-val",     "");

  // Chat bubble enable toggle (dims the max-chars slider when off).
  const bubbleOptionsEl = container.querySelector<HTMLDivElement>("#bubble-options")!;
  container.querySelector<HTMLInputElement>("#cfg-bubble-enabled")!.addEventListener("change", (e) => {
    const on = (e.target as HTMLInputElement).checked;
    bubbleOptionsEl.style.opacity       = on ? "" : "0.4";
    bubbleOptionsEl.style.pointerEvents = on ? "" : "none";
    invoke("set_config_cmd", { key: "tama_chat_bubble_enabled", value: on ? "true" : "false" })
      .catch(err => showToast(String(err), "error"));
  });

  const sliderMap: Array<[string, string]> = [
    ["cfg-size",           "tama_pet_size_px"],
    ["cfg-max-pets",       "tama_max_pets"],
    ["cfg-inactivity",     "tama_inactivity_mins"],
    ["cfg-check",          "tama_action_check_secs"],
    ["cfg-prob",           "tama_action_probability"],
    ["cfg-name-font",      "tama_name_font_size_px"],
    ["cfg-grid-near",      "tama_grid_near_scale"],
    ["cfg-grid-far",       "tama_grid_far_scale"],
    ["cfg-grid-floor-top", "tama_grid_floor_top_frac"],
    ["cfg-grid-guide",     "tama_grid_guide_alpha"],
    ["cfg-bubble-max",     "tama_chat_bubble_max_chars"],
  ];
  sliderMap.forEach(([inputId, key]) => {
    const input = container.querySelector<HTMLInputElement>(`#${inputId}`)!;
    const save = (value: string) =>
      invoke("set_config_cmd", { key, value }).catch(err => showToast(String(err), "error"));

    // Live update while dragging: persist on each `input`, but coalesce to one save per
    // animation frame so a fast drag doesn't fire dozens of IPC/DB writes per second.
    // A final `change` (fired on release) guarantees the settled value is stored even if
    // it landed between frames.
    let pending: string | null = null;
    input.addEventListener("input", (e) => {
      const value = (e.target as HTMLInputElement).value;
      if (pending !== null) { pending = value; return; }
      pending = value;
      requestAnimationFrame(() => {
        const v = pending!;
        pending = null;
        save(v);
      });
    });
    input.addEventListener("change", (e) => save((e.target as HTMLInputElement).value));
  });

  const actionTogglesEl = container.querySelector("#action-toggles")!;
  actionTogglesEl.addEventListener("change", (e) => {
    const cb = (e.target as HTMLElement).closest<HTMLInputElement>(".action-checkbox");
    if (cb) {
      const card = cb.closest<HTMLElement>(".tama-action-card");
      card?.classList.toggle("tama-action-card--on", cb.checked);
    }

    const checked = Array.from(
      container.querySelectorAll<HTMLInputElement>(".action-checkbox:checked")
    ).map(el => el.dataset["id"]!);

    const badge = container.querySelector("#tama-actions-badge")!;
    badge.textContent = `${checked.length} activa${checked.length !== 1 ? "s" : ""}`;

    invoke("set_config_cmd", { key: "tama_enabled_actions", value: JSON.stringify(checked) })
      .catch(err => showToast(String(err), "error"));
  });

  container.querySelector("#btn-fire")!.addEventListener("click", async () => {
    const userId   = Number(container.querySelector<HTMLSelectElement>("#fire-user")!.value);
    const actionId = container.querySelector<HTMLSelectElement>("#fire-action")!.value;
    if (!userId || !actionId) { showToast("Selecciona usuario y acción", "error"); return; }
    try {
      await invoke("tama_trigger_action", { userId, actionId, input: {} });
      showToast("Acción disparada", "success");
    } catch (e) {
      showToast(`Error: ${String(e)}`, "error");
    }
  });

  // Demo (fake) pets — spawn synthetic pets so a first-time user can see the overlay
  // without a live stream. The backend keeps them moving via a re-messaging loop.
  _bindRange("demo-count", "demo-count-val", "");
  container.querySelector("#btn-demo-start")!.addEventListener("click", async () => {
    if (!tamaToggle.checked) {
      showToast("Activa el sistema Tamagotchi (arriba) para ver las mascotas", "info");
    }
    const count = Number(container.querySelector<HTMLInputElement>("#demo-count")!.value) || 5;
    try {
      await invoke("tama_demo_start", { count });
      showToast(`${count} mascota${count !== 1 ? "s" : ""} de prueba generada${count !== 1 ? "s" : ""}`, "success");
    } catch (e) {
      showToast(`Error: ${String(e)}`, "error");
    }
  });

  container.querySelector("#btn-demo-stop")!.addEventListener("click", async () => {
    try {
      await invoke("tama_demo_stop");
      showToast("Mascotas de prueba quitadas", "success");
    } catch (e) {
      showToast(`Error: ${String(e)}`, "error");
    }
  });

  container.querySelector("#btn-reset-pets")!.addEventListener("click", async () => {
    try {
      await invoke("tama_reset_all");
      showToast("Mascotas reiniciadas", "success");
    } catch (e) {
      showToast(`Error: ${String(e)}`, "error");
    }
  });

  container.querySelector("#btn-refresh-pets")!.addEventListener("click", async () => {
    try {
      const fresh = await invoke<PetStateRow[]>("tama_get_pet_states");
      container.querySelector("#pets-list")!.innerHTML = _renderPetsList(fresh);
    } catch (e) {
      showToast(`Error: ${String(e)}`, "error");
    }
  });

  container.querySelector("#pets-list")!.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-remove-pet]");
    if (!btn) return;
    const userId = Number(btn.dataset["removePet"]);
    try {
      await invoke("tama_trigger_action", { userId, actionId: "despawn", input: {} });
      showToast("Mascota eliminada", "success");
      const fresh = await invoke<PetStateRow[]>("tama_get_pet_states");
      container.querySelector("#pets-list")!.innerHTML = _renderPetsList(fresh);
    } catch (e) {
      showToast(`Error: ${String(e)}`, "error");
    }
  });
}

// =========================================================================================================
// Helpers
// =========================================================================================================

function _slider(
  inputId: string,
  labelId: string,
  label: string,
  value: number,
  suffix: string,
  min: number,
  max: number,
  step: number,
): string {
  return `
    <div class="tama-slider-item">
      <div class="tama-slider-header">
        <span class="tama-slider-label">${label}</span>
        <span class="tama-slider-value" id="${labelId}">${value}${suffix}</span>
      </div>
      <input type="range" id="${inputId}" class="tama-range"
             min="${min}" max="${max}" step="${step}" value="${value}"/>
    </div>
  `;
}

type KwActionMeta = { id: string; label: string; icon: string };

function _keywordRowHtml(keyword: string, action: string, meta: KwActionMeta[]): string {
  const opts = meta
    .map(m => `<option value="${m.id}" ${m.id === action ? "selected" : ""}>${m.icon} ${m.label}</option>`)
    .join("");
  const safeKw = keyword.replace(/"/g, "&quot;");
  return `
    <div class="kw-row" style="display:flex;gap:var(--space-3);align-items:center;">
      <input type="text" class="kw-keyword" value="${safeKw}" placeholder="palabra" style="flex:1;min-width:0;"/>
      <span style="color:var(--color-text-muted);flex-shrink:0;">→</span>
      <select class="kw-action" style="flex:1;min-width:0;">${opts}</select>
      <button class="btn btn-danger btn-sm kw-remove" title="Eliminar" style="flex-shrink:0;">${Icons.trash()}</button>
    </div>`;
}

function _renderKeywordRows(map: Record<string, string>, meta: KwActionMeta[]): string {
  const entries = Object.entries(map);
  if (!entries.length) {
    return `<p class="kw-empty" style="color:var(--color-text-muted);font-size:13px;">No hay palabras clave configuradas.</p>`;
  }
  return entries.map(([k, v]) => _keywordRowHtml(k, v, meta)).join("");
}

function _renderPetsList(pets: PetStateRow[]): string {
  if (!pets.length) {
    return `<p style="color:var(--color-text-muted);font-size:13px;padding:var(--space-4) 0;">No hay mascotas activas en este momento.</p>`;
  }
  return pets.map(p => `
    <div class="tama-pet-row">
      <div class="tama-pet-avatar">${Icons.paw(20)}</div>
      <div class="tama-pet-info">
        <div class="tama-pet-name">${p.display_name}</div>
        <div class="tama-pet-meta">x: ${Math.round(p.floor_x)}</div>
      </div>
      <span class="badge ${p.is_sleeping ? "badge-warn" : "badge-ok"}">${p.is_sleeping ? "durmiendo" : "activo"}</span>
      <button class="btn btn-danger btn-sm" data-remove-pet="${p.user_id}" style="display:inline-flex;align-items:center;gap:4px;">${Icons.trash()} Eliminar</button>
    </div>
  `).join("");
}

function _bindRange(inputId: string, labelId: string, suffix: string): void {
  const input = document.getElementById(inputId) as HTMLInputElement | null;
  const label = document.getElementById(labelId);
  if (!input || !label) return;
  const sync = () => {
    label.textContent = input.value + suffix;
    // Fill the track to the left of the thumb (see .tama-range gradient).
    const pct = ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
    input.style.setProperty("--slider-fill", `${pct}%`);
  };
  input.addEventListener("input", sync);
  sync(); // initialize fill + label on load
}
