// =========================================================================================================
// SING ACTION
// =========================================================================================================
// Pet grabs a mic, bobs to a beat with its mouth opening/closing, and musical
// notes float away. Triggered by the "cantar" chat command.
// =========================================================================================================

import { animate } from "motion";
import { BaseAction, ActionMeta, ActionInput } from "../core/BaseAction";
import { ActionRegistry } from "../core/ActionRegistry";
import type { BasePet } from "../core/BasePet";

const NOTES = ["🎵", "🎶", "🎼", "🎤"];

export class SingAction extends BaseAction {
  static readonly meta: ActionMeta = {
    id:             "sing",
    label:          "Cantar",
    description:    "La mascota canta con micrófono, mueve la boca y suelta notas musicales. Comando de chat: cantar",
    icon:           "🎤",
    requiresTarget: false,
    inputs:         [],
    minDurationMs:  3000,
    maxDurationMs:  5000,
    canInterrupt:   true,
    probability:    0.1,
  };

  private micEl: HTMLElement | null = null;
  private noteEls: HTMLElement[] = [];
  private noteTimer: ReturnType<typeof setInterval> | null = null;

  constructor(pet: BasePet, input?: ActionInput) { super(pet, input); }

  async execute(): Promise<void> {
    const el = this.pet.domElement;

    // Mic in hand.
    this.micEl = document.createElement("div");
    this.micEl.textContent = "🎤";
    this.micEl.style.cssText = "position:absolute;bottom:6px;right:-20px;font-size:24px;pointer-events:none;z-index:6;opacity:0;transform:scale(0) rotate(-20deg);";
    el.appendChild(this.micEl);
    await animate(this.micEl, { opacity: [0, 1], transform: ["scale(0) rotate(-20deg)", "scale(1) rotate(0deg)"] }, { duration: 0.3 });

    // Notes drift away on a loop.
    this.noteTimer = setInterval(() => this._spawnNote(el), 450);

    // 5 beats: bob the pet up/down and flap the mouth in sync.
    const beats = 5;
    for (let i = 0; i < beats; i++) {
      if (this.cancelled) break;
      this.pet.setMouth(true);
      await animate(el, { transform: ["translateY(0px) rotate(0deg)", "translateY(-8px) rotate(3deg)"] }, { duration: 0.22 });
      this.pet.setMouth(false);
      await animate(el, { transform: ["translateY(-8px) rotate(3deg)", "translateY(0px) rotate(-3deg)"] }, { duration: 0.22 });
    }

    await this._cleanup();
  }

  private _spawnNote(el: HTMLElement): void {
    if (this.cancelled) return;
    const note = document.createElement("div");
    note.textContent = NOTES[Math.floor(Math.random() * NOTES.length)];
    note.style.cssText = "position:absolute;top:-10px;left:50%;font-size:16px;pointer-events:none;z-index:5;opacity:1;";
    el.appendChild(note);
    this.noteEls.push(note);
    const dx = (Math.random() * 40 + 20) * (Math.random() < 0.5 ? -1 : 1);
    animate(note,
      { opacity: [0, 1, 1, 0], transform: [`translateX(-50%) translate(0px,0px) rotate(0deg)`, `translateX(-50%) translate(${dx}px,-40px) rotate(${dx > 0 ? 30 : -30}deg)`] },
      { duration: 1.4 }
    ).then(() => { note.remove(); this.noteEls = this.noteEls.filter(n => n !== note); });
  }

  private async _cleanup(): Promise<void> {
    if (this.noteTimer) { clearInterval(this.noteTimer); this.noteTimer = null; }
    this.pet.setMouth(false);
    if (this.micEl) {
      await animate(this.micEl, { opacity: 0, transform: "scale(0.5)" }, { duration: 0.25 });
      this.micEl.remove();
      this.micEl = null;
    }
    this.pet.domElement.style.transform = "";
  }

  protected onCancel(): void {
    if (this.noteTimer) { clearInterval(this.noteTimer); this.noteTimer = null; }
    this.pet.setMouth(false);
    this.micEl?.remove();
    this.micEl = null;
    this.noteEls.forEach(n => n.remove());
    this.noteEls = [];
    this.pet.domElement.style.transform = "";
  }
}

ActionRegistry.register(SingAction);
