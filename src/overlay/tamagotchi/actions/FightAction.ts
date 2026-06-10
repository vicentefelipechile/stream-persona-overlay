// =========================================================================================================
// FIGHT ACTION
// =========================================================================================================
// Two pets converge on a meeting cell (chosen by the authoritative backend grid as
// the free cell nearest their midpoint), shake, show a cartoon fight cloud, then
// bounce back to their original cells. Uses PetManager.getRandomPet() for a rival.
//
// Movement is backend-authoritative: instead of animating to a pixel center, the
// action asks the grid to move each pet (PetManager.requestMove) and the resulting
// tama-grid-update glides them. The visual fight FX (shake/cloud/impacts) still run
// locally on each pet's DOM element.
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
    const targetId = this.input["targetUserId"] as number | undefined;
    const rival = targetId
      ? PetManager.get(targetId)
      : PetManager.getRandomPet(this.pet.userId);

    if (!rival || rival.fsm.state === "action") return;

    const myCell    = PetManager.getCell(this.pet.userId);
    const rivalCell = PetManager.getCell(rival.userId);
    if (!myCell || !rivalCell) return;

    const grid = PetManager.getGrid();
    // Meeting cell = midpoint of the two pets, on the front-ish rows so they're
    // clearly visible. The backend resolves the nearest free cells around it.
    const midX = Math.round((myCell.x + rivalCell.x) / 2);
    const midY = Math.round((myCell.y + rivalCell.y) / 2);
    const leftCell  = { x: Math.max(0, midX - 1), y: midY };
    const rightCell = { x: Math.min(grid.cols - 1, midX + 1), y: midY };

    // Estimate the walk time before the FX so they don't start mid-approach. The
    // pet walks at a constant speed (BasePet.WALK_PX_PER_S); pick the larger of the
    // two spans. Clamp to a sane range so a far/near converge still feels like a fight.
    const myPx    = grid.cellToPx(leftCell.x,  leftCell.y,  this.pet.size);
    const rivalPx = grid.cellToPx(rightCell.x, rightCell.y, rival.size);
    const myDist    = Math.hypot(myPx.left    - this.pet.position.x, myPx.top    - this.pet.position.y);
    const rivalDist = Math.hypot(rivalPx.left - rival.position.x,    rivalPx.top - rival.position.y);
    const walkMs = Math.min(2500, Math.max(500, (Math.max(myDist, rivalDist) / 90) * 1000));

    // Send both toward the meeting cells (backend glides them via grid-update).
    PetManager.requestMove(this.pet.userId, leftCell.x, leftCell.y);
    PetManager.requestMove(rival.userId, rightCell.x, rightCell.y);
    await this.wait(walkMs); // let the approach finish

    if (this.cancelled) return;

    const myEl    = this.pet.domElement;
    const rivalEl = rival.domElement;

    // Shake both
    await Promise.all([
      animate(myEl,    { transform: ["translateX(-8px)", "translateX(8px)", "translateX(-6px)", "translateX(6px)", "translateX(0px)"] }, { duration: 0.4 }),
      animate(rivalEl, { transform: ["translateX(8px)", "translateX(-8px)", "translateX(6px)", "translateX(-6px)", "translateX(0px)"] }, { duration: 0.4 }),
    ]);

    // Fight cloud — centered between the two pets' current pixel positions.
    const cx = (this.pet.position.x + rival.position.x) / 2 + this.pet.size / 2;
    this.cloudEl = this._createCloud(cx);
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

    // Both bounce away (visual only)
    await Promise.all([
      animate(myEl,    { transform: ["translateX(-60px)", "translateX(0px)"], opacity: [0.5, 1] }, { duration: 0.4 }),
      animate(rivalEl, { transform: ["translateX(60px)", "translateX(0px)"],  opacity: [0.5, 1] }, { duration: 0.4 }),
    ]);

    // Clear any WAAPI transform residue so it doesn't fight the cell transform.
    myEl.style.transform    = "";
    rivalEl.style.transform = "";

    // Remove cloud
    if (this.cloudEl) {
      await animate(this.cloudEl, { opacity: 0, transform: "scale(0)" }, { duration: 0.3 });
      this.cloudEl.remove();
      this.cloudEl = null;
    }

    // Send both back to their original cells (backend resolves nearest free).
    PetManager.requestMove(this.pet.userId, myCell.x, myCell.y);
    PetManager.requestMove(rival.userId, rivalCell.x, rivalCell.y);
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
