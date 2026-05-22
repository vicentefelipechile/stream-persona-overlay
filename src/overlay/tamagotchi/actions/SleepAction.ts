// =========================================================================================================
// SLEEP ACTION
// =========================================================================================================
// Pet tilts, shows ZZZ bubbles, and waits until cancelled.
// This action is only triggered by the inactivity timer in BasePet,
// not randomly by PetScheduler (probability: 0).
// =========================================================================================================

import { animate } from "motion";
import { BaseAction, ActionMeta } from "../core/BaseAction";
import { ActionRegistry } from "../core/ActionRegistry";
import type { BasePet } from "../core/BasePet";

export class SleepAction extends BaseAction {
  static readonly meta: ActionMeta = {
    id:             "sleep",
    label:          "Dormir",
    description:    "La mascota se inclina y se queda dormida. Se activa por inactividad.",
    icon:           "😴",
    requiresTarget: false,
    inputs:         [],
    minDurationMs:  0,
    maxDurationMs:  Infinity,
    canInterrupt:   true,
    probability:    0,
  };

  private zzzEl:       HTMLElement | null = null;
  private zzzInterval: ReturnType<typeof setInterval> | null = null;

  constructor(pet: BasePet) { super(pet); }

  async execute(): Promise<void> {
    const el = this.pet.domElement;

    // Tilt — looks like the pet sat down and dozed off
    await animate(el,
      { transform: "rotate(15deg) translateY(10px)" },
      { duration: 0.5 }
    );

    // ZZZ bubble loop
    this.zzzEl = document.createElement("div");
    this.zzzEl.style.cssText = `
      position:absolute;
      top:-25px;
      right:-10px;
      font-size:14px;
      pointer-events:none;
      opacity:0;
      z-index:10;
    `;
    el.appendChild(this.zzzEl);

    const cycle = ["z", "zz", "zzz"];
    let idx = 0;
    this.zzzInterval = setInterval(() => {
      if (!this.zzzEl || this.cancelled) return;
      this.zzzEl.textContent = cycle[idx % 3];
      idx++;
      animate(this.zzzEl,
        { opacity: [0, 1, 0], transform: ["translateY(-5px)", "translateY(-15px)"] },
        { duration: 1.5 }
      );
    }, 1600);

    // Keep sleeping until cancelled (inactivity → despawn fires from FSM)
    while (!this.cancelled) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  protected onCancel(): void {
    if (this.zzzInterval) clearInterval(this.zzzInterval);
    this.zzzEl?.remove();
    this.zzzEl = null;
    // Straighten the pet back up
    animate(this.pet.domElement,
      { transform: "rotate(0deg) translateY(0px)" },
      { duration: 0.3 }
    );
  }
}

ActionRegistry.register(SleepAction);
