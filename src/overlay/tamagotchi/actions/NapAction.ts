// =========================================================================================================
// NAP ACTION
// =========================================================================================================
// A short, manually-triggered nap: the pet tilts over, shows ZZZ for a few
// seconds, then wakes up with a stretch. Distinct from the inactivity `sleep`
// action (which stays asleep until despawn). Triggered by the "dormir" command.
// =========================================================================================================

import { animate } from "motion";
import { BaseAction, ActionMeta, ActionInput } from "../core/BaseAction";
import { ActionRegistry } from "../core/ActionRegistry";
import type { BasePet } from "../core/BasePet";

export class NapAction extends BaseAction {
  static readonly meta: ActionMeta = {
    id:             "nap",
    label:          "Siesta",
    description:    "La mascota se echa una siesta corta (ZZZ) y despierta sola. Comando de chat: dormir",
    icon:           "😴",
    requiresTarget: false,
    inputs:         [],
    minDurationMs:  4000,
    maxDurationMs:  6000,
    canInterrupt:   true,
    probability:    0.07,
  };

  private zzzEl: HTMLElement | null = null;
  private zzzTimer: ReturnType<typeof setInterval> | null = null;

  constructor(pet: BasePet, input?: ActionInput) { super(pet, input); }

  async execute(): Promise<void> {
    const el = this.pet.domElement;

    // Lie down.
    await animate(el, { transform: "rotate(15deg) translateY(10px)" }, { duration: 0.4 });

    // ZZZ loop.
    this.zzzEl = document.createElement("div");
    this.zzzEl.style.cssText = "position:absolute;top:-24px;right:-12px;font-size:15px;pointer-events:none;z-index:10;opacity:0;";
    el.appendChild(this.zzzEl);

    const cycle = ["z", "zz", "zzz"];
    let idx = 0;
    this.zzzTimer = setInterval(() => {
      if (!this.zzzEl || this.cancelled) return;
      this.zzzEl.textContent = cycle[idx % 3];
      idx++;
      animate(this.zzzEl, { opacity: [0, 1, 0], transform: ["translateY(-4px)", "translateY(-16px)"] }, { duration: 1.4 });
    }, 1500);

    // Nap ~4.5 s (cancellable).
    await this.wait(4500);

    if (this.zzzTimer) { clearInterval(this.zzzTimer); this.zzzTimer = null; }
    this.zzzEl?.remove();
    this.zzzEl = null;

    // Wake up: straighten, then a little stretch.
    if (!this.cancelled) {
      await animate(el, { transform: ["rotate(15deg) translateY(10px)", "rotate(0deg) translateY(0px)"] }, { duration: 0.3 });
      await animate(el, { transform: ["scale(1,1)", "scale(0.95,1.1)", "scale(1,1)"] }, { duration: 0.4 });
    }

    el.style.transform = "";
  }

  protected onCancel(): void {
    if (this.zzzTimer) { clearInterval(this.zzzTimer); this.zzzTimer = null; }
    this.zzzEl?.remove();
    this.zzzEl = null;
    animate(this.pet.domElement, { transform: "rotate(0deg) translateY(0px)" }, { duration: 0.3 })
      .then(() => { this.pet.domElement.style.transform = ""; });
  }
}

ActionRegistry.register(NapAction);
