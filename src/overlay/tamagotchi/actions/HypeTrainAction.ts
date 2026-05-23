import { animate } from "motion";
import { BaseAction, ActionMeta, ActionInput } from "../core/BaseAction";
import { ActionRegistry } from "../core/ActionRegistry";
import type { BasePet } from "../core/BasePet";

export class HypeTrainAction extends BaseAction {
  static readonly meta: ActionMeta = {
    id: "hype_train",
    label: "Tren de Hype",
    description: "Tren cruzando la pantalla",
    icon: "🚂",
    requiresTarget: false,
    inputs: [],
    minDurationMs: 2000,
    maxDurationMs: 4000,
    canInterrupt: true,
    probability: 0,
  };

  constructor(pet: BasePet, input?: ActionInput) {
    super(pet, input);
  }

  async execute(): Promise<void> {
    const train = document.createElement("div");
    train.textContent = "🚂 HYPE TRAIN 🚂";
    train.style.position = "fixed";
    train.style.bottom = "100px";
    train.style.left = "-400px";
    train.style.fontSize = "24px";
    train.style.fontWeight = "bold";
    train.style.color = "#ff6b6b";
    train.style.pointerEvents = "none";
    train.style.zIndex = "1000";
    train.style.whiteSpace = "nowrap";
    train.style.textShadow = "2px 2px 4px rgba(0,0,0,0.5)";

    document.body.appendChild(train);

    // Animate train crossing the screen
    await animate(train, { left: "100vw" }, { duration: 3, ease: "easeInOut" });

    train.remove();
  }

  protected onCancel(): void {}
}

ActionRegistry.register(HypeTrainAction);
