// =========================================================================================================
// DRINK WATER ACTION
// =========================================================================================================
// Pet pulls out a glass, tilts its head back to gulp, and a few water drops
// fly out. Triggered by the "agua" chat command.
// =========================================================================================================

import { animate } from "motion";
import { BaseAction, ActionMeta, ActionInput } from "../core/BaseAction";
import { ActionRegistry } from "../core/ActionRegistry";
import type { BasePet } from "../core/BasePet";

export class DrinkWaterAction extends BaseAction {
  static readonly meta: ActionMeta = {
    id:             "drink_water",
    label:          "Tomar agua",
    description:    "La mascota saca un vaso y bebe agua. Comando de chat: agua",
    icon:           "💧",
    requiresTarget: false,
    inputs:         [],
    minDurationMs:  2000,
    maxDurationMs:  3500,
    canInterrupt:   true,
    probability:    0.08,
  };

  private propEl: HTMLElement | null = null;
  private dropEls: HTMLElement[] = [];

  constructor(pet: BasePet, input?: ActionInput) { super(pet, input); }

  async execute(): Promise<void> {
    const el = this.pet.domElement;

    // Glass held at the pet's side.
    this.propEl = this._emoji("🥤", "bottom:2px;right:-26px;font-size:28px;");
    el.appendChild(this.propEl);
    await animate(this.propEl,
      { opacity: [0, 1], transform: ["scale(0)", "scale(1)"] },
      { duration: 0.3 }
    );

    // Three gulps: tilt the pet back and squash slightly on each sip.
    for (let i = 0; i < 3; i++) {
      if (this.cancelled) break;
      await animate(el,
        { transform: ["rotate(0deg) scale(1,1)", "rotate(-12deg) scale(1.03,0.95)", "rotate(0deg) scale(1,1)"] },
        { duration: 0.5 }
      );
      this._spawnDrop(el);
      await this.wait(180);
    }

    // Satisfied "Ahh~".
    if (!this.cancelled) {
      const ahh = this._emoji("😌", "top:-26px;left:50%;transform:translateX(-50%);font-size:18px;");
      el.appendChild(ahh);
      await animate(ahh, { opacity: [0, 1, 1, 0], transform: ["translateX(-50%) translateY(0px)", "translateX(-50%) translateY(-12px)"] }, { duration: 1 });
      ahh.remove();
    }

    await this._cleanup();
  }

  private _spawnDrop(el: HTMLElement): void {
    const drop = this._emoji("💧", "top:30%;left:55%;font-size:12px;");
    el.appendChild(drop);
    this.dropEls.push(drop);
    const dx = (Math.random() * 30 + 10) * (Math.random() < 0.5 ? -1 : 1);
    animate(drop,
      { opacity: [1, 1, 0], transform: [`translate(0px,0px)`, `translate(${dx}px,18px)`] },
      { duration: 0.6 }
    ).then(() => { drop.remove(); this.dropEls = this.dropEls.filter(d => d !== drop); });
  }

  private _emoji(char: string, css: string): HTMLElement {
    const node = document.createElement("div");
    node.textContent = char;
    node.style.cssText = `position:absolute;pointer-events:none;z-index:6;opacity:0;${css}`;
    node.style.opacity = "1";
    return node;
  }

  private async _cleanup(): Promise<void> {
    if (this.propEl) {
      await animate(this.propEl, { opacity: 0, transform: "scale(0.5)" }, { duration: 0.25 });
      this.propEl.remove();
      this.propEl = null;
    }
    this.pet.domElement.style.transform = "";
  }

  protected onCancel(): void {
    this.propEl?.remove();
    this.propEl = null;
    this.dropEls.forEach(d => d.remove());
    this.dropEls = [];
    this.pet.domElement.style.transform = "";
  }
}

ActionRegistry.register(DrinkWaterAction);
