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
import type { PerspectiveType, PlacementMode, RowAnchor } from "./Grid2D";
import { GridGuide } from "./GridGuide";

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

interface ChatEventPayload {
  platform: string;
  event_kind: string;
  username: string;
  user_id: number | null;
  display_name: string;
  amount: number | null;
  text: string | null;
  extra: Record<string, unknown>;
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
  private static gridGuide: GridGuide | null = null;
  private static _scheduler: PetScheduler;
  private static container: HTMLElement;
  private static transport: PetTransport = _tauriTransport;

  // Tracks each pet's last known cell so a resize can re-translate without a backend
  // round-trip (the cell is authoritative, the pixels are derived).
  private static cells = new Map<number, Cell>();
  // User IDs that have already received their first cell placement. The first
  // placement snaps (no walk-from-corner); subsequent ones animate.
  private static placed = new Set<number>();

  private static enabled        = true;
  private static maxPets        = 8;
  private static petSizePx      = 80;
  private static jumpOnSpeak    = false;
  private static nameFontSizePx = 11;
  private static keywordActions: Record<string, string> = {};
  private static chatBubbleEnabled  = false;
  private static chatBubbleMaxChars = 40;
  private static _lastGuideAlpha    = 0;

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
      this.chatBubbleEnabled  = String(cfg["tama_chat_bubble_enabled"]) === "true";
      this.chatBubbleMaxChars = Number(cfg["tama_chat_bubble_max_chars"]) || 40;
      this._lastGuideAlpha    = Number(cfg["tama_grid_guide_alpha"]) || 0;
      this.grid.setConfig({
        perspective:     String(cfg["tama_grid_perspective"]) === "true",
        perspectiveType: this._parsePerspectiveType(cfg["tama_grid_perspective_type"]),
        nearScale:       Number(cfg["tama_grid_near_scale"])    || 1.3,
        farScale:        Number(cfg["tama_grid_far_scale"])     || 0.6,
        floorTopFrac:    Number(cfg["tama_grid_floor_top_frac"]) || 0.55,
        placementMode:   this._parsePlacementMode(cfg["tama_placement_mode"]),
        rowAnchor:       this._parseRowAnchor(cfg["tama_row_anchor"]),
      });
    } catch (_) {}

    this._scheduler = new PetScheduler(this.pets, []);

    // Perspective guide grid (white trapezoid). Lives on document.body so it sits
    // behind the pets but above the overlay background. Hidden when alpha is 0.
    this.gridGuide = new GridGuide(document.body, this.grid);
    this.gridGuide.setAlpha(Number(this._lastGuideAlpha));

    await this.transport.listen<ChatMessagePayload>("chat-message", e => {
      this._onChatMessage(e.payload).catch(console.error);
    });
    await this.transport.listen<TtsStatePayload>("tts-state", e => {
      this._onTtsState(e.payload);
    });
    await this.transport.listen<TamaActionPayload>("tama-action", e => {
      this._onTamaAction(e.payload).catch(console.error);
    });
    await this.transport.listen<{ user_id: number }>("tama-despawn", e => {
      this._onDespawn(e.payload.user_id).catch(console.error);
    });
    await this.transport.listen<ChatEventPayload>("chat-event", e => {
      this._onChatEvent(e.payload);
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
      this.gridGuide?.draw();
    });
    await this.transport.listen<GridUpdatePayload>("tama-grid-update", e => {
      this._onGridUpdate(e.payload, true);
    });
    await this.transport.listen<GridRemovePayload>("tama-grid-remove", e => {
      this.cells.delete(e.payload.user_id);
      this.placed.delete(e.payload.user_id);
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
      resizeTimer = setTimeout(() => { this._retranslateAll(); this.gridGuide?.draw(); }, 100);
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
        this.placed.delete(payload.user_id);
      });
      this.pets.set(payload.user_id, pet);
      await pet.spawn();

      // Ask the backend to assign a cell; the resulting tama-grid-update places it.
      this.transport.invoke("tama_grid_ensure", { userId: payload.user_id }).catch(() => {});
    }

    const pet = this.pets.get(payload.user_id)!;

    // Any chat message counts as activity: reset the inactivity timer and wake the
    // pet if it was asleep. This MUST run regardless of which action path runs below,
    // otherwise a user who only sends keyword/command messages (or any user when
    // jump-on-speak is on) never resets the timer and their pet wrongly despawns.
    await pet.onChatMessage();

    // Show the chat message bubble over the pet, if enabled.
    if (this.chatBubbleEnabled && payload.message) {
      pet.showChatBubble(payload.message, this.chatBubbleMaxChars);
    }

    // Keyword-triggered action takes priority over jump-on-speak.
    const kwAction = this._matchKeywordAction(payload.message);
    if (kwAction) {
      await pet.executeAction(kwAction);
      return;
    }

    if (this.jumpOnSpeak) {
      await pet.executeAction("jump");
    }
  }

  private static _onGridUpdate(payload: GridUpdatePayload, animateMove: boolean): void {
    const cell: Cell = { x: payload.cell_x, y: payload.cell_y };
    const isFirstPlacement = !this.placed.has(payload.user_id);
    const prevCell = this.cells.get(payload.user_id);
    // A re-emitted cell that didn't actually change (e.g. the snapshot a `reconfigure`
    // broadcasts when the anchor/placement mode changes) must NOT animate: the pixels
    // moved because the projection changed, not because the pet walked. Walking here
    // would start an animation toward the new edge that fights the layout snap and can
    // leave pets stranded on the wrong side until a resize.
    const cellUnchanged = !!prevCell && prevCell.x === cell.x && prevCell.y === cell.y;
    this.cells.set(payload.user_id, cell);
    this.placed.add(payload.user_id);
    const pet = this.pets.get(payload.user_id);
    if (!pet) return;
    const px = this.grid.cellToPx(cell.x, cell.y, pet.size);
    // First placement must SNAP, never walk: the backend assigns the cell after the
    // pet spawns, so a pet that defaults to (0,0)=top-left would otherwise be seen
    // strolling from the corner to its spot — which reads as a bug to streamers.
    pet.applyCell(cell, px, animateMove && !isFirstPlacement && !cellUnchanged).catch(() => {});
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

  /** Validates the tama_grid_perspective_type config value, defaulting to "plano". */
  private static _parsePerspectiveType(raw: unknown): PerspectiveType {
    const v = String(raw ?? "plano");
    return v === "colina_abajo" || v === "horizonte" ? v : "plano";
  }

  /** Validates the tama_placement_mode config value, defaulting to "free". */
  private static _parsePlacementMode(raw: unknown): PlacementMode {
    return String(raw ?? "free") === "row" ? "row" : "free";
  }

  /** Validates the tama_row_anchor config value, defaulting to "left". */
  private static _parseRowAnchor(raw: unknown): RowAnchor {
    return String(raw ?? "left") === "right" ? "right" : "left";
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
    this.chatBubbleEnabled  = String(cfg["tama_chat_bubble_enabled"]) === "true";
    this.chatBubbleMaxChars = Number(cfg["tama_chat_bubble_max_chars"]) || 40;

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

    // Apply perspective / floor-band / placement changes live, then re-translate.
    const placementMode = this._parsePlacementMode(cfg["tama_placement_mode"]);
    this.grid.setConfig({
      perspective:     String(cfg["tama_grid_perspective"]) === "true",
      perspectiveType: this._parsePerspectiveType(cfg["tama_grid_perspective_type"]),
      nearScale:       Number(cfg["tama_grid_near_scale"])    || 1.3,
      farScale:        Number(cfg["tama_grid_far_scale"])     || 0.6,
      floorTopFrac:    Number(cfg["tama_grid_floor_top_frac"]) || 0.55,
      placementMode,
      rowAnchor:       this._parseRowAnchor(cfg["tama_row_anchor"]),
    });
    this._retranslateAll();

    // Perspective guide grid alpha (redraws / hides live). The guide is meaningless
    // in row mode (no floor band), so force it hidden there.
    this._lastGuideAlpha = placementMode === "row"
      ? 0
      : Number(cfg["tama_grid_guide_alpha"]) || 0;
    this.gridGuide?.setAlpha(this._lastGuideAlpha);

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

  /** Backend-requested despawn (e.g. stopping the demo pets). Runs the normal
   *  despawn animation + callback so the pet leaves the overlay cleanly; the
   *  despawnCallback drops the local references. */
  private static async _onDespawn(userId: number): Promise<void> {
    const pet = this.pets.get(userId);
    if (pet) await pet.remove();
  }

  /** Reacts to live events on a specific pet. Currently: a TikTok "like" makes the
   *  user's pet (if present) emit a floating heart. This is a transient FX, not an
   *  FSM action — it never interrupts whatever the pet is doing. */
  private static _onChatEvent(payload: ChatEventPayload): void {
    if (!this.enabled) return;
    if (payload.event_kind !== "tiktok_like") return;
    if (payload.user_id === null || payload.user_id === undefined) return;
    const pet = this.pets.get(payload.user_id);
    if (pet) pet.emitHeart();
  }

  // =========================================================================================================
  // Public Helpers (used by actions)
  // =========================================================================================================

  static shutdown(): void {
    this._scheduler?.stop();
    this.pets.clear();
    this.cells.clear();
    this.placed.clear();
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
        this.placed.delete(cfg.userId);
      });
      this.pets.set(cfg.userId, pet);
      return pet;
    });
    // Recreated pets must snap to their (preserved) backend cell, not walk to it.
    for (const cfg of configs) this.placed.delete(cfg.userId);
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
