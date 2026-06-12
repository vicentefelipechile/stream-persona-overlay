// =========================================================================================================
// BASE PET
// =========================================================================================================
// Concrete tamagotchi pet class. Manages its own DOM element, FSM, lip-sync,
// sleep, and despawn lifecycle.
//
// Positioning is backend-authoritative: the Rust `GridManager` assigns each pet a
// grid cell and broadcasts it. PetManager translates the cell to pixels (via Grid2D)
// and calls `applyCell()` here — the pet never decides where to walk on its own.
// There is no local wander/idle-walk loop anymore.
//
// Motion v12 constraint: ALL transform animations use CSS transform strings
// (e.g. "translateY(40px) scale(0.8)") — never shorthand x/y/scale/rotate keys.
// =========================================================================================================

import { animate } from "motion";
import { invoke } from "@tauri-apps/api/core";
import { PetStateMachine } from "./PetStateMachine";

// Module-level invoke override. Defaults to the Tauri invoke.
// PetManager sets this before creating any pets when running in browser mode.
type InvokeFn = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
let _invoke: InvokeFn = invoke as InvokeFn;
export function configureBasePetInvoke(fn: InvokeFn): void { _invoke = fn; }

import { ActionRegistry } from "./ActionRegistry";
import type { BaseAction, ActionInput } from "./BaseAction";
import { PropRenderer } from "../props/PropRenderer";
import type { CellPx } from "./Grid2D";

// =========================================================================================================
// Types
// =========================================================================================================

export interface PetConfig {
  userId: number;
  displayName: string;
  mouthOpenUrl: string;
  mouthClosedUrl: string;
  sizePx: number;
  nameFontSizePx?: number;
}

export interface PetPosition {
  x: number;
  y: number;
}

export interface Cell {
  x: number;
  y: number;
}

// =========================================================================================================
// BasePet
// =========================================================================================================

export class BasePet {
  readonly userId: number;
  readonly config: PetConfig;
  readonly fsm: PetStateMachine;
  readonly props: PropRenderer;

  private el: HTMLElement;
  private imgOpen: HTMLImageElement;
  private imgClosed: HTMLImageElement;

  // Current grid cell (authoritative source = backend). Defaults to (0,0) until
  // the first `tama-grid-update` arrives.
  cell: Cell = { x: 0, y: 0 };
  // Last applied pixel placement, kept so actions can read floorY / position.
  pos: PetPosition = { x: 0, y: 0 };
  private currentScale = 1;
  private direction: 1 | -1 = 1;

  private currentAction: BaseAction | null = null;
  private cellAnimAbort: (() => void) | null = null;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private despawnCallback: (() => void) | null = null;

  // Reads from BasePet.inactivityMs so runtime config changes take effect on next reset.
  private get INACTIVITY_TIMEOUT_MS(): number { return BasePet.inactivityMs; }

  constructor(container: HTMLElement, config: PetConfig) {
    this.userId = config.userId;
    this.config = config;
    this.fsm    = new PetStateMachine();

    this.el         = this._buildDOM(container);
    this.props      = new PropRenderer();
    this.imgOpen    = this.el.querySelector<HTMLImageElement>(".pet-mouth-open")!;
    this.imgClosed  = this.el.querySelector<HTMLImageElement>(".pet-mouth-closed")!;

    this._setupFSMListeners();
    this._resetInactivityTimer();
  }

  // =========================================================================================================
  // DOM Construction
  // =========================================================================================================

