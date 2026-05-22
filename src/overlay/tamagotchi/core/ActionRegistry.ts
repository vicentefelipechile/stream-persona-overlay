// =========================================================================================================
// ACTION REGISTRY
// =========================================================================================================
// Central registry for all tamagotchi pet actions.
// Actions self-register by calling ActionRegistry.register(MyAction) at the
// bottom of their module file. Importing the module is enough to register it.
// =========================================================================================================

import type { BasePet } from "./BasePet";
import type { BaseAction, ActionInput, ActionMeta } from "./BaseAction";

type ActionConstructor = new (pet: BasePet, input?: ActionInput) => BaseAction;

export class ActionRegistry {
  private static registry = new Map<string, ActionConstructor>();
  private static metaMap  = new Map<string, ActionMeta>();

  static register(ActionClass: ActionConstructor & { meta: ActionMeta }): void {
    const { id } = ActionClass.meta;
    this.registry.set(id, ActionClass);
    this.metaMap.set(id, ActionClass.meta);
  }

  static get(id: string): ActionConstructor | undefined {
    return this.registry.get(id);
  }

  static getAllMeta(): ActionMeta[] {
    return Array.from(this.metaMap.values());
  }

  // Weighted random selection — respects each action's probability field.
  static getRandomId(exclude: string[] = []): string | null {
    const available = Array.from(this.metaMap.values())
      .filter(m => !exclude.includes(m.id) && m.probability > 0);
    if (!available.length) return null;

    const total = available.reduce((s, m) => s + m.probability, 0);
    let rand = Math.random() * total;
    for (const meta of available) {
      rand -= meta.probability;
      if (rand <= 0) return meta.id;
    }
    return available[available.length - 1].id;
  }
}
