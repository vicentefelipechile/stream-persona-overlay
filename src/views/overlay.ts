// =========================================================================================================
// OVERLAY VIEW
// =========================================================================================================
// Runs in the "overlay" window (transparent chroma-key background).
// Initializes the Tamagotchi pet system and handles window lifecycle events.
// =========================================================================================================

import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc as tauriConvertFileSrc } from "@tauri-apps/api/core";
import { PetManager } from "../overlay/tamagotchi/core/PetManager";
import { initOverlayNotifications } from "../overlay/overlay-notifications";
import { initOverlayBackground } from "../overlay/overlay-background";

// =========================================================================================================
// Initialization
// =========================================================================================================

window.addEventListener("DOMContentLoaded", async () => {
  const body                = document.getElementById("overlay-body")!;
  const tamagotchiContainer = document.getElementById("tamagotchi-container")!;

  try {
    const cfg = await invoke<{ chroma_color: string }>("get_config_cmd");
    body.style.backgroundColor = cfg.chroma_color;
  } catch (_) {
    body.style.backgroundColor = "#00FF00";
  }

  // =========================================================================================================
  // Fade-in Cover
  // =========================================================================================================
  // resetAndTriggerFade() works for both the initial window load and every
  // subsequent show() call. Key steps:
  //  1. Disable the CSS transition temporarily so the opacity:1 reset is instant.
  //  2. Force a reflow (offsetHeight read) so the browser commits the opaque state.
  //  3. Re-enable the transition and add .fade-out to start the 2-second fade.

  function resetAndTriggerFade(): void {
    const cover = document.getElementById("fade-cover");
    if (!cover) return;
    cover.style.transition = "none";
    cover.classList.remove("fade-out");
    cover.style.opacity    = "1";
    void cover.offsetHeight;
    cover.style.transition = "";
    cover.style.opacity    = "";
    requestAnimationFrame(() => {
      cover.classList.add("fade-out");
    });
  }

  resetAndTriggerFade();

  // Background layer (uploaded image in "image" mode; transparent in "color" mode,
  // letting the chroma body color show through).
  initOverlayBackground({
    listen:         (event, handler) => listen(event, handler),
    invoke:         (command, args)  => invoke(command, args),
    convertFileSrc: tauriConvertFileSrc,
  }).catch(err => console.warn("[overlay-bg] init failed:", err));

  // Start the Tamagotchi pet system (non-blocking — errors don't affect main overlay)
  PetManager.init(tamagotchiContainer).catch(err => {
    console.warn("[tamagotchi] PetManager init failed:", err);
  });

  // Surface connection notices (e.g. TikTok connected / connection lost) on-overlay.
  initOverlayNotifications(listen);

  // =========================================================================================================
  // Tauri Event Listeners
  // =========================================================================================================

  // Rust emits this 120ms before show() — gives us time to reset the fade cover
  // to opaque black while the window is still hidden, so the user never sees the flash.
  await listen("overlay-will-show", () => {
    resetAndTriggerFade();
  });

  await listen<string>("chroma-color-changed", (event) => {
    body.style.backgroundColor = event.payload;
  });
});
