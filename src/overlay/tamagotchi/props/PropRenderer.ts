// =========================================================================================================
// PROP RENDERER
// =========================================================================================================
// Manages transient DOM props (zzz bubbles, speech bubbles) attached to a pet.
// =========================================================================================================

import { animate } from "motion";

interface ProppedElement extends HTMLElement {
  _interval?: ReturnType<typeof setInterval>;
}

export class PropRenderer {
  private activeProps = new Map<string, ProppedElement>();

  showZzz(parentEl: HTMLElement): void {
    const zzz = document.createElement("div") as ProppedElement;
    zzz.className = "pet-prop pet-zzz";
    zzz.style.cssText = `
      position:absolute;
      top:-25px;
      right:-10px;
      font-size:14px;
      pointer-events:none;
      opacity:0;
      z-index:10;
    `;
    zzz.textContent = "z";
    parentEl.appendChild(zzz);
    this.activeProps.set("zzz", zzz);

    const cycle = ["z", "zz", "zzz"];
    let idx = 0;

    zzz._interval = setInterval(() => {
      if (!zzz.isConnected) { clearInterval(zzz._interval); return; }
      zzz.textContent = cycle[idx % 3];
      idx++;
      animate(zzz,
        { opacity: [0, 1, 0], transform: ["translateY(-5px)", "translateY(-15px)"] },
        { duration: 1.5 }
      );
    }, 1600);
  }

  /**
   * Emits a single heart that rises slowly like smoke and fades out, then removes
   * itself. Used for the TikTok "like" reaction. Not tracked in `activeProps` — it
   * is fully self-contained and ephemeral, so many can coexist during a like burst.
   */
  emitHeart(parentEl: HTMLElement): void {
    const heart = document.createElement("div");
    heart.className = "pet-prop pet-heart";
    heart.textContent = "❤"; // ❤
    // Slight random horizontal start + drift so a burst of likes spreads out.
    const startX = (Math.random() - 0.5) * 24;
    const drift  = (Math.random() - 0.5) * 30;
    const rise   = 70 + Math.random() * 40;
    const dur    = 1.8 + Math.random() * 0.8;
    parentEl.appendChild(heart);
    animate(heart,
      {
        opacity: [0, 1, 1, 0],
        transform: [
          `translateX(${startX}px) translateY(0px) scale(0.6)`,
          `translateX(${startX + drift * 0.4}px) translateY(-${rise * 0.4}px) scale(1.1)`,
          `translateX(${startX + drift * 0.8}px) translateY(-${rise * 0.8}px) scale(1)`,
          `translateX(${startX + drift}px) translateY(-${rise}px) scale(0.9)`,
        ],
      },
      { duration: dur, ease: "easeOut" }
    ).then(() => heart.remove());
  }

  hideAll(): void {
    for (const [, el] of this.activeProps) {
      if (el._interval) clearInterval(el._interval);
      animate(el, { opacity: 0 }, { duration: 0.3 }).then(() => el.remove());
    }
    this.activeProps.clear();
  }
}