  private _buildDOM(container: HTMLElement): HTMLElement {
    const el = document.createElement("div");
    el.className = "tamagotchi-pet";
    el.dataset["userId"] = String(this.userId);
    // The perspective scale is applied via the individual `scale` CSS property
    // (NOT `transform`), so it composes independently of the `transform` strings
    // that actions animate (jumps, shakes). Because `scale` lives on `.el`, it
    // scales EVERYTHING inside — the sprite, the name label, and any action props
    // (food, 💥, notes…) — keeping far/small pets visually consistent. `transform-
    // origin: bottom center` keeps the pet planted on the floor while it scales.
    el.style.cssText = `
      position:absolute;
      width:${this.config.sizePx}px;
      height:${this.config.sizePx}px;
      left:0px;
      top:0px;
      transform-origin:bottom center;
      scale:1;
      user-select:none;
    `;
    el.innerHTML = `
      <div class="pet-inner" style="position:relative;width:100%;height:100%;">
        <img class="pet-mouth-open"
             src="${this.config.mouthOpenUrl}"
             style="position:absolute;inset:0;width:100%;opacity:0;object-fit:contain;"/>
        <img class="pet-mouth-closed"
             src="${this.config.mouthClosedUrl}"
             style="position:absolute;inset:0;width:100%;opacity:1;object-fit:contain;"/>
      </div>
      <div class="pet-name" style="font-size:${this.config.nameFontSizePx ?? 11}px;">${this.config.displayName}</div>
    `;
    container.appendChild(el);
    return el;
  }

  // =========================================================================================================
  // FSM Listeners
  // =========================================================================================================

  private _setupFSMListeners(): void {
    this.fsm.onEnter("sleeping",  () => this._startSleep());
    this.fsm.onEnter("despawning",() => { this._doDespawn().catch(() => {}); });
  }

  // =========================================================================================================
  // Public API
  // =========================================================================================================

  setDespawnCallback(cb: () => void): void {
    this.despawnCallback = cb;
  }

  async spawn(): Promise<void> {
    this.el.style.opacity   = "0";
    this.el.style.transform = "translateY(40px) scale(0.8)";
    await animate(this.el,
      {
        opacity:   [0, 1, 1],
        transform: [
          "translateY(40px) scale(0.8)",
          "translateY(-10px) scale(1.05)",
          "translateY(0px) scale(1)",
        ],
      },
      { duration: 0.6, type: "spring", stiffness: 300, damping: 20 }
    );
    // Clear the spawn transform from `.el`; `_applyTransform` then sets the
    // perspective scale (on `.el`) and the flip (on `.pet-inner`).
    this.el.style.opacity   = "1";
    this.el.style.transform = "";
    this._applyTransform();
    this.fsm.transition("idle");
    this._persistState(false);
  }

  async onChatMessage(): Promise<void> {
    this._resetInactivityTimer();
    if (this.fsm.state === "sleeping") {
      // Wake the pet — it stays on its current cell; the backend keeps placing it.
      this._stopCurrentAction();
      this.props.hideAll();
      this.fsm.transition("idle");
      this._persistState(false);
    }
  }

  // Throttles heart emission so a rapid like burst doesn't spawn hundreds of nodes.
  private lastHeartAt = 0;
  private chatBubbleEl: HTMLElement | null = null;
  private chatBubbleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Emit a floating heart over the pet (TikTok "like" reaction). Throttled. */
  emitHeart(): void {
    const now = performance.now();
    if (now - this.lastHeartAt < 120) return;
    this.lastHeartAt = now;
    this.props.emitHeart(this.el);
  }

  /**
   * Show a short-lived chat bubble above the pet's head. Truncated to `maxChars`
   * (ellipsis if longer). Re-shown text resets the auto-hide timer. The bubble is a
   * child of `.el` so it inherits the perspective scale.
   */
  showChatBubble(text: string, maxChars: number): void {
    const limit = Math.max(1, maxChars);
    const trimmed = text.length > limit ? `${text.slice(0, limit)}…` : text;

    if (!this.chatBubbleEl) {
      const bubble = document.createElement("div");
      bubble.className = "pet-chat-bubble";
      this.el.appendChild(bubble);
      this.chatBubbleEl = bubble;
    }
    const bubble = this.chatBubbleEl;
    bubble.textContent = trimmed;
    animate(bubble, { opacity: 1 }, { duration: 0.15 });

    if (this.chatBubbleTimer) clearTimeout(this.chatBubbleTimer);
    this.chatBubbleTimer = setTimeout(() => {
      animate(bubble, { opacity: 0 }, { duration: 0.3 });
    }, 4000);
  }

