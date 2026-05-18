// =========================================================================================================
// ANIMATIONS VIEW
// =========================================================================================================
// Configuration panel for overlay animation settings: entry/exit animations,
// idle effects, glow, persona size, visibility duration, and audio threshold.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { invoke } from "@tauri-apps/api/core";
import { showToast } from "../state";
import { AnimationType } from "../overlay/animation-engine";
import { AnimationConfig, loadAnimationConfig } from "../overlay/animation-config";

// =========================================================================================================
// Constants
// =========================================================================================================

const ANIMATION_OPTIONS: { value: AnimationType; label: string; description: string }[] = [
  { value: "bounce",      label: "Bounce",      description: "Entra rebotando desde abajo" },
  { value: "slide-up",    label: "Slide Up",    description: "Sube suavemente con spring" },
  { value: "slide-left",  label: "Slide Left",  description: "Entra desde la derecha" },
  { value: "slide-right", label: "Slide Right", description: "Entra desde la izquierda" },
  { value: "pop",         label: "Pop",         description: "Escala desde cero con overshoot" },
  { value: "flip",        label: "Flip 3D",     description: "Volteo en eje Y" },
  { value: "shake",       label: "Shake",       description: "Vibración horizontal al entrar" },
  { value: "rubber",      label: "Rubber Band", description: "Deformación elástica exagerada" },
  { value: "glitch",      label: "Glitch",      description: "Desplazamientos estilo glitch" },
  { value: "float",       label: "Float",       description: "Fade + flotación continua suave" },
];

function buildAnimSelect(id: string, selectedValue: string): string {
  return `
    <select id="${id}">
      ${ANIMATION_OPTIONS.map(({ value, label, description }) => `
        <option value="${value}" ${value === selectedValue ? "selected" : ""}>${label} — ${description}</option>
      `).join("")}
    </select>
  `;
}

// =========================================================================================================
// Render Function
// =========================================================================================================

