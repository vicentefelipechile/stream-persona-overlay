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

  const enabled          = String(cfg["tama_enabled"])           === "true";
  const petSizePx        = Number(cfg["tama_pet_size_px"])       || 80;
  const maxPets          = Number(cfg["tama_max_pets"])          || 8;
  const walkSpeed        = Number(cfg["tama_walk_speed"])        || 0.6;
  const inactivityMins   = Number(cfg["tama_inactivity_mins"])   || 5;
  const actionCheckSecs  = Number(cfg["tama_action_check_secs"]) || 8;
  const actionProb       = Number(cfg["tama_action_probability"])|| 0.15;

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
      <h1 class="view-title">Tamagotchi</h1>
      <p class="view-subtitle">Mascotas persistentes de los usuarios del chat</p>
    </div>

    <div class="tama-section card">
      <div class="tama-row-header">
        <h2 class="section-title">Sistema Tamagotchi</h2>
        <div style="display:flex;align-items:center;gap:10px;">
          <span id="tama-status-text" style="font-size:13px;color:${enabled ? "var(--color-success)" : "var(--color-text-muted)"};">${enabled ? "Activo" : "Inactivo"}</span>
          <label class="switch">
            <input type="checkbox" id="tama-enabled" ${enabled ? "checked" : ""}/>
            <span class="switch-track"></span>
          </label>
        </div>
      </div>
    </div>

    <div class="tama-grid">

      <div class="card">
        <h2 class="section-title">Configuración Global</h2>
        <div class="form-group">
          <label>Tamaño mascota (px)</label>
          <div class="range-row">
            <input type="range" id="cfg-size" min="40" max="200" step="10" value="${petSizePx}"/>
            <span id="cfg-size-val">${petSizePx}px</span>
          </div>
        </div>
        <div class="form-group">
          <label>Máx. mascotas visibles</label>
          <div class="range-row">
            <input type="range" id="cfg-max-pets" min="1" max="20" value="${maxPets}"/>
            <span id="cfg-max-pets-val">${maxPets}</span>
          </div>
        </div>
        <div class="form-group">
          <label>Velocidad de caminata (px/frame)</label>
          <div class="range-row">
            <input type="range" id="cfg-walk" min="0.1" max="3" step="0.1" value="${walkSpeed}"/>
            <span id="cfg-walk-val">${walkSpeed}</span>
          </div>
        </div>
        <div class="form-group">
          <label>Inactividad antes de dormir (min)</label>
          <div class="range-row">
            <input type="range" id="cfg-inactivity" min="1" max="30" value="${inactivityMins}"/>
            <span id="cfg-inactivity-val">${inactivityMins} min</span>
          </div>
        </div>
        <div class="form-group">
          <label>Intervalo de acciones aleatorias (seg)</label>
          <div class="range-row">
            <input type="range" id="cfg-check" min="3" max="30" value="${actionCheckSecs}"/>
            <span id="cfg-check-val">${actionCheckSecs}s</span>
          </div>
        </div>
        <div class="form-group">
          <label>Probabilidad por check (0–1)</label>
          <div class="range-row">
            <input type="range" id="cfg-prob" min="0" max="1" step="0.05" value="${actionProb}"/>
            <span id="cfg-prob-val">${actionProb}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <h2 class="section-title">Acciones habilitadas (pool aleatorio)</h2>
        <div id="action-toggles">
          ${allActionMeta.map(m => `
            <label class="action-toggle-row" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
              <input type="checkbox" class="action-checkbox" data-id="${m.id}" ${enabledActions.includes(m.id) ? "checked" : ""}/>
              <span style="font-size:16px;">${m.icon}</span>
              <span style="flex:1;">${m.label}</span>
              <span style="font-size:11px;color:var(--text-muted)">${m.description}</span>
            </label>
          `).join("")}
        </div>
      </div>

    </div>

    <div class="card" style="margin-top:16px;">
      <h2 class="section-title">Disparar Acción Manual</h2>
      <div class="tama-fire-row">
        <div class="form-group" style="flex:1;">
          <label>Usuario</label>
          <select id="fire-user" class="input-field">
            <option value="">-- Seleccionar usuario --</option>
            ${activeUsers.map(u => `<option value="${u.id}">${u.display_name}</option>`).join("")}
          </select>
        </div>
        <div class="form-group" style="flex:1;">
          <label>Acción</label>
          <select id="fire-action" class="input-field">
            <option value="">-- Seleccionar acción --</option>
            ${allActionMeta.map(m => `<option value="${m.id}">${m.icon} ${m.label}</option>`).join("")}
          </select>
        </div>
        <button class="btn btn-primary" id="btn-fire" style="align-self:flex-end;">Disparar</button>
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <h2 class="section-title" style="margin:0;">Mascotas Activas</h2>
        <button class="btn btn-outline btn-sm" id="btn-refresh-pets">Actualizar</button>
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
      statusEl.style.color = tamaToggle.checked ? "var(--color-success)" : "var(--color-text-muted)";
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

  // Auto-save each slider on release
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

  // Auto-save action checkboxes on toggle
  container.querySelector("#action-toggles")!.addEventListener("change", () => {
    const checked = Array.from(
      container.querySelectorAll<HTMLInputElement>(".action-checkbox:checked")
    ).map(el => el.dataset["id"]!);
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

  // Delegate remove-pet button clicks
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

function _renderPetsList(pets: PetStateRow[]): string {
  if (!pets.length) {
    return `<p style="color:var(--text-muted);font-size:13px;">No hay mascotas activas en este momento.</p>`;
  }
  return pets.map(p => `
    <div class="pet-row" style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
      <span style="flex:1;font-weight:500;">${p.display_name}</span>
      <span class="badge ${p.is_sleeping ? "badge-warn" : "badge-ok"}">${p.is_sleeping ? "durmiendo" : "activo"}</span>
      <span style="font-size:11px;color:var(--text-muted);">x:${Math.round(p.floor_x)}</span>
      <button class="btn btn-outline btn-sm" style="color:#e05252;border-color:#e05252;" data-remove-pet="${p.user_id}">Eliminar</button>
    </div>
  `).join("");
}

function _bindRange(inputId: string, labelId: string, suffix: string): void {
  const input = document.getElementById(inputId) as HTMLInputElement | null;
  const label = document.getElementById(labelId);
  if (!input || !label) return;
  input.addEventListener("input", () => { label.textContent = input.value + suffix; });
}
