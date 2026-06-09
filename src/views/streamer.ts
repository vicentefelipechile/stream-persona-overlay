// =========================================================================================================
// STREAMER PERSONA VIEW
// =========================================================================================================
// Admin panel view at #/streamer.
// Configures the streamer persona overlay (overlay-streamer.html): the four
// sprites (mouth × eyes), blink timing, talk animation, size/anchor, mic device
// and threshold. Includes a live preview that reuses the real BlinkScheduler so
// timing/animation can be checked without opening OBS.
// =========================================================================================================

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { showToast } from "../state";
import { Icons } from "../icons";
import { BlinkScheduler } from "../overlay/streamer/BlinkScheduler";

type Slot = "mo_eo" | "mc_eo" | "mo_ec" | "mc_ec";

/** An audio input device reported by the native backend (`streamer_list_mics`). */
interface MicDevice {
  id: string;
  name: string;
}

// Cache-buster: the sprite file is overwritten in place, so its URL is identical
// across re-uploads and the webview would show the stale cached image. Appending
// a per-render token forces a fresh load.
function bust(path: string): string {
  const url = convertFileSrc(path);
  return `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`;
}

const SLOTS: { slot: Slot; key: string; label: string }[] = [
  { slot: "mo_eo", key: "streamer_sprite_mo_eo", label: "Boca abierta · Ojos abiertos" },
  { slot: "mc_eo", key: "streamer_sprite_mc_eo", label: "Boca cerrada · Ojos abiertos" },
  { slot: "mo_ec", key: "streamer_sprite_mo_ec", label: "Boca abierta · Ojos cerrados" },
  { slot: "mc_ec", key: "streamer_sprite_mc_ec", label: "Boca cerrada · Ojos cerrados" },
];

const TALK_ANIMATIONS: { value: string; label: string }[] = [
  { value: "none", label: "Ninguna" },
  { value: "bounce", label: "Salto" },
  { value: "abs-bounce", label: "Salto (Seco)" },
  { value: "tremor", label: "Temblor" },
  { value: "sway", label: "Balanceo" },
  { value: "pulse", label: "Pulso" },
  { value: "squash", label: "Squash & Stretch" },
  { value: "jelly", label: "Gelatina" },
];

const ANCHORS: { value: string; label: string }[] = [
  { value: "left", label: "Izquierda" },
  { value: "center", label: "Centro" },
  { value: "right", label: "Derecha" },
];

// =========================================================================================================
// renderStreamer
// =========================================================================================================

