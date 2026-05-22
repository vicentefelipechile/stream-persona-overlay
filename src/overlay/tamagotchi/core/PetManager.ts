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
import { BasePet, configureBasePetInvoke } from "./BasePet";
import type { PetConfig } from "./BasePet";

// =========================================================================================================
// Transport Interface
// =========================================================================================================

/** Injectable transport — pass a browser transport to init() to use WS instead of Tauri IPC. */
export interface PetTransport {
  listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<() => void>;
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  convertFileSrc(path: string): string;
}

const _tauriTransport: PetTransport = {
  listen:         (event, handler) => listen(event, handler),
  invoke:         (command, args)  => invoke(command, args),
  convertFileSrc: convertFileSrc,
};
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
  private static transport: PetTransport = _tauriTransport;

  private static enabled      = true;
  private static maxPets      = 8;
  private static petSizePx    = 80;
  private static jumpOnSpeak  = false;

  // =========================================================================================================
  // Init
  // =========================================================================================================

  static async init(container: HTMLElement, transport?: PetTransport): Promise<void> {
    this.container = container;
    if (transport) {
      this.transport = transport;
      // Wire BasePet's module-level invoke to the same transport
      configureBasePetInvoke((cmd, args) => transport.invoke(cmd, args));
    }

    try {
      const cfg = await this.transport.invoke<Record<string, unknown>>("get_config_cmd");
      this.enabled   = String(cfg["tama_enabled"])   === "true";
      this.maxPets   = Number(cfg["tama_max_pets"])  || 8;
      this.petSizePx = Number(cfg["tama_pet_size_px"]) || 80;
      this.jumpOnSpeak = String(cfg["tama_jump_on_speak"]) === "true";
    } catch (_) {}

    const floorY = window.innerHeight - this.petSizePx - 28;
    this.floor     = new PetFloor({ y: floorY, thickness: 20, minSpacing: 100 });
    this._scheduler = new PetScheduler(this.pets);

    await this.transport.listen<ChatMessagePayload>("chat-message", e => {
      this._onChatMessage(e.payload).catch(console.error);
    });
    await this.transport.listen<TtsStatePayload>("tts-state", e => {
      this._onTtsState(e.payload);
    });
    await this.transport.listen<TamaActionPayload>("tama-action", e => {
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
        mouthOpenUrl:   this.transport.convertFileSrc(payload.mouth_open_path),
        mouthClosedUrl: this.transport.convertFileSrc(payload.mouth_closed_path),
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

    const pet = this.pets.get(payload.user_id)!;
    if (this.jumpOnSpeak) {
      await pet.executeAction("jump");
    } else {
      await pet.onChatMessage();
    }
  }

  private static _onTtsState(payload: TtsStatePayload): void {
    if (!this.enabled) return;
    const pet = this.pets.get(payload.user_id);
    if (!pet) return;

    pet.setMouth(payload.speaking);

    if (!payload.speaking) {
      if (pet.fsm.state === "talking") {
        pet.returnFromFocus().catch(() => {});
      } else if (pet.fsm.state === "approaching") {
        // TTS finished before the pet reached center — flag it so _doApproach returns immediately on arrival.
        pet.markTtsFinished();
      }
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
