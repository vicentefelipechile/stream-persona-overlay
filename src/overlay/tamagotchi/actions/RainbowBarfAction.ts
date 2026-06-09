// =========================================================================================================
// RAINBOW BARF ACTION
// =========================================================================================================
// The classic meme: the pet leans forward and spews a cascade of rainbows out
// of its mouth. Triggered by the "arcoiris" chat command.
// =========================================================================================================

import { animate } from "motion";
import { BaseAction, ActionMeta, ActionInput } from "../core/BaseAction";
import { ActionRegistry } from "../core/ActionRegistry";
import type { BasePet } from "../core/BasePet";

export class RainbowBarfAction extends BaseAction {
  static readonly meta: ActionMeta = {
    id:             "rainbow_barf",
    label:          "Vómito arcoíris",
    description:    "La mascota se inclina y vomita un arcoíris 🌈. Comando de chat: arcoiris",
    icon:           "🌈",
    requiresTarget: false,
    inputs:         [],
    minDurationMs:  2000,
    maxDurationMs:  3000,
    canInterrupt:   true,
    probability:    0.07,
  };

  private rainbowEls: HTMLElement[] = [];

  constructor(pet: BasePet, input?: ActionInput) { super(pet, input); }

  async execute(): Promise<void> {
    const el = this.pet.domElement;

    // Build up: lean back a touch...
    await animate(el, { transform: ["rotate(0deg)", "rotate(10deg) scale(1.05,0.95)"] }, { duration: 0.35 });
    // ...then lurch forward to "barf".
    await animate(el, { transform: ["rotate(10deg) scale(1.05,0.95)", "rotate(-25deg) scale(0.95,1.05)"] }, { duration: 0.18 });

    // Cascade of rainbows streaming out and down-forward.
    for (let i = 0; i < 7; i++) {
      if (this.cancelled) break;
      this._spawnRainbow(el, i);
      await this.wait(120);
    }

    await this.wait(400);

    // Recover.
    if (!this.cancelled) {
      await animate(el, { transform: ["rotate(-25deg) scale(0.95,1.05)", "rotate(0deg) scale(1,1)"] }, { duration: 0.4 });
    }
    el.style.transform = "";
  }

  private _spawnRainbow(el: HTMLElement, i: number): void {
    const rb = document.createElement("div");
    rb.textContent = "🌈";
    rb.style.cssText = "position:absolute;top:35%;left:60%;font-size:18px;pointer-events:none;z-index:7;opacity:1;";
    el.appendChild(rb);
    this.rainbowEls.push(rb);
    const dx = 30 + i * 8 + Math.random() * 10;
    const dy = 10 + Math.random() * 30;
    const scale = 1 + Math.random() * 0.8;
    animate(rb,
      { opacity: [1, 1, 0], transform: [`translate(0px,0px) scale(0.4)`, `translate(${dx}px,${dy}px) scale(${scale})`] },
      { duration: 0.9, ease: "easeOut" }
    ).then(() => { rb.remove(); this.rainbowEls = this.rainbowEls.filter(r => r !== rb); });
  }

  protected onCancel(): void {
    this.rainbowEls.forEach(r => r.remove());
    this.rainbowEls = [];
    this.pet.domElement.style.transform = "";
  }
}

ActionRegistry.register(RainbowBarfAction);
