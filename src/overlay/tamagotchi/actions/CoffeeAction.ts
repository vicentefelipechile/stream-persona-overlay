// =========================================================================================================
// COFFEE ACTION
// =========================================================================================================
// Pet downs a coffee and then vibrates with caffeine energy, lightning bolts
// crackling around it. Triggered by the "cafe" chat command.
// =========================================================================================================

import { animate } from "motion";
import { BaseAction, ActionMeta, ActionInput } from "../core/BaseAction";
import { ActionRegistry } from "../core/ActionRegistry";
import type { BasePet } from "../core/BasePet";

export class CoffeeAction extends BaseAction {
  static readonly meta: ActionMeta = {
    id:             "coffee",
    label:          "Café",
    description:    "La mascota se toma un café y vibra a mil por la cafeína ⚡. Comando de chat: cafe",
    icon:           "☕",
    requiresTarget: false,
    inputs:         [],
    minDurationMs:  2500,
    maxDurationMs:  4000,
    canInterrupt:   true,
    probability:    0.08,
  };

  private cupEl: HTMLElement | null = null;
  private boltEls: HTMLElement[] = [];

  constructor(pet: BasePet, input?: ActionInput) { super(pet, input); }

  async execute(): Promise<void> {
    const el = this.pet.domElement;

    // Take a sip.
    this.cupEl = document.createElement("div");
    this.cupEl.textContent = "☕";
    this.cupEl.style.cssText = "position:absolute;bottom:4px;right:-22px;font-size:24px;pointer-events:none;z-index:6;opacity:0;transform:scale(0);";
    el.appendChild(this.cupEl);
    await animate(this.cupEl, { opacity: [0, 1], transform: ["scale(0)", "scale(1)"] }, { duration: 0.3 });
    await animate(el, { transform: ["rotate(0deg)", "rotate(-15deg)", "rotate(0deg)"] }, { duration: 0.6 });

    if (this.cupEl) {
      await animate(this.cupEl, { opacity: 0, transform: "scale(0.4)" }, { duration: 0.2 });
      this.cupEl.remove();
      this.cupEl = null;
    }

    // Caffeine kicks in: rapid jitter with lightning bolts.
    const jitterMs = 1800;
    const start = performance.now();
    let boltAcc = 0;
    const jitter = () => {
      if (this.cancelled) return;
      const elapsed = performance.now() - start;
      if (elapsed >= jitterMs) return;
      const dx = (Math.random() - 0.5) * 8;
      const dy = (Math.random() - 0.5) * 8;
      const rot = (Math.random() - 0.5) * 8;
      el.style.transform = `translate(${dx}px,${dy}px) rotate(${rot}deg)`;
      boltAcc += 1;
      if (boltAcc % 6 === 0) this._spawnBolt(el);
      requestAnimationFrame(jitter);
    };
    requestAnimationFrame(jitter);
    await this.wait(jitterMs);

    el.style.transform = "";
  }

  private _spawnBolt(el: HTMLElement): void {
    const bolt = document.createElement("div");
    bolt.textContent = "⚡";
    const side = Math.random() < 0.5 ? "left:-14px;" : "right:-14px;";
    bolt.style.cssText = `position:absolute;top:${Math.random() * 40}%;${side}font-size:16px;pointer-events:none;z-index:5;opacity:1;`;
    el.appendChild(bolt);
    this.boltEls.push(bolt);
    animate(bolt, { opacity: [1, 1, 0], transform: ["scale(0.6)", "scale(1.3)"] }, { duration: 0.4 })
      .then(() => { bolt.remove(); this.boltEls = this.boltEls.filter(b => b !== bolt); });
  }

  protected onCancel(): void {
    this.cupEl?.remove();
    this.cupEl = null;
    this.boltEls.forEach(b => b.remove());
    this.boltEls = [];
    this.pet.domElement.style.transform = "";
  }
}

ActionRegistry.register(CoffeeAction);
