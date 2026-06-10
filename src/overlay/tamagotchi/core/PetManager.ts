// =========================================================================================================
// PET MANAGER
// =========================================================================================================
// Singleton that owns all active tamagotchi pets. Positioning is now backend-
// authoritative: the Rust `GridManager` assigns each pet a grid cell and broadcasts
// `tama-grid-config` / `tama-grid-update` / `tama-grid-remove`. PetManager translates
// cells to pixels via `Grid2D` and tells each `BasePet` where to be — pets never
// decide their own position. It still listens to chat-message / tts-state / tama-action
// for spawning, lip-sync, and actions.
// =========================================================================================================

import { listen } from "@tauri-apps/api/event";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { BasePet, configureBasePetInvoke } from "./BasePet";
import type { PetConfig, Cell } from "./BasePet";
import { Grid2D } from "./Grid2D";

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

interface GridConfigPayload { cols: number; rows: number; }
interface GridUpdatePayload { user_id: number; cell_x: number; cell_y: number; }
interface GridRemovePayload { user_id: number; }
interface GridSnapshot { cols: number; rows: number; cells: GridUpdatePayload[]; }

// =========================================================================================================
// PetManager
// =========================================================================================================

export class PetManager {
  private static pets      = new Map<number, BasePet>();
  private static grid      = new Grid2D();
  private static _scheduler: PetScheduler;
  private static container: HTMLElement;
  private static transport: PetTransport = _tauriTransport;

  // Tracks each pet's last known cell so a resize can re-translate without a backend
  // round-trip (the cell is authoritative, the pixels are derived).
  private static cells = new Map<number, Cell>();

  private static enabled        = true;
  private static maxPets        = 8;
  private static petSizePx      = 80;
  private static jumpOnSpeak    = false;
  private static nameFontSizePx = 11;
  private static keywordActions: Record<string, string> = {};

  // =========================================================================================================
  // Init
  // =========================================================================================================

  static async init(container: HTMLElement, transport?: PetTransport): Promise<void> {
    this.container = container;
    if (transport) {
      this.transport = transport;
      configureBasePetInvoke((cmd, args) => transport.invoke(cmd, args));
    }

    try {
      const cfg = await this.transport.invoke<Record<string, unknown>>("get_config_cmd");
      this.enabled        = String(cfg["tama_enabled"])           === "true";
      this.maxPets        = Number(cfg["tama_max_pets"])          || 8;
      this.petSizePx      = Number(cfg["tama_pet_size_px"])       || 80;
      this.jumpOnSpeak    = String(cfg["tama_jump_on_speak"])     === "true";
      this.nameFontSizePx = Number(cfg["tama_name_font_size_px"]) || 11;
      this.keywordActions = this._parseKeywordActions(cfg["tama_keyword_actions"]);
      this.grid.setConfig({
        perspective:  String(cfg["tama_grid_perspective"]) === "true",
        nearScale:    Number(cfg["tama_grid_near_scale"])    || 1.3,
        farScale:     Number(cfg["tama_grid_far_scale"])     || 0.6,
        floorTopFrac: Number(cfg["tama_grid_floor_top_frac"]) || 0.55,
      });
    } catch (_) {}

    this._scheduler = new PetScheduler(this.pets, []);

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

    // Grid events — backend-authoritative positioning.
    await this.transport.listen<GridConfigPayload>("tama-grid-config", e => {
      this.grid.setDimensions(e.payload.cols, e.payload.rows);
      this._retranslateAll();
    });
    await this.transport.listen<GridUpdatePayload>("tama-grid-update", e => {
      this._onGridUpdate(e.payload, true);
    });
    await this.transport.listen<GridRemovePayload>("tama-grid-remove", e => {
      this.cells.delete(e.payload.user_id);
    });

    // Rehydrate dims + existing cells (for clients that connect after pets exist).
    try {
      const snap = await this.transport.invoke<GridSnapshot>("tama_grid_get_state");
      this.grid.setDimensions(snap.cols, snap.rows);
      for (const c of snap.cells) this._onGridUpdate(c, false);
    } catch (_) {}

    // Re-translate every pet's cell to pixels on resize (cells stay authoritative).
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    window.addEventListener("resize", () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this._retranslateAll(), 100);
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

      const cfg: PetConfig = {
        userId:        payload.user_id,
        displayName:   payload.display_name,
        mouthOpenUrl:   this._resolveSrc(payload.mouth_open_path),
        mouthClosedUrl: this._resolveSrc(payload.mouth_closed_path),
        sizePx:         this.petSizePx,
        nameFontSizePx: this.nameFontSizePx,
      };

      const pet = new BasePet(this.container, cfg);
      pet.setDespawnCallback(() => {
        // BasePet already invoked tama_remove_pet_state, which frees the backend
        // grid cell; just drop the local references here.
        this.pets.delete(payload.user_id);
        this.cells.delete(payload.user_id);
      });
      this.pets.set(payload.user_id, pet);
      await pet.spawn();

      // Ask the backend to assign a cell; the resulting tama-grid-update places it.
      this.transport.invoke("tama_grid_ensure", { userId: payload.user_id }).catch(() => {});
    }

