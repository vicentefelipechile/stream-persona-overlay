// =========================================================================================================
// PERSONA QUEUE
// =========================================================================================================
// Manages the set of currently-active persona bubbles, handles eviction when
// MAX_VISIBLE is reached, and exposes helpers for parallel and queue display modes.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { PersonaController } from "./persona-controller";

// =========================================================================================================
// PersonaQueue
// =========================================================================================================

export class PersonaQueue {
  /** user_id → active controller */
  private active = new Map<number, PersonaController>();
  private maxVisible: number;

  constructor(maxVisible = 4) {
    this.maxVisible = maxVisible;
  }

  setMaxVisible(n: number): void {
    this.maxVisible = n;
  }

  // =========================================================================================================
  // Add / Remove
  // =========================================================================================================

  async add(userId: number, controller: PersonaController): Promise<void> {
    if (this.active.size >= this.maxVisible) {
      // Evict the oldest entry to make room
      const oldestId = this.active.keys().next().value;
      if (oldestId !== undefined) await this.remove(oldestId);
    }
    this.active.set(userId, controller);
    await controller.animateIn();
  }

  async remove(userId: number): Promise<void> {
    const c = this.active.get(userId);
    if (!c) return;
    this.active.delete(userId);
    await c.animateOut();
    c.destroy();
  }

  // =========================================================================================================
  // Query
  // =========================================================================================================

  get(userId: number): PersonaController | undefined {
    return this.active.get(userId);
  }

  has(userId: number): boolean {
    return this.active.has(userId);
  }

  size(): number {
    return this.active.size;
  }

  /** Returns all X positions currently occupied. */
  usedPositions(): Set<number> {
    return new Set([...this.active.values()].map((c) => c.getPositionX()));
  }
}
