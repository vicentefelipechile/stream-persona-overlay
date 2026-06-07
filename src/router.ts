// =========================================================================================================
// ROUTER
// =========================================================================================================
// Hash-based view router for the application.
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

// =========================================================================================================
// Types & Configuration
// =========================================================================================================

export type ViewId = "config" | "users" | "logs" | "tamagotchi" | "twitch" | "tiktok" | "eventos";

type ViewRenderer = () => Promise<void>;

const routes: Record<ViewId, ViewRenderer> = {
  config:     renderConfig,
  users:      renderUsers,
  logs:       renderLogs,
  tamagotchi: renderTamagotchi,
  twitch:     renderTwitch,
  tiktok:     renderTiktok,
  eventos:    renderEventos,
};

// =========================================================================================================
// Class: ViewRouter
// =========================================================================================================

class ViewRouter {
  private current: ViewId = "config";
  private container: HTMLElement;
  private navLinks: NodeListOf<Element>;

  constructor() {
    this.container = document.getElementById("view-container")!;
    this.navLinks  = document.querySelectorAll(".nav-link");

    // Vincular links de navegación
    this.navLinks.forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const view = (link as HTMLElement).dataset.view as ViewId;
        if (view) this.navigate(view);
      });
    });

    // Leer hash inicial
    const hash = window.location.hash.replace("#/", "") as ViewId;
    const initialView = hash in routes ? hash : "config";
    this.navigate(initialView);

    // Escuchar cambios de hash (e.g. <a href="#/twitch">)
    window.addEventListener("hashchange", () => {
      const view = window.location.hash.replace("#/", "") as ViewId;
      if (view in routes && view !== this.current) this.navigate(view);
    });
  }

  async navigate(view: ViewId): Promise<void> {
    if (!(view in routes)) return;
    this.current = view;

    // Actualizar hash
    window.location.hash = `/${view}`;

    // Actualizar clases active en sidebar
    this.navLinks.forEach((link) => {
      const linkView = (link as HTMLElement).dataset.view;
      link.classList.toggle("active", linkView === view);
    });

    // Mostrar estado de carga
    this.container.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Cargando...</p>
      </div>
    `;

    try {
      await routes[view]();
    } catch (err) {
      console.error(`Error renderizando vista "${view}":`, err);
      this.container.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon">⚠</span>
          <h3>Error al cargar la vista</h3>
          <p>${String(err)}</p>
        </div>
      `;
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
