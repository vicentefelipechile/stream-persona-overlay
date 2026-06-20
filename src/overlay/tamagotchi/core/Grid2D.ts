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

/** Floor projection style. "plano" = straight trapezoid; "colina_abajo" = sides bow
 *  inward (downhill); "horizonte" = back rows arch up in the centre (spherical horizon). */
export type PerspectiveType = "plano" | "colina_abajo" | "horizonte";

/** Pet placement model. "free" = the wandering 2D grid with perspective; "row" = a
 *  single static line of equally-sized pets pinned to one bottom corner. */
export type PlacementMode = "free" | "row";

/** Which edge the static row is anchored to (row mode only). */
export type RowAnchor = "left" | "right";

export interface GridConfig {
  cols: number;
  rows: number;
  perspective: boolean;
  perspectiveType: PerspectiveType;
  nearScale: number;
  farScale: number;
  floorTopFrac: number;
  placementMode: PlacementMode;
  rowAnchor: RowAnchor;
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
  perspectiveType: "plano",
  nearScale: 1.3,
  farScale: 0.6,
  floorTopFrac: 0.55,
  placementMode: "free",
  rowAnchor: "left",
};

export class Grid2D {
  private cfg: GridConfig = { ...DEFAULT_CONFIG };

  /** Horizontal padding (px) kept clear on each side so pets don't clip the edges. */
  private static readonly EDGE_PAD = 60;
  /** Fraction of the viewport height kept clear below the front floor row, so the
   *  band (and the guide grid + front pets) doesn't run all the way to the very
   *  bottom edge of the screen. */
  private static readonly BOTTOM_MARGIN_FRAC = 0.04;
  /** Side-wall curvature for the "colina_abajo" style. 0 = straight trapezoid sides;
   *  higher values bow the left/right edges inward toward the centre. */
  private static readonly SIDE_CURVE = 0.18;
  /** Arch height for the "horizonte" style, as a fraction of the band height. The
   *  back-centre of the floor lifts by up to this much, fading to the front edge. */
  private static readonly HORIZON_ARCH = 0.16;

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
  get floorTopFrac(): number { return this.cfg.floorTopFrac; }

  /**
   * Translate a cell to screen pixels. `petSizePx` is the base sprite size; the
   * returned `left`/`top` already account for the sprite size so the pet sits
   * visually centered on its column and stands on the floor band.
   */
  cellToPx(cellX: number, cellY: number, petSizePx: number): CellPx {
    if (this.cfg.placementMode === "row") {
      return this.rowCellToPx(cellX, petSizePx);
    }

    const { cols, rows } = this.cfg;

    // Normalized position within the grid (0..1). Guard against 1-wide/1-tall grids.
    const fx = cols > 1 ? cellX / (cols - 1) : 0.5;
    const fy = rows > 1 ? cellY / (rows - 1) : 1;

    const scale = this.scaleForRow(cellY);

    // The floor band is ONE projection (projectPoint), shared by pets AND the guide
    // grid for every style, so a pet's foot point and its column always agree. The
    // point is the centre of the pet's base; offset by the sprite box.
    const { x, y } = this.projectPoint(fx, fy);
    const left = x - (petSizePx * scale) / 2;
    const top = y - petSizePx * scale;

    // Front rows (higher cellY) must paint over back rows; within a row, lower
    // cellX paints over higher cellX (matches the legacy left-in-front rule).
    const z = Math.round(cellY * 1000 + (cols - cellX));

    return { left, top, scale, z };
  }

  // =========================================================================================================
  // Static-row projection (placementMode === "row")
  // =========================================================================================================

  /** Gap between two adjacent pets in the static row, as a fraction of the sprite
   *  size. The slot pitch is `petSizePx * (1 + ROW_GAP_FRAC)`. */
  private static readonly ROW_GAP_FRAC = 0.2;

  /**
   * Flat-row placement: pets are equal-sized (scale 1) and packed in a single line
   * along the bottom, starting flush against the anchored edge. `col` is the
   * backend-assigned slot (0 = nearest the edge). The row sits on the same floor line
   * the free band would use at its front (`1 - BOTTOM_MARGIN_FRAC`), so toggling modes
   * keeps the pets near the bottom of the screen.
   */
  private rowCellToPx(col: number, petSizePx: number): CellPx {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pitch = petSizePx * (1 + Grid2D.ROW_GAP_FRAC);

    // Left edge of the slot, measured from the anchored side toward the centre.
    const offset = Grid2D.EDGE_PAD + col * pitch;
    const left = this.cfg.rowAnchor === "right"
      ? w - Grid2D.EDGE_PAD - petSizePx - col * pitch
      : offset;

    const top = h * (1 - Grid2D.BOTTOM_MARGIN_FRAC) - petSizePx;
    // Newest/outermost pets paint behind the ones nearer the edge so overlaps (if the
    // line ever gets dense) read as a queue stacking away from the corner.
    const z = Math.round(10_000 - col);
    return { left, top, scale: 1, z };
  }