export async function renderStreamer(): Promise<void> {
  const container = document.getElementById("view-container")!;

  let cfg: Record<string, unknown> = {};
  try {
    cfg = await invoke<Record<string, unknown>>("get_config_cmd");
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><span class="empty-state-icon">${Icons.warning(48)}</span><p>${String(e)}</p></div>`;
    return;
  }

  const enabled       = String(cfg["streamer_persona_enabled"]) === "true";
  const blinkInterval = Number(cfg["streamer_blink_interval_ms"]) || 4000;
  const blinkDuration = Number(cfg["streamer_blink_duration_ms"]) || 150;
  const sizePx        = Number(cfg["streamer_size_px"]) || 512;
  const threshold     = Number(cfg["streamer_mic_threshold"]) || 20;
  const talkAnim      = String(cfg["streamer_talk_animation"] ?? "bounce");
  const anchor        = String(cfg["streamer_anchor"] ?? "center");
  const micDeviceId   = String(cfg["streamer_mic_device_id"] ?? "");

  const spritePaths: Record<Slot, string> = {
    mo_eo: String(cfg["streamer_sprite_mo_eo"] ?? ""),
    mc_eo: String(cfg["streamer_sprite_mc_eo"] ?? ""),
    mo_ec: String(cfg["streamer_sprite_mo_ec"] ?? ""),
    mc_ec: String(cfg["streamer_sprite_mc_ec"] ?? ""),
  };

  // =========================================================================================================
  // HTML
  // =========================================================================================================

  container.innerHTML = `
    <div class="view-header">
      <div class="tama-view-header-row">
        <div>
          <h1 class="view-title">${Icons.webcam(20)} Streamer Persona</h1>
          <p class="view-subtitle">Tu personaje animado (estilo PNGTuber) para OBS</p>
        </div>
        <div class="tama-system-toggle">
          <span id="str-status-text" class="tama-system-status${enabled ? " tama-system-status--on" : ""}">${enabled ? "Activo" : "Inactivo"}</span>
          <label class="switch">
            <input type="checkbox" id="str-enabled" ${enabled ? "checked" : ""}/>
            <span class="switch-track"></span>
          </label>
        </div>
      </div>
    </div>

    <div class="card str-card">
      <div class="card-header"><h2 class="section-title">Micrófono</h2></div>
      <p class="view-subtitle" style="margin-bottom:12px;">El overlay abre la boca cuando tu voz supera el umbral. En OBS, permití el acceso al micrófono en la fuente del navegador.</p>
      <div class="config-grid">
        <div class="form-group">
          <label for="str-mic">Dispositivo de entrada</label>
          <select id="str-mic"><option value="">Micrófono por defecto</option></select>
        </div>
        <div class="form-group">
          ${_slider("str-threshold", "str-threshold-val", "Umbral de voz", threshold, "", 0, 80, 1)}
        </div>
      </div>
    </div>

    <div class="card str-card">
      <div class="card-header"><h2 class="section-title">Sprites del personaje</h2></div>
      <p class="view-subtitle" style="margin-bottom:12px;">Subí las 4 combinaciones de boca y ojos (PNG con transparencia, máx. 2&nbsp;MB). Se redimensionan a 512×512.</p>
      <div class="str-sprite-grid">
        ${SLOTS.map(s => _spriteBox(s.slot, s.label, spritePaths[s.slot])).join("")}
      </div>
    </div>

    <div class="str-two-col">
    <div class="card str-card">
      <div class="card-header"><h2 class="section-title">Parpadeo y animación</h2></div>
      <div class="tama-sliders-grid">
        ${_slider("str-interval", "str-interval-val", "Tiempo entre parpadeos", blinkInterval, " ms", 500, 10000, 100)}
        ${_slider("str-duration", "str-duration-val", "Duración del parpadeo",   blinkDuration, " ms", 50,   600,  10)}
        ${_slider("str-size",     "str-size-val",     "Tamaño",                   sizePx,        " px", 128,  1024, 16)}
      </div>
      <div class="config-grid" style="margin-top:12px;">
        <div class="form-group">
          <label for="str-talk">Animación al hablar</label>
          <select id="str-talk">
            ${TALK_ANIMATIONS.map(a => `<option value="${a.value}"${a.value === talkAnim ? " selected" : ""}>${a.label}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label for="str-anchor">Posición horizontal</label>
          <select id="str-anchor">
            ${ANCHORS.map(a => `<option value="${a.value}"${a.value === anchor ? " selected" : ""}>${a.label}</option>`).join("")}
          </select>
        </div>
      </div>
    </div>

    <div class="card str-card">
      <div class="card-header"><h2 class="section-title">Vista previa</h2></div>
      <div class="str-preview-wrap">
        <div class="str-preview-stage">
          <div id="str-preview" class="streamer-persona-preview" data-talk="none">
            ${SLOTS.map(s => `<img class="streamer-sprite-preview" data-slot="${s.slot}" alt=""/>`).join("")}
          </div>
          <div id="str-preview-empty" class="str-preview-empty">${Icons.webcam(40)}<span>Subí los sprites para ver la vista previa</span></div>
        </div>
        <button id="str-preview-talk" class="btn btn-secondary btn-sm">Simular hablar</button>
      </div>
    </div>
    </div>

    <div class="card str-card">
      <div class="section-title" style="display:flex;align-items:center;gap:6px;">${Icons.externalLink(16)} OBS Browser Source</div>
      <p class="view-subtitle" style="margin:8px 0;">Agregá esta URL como <strong>Browser Source</strong> en OBS:</p>
      <div style="display:flex;gap:8px;">
        <input id="str-obs-url" type="text" readonly value="http://localhost:6767/overlay-streamer" style="flex:1;"/>
        <button id="str-copy-url" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;">${Icons.copy(14)} Copiar</button>
      </div>
    </div>
  `;

  // =========================================================================================================
  // Listeners
  // =========================================================================================================

  const save = (key: string, value: string) =>
    invoke("set_config_cmd", { key, value }).catch(err => showToast(String(err), "error"));

  // Reconfigure native mic capture after a streamer setting changes (enable,
  // device, threshold). Capture runs in the backend, so the overlay never asks
  // for mic permissions — it just receives the resulting speaking state over WS.
  const applyMic = () =>
    invoke("streamer_mic_apply").catch(err => console.warn("[streamer] mic apply:", err));

  // Enable toggle
  const enabledEl = container.querySelector<HTMLInputElement>("#str-enabled")!;
  enabledEl.addEventListener("change", async () => {
    const on = enabledEl.checked;
    const txt = container.querySelector("#str-status-text")!;
    txt.textContent = on ? "Activo" : "Inactivo";
    txt.classList.toggle("tama-system-status--on", on);
    await save("streamer_persona_enabled", on ? "true" : "false");
    applyMic();
  });

  // Sliders → live label + save on release
  _bindRange("str-interval",  "str-interval-val",  " ms");
  _bindRange("str-duration",  "str-duration-val",  " ms");
  _bindRange("str-size",      "str-size-val",      " px");
  _bindRange("str-threshold", "str-threshold-val", "");

  _bindSave("str-interval",  "streamer_blink_interval_ms");
  _bindSave("str-duration",  "streamer_blink_duration_ms");
  _bindSave("str-size",      "streamer_size_px");

  // Threshold saves like the others, but also re-applies it to the live capture.
  const thresholdEl = container.querySelector<HTMLInputElement>("#str-threshold")!;
  thresholdEl.addEventListener("change", async () => {
    await save("streamer_mic_threshold", thresholdEl.value);
    applyMic();
  });

  // Selects
  const talkEl = container.querySelector<HTMLSelectElement>("#str-talk")!;
  talkEl.addEventListener("change", () => save("streamer_talk_animation", talkEl.value));
  const anchorEl = container.querySelector<HTMLSelectElement>("#str-anchor")!;
  anchorEl.addEventListener("change", () => {
    save("streamer_anchor", anchorEl.value);
    preview.setAnchor(anchorEl.value);
  });

  // Sprite upload / reset
  for (const { slot } of SLOTS) {
    container.querySelector(`#str-up-${slot}`)?.addEventListener("click", () => _pickSprite(slot));
    container.querySelector(`#str-reset-${slot}`)?.addEventListener("click", () => _resetSprite(slot));
  }

  // Microphone device list (enumerated natively — no browser permission prompt)
  void _populateMics(
    container.querySelector<HTMLSelectElement>("#str-mic")!,
    micDeviceId,
    async (deviceId) => {
      await save("streamer_mic_device_id", deviceId);
      applyMic();
    },
  );

  // OBS URL copy
  container.querySelector("#str-copy-url")!.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText("http://localhost:6767/overlay-streamer");
      showToast("URL copiada al portapapeles", "success");
    } catch {
      showToast("No se pudo copiar al portapapeles", "error");
    }
  });

  // =========================================================================================================
  // Live preview (reuses the real BlinkScheduler)
  // =========================================================================================================

  const preview = _startPreview(container, spritePaths, {
    intervalMs: blinkInterval,
    durationMs: blinkDuration,
    talk: talkAnim,
    anchor,
  });

  // Keep the preview in sync with the timing/animation sliders without saving spam.
  const syncPreviewTiming = () =>
    preview.setTiming(
      Number((container.querySelector("#str-interval") as HTMLInputElement).value),
      Number((container.querySelector("#str-duration") as HTMLInputElement).value),
    );
  container.querySelector("#str-interval")!.addEventListener("input", syncPreviewTiming);
  container.querySelector("#str-duration")!.addEventListener("input", syncPreviewTiming);
  talkEl.addEventListener("change", () => preview.setTalk(talkEl.value));

  const talkBtn = container.querySelector<HTMLButtonElement>("#str-preview-talk")!;
  talkBtn.addEventListener("pointerdown", () => preview.setTalking(true));
  talkBtn.addEventListener("pointerup", () => preview.setTalking(false));
  talkBtn.addEventListener("pointerleave", () => preview.setTalking(false));
}

