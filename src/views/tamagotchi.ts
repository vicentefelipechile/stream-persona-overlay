// =========================================================================================================
// TAMAGOTCHI VIEW
// =========================================================================================================
// Admin panel view at #/tamagotchi.
// Controls the Tamagotchi system: global ON/OFF, size/speed config,
// enabled-actions pool, manual action trigger, and active pets list.
// =========================================================================================================

import { invoke } from "@tauri-apps/api/core";
import { showToast } from "../state";
import { ActionRegistry } from "../overlay/tamagotchi/core/ActionRegistry";

// Import all actions so ActionRegistry is populated (needed for the panel's action list)
import "../overlay/tamagotchi/actions/IdleWalkAction";
import "../overlay/tamagotchi/actions/JumpAction";
import "../overlay/tamagotchi/actions/PopcornAction";
import "../overlay/tamagotchi/actions/FightAction";
import "../overlay/tamagotchi/actions/ExplodeAction";
import "../overlay/tamagotchi/actions/DanceAction";
import "../overlay/tamagotchi/actions/SleepAction";

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

export async function renderTamagotchi(): Promise<void> {
  const container = document.getElementById("view-container")!;

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
    container.innerHTML = `<div class="empty-state"><span class="empty-state-icon">⚠</span><p>${String(e)}</p></div>`;
    return;
  }

  const enabled         = String(cfg["tama_enabled"])           === "true";
  const petSizePx       = Number(cfg["tama_pet_size_px"])       || 80;
  const maxPets         = Number(cfg["tama_max_pets"])          || 8;
  const walkSpeed       = Number(cfg["tama_walk_speed"])        || 0.6;
  const inactivityMins  = Number(cfg["tama_inactivity_mins"])   || 5;
  const actionCheckSecs = Number(cfg["tama_action_check_secs"]) || 8;
  const actionProb      = Number(cfg["tama_action_probability"])|| 0.15;
  const jumpOnSpeak     = String(cfg["tama_jump_on_speak"])     === "true";

  let enabledActions: string[] = [];
  try {
    enabledActions = JSON.parse(String(cfg["tama_enabled_actions"] ?? "[]"));
  } catch (_) {
    enabledActions = ["jump", "popcorn", "dance", "fight", "explode"];
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
          <h1 class="view-title">Tamagotchi</h1>
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
        <h2 class="section-title">Configuración Global</h2>
      </div>
      <div class="tama-sliders-grid">
        ${_slider("cfg-size",       "cfg-size-val",       "Tamaño mascota",              petSizePx,       "px",   40,   200, 10)}
        ${_slider("cfg-max-pets",   "cfg-max-pets-val",   "Máx. mascotas visibles",       maxPets,         "",     1,    20,  1)}
        ${_slider("cfg-walk",       "cfg-walk-val",       "Velocidad de caminata",        walkSpeed,       "",     0.1,  3,   0.1)}
        ${_slider("cfg-inactivity", "cfg-inactivity-val", "Inactividad antes de dormir",  inactivityMins,  " min", 1,    30,  1)}
        ${_slider("cfg-check",      "cfg-check-val",      "Intervalo acciones aleatorias",actionCheckSecs, "s",    3,    30,  1)}
        ${_slider("cfg-prob",       "cfg-prob-val",       "Probabilidad por intervalo",   actionProb,      "",     0,    1,   0.05)}
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
            <span class="tama-action-check">✓</span>
          </label>
        `).join("")}
      </div>
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
            ${allActionMeta.map(m => `<option value="${m.id}">${m.icon} ${m.label}</option>`).join("")}
          </select>
        </div>
        <button class="btn btn-primary" id="btn-fire">Disparar</button>
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-5);margin-bottom:var(--space-8);">
      <div class="card-header">
        <h2 class="section-title">Mascotas Activas</h2>
        <button class="btn btn-outline btn-sm" id="btn-refresh-pets">↻ Actualizar</button>
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

  _bindRange("cfg-size",       "cfg-size-val",       "px");
  _bindRange("cfg-max-pets",   "cfg-max-pets-val",   "");
  _bindRange("cfg-walk",       "cfg-walk-val",       "");
  _bindRange("cfg-inactivity", "cfg-inactivity-val", " min");
  _bindRange("cfg-check",      "cfg-check-val",      "s");
  _bindRange("cfg-prob",       "cfg-prob-val",       "");

  container.querySelector<HTMLInputElement>("#cfg-jump-on-speak")!.addEventListener("change", (e) => {
    const value = (e.target as HTMLInputElement).checked ? "true" : "false";
    invoke("set_config_cmd", { key: "tama_jump_on_speak", value }).catch(err => showToast(String(err), "error"));
  });

  const sliderMap: Array<[string, string]> = [
    ["cfg-size",       "tama_pet_size_px"],
    ["cfg-max-pets",   "tama_max_pets"],
    ["cfg-walk",       "tama_walk_speed"],
    ["cfg-inactivity", "tama_inactivity_mins"],
    ["cfg-check",      "tama_action_check_secs"],
    ["cfg-prob",       "tama_action_probability"],
  ];
  sliderMap.forEach(([inputId, key]) => {
    container.querySelector<HTMLInputElement>(`#${inputId}`)!.addEventListener("change", (e) => {
      const value = (e.target as HTMLInputElement).value;
      invoke("set_config_cmd", { key, value }).catch(err => showToast(String(err), "error"));
    });
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

function _renderPetsList(pets: PetStateRow[]): string {
  if (!pets.length) {
    return `<p style="color:var(--color-text-muted);font-size:13px;padding:var(--space-4) 0;">No hay mascotas activas en este momento.</p>`;
  }
  return pets.map(p => `
    <div class="tama-pet-row">
      <div class="tama-pet-avatar">🐾</div>
      <div class="tama-pet-info">
        <div class="tama-pet-name">${p.display_name}</div>
        <div class="tama-pet-meta">x: ${Math.round(p.floor_x)}</div>
      </div>
      <span class="badge ${p.is_sleeping ? "badge-warn" : "badge-ok"}">${p.is_sleeping ? "durmiendo" : "activo"}</span>
      <button class="btn btn-danger btn-sm" data-remove-pet="${p.user_id}">Eliminar</button>
    </div>
  `).join("");
}

function _bindRange(inputId: string, labelId: string, suffix: string): void {
  const input = document.getElementById(inputId) as HTMLInputElement | null;
  const label = document.getElementById(labelId);
  if (!input || !label) return;
  input.addEventListener("input", () => { label.textContent = input.value + suffix; });
}
