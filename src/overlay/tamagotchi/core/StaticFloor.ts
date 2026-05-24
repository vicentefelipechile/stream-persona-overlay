// =========================================================================================================
// STATIC FLOOR
// =========================================================================================================
// Queue-based pet positioning strategy for "static" layout mode.
// Pets are assigned numbered slots along the left or right edge of the floor
// rather than walking freely. Slots are never compacted after release — gaps
// are acceptable and expected.
// =========================================================================================================

export interface StaticFloorConfig {
  anchor: "left" | "right";
  spacingPx: number;
  petSizePx: number;
  floorY: number;
}

export class StaticFloor {
  private slots = new Map<number, number>(); // userId → slotIndex
  private usedIndices = new Set<number>();   // slot indices currently occupied
  private anchor: "left" | "right";
  private spacingPx: number;
  private petSizePx: number;
  floorY: number;

  constructor(cfg: StaticFloorConfig) {
    this.anchor    = cfg.anchor;
    this.spacingPx = cfg.spacingPx;
    this.petSizePx = cfg.petSizePx;
    this.floorY    = cfg.floorY;
  }

  // Assign the next free slot to a new user. Returns the absolute CSS left value.
  assignSlot(userId: number): number {
    if (this.slots.has(userId)) {
      return this._slotX(this.slots.get(userId)!);
    }
    // Find the smallest non-negative integer not already occupied.
    let index = 0;
    while (this.usedIndices.has(index)) index++;

    this.slots.set(userId, index);
    this.usedIndices.add(index);
    return this._slotX(index);
  }

  // Free a slot. Does not repack — the gap remains until the slot is naturally reused.
  releaseSlot(userId: number): void {
    const index = this.slots.get(userId);
    if (index !== undefined) {
      this.usedIndices.delete(index);
      this.slots.delete(userId);
    }
  }

  // Absolute CSS left value for a given slot index.
  private _slotX(index: number): number {
    const margin = this.petSizePx / 2 + 10;
    if (this.anchor === "left") {
      return margin + index * this.spacingPx;
    }
    return window.innerWidth - margin - index * this.spacingPx;
  }
}
