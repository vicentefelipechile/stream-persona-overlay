// =========================================================================================================
// MAIN ENTRY POINT
// =========================================================================================================
// Entry point for the streamer admin panel (index.html).
// Initializes the router and handles global Tauri events.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { AppState, showToast } from "./state";
import { initRouter } from "./router";

// =========================================================================================================
// Initialization
// =========================================================================================================

window.addEventListener("DOMContentLoaded", async () => {
  // Cargar datos iniciales
  await Promise.all([
    AppState.loadConfig(),
    AppState.loadUsers(),
    AppState.loadVoices(),
  ]);

  // Inicializar router (renderiza la vista inicial)
  initRouter();

  // Botón toggle overlay
  const btnOverlay = document.getElementById("btn-toggle-overlay");
  btnOverlay?.addEventListener("click", async () => {
    try {
      await invoke("toggle_overlay");
    } catch (e) {
      console.error("Error toggling overlay:", e);
    }
  });

  // ── Twitch ──────────────────────────────────────────────────────────────────
  await listen<string>("twitch-connected", (event) => {
    const channel = event.payload;
    updateConnectionStatus(true, `Twitch: @${channel}`);
    showToast(`✓ Conectado a @${channel}`, "success");
  });

  await listen<string>("twitch-error", (event) => {
    updateConnectionStatus(false, "Twitch: error");
    showToast(`✗ Twitch: ${event.payload}`, "error");
  });

  const shownUnregistered = new Set<string>();
  await listen<string>("twitch-unregistered-user", (event) => {
    const username = event.payload;
    if (shownUnregistered.has(username)) return;
    shownUnregistered.add(username);
    showToast(`@${username} escribió pero no está registrado — ignorando`, "info");
  });

  // ── TikTok ──────────────────────────────────────────────────────────────────
  await listen<string>("tiktok-connected", (event) => {
    updateConnectionStatus(true, `TikTok: @${event.payload}`);
    showToast(`✓ Conectado a @${event.payload}`, "success");
  });

  // ── Discord ─────────────────────────────────────────────────────────────────
  await listen<string>("discord-ready", (event) => {
    showToast(`✓ Bot de Discord listo (@${event.payload})`, "success");
  });

  await listen<string>("discord-error", (event) => {
    showToast(`✗ Discord: ${event.payload}`, "error");
  });
});

// =========================================================================================================
// Helpers
// =========================================================================================================

function updateConnectionStatus(connected: boolean, label: string): void {
  const indicator = document.getElementById("connection-status");
  const statusText = indicator?.querySelector(".status-text");

  if (indicator) {
    indicator.classList.toggle("connected", connected);
  }
  if (statusText) {
    statusText.textContent = label;
  }
}
