// =========================================================================================================
// PET FLOOR
// =========================================================================================================
// Tracks pet positions on the floor strip and provides collision-free spawn
// coordinates for new pets.
// =========================================================================================================

export interface FloorConfig {
  y: number;
  thickness: number;
  minSpacing: number;
}

export class PetFloor {
  private config: FloorConfig;
  private positions = new Map<number, number>();

  constructor(config: FloorConfig) {
    this.config = config;
  }

  getSpawnX(userId: number, petWidth: number): number {
    const used   = Array.from(this.positions.values());
    const margin = petWidth / 2 + 20;
    const maxX   = window.innerWidth - margin;

    for (let attempt = 0; attempt < 20; attempt++) {
      const x = margin + Math.random() * (maxX - margin);
      const tooClose = used.some(px => Math.abs(px - x) < this.config.minSpacing);
      if (!tooClose) {
        this.positions.set(userId, x);
        return x;
      }
    }

    // Fallback — evenly spaced
    const x = margin + (this.positions.size * this.config.minSpacing) % (maxX - margin);
    this.positions.set(userId, x);
    return x;
  }

  updatePosition(userId: number, x: number): void {
    this.positions.set(userId, x);
  }

  remove(userId: number): void {
    this.positions.delete(userId);
  }

  get floorY(): number  { return this.config.y; }
  set floorY(y: number) { this.config.y = y; }
}