// =========================================================================================================
// Sprite helpers
// =========================================================================================================

function _spriteBox(slot: Slot, label: string, path: string): string {
  const preview = path
    ? `<img src="${bust(path)}" alt=""/>`
    : `<div class="str-sprite-placeholder">${Icons.webcam(28)}</div>`;
  return `
    <div class="str-sprite-box">
      <div class="str-sprite-thumb" id="str-thumb-${slot}">${preview}</div>
      <span class="str-sprite-label">${label}</span>
      <div class="str-sprite-actions">
        <button class="btn btn-secondary btn-sm" id="str-up-${slot}">${Icons.save(14)} Subir</button>
        <button class="btn btn-outline btn-sm" id="str-reset-${slot}" title="Restablecer">${Icons.reset(14)}</button>
      </div>
    </div>`;
}

async function _pickSprite(slot: Slot): Promise<void> {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp,image/gif";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    // Pass the Uint8Array directly — Tauri v2 sends typed arrays as raw IPC
    // bytes. Array.from(...) would JSON-encode it as a huge number[] (very slow
    // for full-res sprites).
    const imageData = new Uint8Array(await file.arrayBuffer());
    try {
      await invoke("set_streamer_sprite", { slot, imageData });
      showToast("Sprite actualizado", "success");
      await renderStreamer();
    } catch (e) {
      showToast(String(e), "error");
    }
  };
  input.click();
}

