// =========================================================================================================
// BASE PET
// =========================================================================================================
// Concrete tamagotchi pet class. Manages its own DOM element, FSM, walk loop,
// lip-sync, approach/return animations, sleep, and despawn lifecycle.
//
// Motion v12 constraint: ALL transform animations use CSS transform strings
// (e.g. "translateY(40px) scale(0.8)") — never shorthand x/y/scale/rotate keys.
// Springs are expressed as { type: "spring", stiffness: N, damping: N } options.
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

// =========================================================================================================
// Types
// =========================================================================================================

export interface PetConfig {
  userId: number;
  displayName: string;
  mouthOpenUrl: string;
  mouthClosedUrl: string;
  sizePx: number;
  floorY: number;
  initialX?: number;
  staticMode?: boolean;
  nameFontSizePx?: number;
}

export interface PetPosition {
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

  pos: PetPosition;
  private direction: 1 | -1 = 1;
  private currentAction: BaseAction | null = null;

  private walkAnimFrame: number | null = null;
  private moveToAbort:   (() => void) | null = null;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private despawnCallback: (() => void) | null = null;

  // Per-pet walk speed (0.6x–1.5x of base) so pets move at different paces.
  private walkSpeed: number;

  // X position saved when focus starts; restored when focus ends.
  // Not persisted to DB — a restart mid-focus respawns at floor_x which is fine.
  private originX: number | null = null;

  // Set to true when tts-state speaking=false arrives while still approaching.
  // _doApproach checks this on arrival and triggers an immediate return.
  private pendingReturn = false;

  // Reads from BasePet.inactivityMs so runtime config changes take effect on next reset.
  private get INACTIVITY_TIMEOUT_MS(): number { return BasePet.inactivityMs; }

  constructor(container: HTMLElement, config: PetConfig) {
    this.userId = config.userId;
    this.config = config;
    this.fsm    = new PetStateMachine();
    this.pos    = {
      x: config.initialX ?? (Math.random() * (window.innerWidth - 200) + 100),
      y: config.floorY,
    };

    this.walkSpeed  = BasePet.walkSpeedBase * (0.6 + Math.random() * 0.9);
    this.el         = this._buildDOM(container);
    this.props      = new PropRenderer();
    this.imgOpen    = this.el.querySelector<HTMLImageElement>(".pet-mouth-open")!;
    this.imgClosed  = this.el.querySelector<HTMLImageElement>(".pet-mouth-closed")!;

    this._setupFSMListeners();
    this._resetInactivityTimer();
    this._applyZIndex();
  }

  // =========================================================================================================
  // DOM Construction
  // =========================================================================================================

