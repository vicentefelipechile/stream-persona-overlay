// =========================================================================================================
// OVERLAY BROWSER VIEW
// =========================================================================================================
// Entry point for overlay-browser.html — the OBS Browser Source target.
// Mirrors overlay.ts but uses WebSocket transport instead of Tauri IPC.
// No chroma key, no fade-cover: OBS handles transparency natively.
// =========================================================================================================

import { wsListen, wsInvoke, browserConvertFileSrc } from "../overlay/ws-transport";
import { PetManager } from "../overlay/tamagotchi/core/PetManager";
import type { PetTransport } from "../overlay/tamagotchi/core/PetManager";

// =========================================================================================================
// Initialization
// =========================================================================================================

window.addEventListener("DOMContentLoaded", async () => {
  const tamagotchiContainer = document.getElementById("tamagotchi-container")!;

  // =========================================================================================================
  // Browser Transport
  // =========================================================================================================
  // Provides wsListen / wsInvoke / browserConvertFileSrc as drop-in replacements
  // for the Tauri API surface so PetManager works without any Tauri dependency.

  const browserTransport: PetTransport = {
    listen:         (event, handler) => wsListen(event, handler),
    invoke:         (command, args)  => wsInvoke(command, args),
    convertFileSrc: browserConvertFileSrc,
  };

  // Start the Tamagotchi pet system using the WS transport
  PetManager.init(tamagotchiContainer, browserTransport).catch(err => {
    console.warn("[tamagotchi] PetManager init failed:", err);
  });
});
