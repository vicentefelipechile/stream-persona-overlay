// =========================================================================================================
// DANCE ACTION
// =========================================================================================================
// Pet dances with rhythmic rotation/bounce and a floating music note.
// =========================================================================================================

import { animate } from "motion";
import { BaseAction, ActionMeta, ActionInput } from "../core/BaseAction";
import { ActionRegistry } from "../core/ActionRegistry";
import type { BasePet } from "../core/BasePet";

export class DanceAction extends BaseAction {
  static readonly meta: ActionMeta = {
    id:             "dance",
    label:          "Bailar",
    description:    "La mascota baila con rotaciones y saltos rítmicos",
    icon:           "💃",
    requiresTarget: false,
    inputs: [
      {
        key:          "text",
        type:         "text",
        label:        "Nota musical o emoji (encima de la mascota)",
        placeholder:  "🎵",
        required:     false,
        defaultValue: "🎵",
      },
    ],
    minDurationMs: 2000,
    maxDurationMs: 5000,
    canInterrupt:  true,
    probability:   0.12,
  };

  private noteEl: HTMLElement | null = null;

  constructor(pet: BasePet, input?: ActionInput) { super(pet, input); }

  async execute(): Promise<void> {
    const el   = this.pet.domElement;
    const note = (this.input["text"] as string) || "🎵";

    // Floating music note
    this.noteEl = document.createElement("div");
    this.noteEl.textContent = note;
    this.noteEl.style.cssText = `
      position:absolute;
      top:-30px;
      left:50%;
      transform:translateX(-50%);
      font-size:20px;
      pointer-events:none;
      opacity:0;
      z-index:5;
    `;
    el.appendChild(this.noteEl);

    animate(this.noteEl,
      { opacity: [0, 1, 1, 0], transform: ["translateX(-50%) translateY(0px)", "translateX(-50%) translateY(-15px)"] },
      { duration: 2, repeat: 2 }
    );

    // 3 dance cycles: rotate + bounce
    for (let i = 0; i < 3; i++) {
      if (this.cancelled) break;
      await animate(el, {
        transform: [
          "rotate(0deg) translateY(0px)",
          "rotate(-15deg) translateY(-10px)",
          "rotate(15deg) translateY(-10px)",
          "rotate(-10deg) translateY(-5px)",
          "rotate(10deg) translateY(-5px)",
          "rotate(0deg) translateY(0px)",
        ],
      }, { duration: 0.6 });
      await this.wait(150);
    }

    this.noteEl?.remove();
    this.noteEl = null;
  }

  protected onCancel(): void {
    this.noteEl?.remove();
    this.noteEl = null;
  }
}

ActionRegistry.register(DanceAction);
