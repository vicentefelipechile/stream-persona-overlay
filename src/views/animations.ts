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
// Types
// =========================================================================================================

interface UserPreview {
  id: number;
  display_name: string;
  persona: {
    mouth_open_path: string;
    mouth_closed_path: string;
  } | null;
}

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
        <div style="margin-top:14px;padding:10px 12px;background:rgba(0,200,150,0.08);border-left:3px solid #00c896;border-radius:0 4px 4px 0;">
          <p style="font-size:12px;color:#adb1c5;line-height:1.6;margin:0;">
            <strong style="color:#00c896">Pipeline de lip-sync:</strong><br>
            <strong>1. Evento TTS (principal):</strong> Rust emite <code style="background:rgba(255,255,255,0.07);padding:1px 5px;border-radius:2px;">tts-state</code> cuando el TTS del OS
            empieza y termina. Esto sincroniza la boca aunque no haya Stereo Mix.<br><br>
            <strong>2. Web Audio API (granular):</strong> Si configuraste <strong>"Stereo Mix"</strong> o un cable virtual
            (VB-Cable) como dispositivo de grabación predeterminado en Windows, el overlay capta el audio del TTS
            en tiempo real y abre/cierra la boca sílaba por sílaba según el umbral de este slider.
            El estado del mic aparece en la esquina superior derecha del overlay al iniciarse.
          </p>
        </div>
      </div>
    </section>

    <!-- Preview -->
    <section class="section">
      <div class="section-title">▶ Preview de Animación</div>
      <div class="card">
        <p style="font-size:13px;color:#8b8fa8;margin-bottom:14px;">
          Envía un mensaje de prueba al overlay con la animación actual configurada.
          Si TTS está habilitado también se sintetizará la voz para verificar el lip-sync.
          Asegurate de tener el overlay visible antes de hacer click.
        </p>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <button id="btn-preview-anim" class="btn btn-primary">&#9654; Probar animación</button>
          <span id="preview-status" style="font-size:13px;color:#8b8fa8;"></span>
        </div>
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

  let glowDebounce: ReturnType<typeof setTimeout> | null = null;
  glowColorPicker.addEventListener("input", () => {
    syncGlowColor(glowColorPicker.value);
    if (glowDebounce) clearTimeout(glowDebounce);
    glowDebounce = setTimeout(() => saveAnimConfig(), 150);
  });
  glowColorText.addEventListener("input", () => {
    const val = glowColorText.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      syncGlowColor(val);
      if (glowDebounce) clearTimeout(glowDebounce);
      glowDebounce = setTimeout(() => saveAnimConfig(), 150);
    }
  });

  function saveAnimConfig(): void {
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
    invoke("save_animation_config", { config: payload }).catch(e => showToast(String(e), "error"));
  }

  // Auto-save on change (fires when user releases slider or toggles checkbox/select)
  [durationSlider, maxVisibleSlider, sizeSlider, thresholdSlider].forEach(el => {
    el.addEventListener("change", () => saveAnimConfig());
  });
  ["#anim-in", "#anim-out"].forEach(id => {
    container.querySelector(id)!.addEventListener("change", () => saveAnimConfig());
  });
  ["#anim-idle-wiggle", "#anim-idle-breathe", "#anim-outline"].forEach(id => {
    container.querySelector(id)!.addEventListener("change", () => saveAnimConfig());
  });
  glowCheckbox.addEventListener("change", () => saveAnimConfig());

  // =========================================================================================================
  // Preview Button
  // =========================================================================================================

  const previewBtn    = container.querySelector<HTMLButtonElement>("#btn-preview-anim")!;
  const previewStatus = container.querySelector<HTMLElement>("#preview-status")!;

  previewBtn.addEventListener("click", async () => {
    previewBtn.disabled  = true;
    previewStatus.textContent = "Buscando usuario con persona...";

    try {
      const users = await invoke<UserPreview[]>("get_users");
      const withPersona = users.find((u) => u.persona !== null);

      if (!withPersona || !withPersona.persona) {
        previewStatus.textContent = "No hay usuarios con persona registrada.";
        showToast("Registrá al menos un usuario con imágenes para hacer preview.", "info");
        previewBtn.disabled = false;
        return;
      }

      previewStatus.textContent = `Enviando preview de \"${withPersona.display_name}\"...`;

      await invoke("send_test_message", {
        displayName:     withPersona.display_name,
        mouthOpenPath:   withPersona.persona.mouth_open_path,
        mouthClosedPath: withPersona.persona.mouth_closed_path,
      });

      previewStatus.textContent = "Preview enviado. Asegurate de tener el overlay visible.";
      showToast(`Preview enviado para ${withPersona.display_name}`, "success");
    } catch (e) {
      showToast(String(e), "error");
      previewStatus.textContent = "Error al enviar preview.";
    } finally {
      setTimeout(() => {
        previewBtn.disabled       = false;
        previewStatus.textContent = "";
      }, 5000);
    }
  });
}