    const pet = this.pets.get(payload.user_id)!;

    // Keyword-triggered action takes priority over jump-on-speak.
    const kwAction = this._matchKeywordAction(payload.message);
    if (kwAction) {
      await pet.executeAction(kwAction);
      return;
    }

    if (this.jumpOnSpeak) {
      await pet.executeAction("jump");
    } else {
      await pet.onChatMessage();
    }
  }

  private static _onGridUpdate(payload: GridUpdatePayload, animateMove: boolean): void {
    const cell: Cell = { x: payload.cell_x, y: payload.cell_y };
    this.cells.set(payload.user_id, cell);
    const pet = this.pets.get(payload.user_id);
    if (!pet) return;
    const px = this.grid.cellToPx(cell.x, cell.y, pet.size);
    pet.applyCell(cell, px, animateMove).catch(() => {});
  }

  /** Re-derive pixels for every pet from its authoritative cell (resize / config). */
  private static _retranslateAll(): void {
    for (const [userId, pet] of this.pets) {
      const cell = this.cells.get(userId);
      if (!cell) continue;
      const px = this.grid.cellToPx(cell.x, cell.y, pet.size);
      pet.applyCell(cell, px, false).catch(() => {});
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

    const newSizePx = Number(cfg["tama_pet_size_px"]) || 80;
    if (newSizePx !== this.petSizePx) {
      this.petSizePx = newSizePx;
      for (const pet of this.pets.values()) pet.updateSize(newSizePx);
    }

    // Apply perspective / floor-band changes live, then re-translate.
    this.grid.setConfig({
      perspective:  String(cfg["tama_grid_perspective"]) === "true",
      nearScale:    Number(cfg["tama_grid_near_scale"])    || 1.3,
      farScale:     Number(cfg["tama_grid_far_scale"])     || 0.6,
      floorTopFrac: Number(cfg["tama_grid_floor_top_frac"]) || 0.55,
    });
    this._retranslateAll();

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
    const pet = this.pets.get(payload.user_id);
    if (pet) await pet.executeAction(payload.action_id, payload.input);
  }

  // =========================================================================================================
  // Public Helpers (used by actions)
  // =========================================================================================================

  static shutdown(): void {
    this._scheduler?.stop();
    this.pets.clear();
    this.cells.clear();
  }

  /** The cell currently assigned to a pet, or null. Used by actions (e.g. fight). */
  static getCell(userId: number): Cell | null {
    const c = this.cells.get(userId);
    return c ? { ...c } : null;
  }

  /** The shared Grid2D, so actions can translate cells to pixels. */
  static getGrid(): Grid2D { return this.grid; }

  /** Ask the backend to move a pet to the free cell nearest a target. The resulting
   *  tama-grid-update animates the pet. Used by fight/actions. */
  static requestMove(userId: number, cellX: number, cellY: number): void {
    this.transport.invoke("tama_grid_move", { userId, cellX, cellY }).catch(() => {});
  }

  /** Destroys every active pet and recreates it from its stored config, yielding a
   *  clean DOM/FSM/timer state. Triggered by the admin panel via "tama-reset". */
  static async resetAll(): Promise<void> {
    if (!this.pets.size) return;

    const configs = Array.from(this.pets.values()).map(p => p.config);
    for (const pet of this.pets.values()) pet.destroy();
    this.pets.clear();

    const fresh = configs.map(cfg => {
      const pet = new BasePet(this.container, cfg);
      pet.setDespawnCallback(() => {
        this.pets.delete(cfg.userId);
        this.cells.delete(cfg.userId);
      });
      this.pets.set(cfg.userId, pet);
      return pet;
    });
    await Promise.all(fresh.map(p => p.spawn()));

    // Re-assign cells from the backend so the recreated pets get placed.
    for (const cfg of configs) {
      this.transport.invoke("tama_grid_ensure", { userId: cfg.userId }).catch(() => {});
    }
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
