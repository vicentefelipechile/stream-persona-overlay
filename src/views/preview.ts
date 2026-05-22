// =========================================================================================================
// PREVIEW VIEW
// =========================================================================================================
// Render overlay preview, chroma key settings, and test messages.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

import { AppState, ChatMessagePayload, showToast } from "../state";

// =========================================================================================================
// Render Function
// =========================================================================================================

let unlistenChatMessage: UnlistenFn | null = null;

export async function renderPreview(): Promise<void> {
  await AppState.loadConfig();
  const cfg = AppState.config;

  const container = document.getElementById("view-container")!;
  container.innerHTML = `
    <div class="view-header">
      <h1>▶ Preview del Overlay</h1>
      <p>Previsualiza cómo se verá el overlay en OBS. Envía mensajes de prueba para probar la animación.</p>
    </div>

    <div class="section">
      <div class="section-title">Controles</div>
      <div class="card" style="display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap;">
        <div class="form-group" style="margin:0; flex:1; min-width:160px;">
          <label for="preview-select-user">Usuario</label>
          <select id="preview-select-user">
            ${AppState.users
              .filter((u) => u.persona)
              .map((u) => `<option value="${u.id}">${u.display_name}</option>`)
              .join("") || `<option disabled selected>Sin usuarios con persona</option>`}
          </select>
        </div>
        <div class="form-group" style="margin:0; flex:2; min-width:200px;">
          <label for="preview-message">Mensaje de prueba</label>
          <input type="text" id="preview-message" value="Hola! 👋 ¿Cómo está el stream?" />
        </div>
        <button id="btn-preview-send" class="btn btn-primary">Enviar al Overlay ▶</button>
        <button id="btn-toggle-overlay-preview" class="btn btn-outline">Mostrar Ventana</button>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Color chroma key</div>
      <div class="card" style="display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap;">
        <div class="form-group" style="margin:0;">
          <label for="preview-chroma">Color</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input type="color" id="preview-chroma" value="${cfg.chroma_color}" style="width:60px;height:36px;" />
            <input type="text" id="preview-chroma-text" value="${cfg.chroma_color}" style="width:90px; font-family:var(--font-mono);" maxlength="7" />
          </div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          ${["#00FF00","#0000FF","#FF00FF","#000000"].map((c) =>
            `<button class="btn btn-secondary btn-sm preset-chroma" data-color="${c}"
              style="background:${c}; border-color:${c}; color:${c === "#000000" ? "#fff" : "#000"}; min-width:32px;">
            </button>`
          ).join("")}
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Previsualización (simulada)</div>
      <div class="preview-container" id="preview-box"
        style="background:${cfg.chroma_color}; min-height:300px; display:flex; align-items:flex-end; justify-content:center; gap:24px; padding:20px;">
        <div class="empty-state" style="color:rgba(0,0,0,0.4);">
          <span style="font-size:36px;">👤</span>
          <p style="color:inherit;">Envía un mensaje para ver la persona aquí</p>
        </div>
      </div>
    </div>
  `;

  // Sync color inputs
  const chromaInput = container.querySelector<HTMLInputElement>("#preview-chroma")!;
  const chromaText  = container.querySelector<HTMLInputElement>("#preview-chroma-text")!;
  const previewBox  = container.querySelector<HTMLElement>("#preview-box")!;

  let chromaDebounce: ReturnType<typeof setTimeout> | null = null;
  function applyChroma(color: string): void {
    if (chromaDebounce) clearTimeout(chromaDebounce);
    chromaDebounce = setTimeout(() => {
      invoke("set_chroma_color", { color }).catch(e => showToast(String(e), "error"));
    }, 150);
  }

  chromaInput.addEventListener("input", () => {
    chromaText.value = chromaInput.value;
    previewBox.style.background = chromaInput.value;
    applyChroma(chromaInput.value);
  });
  chromaText.addEventListener("input", () => {
    if (/^#[0-9a-fA-F]{6}$/.test(chromaText.value)) {
      chromaInput.value = chromaText.value;
      previewBox.style.background = chromaText.value;
      applyChroma(chromaText.value);
    }
  });

  // Presets
  container.querySelectorAll(".preset-chroma").forEach((btn) => {
    btn.addEventListener("click", () => {
      const color = (btn as HTMLElement).dataset.color!;
      chromaInput.value = color;
      chromaText.value  = color;
      previewBox.style.background = color;
      invoke("set_chroma_color", { color }).catch(e => showToast(String(e), "error"));
    });
  });

  // Toggle ventana overlay
  container.querySelector("#btn-toggle-overlay-preview")!.addEventListener("click", async () => {
    try {
      await invoke("toggle_overlay");
    } catch (e) {
      showToast(String(e), "error");
    }
  });

  // Enviar mensaje de prueba
  container.querySelector("#btn-preview-send")!.addEventListener("click", async () => {
    const userId  = Number((container.querySelector<HTMLSelectElement>("#preview-select-user")!).value);
    const message = (container.querySelector<HTMLInputElement>("#preview-message")!).value;
    const user    = AppState.users.find((u) => u.id === userId);

    if (!user?.persona) {
      showToast("Selecciona un usuario con persona subida", "error");
      return;
    }

    // Preview simulado local
    renderPreviewPersona(previewBox, {
      platform: "test",
      username: user.display_name,
      message,
      user_id: user.id,
      display_name: user.display_name,
      mouth_open_path: user.persona.mouth_open_path,
      mouth_closed_path: user.persona.mouth_closed_path,
      voice_id: user.voice_id,
    });

    // También enviar al overlay real
    try {
      await invoke("send_test_message", {
        displayName: user.display_name,
        mouthOpenPath: user.persona.mouth_open_path,
        mouthClosedPath: user.persona.mouth_closed_path,
      });
    } catch (_) { /* overlay puede no estar visible */ }
  });

  // Limpiar listener anterior si existe
  if (unlistenChatMessage) {
    unlistenChatMessage();
    unlistenChatMessage = null;
  }

  // Escuchar mensajes reales para mostrar en preview
  unlistenChatMessage = await listen<ChatMessagePayload>("chat-message", (event) => {
    renderPreviewPersona(previewBox, event.payload);
  });
}

