// =========================================================================================================
// JUMP ACTION
// =========================================================================================================
// Pet performs one or more bouncy jumps with squash-and-stretch.
//
// All vertical movement uses transform: translateY() instead of the `top` CSS property.
// `top` is a layout property — WAAPI applies it instantaneously (no smooth interpolation).
// translateY is composited on the GPU and interpolates correctly.
//
// The element's `top` (= floorY) stays untouched throughout the entire action.
// The jump height is expressed as a negative translateY offset.
//
// All keyframes include the full transform string so Motion can interpolate every
// component smoothly. This also prevents residual transforms from previous actions
// (e.g. rotate(0deg) from DanceAction) from leaking into the squash/stretch phases.
// =========================================================================================================

import { animate } from "motion";
import { BaseAction, ActionMeta, ActionInput } from "../core/BaseAction";
import { ActionRegistry } from "../core/ActionRegistry";
import type { BasePet } from "../core/BasePet";

export class JumpAction extends BaseAction {
  static readonly meta: ActionMeta = {
    id:             "jump",
    label:          "Saltar",
    description:    "La mascota da uno o varios saltos en el lugar",
    icon:           "⬆️",
    requiresTarget: false,
    inputs: [
      {
        key:          "jumps",
        type:         "range",
        label:        "Número de saltos",
        required:     false,
        defaultValue: "2",
        min:          1,
        max:          5,
      },
    ],
    minDurationMs: 400,
    maxDurationMs: 2000,
    canInterrupt:  true,
    probability:   0.25,
  };

  constructor(pet: BasePet, input?: ActionInput) { super(pet, input); }

  async execute(): Promise<void> {
    const el    = this.pet.domElement;
    const jumps = Number(this.input["jumps"] ?? 2);

    // Reset any leftover transform from a previous action before starting.
    // Previous actions may leave rotate(), translateY() or other functions
    // that would corrupt the squash/stretch interpolation.
    await animate(el,
      { transform: "scaleX(1) scaleY(1) translateY(0px)" },
      { duration: 0.05 }
    );

    for (let i = 0; i < jumps; i++) {
      if (this.cancelled) break;
      const jumpHeight = 60 + Math.random() * 30;

      // Pre-jump squash — compress vertically before the leap
      await animate(el,
        { transform: ["scaleX(1) scaleY(1) translateY(0px)", "scaleX(1.2) scaleY(0.8) translateY(0px)"] },
        { duration: 0.1 }
      );

      // Rise — translateY moves the pet up; scaleY stretches it mid-air
      await animate(el,
        { transform: `scaleX(0.9) scaleY(1.1) translateY(-${jumpHeight}px)` },
        { duration: 0.25, ease: "easeOut" }
      );

      // Land — return to floor with impact squash
      await animate(el,
        { transform: "scaleX(1.3) scaleY(0.7) translateY(0px)" },
        { duration: 0.2, ease: "easeIn" }
      );

      // Recover shape
      await animate(el,
        { transform: "scaleX(1) scaleY(1) translateY(0px)" },
        { duration: 0.15, type: "spring", stiffness: 400, damping: 15 }
      );

      if (i < jumps - 1) await this.wait(100);
    }
  }
}

ActionRegistry.register(JumpAction);
