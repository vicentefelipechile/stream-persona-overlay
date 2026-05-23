// =========================================================================================================
// LOGS VIEW
// =========================================================================================================
// Audit log of recent chat messages and events from Twitch and TikTok, including dropped/blocked entries.
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
          <p>Historial de mensajes recibidos de Twitch y TikTok (últimos 200).</p>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button id="btn-refresh-logs" class="btn btn-secondary btn-sm" style="display:inline-flex;align-items:center;gap:4px;">${Icons.refresh()} Refrescar</button>
          <button id="btn-clear-filter"   class="btn btn-secondary btn-sm log-filter-btn active" data-filter="">Todos</button>
          <button id="btn-filter-shown"   class="btn btn-secondary btn-sm log-filter-btn" data-filter="shown">Mostrados</button>
          <button id="btn-filter-blocked" class="btn btn-secondary btn-sm log-filter-btn" data-filter="blocked" style="color:#ff6b6b;border-color:#ff6b6b;">Bloqueados</button>
          <button id="btn-filter-twitch"  class="btn btn-secondary btn-sm log-filter-btn" style="display:inline-flex;align-items:center;gap:4px;color:#9146ff;border-color:#9146ff;" data-filter="twitch">${Icons.twitchMono()} Twitch</button>
          <button id="btn-filter-tiktok"  class="btn btn-secondary btn-sm log-filter-btn" style="display:inline-flex;align-items:center;gap:4px;color:#ff0050;border-color:#ff0050;" data-filter="tiktok">${Icons.tiktokMono()} TikTok</button>
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

  let currentFilter = "";
  let allLogs: LogEntry[] = [];

  const renderFiltered = () => {
    let filtered = allLogs;
    if (currentFilter === "shown")   filtered = allLogs.filter(l => !l.dropped_reason);
    else if (currentFilter === "blocked") filtered = allLogs.filter(l => !!l.dropped_reason);
    else if (currentFilter === "twitch") filtered = allLogs.filter(l => l.platform === "twitch");
    else if (currentFilter === "tiktok") filtered = allLogs.filter(l => l.platform === "tiktok");

    const content = container.querySelector<HTMLElement>("#logs-content")!;
    if (filtered.length === 0) {
      content.innerHTML = `
        <div class="empty-state" style="padding:40px;">
          <span class="empty-state-icon">${Icons.logs(48)}</span>
          <p>Sin mensajes${currentFilter ? ` (filtro: ${currentFilter})` : ""} aún.</p>
        </div>
      `;
    } else {
      content.innerHTML = filtered.map(logEntryHtml).join("");
    }
    content.style.display = "flex";
  };

  const loadLogs = async () => {
    const loading = container.querySelector<HTMLElement>("#logs-loading")!;
    const content = container.querySelector<HTMLElement>("#logs-content")!;
    loading.style.display = "flex";
    content.style.display = "none";
    try {
      allLogs = await invoke<LogEntry[]>("get_recent_logs_cmd", { limit: 200 });
      renderFiltered();
    } catch (e) {
      showToast("Error cargando logs: " + String(e), "error");
    } finally {
      loading.style.display = "none";
    }
  };

  container.querySelector("#btn-refresh-logs")!.addEventListener("click", loadLogs);

  container.querySelectorAll<HTMLButtonElement>(".log-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".log-filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter ?? "";
      renderFiltered();
    });
  });

  await loadLogs();
}

// =========================================================================================================
// Helpers
// =========================================================================================================

const DROP_REASON_LABELS: Record<string, string> = {
  cooldown:    "cooldown",
  duplicate:   "duplicado",
  rate_window: "límite/seg",
  global_rate: "tope global",
};

function logEntryHtml(log: LogEntry): string {
  const date = new Date(log.created_at + "Z");
  const time = date.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  const platformIcon =
    log.platform === "twitch" ? Icons.twitchMono(11) :
    log.platform === "tiktok" ? Icons.tiktokMono(11) :
    "";

  const blockedBadge = log.dropped_reason
    ? `<span class="log-dropped-badge" title="${log.dropped_reason}">${DROP_REASON_LABELS[log.dropped_reason] ?? log.dropped_reason}</span>`
    : "";

  return `
    <div class="log-entry log-entry--${log.platform}${log.dropped_reason ? " log-entry--blocked" : ""}">
      <span class="log-time">${time}</span>
      <span class="log-platform ${log.platform}">${platformIcon}${log.platform}</span>
      <span class="log-username">${escHtml(log.username)}</span>
      <span class="log-message">${escHtml(log.message)}</span>
      ${blockedBadge}
    </div>
  `;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
