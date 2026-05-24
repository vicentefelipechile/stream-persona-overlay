// =========================================================================================================
// PET SCHEDULER
// =========================================================================================================
// Periodically checks idle pets and fires random actions according to
// each action's probability weight.
// =========================================================================================================

import { ActionRegistry } from "./ActionRegistry";
import type { BasePet } from "./BasePet";

export class PetScheduler {
  private pets: Map<number, BasePet>;
  private blockedActions: string[];
  private intervalId: ReturnType<typeof setInterval> | null = null;

  private readonly CHECK_INTERVAL_MS  = 8_000;
  private readonly TRIGGER_PROBABILITY = 0.15;

  constructor(pets: Map<number, BasePet>, blockedActions: string[] = []) {
    this.pets           = pets;
    this.blockedActions = blockedActions;
    this._start();
  }

  private _start(): void {
    this.intervalId = setInterval(() => this._tick(), this.CHECK_INTERVAL_MS);
  }

  private _tick(): void {
    const exclude = ["idle_walk", "sleep", ...this.blockedActions];
    for (const pet of this.pets.values()) {
      if (pet.fsm.state !== "idle") continue;
      if (Math.random() > this.TRIGGER_PROBABILITY) continue;

      const actionId = ActionRegistry.getRandomId(exclude);
      if (actionId) pet.executeAction(actionId).catch(console.error);
    }
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
  }
}
