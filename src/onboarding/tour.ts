// =========================================================================================================
// ONBOARDING TOUR
// =========================================================================================================
// First-run setup guide built on driver.js. Walks the streamer through the full getting-started flow
// (connect Twitch, register personas via the Discord bot, add the overlay to OBS, enable the pets) and
// doubles as a reference tour for every panel section.
//
// The panel is a hash-based SPA: most step targets live inside async-rendered views (`#view-container`).
// Each step may declare a `view`; before highlighting, we drive the router to that view and wait for the
// target element to appear in the DOM. Sidebar/nav targets need no view change (always present).
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { driver, type Driver, type DriveStep } from "driver.js";
import { router } from "../router";
import type { ViewId } from "../router";

// =========================================================================================================
// Constants
// =========================================================================================================

// localStorage flag — set once the tour has run (completed or closed) so it does not nag on every launch.
const SEEN_KEY = "spo_onboarding_seen";

// =========================================================================================================
// Types
// =========================================================================================================

// A tour step is a driver.js step plus an optional panel view that must be active before highlighting.
interface TourStep extends DriveStep {
  view?: ViewId;
}

// =========================================================================================================
// Step definitions — the getting-started flow, in order
// =========================================================================================================

const STEPS: TourStep[] = [
  {
    // Welcome — centered modal (no element).
    popover: {
      title: "👋 Bienvenido a Stream Persona Overlay",
      description:
        "Te guío en un par de minutos para dejarlo funcionando: conectar tu chat, registrar mascotas y mostrarlas en OBS. Puedes salir cuando quieras con la X.",
    },
  },
  {
    element: "#sidebar",
    popover: {
      title: "Este es el menú",
      description:
        "Desde aquí accedes a cada sección: Twitch, TikTok, Configuración, Usuarios, Logs y las mascotas Tamagotchi. Vamos paso a paso.",
      side: "right",
      align: "center",
    },
  },

  // ── Twitch ───────────────────────────────────────────────────────────────────────────────────────
  {
    view: "twitch",
    element: "#twitch-channel",
    popover: {
      title: "1) Conecta tu canal de Twitch",
      description:
        "Escribe aquí el nombre de tu canal de Twitch (sin la @). Es el chat que la app va a escuchar.",
      side: "bottom",
      align: "start",
    },
  },
  {
    view: "twitch",
    element: "#twitch-token",
    popover: {
      title: "Pega tu token OAuth",
      description:
        "Para leer el chat aunque estés offline necesitas un token. Pégalo aquí y pulsa «Validar» para comprobarlo automáticamente.",
      side: "bottom",
      align: "start",
    },
  },
  {
    view: "twitch",
    element: "#btn-connect-twitch",
    popover: {
      title: "Conéctate",
      description:
        "Con el canal y el token listos, pulsa «Conectar». El indicador del menú se pondrá en verde cuando funcione.",
      side: "top",
      align: "start",
    },
  },

  // ── TikTok (optional) ──────────────────────────────────────────────────────────────────────────────
  {
    view: "tiktok",
    element: "#tiktok-username",
    popover: {
      title: "¿También transmites en TikTok?",
      description:
        "Opcional. Pon aquí tu usuario LIVE de TikTok y la app reaccionará a chat, regalos, likes y seguidores igual que en Twitch.",
      side: "bottom",
      align: "start",
    },
  },

  // ── Discord bot + OBS (Config view) ─────────────────────────────────────────────────────────────────
  {
    view: "config",
    element: "#cfg-discord-token",
    popover: {
      title: "2) El bot de Discord",
      description:
        "Tus viewers registran su mascota subiendo dos imágenes (boca abierta / cerrada) mediante comandos del bot de Discord. Pega aquí el token del bot.",
      side: "bottom",
      align: "start",
    },
  },
  {
    view: "config",
    element: "#btn-restart-discord",
    popover: {
      title: "Activa el bot",
      description:
        "Guarda y pulsa «Reiniciar Bot» para que arranque con el token. A partir de ahí tus viewers ya pueden usar los comandos /persona en Discord.",
      side: "top",
      align: "start",
    },
  },
  {
    view: "config",
    element: "#obs-browser-url",
    popover: {
      title: "3) Muestra el overlay en OBS",
      description:
        "Esta es la URL del overlay. En OBS añade una fuente «Navegador» (Browser Source) y pega esta dirección: las mascotas aparecerán con fondo transparente.",
      side: "bottom",
      align: "start",
    },
  },
  {
    view: "config",
    element: "#btn-copy-obs-url",
    popover: {
      title: "Copia la URL",
      description:
        "Pulsa «Copiar» y pégala en la fuente de OBS. Ajusta el tamaño de la fuente al de tu lienzo (normalmente 1920×1080).",
      side: "top",
      align: "end",
    },
  },

  // ── Users / Overlay / Tamagotchi / Logs ─────────────────────────────────────────────────────────────
  {
    element: "#nav-users",
    popover: {
      title: "Tus viewers registrados",
      description:
        "Aquí ves a todos los que registraron su mascota por Discord, con sus imágenes. Puedes editarlos, silenciarlos o borrarlos.",
      side: "right",
      align: "center",
    },
  },
  {
    element: "#btn-toggle-overlay",
    popover: {
      title: "Alternativa: ventana de overlay",
      description:
        "Si prefieres no usar el Browser Source, este botón abre una ventana con chroma key que capturas en OBS con «Captura de ventana» + filtro chroma.",
      side: "top",
      align: "center",
    },
  },
  {
    view: "tamagotchi",
    // Target the visible toggle wrapper, not the `#tama-enabled` checkbox — the switch hides the real
    // input with `display:none`, which has a zero-size bounding box and throws driver.js positioning off.
    element: ".tama-system-toggle",
    popover: {
      title: "4) Las mascotas Tamagotchi",
      description:
        "Cuando un viewer registrado escribe, su mascota aparece, camina y reacciona al chat. Este interruptor activa el sistema; abajo ajustas tamaño, velocidad y acciones.",
      side: "bottom",
      align: "end",
    },
  },
  {
    element: "#nav-logs",
    popover: {
      title: "Logs",
      description:
        "El historial de mensajes y eventos. Útil para comprobar que el chat llega bien y depurar si algo no aparece.",
      side: "right",
      align: "center",
    },
  },

  // Finish — centered modal.
  {
    element: "#btn-onboarding",
    popover: {
      title: "¡Listo para empezar! 🎉",
      description:
        "Eso es todo. Puedes volver a ver este tutorial cuando quieras desde este botón «¿Cómo empezar?». ¡Buen stream!",
      side: "top",
      align: "center",
    },
  },
];

