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
import { StaticFloor } from "./StaticFloor";

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
import "../actions/DrinkWaterAction";
import "../actions/EatFoodAction";
import "../actions/SingAction";
import "../actions/NapAction";
import "../actions/CoffeeAction";
import "../actions/RainbowBarfAction";
import "../actions/LoveAction";
import "../actions/GhostAction";

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

  private static enabled        = true;
  private static maxPets        = 8;
  private static petSizePx      = 80;
  private static jumpOnSpeak    = false;
  private static nameFontSizePx = 11;
  // Map of lowercased chat keyword -> action ID. When a pet's owner types a
  // keyword, that action is forced instead of the normal walk-to-center/jump.
  private static keywordActions: Record<string, string> = {};

  private static layoutMode:    "dynamic" | "static" = "dynamic";
  private static staticAnchor:  "left" | "right"     = "left";
  private static staticSpacing: number                = 100;
  private static staticFloor:   StaticFloor | null    = null;

  private static readonly STATIC_BLOCKED_ACTIONS = new Set(["fight", "hype_train"]);

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
      this.enabled       = String(cfg["tama_enabled"])          === "true";
      this.maxPets       = Number(cfg["tama_max_pets"])         || 8;
      this.petSizePx     = Number(cfg["tama_pet_size_px"])      || 80;
      this.jumpOnSpeak    = String(cfg["tama_jump_on_speak"])    === "true";
      this.nameFontSizePx = Number(cfg["tama_name_font_size_px"]) || 11;
      this.keywordActions = this._parseKeywordActions(cfg["tama_keyword_actions"]);
      this.layoutMode    = String(cfg["tama_layout_mode"])      === "static" ? "static" : "dynamic";
      this.staticAnchor  = String(cfg["tama_static_anchor"])    === "right"  ? "right"  : "left";
      this.staticSpacing = Number(cfg["tama_static_spacing_px"]) || 100;
    } catch (_) {}

    const floorY = window.innerHeight - this.petSizePx - 28;
    this.floor = new PetFloor({ y: floorY, thickness: 20, minSpacing: 100 });

    if (this.layoutMode === "static") {
      this.staticFloor = new StaticFloor({
        anchor:    this.staticAnchor,
        spacingPx: this.staticSpacing,
        petSizePx: this.petSizePx,
        floorY,
      });
    }

    const blockedActions = this.layoutMode === "static"
      ? Array.from(this.STATIC_BLOCKED_ACTIONS)
      : [];
    this._scheduler = new PetScheduler(this.pets, blockedActions);

    await this.transport.listen<ChatMessagePayload>("chat-message", e => {
      this._onChatMessage(e.payload).catch(console.error);
    });
    await this.transport.listen<TtsStatePayload>("tts-state", e => {
      this._onTtsState(e.payload);
    });
    await this.transport.listen<TamaActionPayload>("tama-action", e => {
      this._onTamaAction(e.payload).catch(console.error);
    });
    await this.transport.listen<Record<string, unknown>>("tama-config-changed", e => {
      this._onTamaConfigChanged(e.payload);
    });
    await this.transport.listen<unknown>("tama-reset", () => {
      this.resetAll().catch(console.error);
    });

    // Recompute floor Y (and static X for right-anchored pets) on window resize
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    window.addEventListener("resize", () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const newFloorY = window.innerHeight - this.petSizePx - 28;
        this.floor.floorY = newFloorY;
        if (this.staticFloor) this.staticFloor.floorY = newFloorY;
        for (const pet of this.pets.values()) {
          pet.updateFloorY(newFloorY);
          if (this.staticFloor) {
            const newX = this.staticFloor.getSlotX(pet.userId);
            if (newX !== null) pet.updatePosX(newX);
          }
        }
      }, 100);
    });
  }

  // =========================================================================================================
  // Event Handlers
  // =========================================================================================================

  private static async _onChatMessage(payload: ChatMessagePayload): Promise<void> {
    if (!this.enabled) return;
    if (payload.user_id === 0) return; // skip test messages (guest pets have negative IDs)

    if (!this.pets.has(payload.user_id)) {
      if (this.pets.size >= this.maxPets) return;

      const spawnX = this.layoutMode === "static"
        ? this.staticFloor!.assignSlot(payload.user_id)
        : this.floor.getSpawnX(payload.user_id, this.petSizePx);

      const cfg: PetConfig = {
        userId:       payload.user_id,
        displayName:  payload.display_name,
        mouthOpenUrl:   this._resolveSrc(payload.mouth_open_path),
        mouthClosedUrl: this._resolveSrc(payload.mouth_closed_path),
        sizePx:    this.petSizePx,
        floorY:    this.floor.floorY,
        initialX:  spawnX,
        staticMode: this.layoutMode === "static",
        nameFontSizePx: this.nameFontSizePx,
      };

      const pet = new BasePet(this.container, cfg);
      pet.setDespawnCallback(() => {
        this.pets.delete(payload.user_id);
        this.floor.remove(payload.user_id);
        this.staticFloor?.releaseSlot(payload.user_id);
      });
      this.pets.set(payload.user_id, pet);
      await pet.spawn();
    }

    const pet = this.pets.get(payload.user_id)!;

    // Keyword-triggered action takes priority over jump-on-speak / walk-to-center.
    const kwAction = this._matchKeywordAction(payload.message);
    if (kwAction && !(this.layoutMode === "static" && this.STATIC_BLOCKED_ACTIONS.has(kwAction))) {
      await pet.executeAction(kwAction);
      return;
    }

    if (this.jumpOnSpeak) {
      await pet.executeAction("jump");
    } else {
      await pet.onChatMessage();
    }
  }

  /** Returns the action ID for the first configured keyword found as a whole
   *  token in `message` (case-insensitive), or null if none matched. */
  private static _matchKeywordAction(message: string): string | null {
    const entries = Object.entries(this.keywordActions);
    if (!entries.length) return null;
    const tokens = new Set(message.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
    for (const [keyword, action] of entries) {
      if (keyword && action && tokens.has(keyword)) return action;
    }
    return null;
  }

  /** Parses the tama_keyword_actions JSON map, lowercasing keys. */
  private static _parseKeywordActions(raw: unknown): Record<string, string> {
    try {
      const parsed = JSON.parse(String(raw ?? "{}")) as Record<string, string>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (k && typeof v === "string" && v) out[k.toLowerCase()] = v;
      }
      return out;
    } catch (_) {
      return {};
    }
  }

  /** Converts an OS path via the transport, but passes http(s) URLs (e.g. a
   *  TikTok profile picture used as a guest sprite) through unchanged. */
  private static _resolveSrc(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    return this.transport.convertFileSrc(path);
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

  private static _onTamaConfigChanged(cfg: Record<string, unknown>): void {
    this.enabled      = String(cfg["tama_enabled"])       === "true";
    this.maxPets      = Number(cfg["tama_max_pets"])      || 8;
    this.jumpOnSpeak  = String(cfg["tama_jump_on_speak"]) === "true";
    this.keywordActions = this._parseKeywordActions(cfg["tama_keyword_actions"]);

    const newFontSize = Number(cfg["tama_name_font_size_px"]) || 11;
    if (newFontSize !== this.nameFontSizePx) {
      this.nameFontSizePx = newFontSize;
      for (const pet of this.pets.values()) pet.updateNameFontSize(newFontSize);
    }

    const newSizePx   = Number(cfg["tama_pet_size_px"]) || 80;
    if (newSizePx !== this.petSizePx) {
      this.petSizePx = newSizePx;
      const newFloorY = window.innerHeight - newSizePx - 28;
      this.floor.floorY = newFloorY;
      if (this.staticFloor) {
        this.staticFloor.floorY = newFloorY;
        this.staticFloor.updatePetSizePx(newSizePx);
      }
      for (const pet of this.pets.values()) {
        pet.updateSize(newSizePx);
        pet.updateFloorY(newFloorY);
        if (this.staticFloor) {
          const newX = this.staticFloor.getSlotX(pet.userId);
          if (newX !== null) pet.updatePosX(newX);
        }
      }
    }

    const newWalkSpeed = Number(cfg["tama_walk_speed"]) || 0.6;
    const newBaseSpeed = newWalkSpeed * 60;
    if (newBaseSpeed !== BasePet.walkSpeedBase) {
      BasePet.walkSpeedBase = newBaseSpeed;
      for (const pet of this.pets.values()) pet.updateWalkSpeed(newBaseSpeed);
    }

    BasePet.inactivityMs = (Number(cfg["tama_inactivity_mins"]) || 5) * 60 * 1000;

    const checkSecs  = Number(cfg["tama_action_check_secs"])  || 8;
    const prob       = Number(cfg["tama_action_probability"]) || 0.15;
    let enabledActions: string[] | undefined;
    try {
      enabledActions = JSON.parse(String(cfg["tama_enabled_actions"] ?? "[]"));
    } catch (_) {}
    this._scheduler.update(checkSecs, prob, enabledActions);
  }

  private static async _onTamaAction(payload: TamaActionPayload): Promise<void> {
    if (this.layoutMode === "static" && this.STATIC_BLOCKED_ACTIONS.has(payload.action_id)) return;
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

  /** Destroys every active pet and recreates it from its stored config, yielding
   *  a clean DOM/FSM/timer state. Recovers pets that froze (e.g. mid-fight)
   *  without restarting the connection. Triggered by the admin panel via the
   *  "tama-reset" event. Identity (sprites, name, slot) is preserved; only the
   *  broken runtime state is wiped. */
  static async resetAll(): Promise<void> {
    if (!this.pets.size) return;

    // Snapshot configs before tearing anything down.
    const configs = Array.from(this.pets.values()).map(p => p.config);
    for (const pet of this.pets.values()) pet.destroy();
    this.pets.clear();

    // Recreate each pet fresh; spawn all in parallel so they pop back together.
    const fresh = configs.map(cfg => {
      const pet = new BasePet(this.container, { ...cfg, floorY: this.floor.floorY });
      pet.setDespawnCallback(() => {
        this.pets.delete(cfg.userId);
        this.floor.remove(cfg.userId);
        this.staticFloor?.releaseSlot(cfg.userId);
      });
      this.pets.set(cfg.userId, pet);
      return pet;
    });
    await Promise.all(fresh.map(p => p.spawn()));
    console.info(`[tama] Reset ${fresh.length} pet(s)`);
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
