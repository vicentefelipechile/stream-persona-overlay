// =========================================================================================================
// ANIMATION ENGINE
// =========================================================================================================
// Motion.js-powered enter/exit animations for persona bubbles.
// All animation types can be selected by the streamer from the /animations view.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { animate, spring } from "motion";

// =========================================================================================================
// Types
// =========================================================================================================

export type AnimationType =
  | "bounce"       // Enters bouncing from below — cartoon, energetic
  | "slide-up"     // Rises smoothly with spring physics — clean, professional
  | "slide-left"   // Enters from the right with spring — directional
  | "slide-right"  // Enters from the left with spring — directional
  | "pop"          // Scales from 0 with spring overshoot — modern, playful
  | "flip"         // 3D Y-axis flip — dramatic
  | "shake"        // Horizontal vibration on entry — comic
  | "rubber"       // Rubber band elastic deformation — cartoon, exaggerated
  | "glitch"       // Rapid displacement glitch effect — cyberpunk
  | "float";       // Fade + continuous gentle float — calm, magical

// =========================================================================================================
// AnimationEngine
// =========================================================================================================

export class AnimationEngine {

  // Motion v11 restricts ObjectTarget<HTMLElement> and excludes shorthand
  // transform properties (x, y, scale, rotateY, skewX, etc.) from its types,
  // even though they work fine at runtime. This wrapper centralises the cast.
  private static animEl(
    el: HTMLElement,
    kf: Record<string, number | string | (number | string)[]>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    opts?: any
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return animate(el as any, kf as any, opts);
  }

  // =========================================================================================================
  // Enter Animations
  // =========================================================================================================

  static async playIn(el: HTMLElement, type: AnimationType): Promise<void> {
    el.style.visibility = "visible";
    el.style.opacity = "0";

    const a = AnimationEngine.animEl;

    switch (type) {
      case "bounce":
        await a(el,
          { y: [120, -20, 10, -5, 0], opacity: [0, 1, 1, 1, 1] },
          { duration: 0.6, easing: [0.215, 0.61, 0.355, 1] }
        ).finished;
        break;

      case "slide-up":
        await a(el,
          { y: [100, 0], opacity: [0, 1] },
          { duration: 0.45, easing: spring({ stiffness: 280, damping: 22 } as any) }
        ).finished;
        break;

      case "slide-left":
        await a(el,
          { x: [200, 0], opacity: [0, 1] },
          { duration: 0.4, easing: spring({ stiffness: 300, damping: 25 } as any) }
        ).finished;
        break;

      case "slide-right":
        await a(el,
          { x: [-200, 0], opacity: [0, 1] },
          { duration: 0.4, easing: spring({ stiffness: 300, damping: 25 } as any) }
        ).finished;
        break;

      case "pop":
        await a(el,
          { scale: [0, 1.15, 0.95, 1], opacity: [0, 1, 1, 1] },
          { duration: 0.5, easing: spring({ stiffness: 400, damping: 20 } as any) }
        ).finished;
        break;

      case "flip":
        el.style.perspective = "600px";
        await a(el,
          { rotateY: [-90, 10, 0], opacity: [0, 1, 1] },
          { duration: 0.55, easing: spring({ stiffness: 250, damping: 18 } as any) }
        ).finished;
        break;

      case "shake":
        await a(el,
          { x: [0, -15, 12, -8, 5, -3, 0], opacity: [0, 1, 1, 1, 1, 1, 1] },
          { duration: 0.5 }
        ).finished;
        break;

      case "rubber":
        await a(el,
          {
            scaleX: [0.1, 1.25, 0.75, 1.15, 0.95, 1],
            scaleY: [0.1, 0.75, 1.25, 0.85, 1.05, 1],
            opacity: [0, 1, 1, 1, 1, 1],
          },
          { duration: 0.7 }
        ).finished;
        break;

      case "glitch": {
        a(el, { opacity: [0, 1] }, { duration: 0.05 });
        for (let i = 0; i < 5; i++) {
          await a(el,
            { x: [0, Math.random() * 16 - 8, 0] },
            { duration: 0.06 }
          ).finished;
        }
        await a(el, { x: [0, 0], skewX: [5, -3, 0] }, { duration: 0.2 }).finished;
        break;
      }

      case "float":
        await a(el,
          { y: [30, 0], opacity: [0, 1] },
          { duration: 0.8, easing: "ease-out" }
        ).finished;
        // Continuous float loop while visible
        a(el,
          { y: [0, -8, 0] },
          { duration: 3, repeat: Infinity, easing: "ease-in-out" }
        );
        break;
    }
  }

  // =========================================================================================================
  // Exit Animations
  // =========================================================================================================

  static async playOut(el: HTMLElement, type: AnimationType): Promise<void> {
    // Cancel any active Motion.js animations (e.g. float loop) before exiting
    el.getAnimations().forEach((anim) => {
      if (anim instanceof CSSAnimation) return;
      anim.cancel();
    });

    const a = AnimationEngine.animEl;

    switch (type) {
      case "bounce":
      case "pop":
        await a(el,
          { scale: [1, 1.1, 0], opacity: [1, 1, 0] },
          { duration: 0.35 }
        ).finished;
        break;

      case "slide-up":
        await a(el,
          { y: [0, -80], opacity: [1, 0] },
          { duration: 0.35, easing: "ease-in" }
        ).finished;
        break;

      case "slide-left":
        await a(el,
          { x: [0, 200], opacity: [1, 0] },
          { duration: 0.35, easing: "ease-in" }
        ).finished;
        break;

      case "slide-right":
        await a(el,
          { x: [0, -200], opacity: [1, 0] },
          { duration: 0.35, easing: "ease-in" }
        ).finished;
        break;

      case "flip":
        await a(el,
          { rotateY: [0, 90], opacity: [1, 0] },
          { duration: 0.35 }
        ).finished;
        break;

      case "float":
        await a(el,
          { y: [0, 30], opacity: [1, 0] },
          { duration: 0.4, easing: "ease-in" }
        ).finished;
        break;

      case "glitch": {
        for (let i = 0; i < 3; i++) {
          await a(el,
            { x: [0, Math.random() * 12 - 6, 0] },
            { duration: 0.05 }
          ).finished;
        }
        await a(el, { opacity: [1, 0], scaleY: [1, 0.1] }, { duration: 0.15 }).finished;
        break;
      }

      default:
        await a(el,
          { opacity: [1, 0] },
          { duration: 0.3 }
        ).finished;
    }

    el.style.visibility = "hidden";
  }
}
