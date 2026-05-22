// =========================================================================================================
// IDLE WALK ACTION
// =========================================================================================================
// Placeholder action for the idle walking state. The actual walk loop runs in
// BasePet._startIdleWalk(). This entry exists so the registry is complete and
// idle_walk can be excluded from random action selection by name.
// =========================================================================================================

import { BaseAction, ActionMeta } from "../core/BaseAction";
import { ActionRegistry } from "../core/ActionRegistry";
import type { BasePet } from "../core/BasePet";

export class IdleWalkAction extends BaseAction {
  static readonly meta: ActionMeta = {
    id:             "idle_walk",
    label:          "Caminar",
    description:    "La mascota camina de un lado a otro en el suelo",
    icon:           "🚶",
    requiresTarget: false,
    inputs:         [],
    minDurationMs:  0,
    maxDurationMs:  Infinity,
    canInterrupt:   true,
    probability:    0, // Never chosen randomly — always active as the base state
  };

  constructor(pet: BasePet) { super(pet); }

  async execute(): Promise<void> {
    // Handled entirely by BasePet's FSM onEnter("idle") listener
  }
}

ActionRegistry.register(IdleWalkAction);
