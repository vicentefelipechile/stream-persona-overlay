// =========================================================================================================
// LOGS VIEW
// =========================================================================================================
// Render message history from chat platforms.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { invoke } from "@tauri-apps/api/core";
import { LogEntry, showToast } from "../state";
import { Icons } from "../icons";

// =========================================================================================================
// Render Function
// =========================================================================================================

export async function renderLogs(): Promise<void> {
  const container = document.getElementById("view-container")!;

  container.innerHTML = `
    <div class="view-header">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <h1>${Icons.logs(20)} Logs</h1>
          <p>Historial de mensajes recibidos de Twitch y TikTok (últimos 100).</p>
        </div>
        <div style="display:flex; gap:8px;">
          <button id="btn-refresh-logs" class="btn btn-secondary btn-sm" style="display:inline-flex;align-items:center;gap:4px;">${Icons.refresh()} Refrescar</button>
          <button id="btn-clear-filter" class="btn btn-secondary btn-sm">Todos</button>
          <button id="btn-filter-twitch" class="btn btn-secondary btn-sm" style="display:inline-flex;align-items:center;gap:4px;color:#9146ff;border-color:#9146ff;">${Icons.twitchMono()} Twitch</button>
          <button id="btn-filter-tiktok" class="btn btn-secondary btn-sm" style="display:inline-flex;align-items:center;gap:4px;color:#ff0050;border-color:#ff0050;">${Icons.tiktokMono()} TikTok</button>
        </div>
      </div>
    </div>

    <div class="card" style="padding: 0; overflow:hidden;">
      <div id="logs-loading" class="loading-state" style="height:120px;">
        <div class="spinner"></div>
      </div>
      <div id="logs-content" class="log-list" style="padding: 8px 0; display:none; max-height:600px; overflow-y:auto;"></div>
    </div>
  `;

  await loadLogs(container, null);

  // Refrescar
  container.querySelector("#btn-refresh-logs")!.addEventListener("click", async () => {
    await loadLogs(container, currentFilter);
  });

  // Filtros
  let currentFilter: string | null = null;

  container.querySelector("#btn-clear-filter")!.addEventListener("click", async () => {
    currentFilter = null;
    await loadLogs(container, null);
  });
  container.querySelector("#btn-filter-twitch")!.addEventListener("click", async () => {
    currentFilter = "twitch";
    await loadLogs(container, "twitch");
  });
  container.querySelector("#btn-filter-tiktok")!.addEventListener("click", async () => {
    currentFilter = "tiktok";
    await loadLogs(container, "tiktok");
  });
}

async function loadLogs(container: HTMLElement, filter: string | null): Promise<void> {
  const loading = container.querySelector<HTMLElement>("#logs-loading")!;
  const content = container.querySelector<HTMLElement>("#logs-content")!;

  loading.style.display = "flex";
  content.style.display = "none";

  try {
    const logs = await invoke<LogEntry[]>("get_recent_logs_cmd", { limit: 100 });
    const filtered = filter ? logs.filter((l) => l.platform === filter) : logs;

    if (filtered.length === 0) {
      loading.style.display = "none";
      content.style.display = "flex";
      content.innerHTML = `
        <div class="empty-state" style="padding:40px;">
          <span class="empty-state-icon">${Icons.logs(48)}</span>
          <p>Sin mensajes${filter ? ` de ${filter}` : ""} aún.</p>
        </div>
      `;
      return;
    }

    content.innerHTML = filtered.map(logEntryHtml).join("");
    loading.style.display = "none";
    content.style.display = "flex";
  } catch (e) {
    showToast("Error cargando logs: " + String(e), "error");
    loading.style.display = "none";
  }
}

function logEntryHtml(log: LogEntry): string {
  const date = new Date(log.created_at + "Z");
  const time = date.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  const platformIcon =
    log.platform === "twitch" ? Icons.twitchMono(11) :
    log.platform === "tiktok" ? Icons.tiktokMono(11) :
    "";

  return `
    <div class="log-entry log-entry--${log.platform}">
      <span class="log-time">${time}</span>
      <span class="log-platform ${log.platform}">${platformIcon}${log.platform}</span>
      <span class="log-username">${escHtml(log.username)}</span>
      <span class="log-message">${escHtml(log.message)}</span>
    </div>
  `;
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