export async function renderAnimations(): Promise<void> {
  const cfg: AnimationConfig = await loadAnimationConfig();

  const container = document.getElementById("view-container")!;
  container.innerHTML = `
    <div class="view-header">
      <h1>✨ Animaciones del Overlay</h1>
      <p>Configurá las animaciones de entrada/salida y los efectos visuales de las personas.</p>
    </div>

    <!-- Entry / Exit -->
    <section class="section">
      <div class="section-title">Animaciones de Movimiento</div>
      <div class="card">
        <div class="config-grid">
          <div class="form-group">
            <label for="anim-in">Animación de entrada</label>
            ${buildAnimSelect("anim-in", cfg.animationIn)}
          </div>
          <div class="form-group">
            <label for="anim-out">Animación de salida</label>
            ${buildAnimSelect("anim-out", cfg.animationOut)}
          </div>
        </div>
        <div class="config-grid">
          <div class="form-group">
            <label for="anim-duration">
              Tiempo visible: <strong id="anim-duration-val">${cfg.visibleDurationSecs}s</strong>
            </label>
            <input type="range" id="anim-duration"
              min="3" max="30" step="0.5"
              value="${cfg.visibleDurationSecs}" />
          </div>
          <div class="form-group">
            <label for="anim-max-visible">
              Personas simultáneas: <strong id="anim-max-visible-val">${cfg.maxVisiblePersonas}</strong>
            </label>
            <input type="range" id="anim-max-visible"
              min="1" max="8" step="1"
              value="${cfg.maxVisiblePersonas}" />
          </div>
        </div>
      </div>
    </section>

    <!-- Persona Size -->
    <section class="section">
      <div class="section-title">Tamaño de Persona</div>
      <div class="card">
        <div class="form-group">
          <label for="anim-size">
            Tamaño: <strong id="anim-size-val">${cfg.personaSizePx}px</strong>
          </label>
          <input type="range" id="anim-size"
            min="64" max="512" step="8"
            value="${cfg.personaSizePx}" />
        </div>
      </div>
    </section>

    <!-- Idle Effects -->
    <section class="section">
      <div class="section-title">Efectos Idle</div>
      <div class="card">
        <div class="config-grid">
          <div class="form-group">
            <label>Wiggle (rotación suave)</label>
            <label class="switch" style="margin-top:8px;">
              <input type="checkbox" id="anim-idle-wiggle" ${cfg.idleWiggle ? "checked" : ""} />
              <span class="switch-track"></span>
            </label>
          </div>
          <div class="form-group">
            <label>Breathing (escala suave)</label>
            <label class="switch" style="margin-top:8px;">
              <input type="checkbox" id="anim-idle-breathe" ${cfg.idleBreathe ? "checked" : ""} />
              <span class="switch-track"></span>
            </label>
          </div>
        </div>
      </div>
    </section>

    <!-- Visual Effects -->
    <section class="section">
      <div class="section-title">Efectos Visuales</div>
      <div class="card">
        <div class="config-grid">
          <div class="form-group">
            <label>Outline (sombra de contorno)</label>
            <label class="switch" style="margin-top:8px;">
              <input type="checkbox" id="anim-outline" ${cfg.outlineEffect ? "checked" : ""} />
              <span class="switch-track"></span>
            </label>
          </div>
          <div class="form-group">
            <label>Glow (halo de color)</label>
            <label class="switch" style="margin-top:8px;">
              <input type="checkbox" id="anim-glow" ${cfg.glowEffect ? "checked" : ""} />
              <span class="switch-track"></span>
            </label>
          </div>
        </div>
        <div class="form-group" id="glow-color-group" style="${cfg.glowEffect ? "" : "opacity:0.4;pointer-events:none;"}">
          <label for="anim-glow-color">Color del Glow</label>
          <div style="display:flex;gap:12px;align-items:center;margin-top:6px;">
            <input type="color" id="anim-glow-color" value="${cfg.glowColor}"
              style="width:48px;height:36px;border:none;background:none;cursor:pointer;padding:0;" />
            <input type="text"  id="anim-glow-color-text" value="${cfg.glowColor}"
              style="width:100px;font-family:'IBM Plex Mono',monospace;font-size:13px;" />
            <div id="glow-preview" style="width:36px;height:36px;border-radius:50%;background:${cfg.glowColor};box-shadow:0 0 12px ${cfg.glowColor};"></div>
          </div>
        </div>
      </div>
    </section>

    <!-- Audio Threshold -->
    <section class="section">
      <div class="section-title">Detección de Audio (Lip-Sync)</div>
      <div class="card">
        <div class="form-group">
          <label for="anim-threshold">
            Umbral de voz: <strong id="anim-threshold-val">${cfg.audioThreshold}</strong>
            <span style="font-size:11px;color:#8b8fa8;margin-left:8px;">(0 = muy sensible, 255 = muy insensible)</span>
          </label>
          <input type="range" id="anim-threshold"
            min="0" max="100" step="1"
            value="${cfg.audioThreshold}" />
        </div>
        <p style="font-size:12px;color:#8b8fa8;margin-top:8px;">
          El TTS del sistema emite eventos de habla que sincronizan la boca de la persona automáticamente.
          Este umbral se usa si en el futuro se conecta detección de micrófono (VAD).
        </p>
      </div>
    </section>

    <!-- Save button -->
    <section class="section">
      <div class="card" style="display:flex;gap:12px;align-items:center;">
        <button id="btn-save-animations" class="btn btn-primary">💾 Guardar configuración</button>
        <span id="anim-save-status" style="font-size:13px;color:#8b8fa8;"></span>
      </div>
    </section>
  `;

  // =========================================================================================================
  // Component Mounts & Listeners
  // =========================================================================================================

  // Slider live labels
  const durationSlider   = container.querySelector<HTMLInputElement>("#anim-duration")!;
  const maxVisibleSlider = container.querySelector<HTMLInputElement>("#anim-max-visible")!;
  const sizeSlider       = container.querySelector<HTMLInputElement>("#anim-size")!;
  const thresholdSlider  = container.querySelector<HTMLInputElement>("#anim-threshold")!;

  durationSlider.addEventListener("input", () => {
    container.querySelector<HTMLElement>("#anim-duration-val")!.textContent = `${durationSlider.value}s`;
  });
  maxVisibleSlider.addEventListener("input", () => {
    container.querySelector<HTMLElement>("#anim-max-visible-val")!.textContent = maxVisibleSlider.value;
  });
  sizeSlider.addEventListener("input", () => {
    container.querySelector<HTMLElement>("#anim-size-val")!.textContent = `${sizeSlider.value}px`;
  });
  thresholdSlider.addEventListener("input", () => {
    container.querySelector<HTMLElement>("#anim-threshold-val")!.textContent = thresholdSlider.value;
  });

  // Glow toggle — enable/disable color picker
  const glowCheckbox    = container.querySelector<HTMLInputElement>("#anim-glow")!;
  const glowColorGroup  = container.querySelector<HTMLElement>("#glow-color-group")!;

  glowCheckbox.addEventListener("change", () => {
    glowColorGroup.style.opacity       = glowCheckbox.checked ? "1" : "0.4";
    glowColorGroup.style.pointerEvents = glowCheckbox.checked ? "" : "none";
  });

  // Glow color sync (native picker ↔ text input ↔ preview)
  const glowColorPicker = container.querySelector<HTMLInputElement>("#anim-glow-color")!;
  const glowColorText   = container.querySelector<HTMLInputElement>("#anim-glow-color-text")!;
  const glowPreview     = container.querySelector<HTMLElement>("#glow-preview")!;

  function syncGlowColor(color: string): void {
    glowColorPicker.value    = color;
    glowColorText.value      = color;
    glowPreview.style.background  = color;
    glowPreview.style.boxShadow   = `0 0 12px ${color}`;
  }

  glowColorPicker.addEventListener("input", () => syncGlowColor(glowColorPicker.value));
  glowColorText.addEventListener("input", () => {
    const val = glowColorText.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(val)) syncGlowColor(val);
  });

  // Save
  container.querySelector<HTMLButtonElement>("#btn-save-animations")!.addEventListener("click", async () => {
    const statusEl = container.querySelector<HTMLElement>("#anim-save-status")!;
    statusEl.textContent = "Guardando...";

    const payload = {
      animation_in:          (container.querySelector<HTMLSelectElement>("#anim-in")!).value,
      animation_out:         (container.querySelector<HTMLSelectElement>("#anim-out")!).value,
      visible_duration_secs: parseFloat(durationSlider.value),
      idle_wiggle:           (container.querySelector<HTMLInputElement>("#anim-idle-wiggle")!).checked,
      idle_breathe:          (container.querySelector<HTMLInputElement>("#anim-idle-breathe")!).checked,
      glow_effect:           glowCheckbox.checked,
      glow_color:            glowColorPicker.value,
      outline_effect:        (container.querySelector<HTMLInputElement>("#anim-outline")!).checked,
      persona_size_px:       parseInt(sizeSlider.value),
      audio_threshold:       parseInt(thresholdSlider.value),
      max_visible_personas:  parseInt(maxVisibleSlider.value),
    };

    try {
      await invoke("save_animation_config", { config: payload });
      showToast("Configuración de animaciones guardada", "success");
      statusEl.textContent = "";
    } catch (e) {
      showToast(String(e), "error");
      statusEl.textContent = "";
    }
  });
}
