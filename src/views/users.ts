// =========================================================================================================
// USERS VIEW
// =========================================================================================================
// Render user management table, handle CRUD actions, and open edit modals.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";

import { AppState, User, showToast } from "../state";

// =========================================================================================================
// Render Function
// =========================================================================================================

export async function renderUsers(): Promise<void> {
  await AppState.loadUsers();
  await AppState.loadVoices();

  const container = document.getElementById("view-container")!;

  container.innerHTML = `
    <div class="view-header">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <h1>👥 Usuarios</h1>
          <p>Gestiona los usuarios registrados y sus personas del overlay.</p>
        </div>
        <span id="user-count" class="badge badge-active">${AppState.users.length} usuario${AppState.users.length !== 1 ? "s" : ""}</span>
      </div>
    </div>

    <div class="card" style="padding:0; overflow:hidden;">
      ${AppState.users.length === 0
        ? `<div class="empty-state">
             <span class="empty-state-icon">👤</span>
             <h3>Sin usuarios registrados</h3>
             <p>Los usuarios se registran usando el bot de Discord con /persona upload-open y /persona set-username.</p>
           </div>`
        : `<table class="users-table" id="users-table">
             <thead>
               <tr>
                 <th>Usuario</th>
                 <th>Twitch</th>
                 <th>TikTok</th>
                 <th>Voz</th>
                 <th>Estado</th>
                 <th>Acciones</th>
               </tr>
             </thead>
             <tbody id="users-tbody">
               ${AppState.users.map(userRow).join("")}
             </tbody>
           </table>`
      }
    </div>
  `;

  // Vincular botones de acciones en la tabla
  bindTableActions(container);
}

function userRow(user: User): string {
  const imgSrc = user.persona
    ? `src="${convertFileSrc(user.persona.mouth_closed_path)}"`
    : "";

  const avatarEl = user.persona
    ? `<img class="avatar-img" ${imgSrc} alt="${user.display_name}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
       <div class="avatar-placeholder" style="display:none;">👤</div>`
    : `<div class="avatar-placeholder">👤</div>`;

  return `
    <tr data-user-id="${user.id}">
      <td>
        <div class="user-avatar">
          ${avatarEl}
          <div>
            <div class="user-name">${escHtml(user.display_name)}</div>
            <div class="user-discord mono">${escHtml(user.discord_id)}</div>
          </div>
        </div>
      </td>
      <td>
        ${user.twitch_username
          ? `<span class="badge badge-twitch">${escHtml(user.twitch_username)}</span>`
          : `<span class="text-muted" style="font-size:12px;">—</span>`}
      </td>
      <td>
        ${user.tiktok_username
          ? `<span class="badge badge-tiktok">${escHtml(user.tiktok_username)}</span>`
          : `<span class="text-muted" style="font-size:12px;">—</span>`}
      </td>
      <td>
        <span class="text-mono" style="font-size:12px; color:var(--color-text-muted);">${escHtml(user.voice_id)}</span>
      </td>
      <td>
        <span class="badge ${user.is_active ? "badge-active" : "badge-inactive"}">
          ${user.is_active ? "Activo" : "Inactivo"}
        </span>
      </td>
      <td class="actions">
        <button class="btn btn-secondary btn-sm btn-edit" data-id="${user.id}" title="Editar">✎</button>
        <button class="btn btn-outline btn-sm btn-preview-user" data-id="${user.id}" title="Preview en overlay">▶</button>
        <button class="btn btn-secondary btn-sm btn-toggle" data-id="${user.id}" title="${user.is_active ? "Desactivar" : "Activar"}">
          ${user.is_active ? "⏸" : "▶"}
        </button>
        <button class="btn btn-danger btn-sm btn-delete" data-id="${user.id}" title="Eliminar">✕</button>
      </td>
    </tr>
  `;
}

