import { animate } from "motion";
import { BaseAction, ActionMeta, ActionInput } from "../core/BaseAction";
import { ActionRegistry } from "../core/ActionRegistry";
import type { BasePet } from "../core/BasePet";

export class ConfettiAction extends BaseAction {
  static readonly meta: ActionMeta = {
    id: "confetti",
    label: "Confeti",
    description: "Explosión de confeti para celebraciones",
    icon: "🎉",
    requiresTarget: false,
    inputs: [],
    minDurationMs: 600,
    maxDurationMs: 2000,
    canInterrupt: true,
    probability: 0,
  };

  constructor(pet: BasePet, input?: ActionInput) {
    super(pet, input);
  }

  async execute(): Promise<void> {
    // Create 10 confetti particles
    for (let i = 0; i < 10; i++) {
      if (this.cancelled) return;

      const confetti = document.createElement("div");
      confetti.style.position = "fixed";
      confetti.style.width = "10px";
      confetti.style.height = "10px";
      confetti.style.borderRadius = "50%";
      confetti.style.pointerEvents = "none";

      const colors = ["#ff6b6b", "#4ecdc4", "#45b7d1", "#ffd93d", "#a8e6cf"];
      confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];

      const rect = this.pet.domElement.getBoundingClientRect();
      confetti.style.left = rect.left + rect.width / 2 + "px";
      confetti.style.top = rect.top + rect.height / 2 + "px";

      document.body.appendChild(confetti);

      const duration = 1 + Math.random() * 0.5;
      const tx = (Math.random() - 0.5) * 200;
      const ty = -100 - Math.random() * 100;

      animate(
        confetti,
        { transform: `translate(${tx}px, ${ty}px)`, opacity: 0 },
        { duration, ease: "easeOut" }
      ).then(() => confetti.remove());
    }

    await this.wait(1500);
  }

  protected onCancel(): void {}
}

ActionRegistry.register(ConfettiAction);
