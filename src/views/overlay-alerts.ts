// =========================================================================================================
// EVENT ALERT OVERLAY VIEW
// =========================================================================================================
// Entry point for overlay-alerts.html — a dedicated OBS Browser Source that
// renders event alerts for both Twitch (cheer/sub/raid/follow) and TikTok
// (donation, follow, etc). Independent from the pet overlay so it can be
// positioned/scaled separately in OBS. Uses the WebSocket transport (no Tauri
// APIs) to receive the backend-resolved `event-alert` event.
// =========================================================================================================

import { wsListen, browserConvertFileSrc } from "../overlay/ws-transport";
import { AlertManager } from "../overlay/alerts/AlertManager";
import type { EventAlertPayload } from "../overlay/alerts/AlertManager";
import { initOverlayNotifications } from "../overlay/overlay-notifications";

window.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("alert-root");
  if (!root) {
    console.error("[overlay-alerts] #alert-root no encontrado");
    return;
  }

  const manager = new AlertManager(root, browserConvertFileSrc);

  wsListen<EventAlertPayload>("event-alert", (event) => {
    manager.enqueue(event.payload);
  }).catch((err) => {
    console.warn("[overlay-alerts] no se pudo registrar el listener event-alert:", err);
  });

  // Surface connection notices (e.g. TikTok connected / connection lost) on-overlay.
  initOverlayNotifications(wsListen);

  console.log("[overlay-alerts] listo — esperando alertas");
});
