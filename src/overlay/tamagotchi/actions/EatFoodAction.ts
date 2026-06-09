// =========================================================================================================
// EAT FOOD ACTION
// =========================================================================================================
// Pet holds a piece of food and chomps it down bite by bite (the food shrinks),
// finishing with a happy "😋". Triggered by the "comida" chat command.
// =========================================================================================================

import { animate } from "motion";
import { BaseAction, ActionMeta, ActionInput } from "../core/BaseAction";
import { ActionRegistry } from "../core/ActionRegistry";
import type { BasePet } from "../core/BasePet";

const FOODS = ["🍔", "🍕", "🍗", "🍩", "🌮", "🍪"];

export class EatFoodAction extends BaseAction {
  static readonly meta: ActionMeta = {
    id:             "eat_food",
    label:          "Comer comida",
    description:    "La mascota saca comida y la devora a mordiscos. Comando de chat: comida",
    icon:           "🍔",
    requiresTarget: false,
    inputs: [
      {
        key:         "text",
        type:        "text",
        label:       "Emoji de comida (opcional, aleatorio si se deja vacío)",
        placeholder: "🍔",
        required:    false,
      },
    ],
    minDurationMs: 2500,
    maxDurationMs: 4000,
    canInterrupt:  true,
    probability:   0.08,
  };

  private foodEl: HTMLElement | null = null;

  constructor(pet: BasePet, input?: ActionInput) { super(pet, input); }

  async execute(): Promise<void> {
    const el   = this.pet.domElement;
    const food = (this.input["text"] as string) || FOODS[Math.floor(Math.random() * FOODS.length)];

    this.foodEl = document.createElement("div");
    this.foodEl.textContent = food;
    this.foodEl.style.cssText = "position:absolute;bottom:4px;right:-22px;font-size:26px;pointer-events:none;z-index:6;opacity:0;transform:scale(0);";
    el.appendChild(this.foodEl);
    await animate(this.foodEl, { opacity: [0, 1], transform: ["scale(0)", "scale(1)"] }, { duration: 0.3 });

    // Four bites: the pet squashes (chomp) while the food shrinks toward nothing.
    const bites = 4;
    for (let i = 0; i < bites; i++) {
      if (this.cancelled) break;
      await animate(el,
        { transform: ["scale(1,1)", "scale(1.08,0.9)", "scale(1,1)"] },
        { duration: 0.28 }
      );
      const remaining = 1 - (i + 1) / bites;
      if (this.foodEl) {
        await animate(this.foodEl, { transform: `scale(${remaining})`, opacity: remaining > 0 ? 1 : 0 }, { duration: 0.15 });
      }
      await this.wait(160);
    }

    this.foodEl?.remove();
    this.foodEl = null;

    if (!this.cancelled) {
      const yum = document.createElement("div");
      yum.textContent = "😋";
      yum.style.cssText = "position:absolute;top:-26px;left:50%;font-size:18px;pointer-events:none;z-index:6;transform:translateX(-50%);";
      el.appendChild(yum);
      await animate(yum, { opacity: [0, 1, 1, 0], transform: ["translateX(-50%) translateY(0px)", "translateX(-50%) translateY(-12px)"] }, { duration: 1 });
      yum.remove();
    }

    el.style.transform = "";
  }

  protected onCancel(): void {
    this.foodEl?.remove();
    this.foodEl = null;
    this.pet.domElement.style.transform = "";
  }
}

ActionRegistry.register(EatFoodAction);
