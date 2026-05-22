// =========================================================================================================
// PET MANAGER
// =========================================================================================================
// Singleton that owns all active tamagotchi pets. Listens to the same Tauri
// events as overlay.ts (chat-message, tts-state) so pets can react in parallel
// with the main persona bubbles. Also handles the tama-action event fired by
// the admin panel to trigger manual or automated actions.
// =========================================================================================================

import { listen } from "@tauri-apps/api/event";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { BasePet } from "./BasePet";
import type { PetConfig } from "./BasePet";
import { PetFloor } from "./PetFloor";
import { PetScheduler } from "./PetScheduler";

// Import all actions so they self-register on module load
import "../actions/IdleWalkAction";
import "../actions/JumpAction";
import "../actions/PopcornAction";
import "../actions/FightAction";
import "../actions/ExplodeAction";
import "../actions/DanceAction";
import "../actions/SleepAction";

// =========================================================================================================
// Payload Types
// =========================================================================================================

interface ChatMessagePayload {
  platform: string;
  username: string;
  message: string;
  user_id: number;
  display_name: string;
  mouth_open_path: string;
  mouth_closed_path: string;
  voice_id: string;
}

interface TtsStatePayload {
  user_id: number;
  speaking: boolean;
}

interface TamaActionPayload {
  user_id: number;
  action_id: string;
  input: Record<string, unknown>;
}

// =========================================================================================================
// PetManager
// =========================================================================================================

export class PetManager {
  private static pets      = new Map<number, BasePet>();
  private static floor:     PetFloor;
  private static _scheduler: PetScheduler;
  private static container: HTMLElement;

  private static enabled    = true;
  private static maxPets    = 8;
  private static petSizePx  = 80;

  // =========================================================================================================
  // Init
  // =========================================================================================================

  static async init(container: HTMLElement): Promise<void> {
    this.container = container;

    try {
      const cfg = await invoke<Record<string, unknown>>("get_config_cmd");
      this.enabled   = String(cfg["tama_enabled"])   === "true";
      this.maxPets   = Number(cfg["tama_max_pets"])  || 8;
      this.petSizePx = Number(cfg["tama_pet_size_px"]) || 80;
    } catch (_) {}

    const floorY = window.innerHeight - this.petSizePx - 20;
    this.floor     = new PetFloor({ y: floorY, thickness: 20, minSpacing: 100 });
    this._scheduler = new PetScheduler(this.pets);

    await listen<ChatMessagePayload>("chat-message", e => {
      this._onChatMessage(e.payload).catch(console.error);
    });
    await listen<TtsStatePayload>("tts-state", e => {
      this._onTtsState(e.payload);
    });
    await listen<TamaActionPayload>("tama-action", e => {
      this._onTamaAction(e.payload).catch(console.error);
    });

    // Recompute floor Y whenever the overlay window is resized
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    window.addEventListener("resize", () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const newFloorY = window.innerHeight - this.petSizePx - 20;
        this.floor.floorY = newFloorY;
        for (const pet of this.pets.values()) {
          pet.updateFloorY(newFloorY);
        }
      }, 100);
    });
  }

  // =========================================================================================================
  // Event Handlers
  // =========================================================================================================

  private static async _onChatMessage(payload: ChatMessagePayload): Promise<void> {
    if (!this.enabled) return;
    if (payload.user_id <= 0) return; // skip test messages

    if (!this.pets.has(payload.user_id)) {
      if (this.pets.size >= this.maxPets) return;

      const spawnX = this.floor.getSpawnX(payload.user_id, this.petSizePx);
      const cfg: PetConfig = {
        userId:       payload.user_id,
        displayName:  payload.display_name,
        mouthOpenUrl: convertFileSrc(payload.mouth_open_path),
        mouthClosedUrl: convertFileSrc(payload.mouth_closed_path),
        sizePx:  this.petSizePx,
        floorY:  this.floor.floorY,
        initialX: spawnX,
      };

      const pet = new BasePet(this.container, cfg);
      pet.setDespawnCallback(() => {
        this.pets.delete(payload.user_id);
        this.floor.remove(payload.user_id);
      });
      this.pets.set(payload.user_id, pet);
      await pet.spawn();
    }

    await this.pets.get(payload.user_id)!.onChatMessage();
  }

  private static _onTtsState(payload: TtsStatePayload): void {
    if (!this.enabled) return;
    const pet = this.pets.get(payload.user_id);
    if (!pet) return;

    pet.setMouth(payload.speaking);

    if (!payload.speaking && pet.fsm.state === "talking") {
      pet.returnToFloor().catch(() => {});
    }
  }

  private static async _onTamaAction(payload: TamaActionPayload): Promise<void> {
    const pet = this.pets.get(payload.user_id);
    if (pet) await pet.executeAction(payload.action_id, payload.input);
  }

  // =========================================================================================================
  // Public Helpers (used by actions)
  // =========================================================================================================

  static shutdown(): void {
    this._scheduler?.stop();
    this.pets.clear();
  }

  static get(userId: number): BasePet | undefined {
    return this.pets.get(userId);
  }

  static getRandomPet(excludeUserId: number): BasePet | undefined {
    const candidates = Array.from(this.pets.values())
      .filter(p => p.userId !== excludeUserId && p.fsm.state === "idle");
    if (!candidates.length) return undefined;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
}
