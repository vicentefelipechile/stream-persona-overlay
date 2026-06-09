// =========================================================================================================
// LOVE ACTION
// =========================================================================================================
// Pet falls in love: floating hearts rise around it while it bounces happily.
// Triggered by the "amor" chat command.
// =========================================================================================================

import { animate } from "motion";
import { BaseAction, ActionMeta, ActionInput } from "../core/BaseAction";
import { ActionRegistry } from "../core/ActionRegistry";
import type { BasePet } from "../core/BasePet";

const HEARTS = ["❤️", "💕", "💖", "💗", "😍"];

export class LoveAction extends BaseAction {
  static readonly meta: ActionMeta = {
    id:             "love",
    label:          "Enamorarse",
    description:    "La mascota se enamora y suelta corazones flotantes 💖. Comando de chat: amor",
    icon:           "❤️",
    requiresTarget: false,
    inputs:         [],
    minDurationMs:  2500,
    maxDurationMs:  4000,
    canInterrupt:   true,
    probability:    0.08,
  };

  private heartEls: HTMLElement[] = [];
  private heartTimer: ReturnType<typeof setInterval> | null = null;

  constructor(pet: BasePet, input?: ActionInput) { super(pet, input); }

  async execute(): Promise<void> {
    const el = this.pet.domElement;

    // Hearts keep floating up while the pet swoons.
    this.heartTimer = setInterval(() => this._spawnHeart(el), 280);

    // Three swoony bounces with a little wiggle.
    for (let i = 0; i < 3; i++) {
      if (this.cancelled) break;
      await animate(el,
        { transform: [
          "translateY(0px) rotate(0deg) scale(1)",
          "translateY(-12px) rotate(-6deg) scale(1.08)",
          "translateY(0px) rotate(6deg) scale(1)",
          "translateY(-6px) rotate(0deg) scale(1.04)",
          "translateY(0px) rotate(0deg) scale(1)",
        ] },
        { duration: 0.9 }
      );
      await this.wait(120);
    }

    if (this.heartTimer) { clearInterval(this.heartTimer); this.heartTimer = null; }
    await this.wait(400);
    el.style.transform = "";
  }

  private _spawnHeart(el: HTMLElement): void {
    if (this.cancelled) return;
    const heart = document.createElement("div");
    heart.textContent = HEARTS[Math.floor(Math.random() * HEARTS.length)];
    const startLeft = 20 + Math.random() * 60;
    heart.style.cssText = `position:absolute;bottom:40%;left:${startLeft}%;font-size:${12 + Math.random() * 10}px;pointer-events:none;z-index:7;opacity:1;`;
    el.appendChild(heart);
    this.heartEls.push(heart);
    const dx = (Math.random() - 0.5) * 30;
    animate(heart,
      { opacity: [0, 1, 1, 0], transform: ["translate(0px,0px) scale(0.5)", `translate(${dx}px,-45px) scale(1.1)`] },
      { duration: 1.6, ease: "easeOut" }
    ).then(() => { heart.remove(); this.heartEls = this.heartEls.filter(h => h !== heart); });
  }

  protected onCancel(): void {
    if (this.heartTimer) { clearInterval(this.heartTimer); this.heartTimer = null; }
    this.heartEls.forEach(h => h.remove());
    this.heartEls = [];
    this.pet.domElement.style.transform = "";
  }
}

ActionRegistry.register(LoveAction);
