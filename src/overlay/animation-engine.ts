// =========================================================================================================
// ANIMATION ENGINE
// =========================================================================================================
// Motion.js-powered enter/exit animations for persona bubbles.
// All animation types can be selected by the streamer from the /animations view.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { animate } from "motion";

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


  // =========================================================================================================
  // Enter Animations
  // =========================================================================================================

  static async playIn(el: HTMLElement, type: AnimationType): Promise<void> {
    el.style.visibility = "visible";

    switch (type) {
      case "bounce":
        await animate(el,
          { transform: ["translateY(120px)", "translateY(-20px)", "translateY(10px)", "translateY(-5px)", "translateY(0px)"], opacity: [0, 1, 1, 1, 1] },
          { duration: 0.6, ease: [0.215, 0.61, 0.355, 1] }
        );
        break;

      case "slide-up":
        el.style.transform = "translateY(100px)";
        el.style.opacity = "0";
        void el.offsetWidth;
        await animate(el,
          { transform: "translateY(0px)", opacity: 1 },
          { type: "spring", stiffness: 280, damping: 22 }
        );
        break;

      case "slide-left":
        el.style.transform = "translateX(200px)";
        el.style.opacity = "0";
        void el.offsetWidth;
        await animate(el,
          { transform: "translateX(0px)", opacity: 1 },
          { type: "spring", stiffness: 300, damping: 25 }
        );
        break;

      case "slide-right":
        el.style.transform = "translateX(-200px)";
        el.style.opacity = "0";
        void el.offsetWidth;
        await animate(el,
          { transform: "translateX(0px)", opacity: 1 },
          { type: "spring", stiffness: 300, damping: 25 }
        );
        break;

      case "pop":
        el.style.transform = "scale(0)";
        el.style.opacity = "0";
        void el.offsetWidth;
        await animate(el,
          { transform: "scale(1)", opacity: 1 },
          { type: "spring", stiffness: 400, damping: 20 }
        );
        break;

      case "flip":
        el.style.perspective = "600px";
        el.style.transform = "rotateY(-90deg)";
        el.style.opacity = "0";
        void el.offsetWidth;
        await animate(el,
          { transform: "rotateY(0deg)", opacity: 1 },
          { type: "spring", stiffness: 250, damping: 18 }
        );
        break;

      case "shake":
        await animate(el,
          { transform: ["translateX(0px)", "translateX(-15px)", "translateX(12px)", "translateX(-8px)", "translateX(5px)", "translateX(-3px)", "translateX(0px)"], opacity: [0, 1, 1, 1, 1, 1, 1] },
          { duration: 0.5 }
        );
        break;

      case "rubber":
        await animate(el,
          {
            transform: [
              "scale(0.1, 0.1)",
              "scale(1.25, 0.75)",
              "scale(0.75, 1.25)",
              "scale(1.15, 0.85)",
              "scale(0.95, 1.05)",
              "scale(1, 1)"
            ],
            opacity: [0, 1, 1, 1, 1, 1],
          },
          { duration: 0.7 }
        );
        break;

      case "glitch": {
        animate(el, { opacity: [0, 1] }, { duration: 0.05 });
        for (let i = 0; i < 5; i++) {
          const rx = Math.random() * 16 - 8;
          await animate(el,
            { transform: [`translateX(0px)`, `translateX(${rx}px)`, `translateX(0px)`] },
            { duration: 0.06 }
          );
        }
        await animate(el, { transform: ["translateX(0px) skewX(5deg)", "translateX(0px) skewX(-3deg)", "translateX(0px) skewX(0deg)"] }, { duration: 0.2 });
        break;
      }

      case "float":
        await animate(el,
          { transform: ["translateY(30px)", "translateY(0px)"], opacity: [0, 1] },
          { duration: 0.8, ease: "easeOut" }
        );
        // Continuous float loop while visible
        animate(el,
          { transform: ["translateY(0px)", "translateY(-8px)", "translateY(0px)"] },
          { duration: 3, repeat: Infinity, ease: "easeInOut" }
        );
        break;
    }
  }

  // =========================================================================================================
  // Exit Animations
  // =========================================================================================================

  static async playOut(el: HTMLElement, type: AnimationType): Promise<void> {
    // Cancel any active Motion.js animations (float loop, etc.) before exiting.
    // Also cancel CSS animations on the inner element to avoid conflicts.
    el.getAnimations().forEach((anim) => {
      if (anim instanceof CSSAnimation) return;
      anim.cancel();
    });
    const inner = el.querySelector<HTMLElement>(".persona-inner");
    if (inner) inner.getAnimations().forEach((a) => a.cancel());

    // IMPORTANT: Do NOT use explicit starting keyframes like { y: [0, -80] }.
    // If a previous animation (float, entry) left the element at a non-zero
    // transform, the [0, ...] start causes a visible snap before the exit.
    // Single end-keyframe lets Motion.js animate FROM the current position.


    switch (type) {
      case "bounce":
      case "pop":
        await animate(el,
          { transform: "scale(0)", opacity: 0 },
          { duration: 0.35 }
        );
        break;

      case "slide-up":
        await animate(el,
          { transform: "translateY(-80px)", opacity: 0 },
          { duration: 0.35, ease: "easeIn" }
        );
        break;

      case "slide-left":
        await animate(el,
          { transform: "translateX(200px)", opacity: 0 },
          { duration: 0.35, ease: "easeIn" }
        );
        break;

      case "slide-right":
        await animate(el,
          { transform: "translateX(-200px)", opacity: 0 },
          { duration: 0.35, ease: "easeIn" }
        );
        break;

      case "flip":
        await animate(el,
          { transform: "rotateY(90deg)", opacity: 0 },
          { duration: 0.35 }
        );
        break;

      case "float":
        await animate(el,
          { transform: "translateY(30px)", opacity: 0 },
          { duration: 0.4, ease: "easeIn" }
        );
        break;

      case "glitch": {
        for (let i = 0; i < 3; i++) {
          const rx = Math.random() * 12 - 6;
          await animate(el,
            { transform: [`translateX(0px)`, `translateX(${rx}px)`, `translateX(0px)`] },
            { duration: 0.05 }
          );
        }
        await animate(el, { opacity: 0, transform: "scaleY(0.1)" }, { duration: 0.15 });
        break;
      }

      default:
        await animate(el,
          { opacity: 0 },
          { duration: 0.3 }
        );
    }

    el.style.visibility = "hidden";
  }
}
