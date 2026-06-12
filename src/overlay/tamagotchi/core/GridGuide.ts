// =========================================================================================================
// GRID GUIDE
// =========================================================================================================
// Optional white perspective guide grid drawn on the floor band, shaped as an
// isosceles trapezoid (narrow at the back, wide at the front) to help the streamer
// align pets and scenery with the pet grid's perspective. Purely a visual aid — it
// holds no state beyond the canvas and the current alpha; the geometry is derived
// from the shared `Grid2D` (floor-band fraction + near/far scale).
//
// Drawn on a full-window <canvas> layered behind the pets (and behind the overlay
// background). When alpha is 0 the canvas is hidden and nothing is drawn.
// =========================================================================================================

import type { Grid2D } from "./Grid2D";

export class GridGuide {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private grid: Grid2D;
  private alpha = 0;

  // Number of guide lines drawn in each direction. Independent from the logical
  // grid resolution (150x30) — that many lines would be unreadable.
  private static readonly COLS = 12;
  private static readonly ROWS = 8;

  constructor(container: HTMLElement, grid: Grid2D) {
    this.grid = grid;
    this.canvas = document.createElement("canvas");
    this.canvas.id = "overlay-grid-guide";
    this.canvas.style.cssText =
      "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;display:none;";
    // Insert as the first child so it sits behind the pets (which are z-index:1+
    // within the container) but above the overlay background (#overlay-bg, z-index:0).
    container.insertBefore(this.canvas, container.firstChild);
    this.ctx = this.canvas.getContext("2d");
  }

  /** Update the guide opacity (0–1) and redraw. */
  setAlpha(alpha: number): void {
    this.alpha = Math.max(0, Math.min(1, alpha));
    this.draw();
  }

  /** Recompute and repaint (call on resize / config change). */
  draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    if (this.alpha <= 0) {
      this.canvas.style.display = "none";
      return;
    }
    this.canvas.style.display = "block";

    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    ctx.clearRect(0, 0, w, h);

    // The guide uses the SAME projector the pets use: Grid2D.projectPoint(fx, fy)
    // maps a normalized cell (fx column, fy depth) to a pixel, for every perspective
    // style, so the grid lines land exactly where pets stand and bend with whatever
    // curvature is active (flat / downhill / horizon / dome).
    const pt = (fx: number, fy: number) => this.grid.projectPoint(fx, fy);

    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.shadowColor = "rgba(0,0,0,0.4)";
    ctx.shadowBlur = 2;

    // Horizontal lines (rows) — polylines sampled across X so curved styles show.
    const XS = GridGuide.COLS * 2;
    for (let r = 0; r <= GridGuide.ROWS; r++) {
      const fy = r / GridGuide.ROWS;
      ctx.beginPath();
      for (let s = 0; s <= XS; s++) {
        const { x, y } = pt(s / XS, fy);
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Vertical lines (columns) — polylines sampled across depth so they bend.
    const YS = GridGuide.ROWS * 3;
    for (let c = 0; c <= GridGuide.COLS; c++) {
      const fx = c / GridGuide.COLS;
      ctx.beginPath();
      for (let s = 0; s <= YS; s++) {
        const { x, y } = pt(fx, s / YS);
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  destroy(): void {
    this.canvas.remove();
  }
}