  private _buildDOM(container: HTMLElement): HTMLElement {
    const el = document.createElement("div");
    el.className = "tamagotchi-pet";
    el.dataset["userId"] = String(this.userId);
    el.style.cssText = `
      position:absolute;
      width:${this.config.sizePx}px;
      height:${this.config.sizePx}px;
      left:${this.pos.x}px;
      top:${this.pos.y}px;
      transform-origin:bottom center;
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

  // Z-index follows horizontal position: the further left a pet is, the higher
  // its z-index, so pets on the left render in front of pets on the right.
  private _applyZIndex(): void {
    this.el.style.zIndex = String(Math.round(Math.max(0, window.innerWidth - this.pos.x)));
  }

  // =========================================================================================================
  // FSM Listeners
  // =========================================================================================================

  private _setupFSMListeners(): void {
    this.fsm.onEnter("idle",      () => this._startIdleWalk());
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
    // Clear any residual inline transform/opacity Motion may have left on the element.
    this.el.style.opacity   = "1";
    this.el.style.transform = "";
    this.fsm.transition("idle");
    this._persistState(false);
  }

  async onChatMessage(): Promise<void> {
    this._resetInactivityTimer();
    const state = this.fsm.state;

    if (state === "approaching" || state === "talking") {
      // Already focused — nothing to do besides the inactivity reset above.
      return;
    }

    if (state === "returning") {
      // Pet is walking home — send it back to center without overwriting originX.
      this.moveToAbort?.();
      this.fsm.transition("approaching");
      await this._doApproach();
      return;
    }

    if (state === "sleeping") {
      // Wake the pet first, then focus it.
      this._stopCurrentAction();
      this.props.hideAll();
      this.fsm.transition("idle");
    }

    // In static mode pets do not walk — no approach/return cycle.
    if (this.config.staticMode) return;

    if (!this.fsm.canDo("approaching")) return;
    this._stopCurrentAction();
    // Only capture originX on a fresh focus entry (idle -> approaching).
    if (this.originX === null) this.originX = this.pos.x;
    this.fsm.transition("approaching");
    await this._doApproach();
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

  // =========================================================================================================
  // Movement
  // =========================================================================================================

  // 36 px/s at 60 fps ≈ 0.6 px/frame — used for idle walk. Mutable so runtime config applies.
  static walkSpeedBase = 36;
  // Minutes before a pet falls asleep. Read by _resetInactivityTimer().
  static inactivityMs = 5 * 60 * 1000;
  // Faster speed for approach/return so the pet arrives before TTS ends.
  private static readonly FOCUS_SPEED_PX_PER_S = 200;

  private _startIdleWalk(): void {
    if (this.config.staticMode) return;
    let lastTime: number | null = null;
    let isMoving    = true;
    // First decision after a short random delay so pets don't all pause in sync.
    let nextDecision = Math.random() * 3 + 1;

    const decide = () => {
      const roll = Math.random();
      if (!isMoving) {
        isMoving = true;
        if (Math.random() < 0.5) { this.direction *= -1; this._flipHorizontal(); }
        nextDecision = Math.random() * 5 + 2;
      } else if (roll < 0.25) {
        isMoving = false;
        nextDecision = Math.random() * 3 + 1;
      } else if (roll < 0.5) {
        this.direction *= -1;
        this._flipHorizontal();
        nextDecision = Math.random() * 5 + 2;
      } else {
        nextDecision = Math.random() * 5 + 2;
      }
    };

    const step = (now: number) => {
      if (this.fsm.state !== "idle") return;
      const dt = lastTime !== null ? (now - lastTime) / 1000 : 0;
      lastTime = now;

      nextDecision -= dt;
      if (nextDecision <= 0) decide();

      if (isMoving) {
        this.pos.x += this.direction * this.walkSpeed * dt;

        const margin = this.config.sizePx / 2 + 20;
        const maxX   = window.innerWidth - margin;
        if (this.pos.x <= margin) {
          this.pos.x  = margin;
          this.direction = 1;
          this._flipHorizontal();
        } else if (this.pos.x >= maxX) {
          this.pos.x  = maxX;
          this.direction = -1;
          this._flipHorizontal();
        }

        this.el.style.left = `${this.pos.x}px`;
        this._applyZIndex();
      }

      this.walkAnimFrame = requestAnimationFrame(step);
    };
    this.walkAnimFrame = requestAnimationFrame(step);
  }

  resumeIdleWalk(): void {
    if (this.fsm.state !== "idle") return;
    this._stopWalking();
    this._startIdleWalk();
  }

  private _stopWalking(): void {
    if (this.walkAnimFrame !== null) {
      cancelAnimationFrame(this.walkAnimFrame);
      this.walkAnimFrame = null;
    }
  }

  private _stopCurrentAction(): void {
    this._stopWalking();
    this.moveToAbort?.();
    this.currentAction?.cancel();
    this.currentAction = null;
  }

  private _flipHorizontal(): void {
    const inner = this.el.querySelector<HTMLElement>(".pet-inner")!;
    inner.style.transform = this.direction === -1 ? "scaleX(-1)" : "scaleX(1)";
  }

  async moveTo(targetX: number, speedPx: number = 150): Promise<void> {
    this.moveToAbort?.();   // cancel any previous moveTo
    this._stopWalking();

    const dist = Math.abs(targetX - this.pos.x);
    if (dist < 1) {
      this.pos.x = targetX;
      this.el.style.left = `${targetX}px`;
      this._applyZIndex();
      return;
    }

    this.direction = targetX > this.pos.x ? 1 : -1;
    this._flipHorizontal();

    const durationMs = Math.max(100, (dist / speedPx) * 1000);
    const startX     = this.pos.x;
    const startTime  = performance.now();

    // Use RAF instead of WAAPI so `left` is always authoritative in the inline
    // style — no WAAPI fill/commit race that could leak into `transform`.
    await new Promise<void>(resolve => {
      let aborted = false;
      this.moveToAbort = () => { aborted = true; resolve(); };

      const step = (now: number) => {
        if (aborted) return;
        const t = Math.min(1, (now - startTime) / durationMs);
        this.pos.x = startX + (targetX - startX) * t;
        this.el.style.left = `${this.pos.x}px`;
        this._applyZIndex();
        if (t < 1) requestAnimationFrame(step);
        else {
          this.pos.x = targetX;
          this.el.style.left = `${targetX}px`;
          this._applyZIndex();
          this.moveToAbort = null;
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  async moveY(targetY: number, duration: number = 0.4): Promise<void> {
    // Animate only `top` — keeping transform separate prevents WAAPI from
    // cancelling a concurrent moveTo animation that may also use transform internally.
    await animate(this.el,
      { top: `${targetY}px` },
      { duration, type: "spring", stiffness: 200, damping: 22 }
    );
    // Commit final value to inline style for the same WAAPI commit reason.
    this.el.style.top = `${targetY}px`;
    this.pos.y = targetY;
  }

  // =========================================================================================================
  // Approach / Return
  // =========================================================================================================

  private async _doApproach(): Promise<void> {
    this._stopWalking();
    // Center the pet horizontally (account for sprite width so it looks visually centered).
    const centerX = window.innerWidth / 2 - this.config.sizePx / 2;
    await this.moveTo(centerX, BasePet.FOCUS_SPEED_PX_PER_S);
    if (this.fsm.state !== "approaching") return;
    this.fsm.transition("talking");
    // TTS may have finished while we were still walking — return immediately if so.
    if (this.pendingReturn) {
      this.pendingReturn = false;
      this.returnFromFocus().catch(() => {});
      return;
    }
  }

  // Called by PetManager when tts-state speaking=false arrives before the pet
  // finishes walking to center. The flag is consumed by _doApproach on arrival.
  markTtsFinished(): void {
    this.pendingReturn = true;
  }

  async returnFromFocus(): Promise<void> {
    if (!this.fsm.canDo("returning")) return;
    this.fsm.transition("returning");
    const target = this.originX ?? this.pos.x;
    await this.moveTo(target, BasePet.FOCUS_SPEED_PX_PER_S);
    this.originX = null;
    if (this.fsm.state === "returning") this.fsm.transition("idle");
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
      floorX:      this.pos.x,
      isSleeping,
    }).catch(() => {});
  }

  // =========================================================================================================
  // =========================================================================================================
  // Runtime Config Updates
  // =========================================================================================================

  updateSize(sizePx: number): void {
    this.config.sizePx   = sizePx;
    this.el.style.width  = `${sizePx}px`;
    this.el.style.height = `${sizePx}px`;
  }

  updatePosX(x: number): void {
    this.pos.x          = x;
    this.el.style.left  = `${x}px`;
    this._applyZIndex();
  }

  updateNameFontSize(px: number): void {
    this.config.nameFontSizePx = px;
    const nameEl = this.el.querySelector<HTMLElement>(".pet-name");
    if (nameEl) nameEl.style.fontSize = `${px}px`;
  }

  updateWalkSpeed(baseSpeed: number): void {
    this.walkSpeed = baseSpeed * (0.6 + Math.random() * 0.9);
  }

  // Floor Y update (called by PetManager on window resize)
  // =========================================================================================================

  updateFloorY(y: number): void {
    this.config.floorY = y;
    // Reposition immediately only when idle — other states finish their own animations
    // and will land on the new floorY when they call returnToFloor or _startIdleWalk.
    if (this.fsm.state === "idle") {
      this.pos.y         = y;
      this.el.style.top  = `${y}px`;
    }
  }

  // =========================================================================================================
  // Getters (used by actions)
  // =========================================================================================================

  get domElement(): HTMLElement  { return this.el; }
  get position(): PetPosition    { return { ...this.pos }; }
  get floorY(): number           { return this.config.floorY; }
  get size(): number             { return this.config.sizePx; }
}
