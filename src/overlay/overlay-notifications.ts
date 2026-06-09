// =========================================================================================================
// OVERLAY NOTIFICATIONS
// =========================================================================================================
// Transient on-overlay toasts for connection status (mainly TikTok connect / lost
// connection). The streamer usually watches the overlay, not the admin panel, so a
// silent backend disconnect would otherwise go unnoticed. Rendered self-contained
// (own <style>, own container) so it works in every overlay regardless of which CSS
// bundle that page loads, under both the Tauri (`listen`) and WS (`wsListen`) transports.
// =========================================================================================================

// =========================================================================================================
// Types
// =========================================================================================================

export type OverlayNoticeLevel = "success" | "error" | "info";

export interface OverlayNotificationPayload {
  level:   OverlayNoticeLevel;
  message: string;
}

// Matches both Tauri's listen() and ws-transport's wsListen(): each resolves to an
// unlisten fn and delivers an event object exposing `.payload`.
type ListenFn = <T>(event: string, handler: (e: { payload: T }) => void) => Promise<unknown>;

// =========================================================================================================
// Rendering
// =========================================================================================================

const LEVEL_COLOR: Record<OverlayNoticeLevel, string> = {
  success: "#2ee6a6",
  error:   "#ff5c5c",
  info:    "#5c9dff",
};

const DISMISS_MS = 6000;

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (container) return container;

  // One-time stylesheet so the fade/slide animation works on every overlay page.
  const style = document.createElement("style");
  style.textContent = `
    #overlay-notice-container {
      position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
      display: flex; flex-direction: column; gap: 8px; align-items: center;
      z-index: 2147483647; pointer-events: none;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    .overlay-notice {
      padding: 8px 16px; border-radius: 10px; font-size: 14px; font-weight: 600;
      color: #fff; background: rgba(15, 17, 23, 0.92);
      border: 1px solid var(--overlay-notice-color, #5c9dff);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
      max-width: 80vw; text-align: center; white-space: nowrap;
      opacity: 0; transform: translateY(-8px);
      transition: opacity 0.25s ease, transform 0.25s ease;
    }
    .overlay-notice.is-visible { opacity: 1; transform: translateY(0); }
    .overlay-notice::before {
      content: ""; display: inline-block; width: 8px; height: 8px;
      margin-right: 8px; border-radius: 50%; vertical-align: middle;
      background: var(--overlay-notice-color, #5c9dff);
    }
  `;
  document.head.appendChild(style);

  container = document.createElement("div");
  container.id = "overlay-notice-container";
  document.body.appendChild(container);
  return container;
}

/** Renders a single transient notice that auto-dismisses after a few seconds. */
export function showOverlayNotification(message: string, level: OverlayNoticeLevel = "info"): void {
  const root = ensureContainer();

  const notice = document.createElement("div");
  notice.className = "overlay-notice";
  notice.style.setProperty("--overlay-notice-color", LEVEL_COLOR[level] ?? LEVEL_COLOR.info);
  notice.textContent = message;
  root.appendChild(notice);

  // Next frame: flip to visible so the enter transition runs.
  requestAnimationFrame(() => notice.classList.add("is-visible"));

  window.setTimeout(() => {
    notice.classList.remove("is-visible");
    window.setTimeout(() => notice.remove(), 300);
  }, DISMISS_MS);
}

// =========================================================================================================
// Wiring
// =========================================================================================================

/** Subscribes to the backend `overlay-notification` event using whichever transport
 *  (Tauri `listen` or WS `wsListen`) the host overlay already uses. */
export function initOverlayNotifications(listen: ListenFn): void {
  listen<OverlayNotificationPayload>("overlay-notification", (e) => {
    const p = e.payload;
    if (p && typeof p.message === "string") {
      showOverlayNotification(p.message, p.level ?? "info");
    }
  }).catch((err) => console.warn("[overlay] no se pudo registrar overlay-notification:", err));
}
