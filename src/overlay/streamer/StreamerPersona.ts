// =========================================================================================================
// StreamerPersona
// =========================================================================================================
// Renders the streamer persona: four stacked <img> sprites (mouth × eyes matrix)
// of which exactly one is visible per frame. Drives a single rAF loop that:
//   1. reads the mic level         -> mouth open if level > threshold
//   2. ticks the BlinkScheduler    -> eyes open/closed (independent of talking)
//   3. shows the matching sprite
//   4. toggles the talk-animation CSS class while speaking
//
// All visual config (sprites, size, anchor, timing, threshold, animation) is
// applied through applyConfig(), which the overlay calls on init and on every
// `streamer-config-changed` event so edits take effect live.
// =========================================================================================================

import { BlinkScheduler, type EyeState } from "./BlinkScheduler";

type Slot = "mo_eo" | "mc_eo" | "mo_ec" | "mc_ec";

const TALK_ANIMATIONS = ["none", "bounce", "abs-bounce", "tremor", "sway", "pulse", "squash", "jelly"] as const;
type TalkAnimation = (typeof TALK_ANIMATIONS)[number];

/** Subset of the config object relevant to the streamer overlay. */
export interface StreamerConfig {
  streamer_persona_enabled: boolean;
  streamer_sprite_mo_eo: string;
  streamer_sprite_mc_eo: string;
  streamer_sprite_mo_ec: string;
  streamer_sprite_mc_ec: string;
  streamer_blink_interval_ms: number;
  streamer_blink_duration_ms: number;
  streamer_talk_animation: string;
  streamer_size_px: number;
  streamer_anchor: string;
  streamer_mic_threshold: number;
  streamer_mic_device_id: string;
}

export class StreamerPersona {
  private root: HTMLElement;
  private imgs: Record<Slot, HTMLImageElement>;
  private blink: BlinkScheduler;

  private talkAnim: TalkAnimation = "bounce";
  private enabled = true;
  // Speaking state pushed from the backend (native mic capture broadcasts the
  // `streamer-speaking` boolean — threshold + hang time are applied there).
  private speaking = false;
  private rafId = 0;

  private convert: (path: string) => string;

  constructor(container: HTMLElement, convertFileSrc: (path: string) => string) {
    this.convert = convertFileSrc;
    this.blink = new BlinkScheduler(4000, 150);

    this.root = document.createElement("div");
    this.root.className = "streamer-persona";

    const make = (slot: Slot): HTMLImageElement => {
      const img = document.createElement("img");
      img.className = "streamer-sprite";
      img.dataset.slot = slot;
      img.alt = "";
      img.draggable = false;
      this.root.appendChild(img);
      return img;
    };
    this.imgs = {
      mo_eo: make("mo_eo"),
      mc_eo: make("mc_eo"),
      mo_ec: make("mo_ec"),
      mc_ec: make("mc_ec"),
    };

    container.appendChild(this.root);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async init(cfg: StreamerConfig): Promise<void> {
    this.applyConfig(cfg);
    this.blink.start(performance.now());
    this.loop();
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
  }

  /** Updates the speaking state from the backend `streamer-speaking` broadcast. */
  setSpeaking(on: boolean): void {
    this.speaking = on;
  }

  // ── Config ───────────────────────────────────────────────────────────────--

  applyConfig(cfg: StreamerConfig): void {
    this.enabled = cfg.streamer_persona_enabled;
    this.talkAnim = TALK_ANIMATIONS.includes(cfg.streamer_talk_animation as TalkAnimation)
      ? (cfg.streamer_talk_animation as TalkAnimation)
      : "none";

    this.blink.setTiming(
      cfg.streamer_blink_interval_ms,
      cfg.streamer_blink_duration_ms,
      performance.now(),
    );

    // Sprites — only reassign src when it actually changes to avoid reloads.
    this.setSrc("mo_eo", cfg.streamer_sprite_mo_eo);
    this.setSrc("mc_eo", cfg.streamer_sprite_mc_eo);
    this.setSrc("mo_ec", cfg.streamer_sprite_mo_ec);
    this.setSrc("mc_ec", cfg.streamer_sprite_mc_ec);

    // Size + anchor.
    this.root.style.setProperty("--streamer-size", `${cfg.streamer_size_px}px`);
    this.root.dataset.anchor = ["left", "center", "right"].includes(cfg.streamer_anchor)
      ? cfg.streamer_anchor
      : "center";

    this.root.style.display = this.enabled ? "" : "none";
  }

  private setSrc(slot: Slot, path: string): void {
    const img = this.imgs[slot];
    if (!path) {
      img.removeAttribute("src");
      return;
    }
    // The sprite file is overwritten in place on re-upload, so the URL is
    // identical and the cached image would persist. setSrc only runs from
    // applyConfig (init + config-change events), so a per-call cache-buster
    // guarantees the new sprite shows without reloading the whole overlay.
    const url = this.convert(path);
    img.src = `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`;
  }

  // ── Render loop ──────────────────────────────────────────────────────────--

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    if (!this.enabled) return;

    const now = performance.now();

    // 1. Mouth from the backend-provided speaking state.
    const mouthOpen = this.speaking;

    // 2. Eyes from the scheduler.
    const eyes: EyeState = this.blink.tick(now);

    // 3. Show the matching sprite.
    const slot: Slot = `${mouthOpen ? "mo" : "mc"}_${eyes === "open" ? "eo" : "ec"}` as Slot;
    this.showSlot(slot);

    // 4. Talk animation while speaking.
    const wantAnim = mouthOpen ? this.talkAnim : "none";
    if (this.root.dataset.talk !== wantAnim) {
      this.root.dataset.talk = wantAnim;
    }
  };

  private showSlot(active: Slot): void {
    for (const slot of Object.keys(this.imgs) as Slot[]) {
      this.imgs[slot].style.opacity = slot === active ? "1" : "0";
    }
  }
}
