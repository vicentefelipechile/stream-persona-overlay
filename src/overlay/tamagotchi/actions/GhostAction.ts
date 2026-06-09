// =========================================================================================================
// GHOST ACTION
// =========================================================================================================
// Pet turns translucent, floats up, lets out a spooky "¡Boo!" and shivers before
// settling back down. Triggered by the "boo" chat command.
// =========================================================================================================

import { animate } from "motion";
import { BaseAction, ActionMeta, ActionInput } from "../core/BaseAction";
import { ActionRegistry } from "../core/ActionRegistry";
import type { BasePet } from "../core/BasePet";

export class GhostAction extends BaseAction {
  static readonly meta: ActionMeta = {
    id:             "ghost",
    label:          "Fantasma",
    description:    "La mascota se vuelve traslúcida, flota y grita ¡Boo! 👻. Comando de chat: boo",
    icon:           "👻",
    requiresTarget: false,
    inputs:         [],
    minDurationMs:  2500,
    maxDurationMs:  3500,
    canInterrupt:   true,
    probability:    0.07,
  };

  private ghostEl:  HTMLElement | null = null;
  private bubbleEl: HTMLElement | null = null;

  constructor(pet: BasePet, input?: ActionInput) { super(pet, input); }

  async execute(): Promise<void> {
    const el = this.pet.domElement;

    // Fade translucent and lift off the floor.
    this.ghostEl = document.createElement("div");
    this.ghostEl.textContent = "👻";
    this.ghostEl.style.cssText = "position:absolute;top:-22px;left:50%;font-size:18px;pointer-events:none;z-index:7;opacity:0;transform:translateX(-50%);";
    el.appendChild(this.ghostEl);

    await animate(el, { opacity: 0.45, transform: "translateY(-14px)" }, { duration: 0.4 });
    animate(this.ghostEl, { opacity: [0, 1, 1, 0], transform: ["translateX(-50%) translateY(0px)", "translateX(-50%) translateY(-10px)"] }, { duration: 2 });

    // "¡Boo!"
    this.bubbleEl = document.createElement("div");
    this.bubbleEl.textContent = "¡Boo!";
    this.bubbleEl.style.cssText = `
      position:absolute;top:-48px;left:50%;transform:translateX(-50%) scale(0);
      background:#fff;border:2px solid #333;border-radius:4px;padding:3px 8px;
      font-family:'IBM Plex Sans',sans-serif;font-size:12px;font-weight:700;
      white-space:nowrap;pointer-events:none;z-index:10;`;
    el.appendChild(this.bubbleEl);
    await animate(this.bubbleEl, { opacity: [0, 1], transform: ["translateX(-50%) scale(0)", "translateX(-50%) scale(1.1)"] }, { duration: 0.25 });

    // Spooky shiver while floating.
    for (let i = 0; i < 4; i++) {
      if (this.cancelled) break;
      await animate(el, { transform: ["translateY(-14px) translateX(0px)", "translateY(-14px) translateX(-4px)", "translateY(-14px) translateX(4px)", "translateY(-14px) translateX(0px)"] }, { duration: 0.3 });
    }

    // Settle back, fade in.
    if (this.bubbleEl) {
      await animate(this.bubbleEl, { opacity: 0 }, { duration: 0.2 });
      this.bubbleEl.remove();
      this.bubbleEl = null;
    }
    if (!this.cancelled) {
      await animate(el, { opacity: 1, transform: "translateY(0px)" }, { duration: 0.4 });
    }
    this._cleanup();
  }

  private _cleanup(): void {
    this.ghostEl?.remove();
    this.ghostEl = null;
    const el = this.pet.domElement;
    el.style.opacity = "1";
    el.style.transform = "";
  }

  protected onCancel(): void {
    this.bubbleEl?.remove();
    this.bubbleEl = null;
    this._cleanup();
  }
}

ActionRegistry.register(GhostAction);
