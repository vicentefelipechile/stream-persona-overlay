// =========================================================================================================
// ACTION TEMPLATE
// =========================================================================================================
// Copy this file to create a new tamagotchi action.
// Replace MyNewAction / "my_action" / labels throughout, then register at the bottom.
//
// Motion v12 rules:
//   - Use CSS transform strings: { transform: "translateY(20px) scale(0.8)" }
//   - Springs: { type: "spring", stiffness: 300, damping: 20 }  (not spring() import)
//   - Easing:  { ease: "easeOut" }  (not "easing:")
//   - Always await animate() directly — no .finished needed
// =========================================================================================================

import { animate } from "motion";
import { BaseAction, ActionMeta, ActionInput } from "../core/BaseAction";
import { ActionRegistry } from "../core/ActionRegistry";
import type { BasePet } from "../core/BasePet";

export class MyNewAction extends BaseAction {
  static readonly meta: ActionMeta = {
    id:             "my_action",       // Unique snake_case ID
    label:          "Mi Acción",       // Shown in the admin panel
    description:    "Descripción breve de qué hace la acción.",
    icon:           "🎯",
    requiresTarget: false,
    inputs: [
      // Add inputs as needed:
      // { key: "text", type: "text", label: "Texto", required: false }
    ],
    minDurationMs: 500,
    maxDurationMs: 3000,
    canInterrupt:  true,
    probability:   0.1,   // Weight for random selection (0 = never random)
  };

  constructor(pet: BasePet, input?: ActionInput) { super(pet, input); }

  async execute(): Promise<void> {
    const el = this.pet.domElement;

    // Example animation — replace with your logic:
    await animate(el, { transform: "scale(1.2)" }, { duration: 0.2 });
    await this.wait(500); // Respects cancellation
    await animate(el, { transform: "scale(1)" }, { duration: 0.2 });

    // Use this.input.text, this.input.imageUrl, etc. for custom inputs
    // Use this.cancelled to check for early cancellation inside loops
  }

  protected onCancel(): void {
    // Clean up any DOM elements you created (props, bubbles, etc.)
  }
}

// Register ALWAYS at the bottom — this runs on module import
ActionRegistry.register(MyNewAction);
