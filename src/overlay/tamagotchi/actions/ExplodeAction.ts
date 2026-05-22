// =========================================================================================================
// EXPLODE ACTION
// =========================================================================================================
// Pet trembles, flashes white, explodes into particles, then respawns.
// =========================================================================================================

import { animate } from "motion";
import { BaseAction, ActionMeta, ActionInput } from "../core/BaseAction";
import { ActionRegistry } from "../core/ActionRegistry";
import type { BasePet } from "../core/BasePet";

export class ExplodeAction extends BaseAction {
  static readonly meta: ActionMeta = {
    id:             "explode",
    label:          "Explotar",
    description:    "La mascota explota con partículas y reaparece tras unos segundos.",
    icon:           "💣",
    requiresTarget: false,
    inputs: [
      {
        key:          "color",
        type:         "color",
        label:        "Color de la explosión",
        required:     false,
        defaultValue: "#ff6600",
      },
    ],
    minDurationMs: 2500,
    maxDurationMs: 4000,
    canInterrupt:  false,
    probability:   0.05,
  };

  constructor(pet: BasePet, input?: ActionInput) { super(pet, input); }

  async execute(): Promise<void> {
    const el    = this.pet.domElement;
    const color = (this.input["color"] as string) ?? "#ff6600";

    // Build-up tremor
    for (let i = 0; i < 8; i++) {
      if (this.cancelled) return;
      await animate(el, {
        transform: [
          "translateX(0px) translateY(0px)",
          "translateX(-4px) translateY(-2px)",
          "translateX(4px) translateY(2px)",
          "translateX(-2px) translateY(-1px)",
          "translateX(2px) translateY(1px)",
          "translateX(0px) translateY(0px)",
        ],
      }, { duration: 0.12 });
    }

    // White flash + scale up
    await animate(el,
      { transform: ["scale(1)", "scale(1.5)"], filter: ["brightness(1)", "brightness(5)"] },
      { duration: 0.15 }
    );

    // Spawn particles
    const particles = this._spawnParticles(el, color);

    // Hide pet
    el.style.opacity = "0";
    await animate(el, { transform: "scale(0)" }, { duration: 0.1 });

    await this.wait(1200);
    particles.forEach(p => p.remove());

    if (this.cancelled) return;

    // Reappear
    await this.wait(500);
    el.style.opacity = "1";
    await animate(el,
      {
        transform: [
          "translateY(-30px) scale(0)",
          "translateY(0px) scale(1.3)",
          "translateY(0px) scale(0.9)",
          "translateY(0px) scale(1)",
        ],
        filter: ["brightness(3)", "brightness(1)", "brightness(1)", "brightness(1)"],
      },
      { duration: 0.6, type: "spring", stiffness: 350, damping: 18 }
    );
  }

  private _spawnParticles(origin: HTMLElement, color: string): HTMLElement[] {
    const rect    = origin.getBoundingClientRect();
    const cx      = rect.left + rect.width  / 2;
    const cy      = rect.top  + rect.height / 2;
    const count   = 12;
    const result: HTMLElement[] = [];

    for (let i = 0; i < count; i++) {
      const p     = document.createElement("div");
      const angle = (i / count) * Math.PI * 2;
      const dist  = 40 + Math.random() * 60;
      const size  = 6  + Math.random() * 8;

      p.style.cssText = `
        position:fixed;
        left:${cx}px;
        top:${cy}px;
        width:${size}px;
        height:${size}px;
        background:${color};
        border-radius:50%;
        pointer-events:none;
        z-index:9999;
      `;
      document.body.appendChild(p);
      result.push(p);

      animate(p, {
        left:      `${cx + Math.cos(angle) * dist}px`,
        top:       `${cy + Math.sin(angle) * dist}px`,
        opacity:   [1, 1, 0],
        transform: ["scale(1)", "scale(0.3)"],
      }, { duration: 0.8 + Math.random() * 0.4, ease: "easeOut" });
    }

    return result;
  }
}

ActionRegistry.register(ExplodeAction);
