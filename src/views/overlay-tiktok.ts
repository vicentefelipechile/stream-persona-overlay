// =========================================================================================================
// TIKTOK ALERT OVERLAY VIEW
// =========================================================================================================
// Entry point for overlay-tiktok.html — a dedicated OBS Browser Source that
// renders TikTok event alerts (donation, follow, etc). Independent from the pet
// overlay so it can be positioned/scaled separately in OBS. Uses the WebSocket
// transport (no Tauri APIs) to receive the backend-resolved `tiktok-alert` event.
// =========================================================================================================

import { wsListen, browserConvertFileSrc } from "../overlay/ws-transport";
import { AlertManager } from "../overlay/alerts/AlertManager";
import type { TiktokAlertPayload } from "../overlay/alerts/AlertManager";

window.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("alert-root");
  if (!root) {
    console.error("[overlay-tiktok] #alert-root no encontrado");
    return;
  }

  const manager = new AlertManager(root, browserConvertFileSrc);

  wsListen<TiktokAlertPayload>("tiktok-alert", (event) => {
    manager.enqueue(event.payload);
  }).catch((err) => {
    console.warn("[overlay-tiktok] no se pudo registrar el listener tiktok-alert:", err);
  });

  console.log("[overlay-tiktok] listo — esperando alertas");
});
