// =========================================================================================================
// BASE ACTION
// =========================================================================================================
// Abstract base class for all tamagotchi pet actions.
// Each action lives in its own file in actions/ and registers itself
// on module load via ActionRegistry.register().
// =========================================================================================================

import type { BasePet } from "./BasePet";

// =========================================================================================================
// Types
// =========================================================================================================

export interface ActionInput {
  imageUrl?: string;
  text?: string;
  targetUserId?: number;
  color?: string;
  scale?: number;
  [key: string]: unknown;
}

export interface ActionMeta {
  id: string;
  label: string;
  description: string;
  icon: string;
  requiresTarget: boolean;
  inputs: ActionInputConfig[];
  minDurationMs: number;
  maxDurationMs: number;
  canInterrupt: boolean;
  probability: number;
}

export interface ActionInputConfig {
  key: string;
  type: "image" | "text" | "color" | "range" | "select";
  label: string;
  placeholder?: string;
  required: boolean;
  defaultValue?: string;
  options?: string[];
  min?: number;
  max?: number;
}

// =========================================================================================================
// BaseAction
// =========================================================================================================

export abstract class BaseAction {
  protected pet: BasePet;
  protected input: ActionInput;
  protected cancelled: boolean = false;

  static readonly meta: ActionMeta;

  constructor(pet: BasePet, input: ActionInput = {}) {
    this.pet = pet;
    this.input = input;
  }

  abstract execute(): Promise<void>;

  cancel(): void {
    this.cancelled = true;
    this.onCancel();
  }

  protected onCancel(): void {}

  protected wait(ms: number): Promise<void> {
    return new Promise(resolve => {
      const t = setTimeout(resolve, ms);
      const check = setInterval(() => {
        if (this.cancelled) { clearTimeout(t); clearInterval(check); resolve(); }
      }, 50);
      setTimeout(() => clearInterval(check), ms + 100);
    });
  }
}
