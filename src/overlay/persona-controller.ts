// =========================================================================================================
// PERSONA CONTROLLER
// =========================================================================================================
// Manages a single persona bubble: DOM lifecycle, mouth animation (lip-sync),
// idle effects, and enter/exit animations via AnimationEngine.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { animate } from "motion";
import { AnimationEngine, AnimationType } from "./animation-engine";

// Motion v11 type workaround — see animation-engine.ts for explanation
function animEl(
  el: HTMLElement | HTMLImageElement,
  kf: Record<string, number | string | (number | string)[]>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opts?: any
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return animate(el as any, kf as any, opts);
}

// =========================================================================================================
// Types
// =========================================================================================================

export type MouthState = "open" | "closed";

export interface PersonaConfig {
  userId: number;
  displayName: string;
  mouthOpenUrl: string;
  mouthClosedUrl: string;
  animationIn: AnimationType;
  animationOut: AnimationType;
  sizePx: number;
  idleWiggle: boolean;
  idleBreathe: boolean;
  glowEffect: boolean;
  glowColor: string;
  outlineEffect: boolean;
  positionX: number;
}

// =========================================================================================================
// PersonaController Class
// =========================================================================================================

export class PersonaController {
  private el: HTMLDivElement;
  private imgOpen: HTMLImageElement;
  private imgClosed: HTMLImageElement;
  private msgEl: HTMLSpanElement;

  private currentMouth: MouthState = "closed";
  private mouthDebounce: ReturnType<typeof setTimeout> | null = null;
  private readonly MOUTH_DEBOUNCE_MS = 80;

  private config: PersonaConfig;

  constructor(container: HTMLElement, config: PersonaConfig) {
    this.config   = config;
    this.el       = this._buildDOM(container);
    this.imgOpen  = this.el.querySelector<HTMLImageElement>(".mouth-open")!;
    this.imgClosed = this.el.querySelector<HTMLImageElement>(".mouth-closed")!;
    this.msgEl    = this.el.querySelector<HTMLSpanElement>(".persona-message")!;
    this._applyEffects();
  }

  // =========================================================================================================
  // DOM Construction
  // =========================================================================================================

  private _buildDOM(container: HTMLElement): HTMLDivElement {
    const el = document.createElement("div");
    el.className        = "persona-wrapper";
    el.style.left       = `${this.config.positionX}px`;
    el.style.visibility = "hidden";
    el.style.width      = `${this.config.sizePx}px`;

    el.innerHTML = `
      <div class="persona-inner">
        <div class="persona-mouth-stack" style="width:${this.config.sizePx}px;height:${this.config.sizePx}px;">
          <img class="mouth-open"   src="${this.config.mouthOpenUrl}"   alt="${this.config.displayName}" style="opacity:0;" />
          <img class="mouth-closed" src="${this.config.mouthClosedUrl}" alt="${this.config.displayName}" style="opacity:1;" />
        </div>
        <span class="persona-name">${this.config.displayName}</span>
        <span class="persona-message"></span>
      </div>
    `;
    container.appendChild(el);
    return el;
  }

  // =========================================================================================================
  // Effect Classes
  // =========================================================================================================

  private _applyEffects(): void {
    const { idleWiggle, idleBreathe, glowEffect, glowColor, outlineEffect } = this.config;
    this.el.classList.toggle("idle-wiggle",    idleWiggle);
    this.el.classList.toggle("idle-breathe",   idleBreathe);
    this.el.classList.toggle("glow-effect",    glowEffect);
    this.el.classList.toggle("outline-effect", outlineEffect);
    this.el.style.setProperty("--glow-color", glowColor);
  }

  // =========================================================================================================
  // Lip-Sync
  // =========================================================================================================

  setMouth(state: MouthState): void {
    if (this.mouthDebounce) clearTimeout(this.mouthDebounce);

    this.mouthDebounce = setTimeout(() => {
      if (state === this.currentMouth) return;
      this.currentMouth = state;

      const showOpen = state === "open";
      animEl(this.imgOpen,   { opacity: showOpen ? [0, 1] : [1, 0] }, { duration: 0.05 });
      animEl(this.imgClosed, { opacity: showOpen ? [1, 0] : [0, 1] }, { duration: 0.05 });
    }, this.MOUTH_DEBOUNCE_MS);
  }

  // =========================================================================================================
  // Message & Position
  // =========================================================================================================

  updateMessage(text: string): void {
    this.msgEl.textContent = text;
  }

  getPositionX(): number {
    return this.config.positionX;
  }

  // =========================================================================================================
  // Entry / Exit
  // =========================================================================================================

  async animateIn(): Promise<void> {
    await AnimationEngine.playIn(this.el, this.config.animationIn);
  }

  async animateOut(): Promise<void> {
    await AnimationEngine.playOut(this.el, this.config.animationOut);
  }

  destroy(): void {
    this.el.remove();
  }
}
