// =========================================================================================================
// ROUTER
// =========================================================================================================
// Hash-based view router. Views are rendered ONCE into their own persistent pane
// and then kept alive in the DOM — navigating only toggles which pane is visible.
//
// This is deliberate: it's a local desktop app, so there is no "loading" state and
// no full re-render on navigation. Switching views (or returning to one) preserves
// scroll position, form state, collapsed cards, live listeners, etc. A view is only
// rendered the first time it is shown (lazy); after that it is simply re-shown.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { renderConfig } from "./views/config";
import { renderUsers } from "./views/users";
import { renderLogs } from "./views/logs";
import { renderTamagotchi } from "./views/tamagotchi";
import { renderTwitch } from "./views/twitch";
import { renderTiktok } from "./views/tiktok";
import { renderEventos } from "./views/eventos";
import { renderStreamer } from "./views/streamer";

// =========================================================================================================
// Types & Configuration
// =========================================================================================================

export type ViewId = "config" | "users" | "logs" | "tamagotchi" | "twitch" | "tiktok" | "eventos" | "streamer";

/** A view renderer paints its content into the given pane element. */
type ViewRenderer = (pane: HTMLElement) => Promise<void>;

const routes: Record<ViewId, ViewRenderer> = {
  config:     renderConfig,
  users:      renderUsers,
  logs:       renderLogs,
  tamagotchi: renderTamagotchi,
  twitch:     renderTwitch,
  tiktok:     renderTiktok,
  eventos:    renderEventos,
  streamer:   renderStreamer,
};

// =========================================================================================================
// Class: ViewRouter
// =========================================================================================================

class ViewRouter {
  private current: ViewId = "config";
  private container: HTMLElement;
  private navLinks: NodeListOf<Element>;
  /** One persistent pane per view (created lazily). */
  private panes = new Map<ViewId, HTMLElement>();
  /** Views that have already been rendered at least once. */
  private rendered = new Set<ViewId>();

  constructor() {
    this.container = document.getElementById("view-container")!;
    this.navLinks  = document.querySelectorAll(".nav-link");

    // Vincular links de navegación
    this.navLinks.forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const view = (link as HTMLElement).dataset.view as ViewId;
        if (view) void this.navigate(view);
      });
    });

    // Leer hash inicial
    const hash = window.location.hash.replace("#/", "") as ViewId;
    const initialView = hash in routes ? hash : "config";
    void this.navigate(initialView);

    // Escuchar cambios de hash (e.g. <a href="#/twitch">)
    window.addEventListener("hashchange", () => {
      const view = window.location.hash.replace("#/", "") as ViewId;
      if (view in routes && view !== this.current) void this.navigate(view);
    });
  }

  /** Returns the persistent pane for `view`, creating it on first use. */
  private paneFor(view: ViewId): HTMLElement {
    let pane = this.panes.get(view);
    if (!pane) {
      pane = document.createElement("div");
      pane.className = "view-pane";
      pane.dataset.view = view;
      pane.style.display = "none";
      this.container.appendChild(pane);
      this.panes.set(view, pane);
    }
    return pane;
  }

  async navigate(view: ViewId): Promise<void> {
    if (!(view in routes)) return;

    const pane = this.paneFor(view);

    // Hide the previously active pane, show the target one. No re-render, no
    // "loading" flash — the pane keeps its DOM, scroll and listeners.
    const prev = this.panes.get(this.current);
    if (prev && prev !== pane) prev.style.display = "none";
    pane.style.display = "";

    this.current = view;
    window.location.hash = `/${view}`;

    // Actualizar clases active en sidebar
    this.navLinks.forEach((link) => {
      const linkView = (link as HTMLElement).dataset.view;
      link.classList.toggle("active", linkView === view);
    });

    // Render only the first time this view is shown.
    if (this.rendered.has(view)) return;
    this.rendered.add(view);

    try {
      await routes[view](pane);
    } catch (err) {
      console.error(`Error renderizando vista "${view}":`, err);
      // Allow a later retry if the first render threw.
      this.rendered.delete(view);
      pane.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon">⚠</span>
          <h3>Error al cargar la vista</h3>
          <p>${String(err)}</p>
        </div>
      `;
    }
  }

  /** Force a fresh render of `view` on its next show (used after connection
   *  changes that alter banners/badges). If it's the current view, re-renders now. */
  invalidate(view: ViewId): void {
    this.rendered.delete(view);
    if (view === this.current) {
      const pane = this.panes.get(view);
      if (pane) {
        pane.innerHTML = "";
        this.rendered.add(view);
        void routes[view](pane).catch((err) => {
          console.error(`Error re-renderizando vista "${view}":`, err);
          this.rendered.delete(view);
        });
      }
    }
  }

  getCurrent(): ViewId {
    return this.current;
  }
}

// =========================================================================================================
// Exports
// =========================================================================================================

export let router: ViewRouter;

export function initRouter(): void {
  router = new ViewRouter();
}
