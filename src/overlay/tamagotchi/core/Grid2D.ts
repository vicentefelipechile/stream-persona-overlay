// =========================================================================================================
// GRID 2D
// =========================================================================================================
// Pure cell -> pixel translator for the backend-authoritative pet grid. The Rust
// `GridManager` owns cell assignment and movement; this class only knows the grid
// dimensions (received via `tama-grid-config`) and turns a cell `(cellX, cellY)`
// into screen pixels, a perspective scale, and a z-index.
//
// The grid is laid over a "floor band": a vertical strip from `floorTopFrac` of the
// viewport height down to the bottom. Row 0 is the back of the band (far, small),
// the last row is the front (near, large). Columns spread across the usable width.
//
// This holds NO authoritative pet state — PetManager feeds it the cell the backend
// assigned and renders the result. It is recomputed live on window resize.
// =========================================================================================================

export interface GridConfig {
  cols: number;
  rows: number;
  perspective: boolean;
  nearScale: number;
  farScale: number;
  floorTopFrac: number;
}

export interface CellPx {
  left: number;
  top: number;
  scale: number;
  z: number;
}

const DEFAULT_CONFIG: GridConfig = {
  cols: 150,
  rows: 30,
  perspective: true,
  nearScale: 1.3,
  farScale: 0.6,
  floorTopFrac: 0.55,
};

export class Grid2D {
  private cfg: GridConfig = { ...DEFAULT_CONFIG };

  /** Horizontal padding (px) kept clear on each side so pets don't clip the edges. */
  private static readonly EDGE_PAD = 60;

  /** Merge partial config from the backend (`tama-grid-config` / get_config). */
  setConfig(partial: Partial<GridConfig>): void {
    this.cfg = { ...this.cfg, ...partial };
  }

  /** Just the dimensions, when only `tama-grid-config` (cols/rows) arrives. */
  setDimensions(cols: number, rows: number): void {
    if (cols > 0) this.cfg.cols = cols;
    if (rows > 0) this.cfg.rows = rows;
  }

  get cols(): number { return this.cfg.cols; }
  get rows(): number { return this.cfg.rows; }

  /**
   * Translate a cell to screen pixels. `petSizePx` is the base sprite size; the
   * returned `left`/`top` already account for the sprite size so the pet sits
   * visually centered on its column and stands on the floor band.
   */
  cellToPx(cellX: number, cellY: number, petSizePx: number): CellPx {
    const { cols, rows } = this.cfg;
    const w = window.innerWidth;
    const h = window.innerHeight;

    // Normalized position within the grid (0..1). Guard against 1-wide/1-tall grids.
    const fx = cols > 1 ? cellX / (cols - 1) : 0.5;
    const fy = rows > 1 ? cellY / (rows - 1) : 1;

    const scale = this.scaleForRow(cellY);

    // Floor band runs from floorTopFrac*h down to the bottom.
    const bandTop = h * this.cfg.floorTopFrac;
    const bandH = Math.max(0, h - bandTop);
    const top = bandTop + fy * bandH - petSizePx * scale;

    const usableW = Math.max(0, w - Grid2D.EDGE_PAD * 2);
    const left = Grid2D.EDGE_PAD + fx * usableW - (petSizePx * scale) / 2;

    // Front rows (higher cellY) must paint over back rows; within a row, lower
    // cellX paints over higher cellX (matches the legacy left-in-front rule).
    const z = Math.round(cellY * 1000 + (cols - cellX));

    return { left, top, scale, z };
  }

  /** Perspective scale for a given row, or 1 when perspective is off. */
  scaleForRow(cellY: number): number {
    if (!this.cfg.perspective) return 1;
    const { rows, farScale, nearScale } = this.cfg;
    const fy = rows > 1 ? cellY / (rows - 1) : 1;
    return farScale + (nearScale - farScale) * fy;
  }
}
