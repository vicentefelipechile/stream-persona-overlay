// =========================================================================================================
// FIGHT ACTION
// =========================================================================================================
// Two pets charge toward each other, shake, show a cartoon fight cloud,
// then bounce away. Uses PetManager.getRandomPet() to find a rival.
// =========================================================================================================

import { animate } from "motion";
import { BaseAction, ActionMeta, ActionInput } from "../core/BaseAction";
import { ActionRegistry } from "../core/ActionRegistry";
import { PetManager } from "../core/PetManager";
import type { BasePet } from "../core/BasePet";

export class FightAction extends BaseAction {
  static readonly meta: ActionMeta = {
    id:             "fight",
    label:          "Pelea",
    description:    "Dos mascotas se acercan y pelean. Se elige un rival al azar o puedes especificar uno.",
    icon:           "👊",
    requiresTarget: true,
    inputs: [
      {
        key:         "targetUserId",
        type:        "select",
        label:       "Usuario rival (opcional, aleatorio si no se elige)",
        required:    false,
        options:     [], // Populated dynamically with active users
      },
      {
        key:         "imageUrl",
        type:        "image",
        label:       "Imagen de la nube de pelea (opcional)",
        placeholder: "Deja vacío para usar 💥 por defecto",
        required:    false,
      },
    ],
    minDurationMs: 3000,
    maxDurationMs: 6000,
    canInterrupt:  false,
    probability:   0.08,
  };

  private cloudEl: HTMLElement | null = null;

  constructor(pet: BasePet, input?: ActionInput) { super(pet, input); }

  async execute(): Promise<void> {
    if (this.pet.config.staticMode) return;

    const targetId = this.input["targetUserId"] as number | undefined;
    const rival = targetId
      ? PetManager.get(targetId)
      : PetManager.getRandomPet(this.pet.userId);

    if (!rival || rival.fsm.state === "action") return;

    const myEl    = this.pet.domElement;
    const rivalEl = rival.domElement;
    const centerX = window.innerWidth / 2;

    // Both move to center
    await Promise.all([
      this.pet.moveTo(centerX - 60, 250),
      rival.moveTo(centerX + 60, 250),
    ]);

    if (this.cancelled) return;

    // Shake both
    await Promise.all([
      animate(myEl,    { transform: ["translateX(-8px)", "translateX(8px)", "translateX(-6px)", "translateX(6px)", "translateX(0px)"] }, { duration: 0.4 }),
      animate(rivalEl, { transform: ["translateX(8px)", "translateX(-8px)", "translateX(6px)", "translateX(-6px)", "translateX(0px)"] }, { duration: 0.4 }),
    ]);

    // Fight cloud
    this.cloudEl = this._createCloud(centerX);
    document.body.appendChild(this.cloudEl);
    await animate(this.cloudEl,
      { opacity: [0, 1, 1], transform: ["scale(0.5)", "scale(1.3)", "scale(1)"] },
      { duration: 0.3 }
    );

    // Hit impacts
    for (let i = 0; i < 4; i++) {
      if (this.cancelled) break;
      await Promise.all([
        animate(myEl,      { transform: ["translateX(-12px)", "translateX(12px)", "translateX(0px)"] }, { duration: 0.15 }),
        animate(rivalEl,   { transform: ["translateX(12px)", "translateX(-12px)", "translateX(0px)"] }, { duration: 0.15 }),
        animate(this.cloudEl, {
          transform: ["rotate(0deg) scale(1)", "rotate(15deg) scale(1.1)", "rotate(-10deg) scale(0.9)", "rotate(0deg) scale(1)"],
        }, { duration: 0.3 }),
      ]);
      await this.wait(200);
    }

    // Both bounce away
    await Promise.all([
      animate(myEl,    { transform: ["translateX(-60px)", "translateX(0px)"], opacity: [0.5, 1] }, { duration: 0.4 }),
      animate(rivalEl, { transform: ["translateX(60px)", "translateX(0px)"],  opacity: [0.5, 1] }, { duration: 0.4 }),
    ]);

    // Clear any WAAPI transform residue so pos.x and visual position stay in sync.
    myEl.style.transform    = "";
    rivalEl.style.transform = "";

    // Remove cloud
    if (this.cloudEl) {
      await animate(this.cloudEl, { opacity: 0, transform: "scale(0)" }, { duration: 0.3 });
      this.cloudEl.remove();
      this.cloudEl = null;
    }

    // Walk back to random positions
    await Promise.all([
      this.pet.moveTo(Math.random() * (window.innerWidth * 0.3), 150),
      rival.moveTo(window.innerWidth * 0.6 + Math.random() * 200, 150),
    ]);

    // Rival was never taken out of "idle" state by the fight, so onEnter("idle")
    // won't fire again — restart its walk loop manually.
    rival.resumeIdleWalk();
  }

  private _createCloud(cx: number): HTMLElement {
    const el = document.createElement("div");
    el.className = "pet-fight-cloud";
    el.style.cssText = `
      position:fixed;
      left:${cx - 50}px;
      top:${this.pet.floorY - 80}px;
      width:100px;
      height:100px;
      font-size:60px;
      text-align:center;
      line-height:100px;
      opacity:0;
      pointer-events:none;
      z-index:9999;
    `;
    if (this.input["imageUrl"]) {
      const img = document.createElement("img");
      img.src = this.input["imageUrl"] as string;
      img.style.cssText = "width:100%;height:100%;object-fit:contain;";
      el.appendChild(img);
    } else {
      el.textContent = "💥";
    }
    return el;
  }

  protected onCancel(): void {
    this.cloudEl?.remove();
  }
}

ActionRegistry.register(FightAction);
