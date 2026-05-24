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
  private enabledActionIds: string[] | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  private checkIntervalMs   = 8_000;
  private triggerProbability = 0.15;

  constructor(pets: Map<number, BasePet>, blockedActions: string[] = []) {
    this.pets           = pets;
    this.blockedActions = blockedActions;
    this._start();
  }

  update(checkIntervalSecs: number, probability: number, enabledActions?: string[]): void {
    this.checkIntervalMs    = checkIntervalSecs * 1000;
    this.triggerProbability = probability;
    if (enabledActions !== undefined) this.enabledActionIds = enabledActions;
    if (this.intervalId) clearInterval(this.intervalId);
    this._start();
  }

  private _start(): void {
    this.intervalId = setInterval(() => this._tick(), this.checkIntervalMs);
  }

  private _tick(): void {
    const baseExclude = ["idle_walk", "sleep", ...this.blockedActions];
    let exclude = baseExclude;
    if (this.enabledActionIds !== null) {
      const notEnabled = ActionRegistry.getAllMeta()
        .filter(m => !this.enabledActionIds!.includes(m.id))
        .map(m => m.id);
      exclude = [...baseExclude, ...notEnabled];
    }
    for (const pet of this.pets.values()) {
      if (pet.fsm.state !== "idle") continue;
      if (Math.random() > this.triggerProbability) continue;

      const actionId = ActionRegistry.getRandomId(exclude);
      if (actionId) pet.executeAction(actionId).catch(console.error);
    }
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
  }
}