  setMouth(open: boolean): void {
    animate(this.imgOpen,   { opacity: open ? 1 : 0 }, { duration: 0.04 });
    animate(this.imgClosed, { opacity: open ? 0 : 1 }, { duration: 0.04 });
  }

  async executeAction(actionId: string, input?: ActionInput): Promise<void> {
    if (!this.fsm.canDo("action")) return;
    const ActionClass = ActionRegistry.get(actionId);
    if (!ActionClass) return;

    this._stopCurrentAction();
    this.fsm.transition("action");

    const action = new ActionClass(this, input);
    this.currentAction = action;
    await action.execute();

    this.currentAction = null;
    if (this.fsm.state === "action") this.fsm.transition("idle");
  }

  async remove(): Promise<void> {
    this._stopCurrentAction();
    if (this.fsm.state !== "despawning") this.fsm.transition("despawning");
  }

  /** Hard, synchronous teardown used by PetManager.resetAll() to recreate a pet
   *  from scratch. Stops every timer/action and removes the DOM element
   *  immediately — no despawn animation, no callback, no DB delete. */
  destroy(): void {
    this._stopCurrentAction();
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    if (this.chatBubbleTimer) { clearTimeout(this.chatBubbleTimer); this.chatBubbleTimer = null; }
    this.props.hideAll();
    this.el.remove();
  }

  // =========================================================================================================
  // Cell placement (driven by PetManager from backend grid updates)
  // =========================================================================================================

  // Minutes before a pet falls asleep. Read by _resetInactivityTimer().
  static inactivityMs = 5 * 60 * 1000;
  // Walking speed (px/s) at constant velocity, so a long wander reads as the pet
  // strolling across the floor over several seconds rather than a quick hop.
  // ~90 px/s ⇒ a ~450px span ≈ 5 s. Clamped by MIN/MAX duration below.
  private static readonly WALK_PX_PER_S = 90;
  private static readonly MIN_WALK_MS = 250;
  private static readonly MAX_WALK_MS = 9000;

  /**
   * Place the pet on a grid cell. `cellPx` is the resolved pixel target (left/top/
   * scale/z) from Grid2D. When `animateMove` is true the pet glides; otherwise it
   * snaps (used on spawn and window resize). Always the authoritative position.
   */
  async applyCell(cell: Cell, cellPx: CellPx, animateMove: boolean): Promise<void> {
    const prevX = this.pos.x;
    this.cell = { ...cell };

    // Face the direction of travel before moving.
    if (cellPx.left > prevX + 1)      { this.direction = 1;  this._flipHorizontal(); }
    else if (cellPx.left < prevX - 1) { this.direction = -1; this._flipHorizontal(); }

    this.el.style.zIndex = String(cellPx.z);

    if (!animateMove) {
      this._snapTo(cellPx);
      return;
    }

    this.cellAnimAbort?.();
    const startX = this.pos.x;
    const startY = this.pos.y;
    const startScale = this.currentScale;
    const dist = Math.hypot(cellPx.left - startX, cellPx.top - startY);
    // Constant walking speed → duration scales with distance (clamped).
    const durationMs = Math.min(
      BasePet.MAX_WALK_MS,
      Math.max(BasePet.MIN_WALK_MS, (dist / BasePet.WALK_PX_PER_S) * 1000),
    );
    const startTime = performance.now();

    await new Promise<void>(resolve => {
      let aborted = false;
      this.cellAnimAbort = () => { aborted = true; resolve(); };
      const step = (now: number) => {
        if (aborted) return;
        // Linear time → constant velocity (a walk, not an ease-in-out glide).
        const t = Math.min(1, (now - startTime) / durationMs);
        this.pos.x = startX + (cellPx.left - startX) * t;
        this.pos.y = startY + (cellPx.top  - startY) * t;
        // Interpolate the perspective scale along the walk so it grows/shrinks smoothly.
        this.currentScale = startScale + (cellPx.scale - startScale) * t;
        this.el.style.left = `${this.pos.x}px`;
        this.el.style.top  = `${this.pos.y}px`;
        this._applyTransform();
        if (t < 1) requestAnimationFrame(step);
        else { this._snapTo(cellPx); this.cellAnimAbort = null; resolve(); }
      };
      requestAnimationFrame(step);
    });
  }