function bindTableActions(container: HTMLElement): void {
  // Editar
  container.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number((btn as HTMLElement).dataset.id);
      const user = AppState.users.find((u) => u.id === id);
      if (user) openEditModal(user);
    });
  });

  // Preview
  container.querySelectorAll(".btn-preview-user").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number((btn as HTMLElement).dataset.id);
      const user = AppState.users.find((u) => u.id === id);
      if (!user?.persona) {
        showToast("Este usuario no tiene persona subida aún", "error");
        return;
      }
      try {
        await invoke("send_test_message", {
          displayName: user.display_name,
          mouthOpenPath: user.persona.mouth_open_path,
          mouthClosedPath: user.persona.mouth_closed_path,
        });
        showToast(`Preview de ${user.display_name} enviado al overlay`, "info");
      } catch (e) {
        showToast(String(e), "error");
      }
    });
  });

  // Toggle activo
  container.querySelectorAll(".btn-toggle").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number((btn as HTMLElement).dataset.id);
      try {
        await invoke("toggle_user_active_cmd", { id });
        showToast("Estado actualizado", "success");
        await renderUsers();
      } catch (e) {
        showToast(String(e), "error");
      }
    });
  });

  // Eliminar
  container.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number((btn as HTMLElement).dataset.id);
      const user = AppState.users.find((u) => u.id === id);
      if (!user) return;

      if (!confirm(`¿Eliminar a "${user.display_name}"? Esta acción no se puede deshacer.`)) return;

      try {
        await invoke("delete_user_cmd", { id });
        showToast(`${user.display_name} eliminado`, "success");
        await renderUsers();
      } catch (e) {
        showToast(String(e), "error");
      }
    });
  });
}

// =========================================================================================================
// Edit Modal
// =========================================================================================================
function openEditModal(user: User): void {
  const voices = AppState.voices;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "edit-modal-backdrop";

  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-header">
        <h2 id="modal-title">Editar — ${escHtml(user.display_name)}</h2>
        <button class="modal-close" id="modal-close-btn" aria-label="Cerrar">✕</button>
      </div>

      <div class="form-group">
        <label for="edit-display-name">Nombre mostrado</label>
        <input type="text" id="edit-display-name" value="${escHtml(user.display_name)}" />
      </div>
      <div class="form-group">
        <label for="edit-twitch">Username Twitch</label>
        <input type="text" id="edit-twitch" value="${escHtml(user.twitch_username ?? "")}" placeholder="sin @" />
      </div>
      <div class="form-group">
        <label for="edit-tiktok">Username TikTok</label>
        <input type="text" id="edit-tiktok" value="${escHtml(user.tiktok_username ?? "")}" placeholder="sin @" />
      </div>
      <div class="form-group">
        <label for="edit-voice">Voz TTS</label>
        <select id="edit-voice">
          ${voices.map((v) =>
            `<option value="${escHtml(v.id)}" ${v.id === user.voice_id ? "selected" : ""}>${escHtml(v.name)}</option>`
          ).join("")}
        </select>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" id="modal-cancel-btn">Cancelar</button>
        <button class="btn btn-primary" id="modal-save-btn">Guardar cambios</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const closeModal = () => backdrop.remove();

  backdrop.querySelector("#modal-close-btn")!.addEventListener("click", closeModal);
  backdrop.querySelector("#modal-cancel-btn")!.addEventListener("click", closeModal);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });

  backdrop.querySelector("#modal-save-btn")!.addEventListener("click", async () => {
    const displayName    = (backdrop.querySelector<HTMLInputElement>("#edit-display-name")!).value.trim();
    const twitchUsername = (backdrop.querySelector<HTMLInputElement>("#edit-twitch")!).value.trim() || null;
    const tiktokUsername = (backdrop.querySelector<HTMLInputElement>("#edit-tiktok")!).value.trim() || null;
    const voiceId        = (backdrop.querySelector<HTMLSelectElement>("#edit-voice")!).value;

    try {
      await invoke("update_user_cmd", {
        user: { id: user.id, display_name: displayName, twitch_username: twitchUsername, tiktok_username: tiktokUsername, voice_id: voiceId },
      });
      showToast("Usuario actualizado", "success");
      closeModal();
      await renderUsers();
    } catch (e) {
      showToast(String(e), "error");
    }
  });
}

// =========================================================================================================
// Helpers
// =========================================================================================================
function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
