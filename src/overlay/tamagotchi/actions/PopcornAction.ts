// =========================================================================================================
// POPCORN ACTION
// =========================================================================================================
// Pet holds up a popcorn bucket (emoji or custom image) with an optional
// speech bubble while it watches the stream.
// =========================================================================================================

import { animate } from "motion";
import { BaseAction, ActionMeta, ActionInput } from "../core/BaseAction";
import { ActionRegistry } from "../core/ActionRegistry";
import type { BasePet } from "../core/BasePet";

export class PopcornAction extends BaseAction {
  static readonly meta: ActionMeta = {
    id:             "popcorn",
    label:          "Palomitas",
    description:    "La mascota saca palomitas y las sostiene. Puedes usar imagen personalizada o el emoji por defecto.",
    icon:           "🍿",
    requiresTarget: false,
    inputs: [
      {
        key:         "imageUrl",
        type:        "image",
        label:       "Imagen del balde (opcional, PNG transparente recomendado)",
        placeholder: "Deja vacío para usar 🍿 por defecto",
        required:    false,
      },
      {
        key:         "text",
        type:        "text",
        label:       "Texto en bocadillo (opcional)",
        placeholder: 'Ej: "Viendo el drama 👀"',
        required:    false,
      },
    ],
    minDurationMs: 3000,
    maxDurationMs: 8000,
    canInterrupt:  true,
    probability:   0.15,
  };

  private propEl:   HTMLElement | null = null;
  private bubbleEl: HTMLElement | null = null;

  constructor(pet: BasePet, input?: ActionInput) { super(pet, input); }

  async execute(): Promise<void> {
    const el = this.pet.domElement;

    // Create prop container
    this.propEl = document.createElement("div");
    this.propEl.className = "pet-prop popcorn-bucket";
    this.propEl.style.cssText = `
      position:absolute;
      bottom:0;
      right:-30px;
      width:40px;
      height:40px;
      opacity:0;
      pointer-events:none;
      z-index:5;
    `;

    if (this.input["imageUrl"]) {
      const img = document.createElement("img");
      img.src = this.input["imageUrl"] as string;
      img.style.cssText = "width:100%;height:100%;object-fit:contain;";
      this.propEl.appendChild(img);
    } else {
      this.propEl.style.fontSize   = "32px";
      this.propEl.style.lineHeight = "40px";
      this.propEl.textContent = "🍿";
    }
    el.appendChild(this.propEl);

    // Pop-in
    await animate(this.propEl,
      { opacity: [0, 1, 1], transform: ["scale(0)", "scale(1.2)", "scale(1)"] },
      { duration: 0.4 }
    );

    // Optional speech bubble
    if (this.input["text"] && !this.cancelled) {
      this.bubbleEl = this._createBubble(this.input["text"] as string);
      el.appendChild(this.bubbleEl);
      await animate(this.bubbleEl,
        { opacity: [0, 1], transform: ["translateY(10px)", "translateY(0px)"] },
        { duration: 0.3 }
      );
    }

    // Gentle idle bob while holding popcorn
    if (!this.cancelled && this.propEl) {
      animate(this.propEl,
        { transform: ["translateY(0px)", "translateY(-4px)", "translateY(0px)"] },
        { duration: 1.5, repeat: 4, ease: "easeInOut" }
      );
      await this.wait(4000);
    }

    // Remove prop
    if (this.propEl) {
      await animate(this.propEl, { opacity: 0, transform: "scale(0.5)" }, { duration: 0.3 });
      this.propEl.remove();
      this.propEl = null;
    }
    if (this.bubbleEl) {
      await animate(this.bubbleEl, { opacity: 0 }, { duration: 0.2 });
      this.bubbleEl.remove();
      this.bubbleEl = null;
    }
  }

  private _createBubble(text: string): HTMLElement {
    const bubble = document.createElement("div");
    bubble.className = "pet-speech-bubble";
    bubble.style.cssText = `
      position:absolute;
      top:-50px;
      left:50%;
      transform:translateX(-50%);
      background:#ffffff;
      border:2px solid #333;
      border-radius:4px;
      padding:4px 8px;
      font-family:'IBM Plex Sans',sans-serif;
      font-size:11px;
      white-space:nowrap;
      opacity:0;
      pointer-events:none;
      z-index:10;
    `;
    bubble.textContent = text;
    return bubble;
  }

  protected onCancel(): void {
    this.propEl?.remove();
    this.bubbleEl?.remove();
  }
}

ActionRegistry.register(PopcornAction);