  /** Perspective scale for a given row, or 1 when perspective is off. Uses the same
   *  curved depth as the floor band so the sprite shrinks in step with the rows. */
  scaleForRow(cellY: number): number {
    if (!this.cfg.perspective) return 1;
    const { farScale, nearScale } = this.cfg;
    return farScale + (nearScale - farScale) * this.rowDepth(cellY);
  }

  // =========================================================================================================
  // Floor-band projection (shared by pets AND the guide grid)
  // =========================================================================================================

  /**
   * Normalized depth of a row, 0 = back (far), 1 = front (near), with a real
   * **perspective curve** (not linear) so rows compress toward the BACK — that's what
   * sells the depth instead of an orthographic-looking flat trapezoid.
   *
   * `t = cellY/(rows-1)` is linear (0 = far, 1 = near). A camera looking down a floor
   * foreshortens the far rows: their `depth` must change SLOWLY near t=0 (rows bunch
   * up at the back) and quickly near t=1 (rows spread out at the front). The
   * projective map that does this is `depth = t / (m - (m-1)·t)` with `m =
   * nearScale/farScale ≥ 1` — bigger near/far gap ⇒ stronger foreshortening. With
   * perspective off (or m≈1) it collapses back to linear. rowTop / rowEdges /
   * scaleForRow all read this, so pets and the guide grid curve together.
   */
  private rowDepth(cellY: number): number {
    const { rows } = this.cfg;
    const t = rows > 1 ? cellY / (rows - 1) : 1;
    if (!this.cfg.perspective || this.cfg.farScale <= 0) return t;
    const m = Math.max(1, Math.min(8, this.cfg.nearScale / this.cfg.farScale));
    return t / (m - (m - 1) * t);
  }

  /**
   * Projected pixel point for a normalized cell position. `fx`/`fy` are 0..1 (fx =
   * column left→front, fy = depth back→front). This is the unified projector used by
   * BOTH the pets (`cellToPx`) and the guide grid for every style, so they always
   * agree. It defers to rowEdges()/rowTop() which apply the per-style curvature.
   */
  projectPoint(fx: number, fy: number): { x: number; y: number } {
    const cellY = fy * Math.max(0, this.cfg.rows - 1);
    const { left, right } = this.rowEdges(cellY);
    return { x: left + (right - left) * fx, y: this.rowTop(cellY, fx) };
  }

  /** Y pixel of the floor line for a row (where a pet on that row stands). The band
   *  runs from floorTopFrac*h down to (1 - BOTTOM_MARGIN_FRAC)*h, leaving a margin so
   *  the front row / guide grid don't reach the very bottom edge.
   *
   *  `fx` (0..1, horizontal position in the row) only matters for the "horizonte"
   *  style, where the back rows arch UP in the centre (spherical-horizon look): the
   *  arch is a parabola across X (peak at fx=0.5, zero at the edges) whose height
   *  fades from the back (max) to the front (none). Other styles ignore `fx`. */
  rowTop(cellY: number, fx = 0.5): number {
    const h = window.innerHeight;
    const bandTop = h * this.cfg.floorTopFrac;
    const bandBottom = h * (1 - Grid2D.BOTTOM_MARGIN_FRAC);
    const bandH = Math.max(0, bandBottom - bandTop);
    let y = bandTop + this.rowDepth(cellY) * bandH;

    if (this.cfg.perspective && this.cfg.perspectiveType === "horizonte") {
      const arch = 1 - 4 * (fx - 0.5) * (fx - 0.5);   // 1 at centre, 0 at edges
      const depthFade = 1 - this.rowDepth(cellY);       // 1 at back, 0 at front
      y -= Grid2D.HORIZON_ARCH * bandH * arch * depthFade;
    }
    return y;
  }

  /**
   * Left/right pixel edges of the floor band at a given row. The band is a trapezoid
   * (narrow at the back, full width at the front) so a column converges with depth,
   * exactly like the sprites shrink. The back width is tied to the perspective scale
   * ratio (far/near) so the taper matches how much smaller far pets are — when
   * perspective is off the band is a full-width rectangle.
   */
  rowEdges(cellY: number): { left: number; right: number } {
    const w = window.innerWidth;
    const usableW = Math.max(0, w - Grid2D.EDGE_PAD * 2);
    const fy = this.rowDepth(cellY);

    // widthFrac: fraction of the full width at this row. Front = 1, back = far/near.
    let widthFrac = 1;
    if (this.cfg.perspective && this.cfg.nearScale > 0) {
      const backFrac = Math.min(1, this.cfg.farScale / this.cfg.nearScale);
      widthFrac = backFrac + (1 - backFrac) * fy;
      // "colina_abajo": bow the side walls inward (an inward bulge that is 0 at both
      // ends and peaks mid-depth) so the left/right edges read as curved diagonals.
      if (this.cfg.perspectiveType === "colina_abajo") {
        widthFrac *= 1 - Grid2D.SIDE_CURVE * Math.sin(Math.PI * fy);
      }
    }
    const rowW = usableW * widthFrac;
    const left = Grid2D.EDGE_PAD + (usableW - rowW) / 2;
    return { left, right: left + rowW };
  }
}