async function _resetSprite(slot: Slot): Promise<void> {
  try {
    await invoke("reset_streamer_sprite", { slot });
    showToast("Sprite restablecido", "success");
    await renderStreamer();
  } catch (e) {
    showToast(String(e), "error");
  }
}

// =========================================================================================================
// Microphone enumeration
// =========================================================================================================

async function _populateMics(
  select: HTMLSelectElement,
  current: string,
  onChange: (deviceId: string) => void,
): Promise<void> {
  // Devices are enumerated by the native backend (cpal), so listing them needs no
  // getUserMedia call and triggers no browser mic permission prompt.
  try {
    const mics = await invoke<MicDevice[]>("streamer_list_mics");
    for (const mic of mics) {
      const opt = document.createElement("option");
      opt.value = mic.id;
      opt.textContent = mic.name;
      if (mic.id === current) opt.selected = true;
      select.appendChild(opt);
    }
  } catch (e) {
    console.warn("[streamer] No se pudieron listar micrófonos:", e);
  }

  select.addEventListener("change", () => onChange(select.value));
}

// =========================================================================================================
// Live preview
// =========================================================================================================

interface PreviewHandle {
  setTiming(intervalMs: number, durationMs: number): void;
  setTalk(anim: string): void;
  setTalking(on: boolean): void;
  setAnchor(anchor: string): void;
}

function _startPreview(
  container: HTMLElement,
  paths: Record<Slot, string>,
  init: { intervalMs: number; durationMs: number; talk: string; anchor: string },
): PreviewHandle {
  const root = container.querySelector<HTMLElement>("#str-preview")!;
  const emptyEl = container.querySelector<HTMLElement>("#str-preview-empty")!;
  const imgs = {} as Record<Slot, HTMLImageElement>;
  let haveAny = false;
  for (const { slot } of SLOTS) {
    const img = root.querySelector<HTMLImageElement>(`img[data-slot="${slot}"]`)!;
    if (paths[slot]) {
      img.src = bust(paths[slot]);
      haveAny = true;
    }
    imgs[slot] = img;
  }
  emptyEl.style.display = haveAny ? "none" : "";

  const blink = new BlinkScheduler(init.intervalMs, init.durationMs);
  blink.start(performance.now());
  root.dataset.talk = "none";
  root.dataset.anchor = init.anchor;
  let talkAnim = init.talk;
  let talking = false;

  const loop = () => {
    if (!document.body.contains(root)) return; // self-cancel on navigation
    const eyes = blink.tick(performance.now());
    const slot = `${talking ? "mo" : "mc"}_${eyes === "open" ? "eo" : "ec"}` as Slot;
    for (const s of SLOTS) imgs[s.slot].style.opacity = s.slot === slot ? "1" : "0";
    const wantTalk = talking ? talkAnim : "none";
    if (root.dataset.talk !== wantTalk) root.dataset.talk = wantTalk;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return {
    setTiming: (i, d) => blink.setTiming(i, d, performance.now()),
    setTalk: (a) => { talkAnim = a; },
    setTalking: (on) => { talking = on; },
    setAnchor: (a) => { root.dataset.anchor = a; },
  };
}

// =========================================================================================================
// Slider helpers (mirror tamagotchi.ts)
// =========================================================================================================

function _slider(
  inputId: string,
  labelId: string,
  label: string,
  value: number,
  suffix: string,
  min: number,
  max: number,
  step: number,
): string {
  return `
    <div class="tama-slider-item">
      <div class="tama-slider-header">
        <span class="tama-slider-label">${label}</span>
        <span class="tama-slider-value" id="${labelId}">${value}${suffix}</span>
      </div>
      <input type="range" id="${inputId}" class="tama-range"
             min="${min}" max="${max}" step="${step}" value="${value}"/>
    </div>
  `;
}

function _bindRange(inputId: string, labelId: string, suffix: string): void {
  const input = document.getElementById(inputId) as HTMLInputElement | null;
  const label = document.getElementById(labelId);
  if (!input || !label) return;
  input.addEventListener("input", () => { label.textContent = input.value + suffix; });
}

function _bindSave(inputId: string, key: string): void {
  const input = document.getElementById(inputId) as HTMLInputElement | null;
  if (!input) return;
  // Save on release (change), not on every input tick, to avoid DB write spam.
  input.addEventListener("change", () => {
    invoke("set_config_cmd", { key, value: input.value }).catch(err => showToast(String(err), "error"));
  });
}