  private _snapTo(cellPx: CellPx): void {
    this.pos.x = cellPx.left;
    this.pos.y = cellPx.top;
    this.el.style.left = `${cellPx.left}px`;
    this.el.style.top  = `${cellPx.top}px`;
    this.currentScale  = cellPx.scale;
    this._applyTransform();
  }

  // Perspective scale lives on `.el` via the individual `scale` property so it
  // scales the sprite + name + action props together and composes with the
  // `transform` strings actions animate. The horizontal flip stays on `.pet-inner`
  // so it only mirrors the sprite (not the readable name label).
  private _applyTransform(): void {
    this.el.style.scale = String(this.currentScale);
    const inner = this.el.querySelector<HTMLElement>(".pet-inner");
    if (!inner) return;
    inner.style.transform = this.direction === -1 ? "scaleX(-1)" : "scaleX(1)";
  }

  private _flipHorizontal(): void {
    this._applyTransform();
  }

  private _stopCurrentAction(): void {
    this.cellAnimAbort?.();
    this.cellAnimAbort = null;
    this.currentAction?.cancel();
    this.currentAction = null;
  }

  // =========================================================================================================
  // Inactivity / Sleep / Despawn
  // =========================================================================================================

  private _resetInactivityTimer(): void {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => {
      if (this.fsm.canDo("sleeping")) this.fsm.transition("sleeping");
    }, this.INACTIVITY_TIMEOUT_MS);
  }

  private _startSleep(): void {
    this._stopCurrentAction();
    this.props.showZzz(this.el);
    this._persistState(true);
    setTimeout(() => {
      if (this.fsm.state === "sleeping") this.fsm.transition("despawning");
    }, 30_000);
  }

  private async _doDespawn(): Promise<void> {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.props.hideAll();
    await animate(this.el,
      { opacity: 0, transform: "translateY(20px) scale(0.8)" },
      { duration: 0.5 }
    );
    this.el.remove();
    if (this.userId > 0) {
      _invoke("tama_remove_pet_state", { userId: this.userId }).catch(() => {});
    }
    this.despawnCallback?.();
  }

  private _persistState(isSleeping: boolean): void {
    if (this.userId <= 0) return;
    _invoke("tama_upsert_pet_state", {
      userId:      this.userId,
      displayName: this.config.displayName,
      cellX:       this.cell.x,
      cellY:       this.cell.y,
      isSleeping,
    }).catch(() => {});
  }

  // =========================================================================================================
  // Runtime Config Updates
  // =========================================================================================================

  updateSize(sizePx: number): void {
    this.config.sizePx   = sizePx;
    this.el.style.width  = `${sizePx}px`;
    this.el.style.height = `${sizePx}px`;
  }

  updateNameFontSize(px: number): void {
    this.config.nameFontSizePx = px;
    const nameEl = this.el.querySelector<HTMLElement>(".pet-name");
    if (nameEl) nameEl.style.fontSize = `${px}px`;
  }

  // =========================================================================================================
  // Getters (used by actions)
  // =========================================================================================================

  get domElement(): HTMLElement  { return this.el; }
  get position(): PetPosition    { return { ...this.pos }; }
  // Floor Y for prop placement = the pet's current top edge.
  get floorY(): number           { return this.pos.y; }
  get size(): number             { return this.config.sizePx; }
  get scale(): number            { return this.currentScale; }
}