// =========================================================================================================
// Render Preview Persona
// =========================================================================================================
function renderPreviewPersona(
  box: HTMLElement,
  payload: ChatMessagePayload
): void {
  // Limpiar estado vacío
  const emptyState = box.querySelector(".empty-state");
  emptyState?.remove();

  const id = `preview-persona-${payload.user_id}`;
  let bubble = box.querySelector<HTMLElement>(`#${id}`);

  if (!bubble) {
    bubble = document.createElement("div");
    bubble.id = id;
    bubble.className = "persona-bubble";
    bubble.innerHTML = `
      <img class="persona-img" src="" alt="${payload.display_name}" />
      <span class="persona-name">${payload.display_name}</span>
      <span class="persona-message"></span>
    `;
    box.appendChild(bubble);
  }

  const img = bubble.querySelector<HTMLImageElement>(".persona-img")!;
  const msgEl = bubble.querySelector<HTMLElement>(".persona-message")!;

  msgEl.textContent = payload.message;

  // Animación boca: open → closed
  // Las rutas son del OS — convertFileSrc() las transforma al protocolo asset:// que Tauri puede servir
  img.src = convertFileSrc(payload.mouth_open_path);
  setTimeout(() => { img.src = convertFileSrc(payload.mouth_closed_path); }, 300);

  // Auto-remover después de 5s
  bubble.classList.remove("exiting");
  clearTimeout((bubble as any)._exitTimer);
  (bubble as any)._exitTimer = setTimeout(() => {
    bubble!.classList.add("exiting");
    setTimeout(() => bubble!.remove(), 400);
  }, 5000);
}
