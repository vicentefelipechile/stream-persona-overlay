// =========================================================================================================
// ALERT MANAGER
// =========================================================================================================
// Renders TikTok event alerts (image + text + sound) on the dedicated alert
// overlay (overlay-tiktok.html). Alerts are queued and shown one at a time so a
// burst of events never overlaps. The backend resolves each alert before
// emitting `tiktok-alert`, so this class only renders the already-formatted data.
//
// NOTE (motion v12): keyframe transforms MUST be passed as CSS `transform`
// strings, not shorthand props (x/scale/...). See AGENTS.md §3.
// =========================================================================================================

import { animate } from "motion";

export interface TiktokAlertPayload {
  event_kind: string;
  image_path: string;
  sound_path: string;
  text: string;
  duration_ms: number;
  transition: string;
}

/** Converts an absolute OS path into a URL the overlay can load. */
type ConvertFn = (path: string) => string;

// Entry transforms per transition: animate from `from` -> `to` while fading in.
const ENTER: Record<string, { from: string; to: string }> = {
  fade: { from: "none", to: "none" },
  "slide-down": { from: "translateY(-48px)", to: "translateY(0px)" },
  "slide-up": { from: "translateY(48px)", to: "translateY(0px)" },
  scale: { from: "scale(0.6)", to: "scale(1)" },
  none: { from: "none", to: "none" },
};

// Exit transform per transition: animate to this while fading out.
const EXIT: Record<string, string> = {
  fade: "none",
  "slide-down": "translateY(-48px)",
  "slide-up": "translateY(48px)",
  scale: "scale(0.6)",
  none: "none",
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AlertManager {
  private readonly root: HTMLElement;
  private readonly convert: ConvertFn;
  private readonly queue: TiktokAlertPayload[] = [];
  private playing = false;

  constructor(root: HTMLElement, convert: ConvertFn) {
    this.root = root;
    this.convert = convert;
  }

  /** Adds an alert to the queue and starts the player if idle. */
  enqueue(alert: TiktokAlertPayload): void {
    this.queue.push(alert);
    if (!this.playing) void this.playNext();
  }

  private async playNext(): Promise<void> {
    const alert = this.queue.shift();
    if (!alert) {
      this.playing = false;
      return;
    }
    this.playing = true;
    try {
      await this.show(alert);
    } catch (e) {
      console.warn("[alerts] error mostrando alerta:", e);
    }
    void this.playNext();
  }

  private async show(alert: TiktokAlertPayload): Promise<void> {
    const el = document.createElement("div");
    el.className = "spo-alert";

    if (alert.image_path) {
      const img = document.createElement("img");
      img.className = "spo-alert__img";
      img.src = this.convert(alert.image_path);
      el.appendChild(img);
    }
    if (alert.text) {
      const txt = document.createElement("div");
      txt.className = "spo-alert__text";
      txt.textContent = alert.text;
      el.appendChild(txt);
    }
    this.root.appendChild(el);

    // Fire-and-forget sound (autoplay is allowed in OBS browser sources).
    let audio: HTMLAudioElement | null = null;
    if (alert.sound_path) {
      try {
        audio = new Audio(this.convert(alert.sound_path));
        audio.play().catch(() => {});
      } catch {
        /* ignore audio failures — the visual alert still shows */
      }
    }

    const transition = alert.transition || "fade";
    const enter = ENTER[transition] ?? ENTER.fade;
    const exitTransform = EXIT[transition] ?? EXIT.fade;
    const animDur = transition === "none" ? 0 : 0.4;

    // Entry: set the initial state to avoid a one-frame flash, then animate in.
    // motion v12 needs keyframe arrays here; transforms must be CSS strings.
    el.style.opacity = "0";
    el.style.transform = enter.from;
    await animate(
      el,
      { opacity: [0, 1], transform: [enter.from, enter.to] },
      { duration: animDur }
    );

    await wait(Math.max(0, alert.duration_ms));

    // Exit: fade out (and move out for non-fade transitions).
    await animate(
      el,
      { opacity: [1, 0], transform: [enter.to, exitTransform] },
      { duration: animDur }
    );

    el.remove();
    if (audio) {
      try {
        audio.pause();
      } catch {
        /* noop */
      }
    }
  }
}
