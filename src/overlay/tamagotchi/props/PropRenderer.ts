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

  hideAll(): void {
    for (const [, el] of this.activeProps) {
      if (el._interval) clearInterval(el._interval);
      animate(el, { opacity: 0 }, { duration: 0.3 }).then(() => el.remove());
    }
    this.activeProps.clear();
  }
}