// =========================================================================================================
// Helpers
// =========================================================================================================

// Wait until a selector resolves to an element (the target views render asynchronously). Resolves with the
// element, or null after the timeout so the tour can degrade gracefully instead of hanging.
function waitForElement(selector: string, timeoutMs = 2500): Promise<Element | null> {
  const existing = document.querySelector(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      if (Date.now() > deadline) return resolve(null);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// Ensure the panel is on the right view and the target element exists before driver.js highlights it.
async function prepareStep(index: number): Promise<void> {
  const step = STEPS[index];
  if (!step) return;

  if (step.view && router?.getCurrent() !== step.view) {
    await router.navigate(step.view);
  }

  const target = typeof step.element === "string" ? step.element : undefined;
  if (target) {
    await waitForElement(target);
  }
}

// =========================================================================================================
// Tour driver
// =========================================================================================================

let driverObj: Driver | null = null;

export async function startTour(): Promise<void> {
  // If a previous run is still active, tear it down first.
  driverObj?.destroy();

  driverObj = driver({
    showProgress: true,
    progressText: "{{current}} de {{total}}",
    nextBtnText: "Siguiente",
    prevBtnText: "Atrás",
    doneBtnText: "Finalizar",
    popoverClass: "spo-tour",
    overlayColor: "#0d0f14",
    overlayOpacity: 0.7,
    stagePadding: 6,
    stageRadius: 4,
    allowClose: true,
    smoothScroll: true,
    // Navigation must go through onNextClick/onPrevClick so we can switch views and await async-rendered
    // targets. Keyboard control calls moveNext()/movePrevious() directly, bypassing that prep — disable it.
    allowKeyboardControl: false,
    steps: STEPS,

    // We own navigation so we can switch panel views and await async-rendered targets between steps.
    onNextClick: async (_el, _step, { driver: d }) => {
      const next = (d.getActiveIndex() ?? 0) + 1;
      if (next >= STEPS.length) {
        d.destroy();
        return;
      }
      await prepareStep(next);
      d.moveTo(next);
    },
    onPrevClick: async (_el, _step, { driver: d }) => {
      const prev = (d.getActiveIndex() ?? 0) - 1;
      if (prev < 0) return;
      await prepareStep(prev);
      d.moveTo(prev);
    },
    onDestroyed: () => {
      markSeen();
      driverObj = null;
    },
  });

  // Prepare and show the first step.
  await prepareStep(0);
  driverObj.drive(0);
}

// =========================================================================================================
// First-run handling
// =========================================================================================================

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // localStorage may be unavailable in rare webview configs — non-fatal.
  }
}

function hasSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true; // Fail closed: do not auto-launch if we cannot read the flag.
  }
}

// Launch the tour automatically the first time the panel is ever opened.
export async function maybeAutoStartTour(): Promise<void> {
  if (hasSeen()) return;
  await startTour();
}
