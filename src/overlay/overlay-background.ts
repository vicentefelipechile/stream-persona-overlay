// =========================================================================================================
// OVERLAY BACKGROUND
// =========================================================================================================
// Shared background layer for both overlay targets (the chroma-key Tauri window and
// the transparent OBS Browser Source). It paints `#overlay-bg` — a full-screen layer
// behind the pets — with either a flat color or an uploaded image, at one of three
// quality levels (original / media / baja).
//
// The backend pre-generates the three image variants on upload (bg_original.<ext> /
// bg_media.png / bg_baja.png under {app_data_dir}/overlay_bg/). This module only
// derives the right variant path from the stored original path + chosen quality.
//
// Transport-agnostic: pass the Tauri API surface (overlay.ts) or the WS transport
// (overlay-browser.ts).
//
// `#overlay-bg` only paints in "image" mode. In "color" mode it stays transparent:
//   - the chroma window keeps its chroma color on the body (set by overlay.ts), so
//     the chroma key still works;
//   - the OBS Browser Source stays transparent.
// =========================================================================================================

export interface BackgroundTransport {
  listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<() => void>;
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  convertFileSrc(path: string): string;
}

interface BgConfig {
  overlay_bg_mode: string;       // "color" | "image"
  overlay_bg_image_path: string;
  overlay_bg_quality: string;    // "original" | "media" | "baja"
}

/**
 * Returns the variant file path for the chosen quality. The backend always writes
 * bg_media.png / bg_baja.png next to the original; "original" uses the stored path
 * verbatim. Replaces only the basename so the directory is preserved.
 */
function variantPath(originalPath: string, quality: string): string {
  if (!originalPath) return "";
  if (quality === "original") return originalPath;
  const sep = originalPath.includes("\\") ? "\\" : "/";
  const dir = originalPath.slice(0, originalPath.lastIndexOf(sep) + 1);
  const file = quality === "media" ? "bg_media.png" : "bg_baja.png";
  return dir + file;
}

export async function initOverlayBackground(transport: BackgroundTransport): Promise<void> {
  const bgEl = document.getElementById("overlay-bg");
  if (!bgEl) return;

  // Tracks the latest apply() call so a slow-loading image from an earlier call can't
  // overwrite the background after a newer call already painted.
  let applyToken = 0;

  const apply = (cfg: BgConfig): void => {
    const token = ++applyToken;
    const mode = cfg.overlay_bg_mode || "color";
    if (mode === "image" && cfg.overlay_bg_image_path) {
      const path = variantPath(cfg.overlay_bg_image_path, cfg.overlay_bg_quality || "original");
      // Cache-bust so re-uploads / quality switches force a reload of the same name.
      const src = `${transport.convertFileSrc(path)}?q=${cfg.overlay_bg_quality}&t=${Date.now()}`;
      // Preload the variant before swapping it in. Painting the new background only once
      // the bytes are decoded keeps the previous image on screen until then, avoiding the
      // chroma-color flash that appears while the browser fetches a fresh (cache-busted) URL.
      const img = new Image();
      img.onload = () => {
        if (token !== applyToken) return; // a newer apply() superseded this one
        bgEl.style.backgroundImage = `url("${src}")`;
      };
      img.src = src;
      return;
    }
    // Color mode → transparent layer (chroma color lives on the body / OBS handles it).
    bgEl.style.backgroundImage = "";
  };

  try {
    const cfg = await transport.invoke<BgConfig>("get_config_cmd");
    apply(cfg);
  } catch (_) {
    // Leave transparent on failure.
  }

  await transport.listen<BgConfig>("overlay-bg-changed", e => apply(e.payload));
}
