# Addendum — Animaciones y Detección de Audio en Tiempo Real

> Complemento al plan principal `plan-proyecto-streamoverlay.md`. Cubre el sistema de detección de voz, el pipeline de lip-sync, y el motor de animaciones de entrada/salida con selección por el streamer.

---

## Índice

1. [Visión General del Sistema](#1-visión-general-del-sistema)
2. [Detección de Audio — Web Audio API + VAD](#2-detección-de-audio--web-audio-api--vad)
3. [Pipeline de Lip-Sync](#3-pipeline-de-lip-sync)
4. [Motor de Animaciones — Motion.js para Vanilla JS](#4-motor-de-animaciones--motionjs-para-vanilla-js)
5. [Tipos de Animación Disponibles](#5-tipos-de-animación-disponibles)
6. [Panel de Selección de Animación (Streamer)](#6-panel-de-selección-de-animación-streamer)
7. [Arquitectura del Módulo Frontend](#7-arquitectura-del-módulo-frontend)
8. [Integración con Tauri Events](#8-integración-con-tauri-events)
9. [Schema de DB — Campos nuevos](#9-schema-de-db--campos-nuevos)
10. [Dependencias Nuevas](#10-dependencias-nuevas)

---

## 1. Visión General del Sistema

Cuando un usuario habla en Twitch o TikTok, el overlay sigue este flujo completo:

```
[Mensaje detectado por Rust]
        │
        ▼
[Tauri Event → frontend overlay]
        │
        ▼
[Animación de ENTRADA] ← definida por el streamer
        │  (bounce, slide, pop, etc.)
        ▼
[Persona visible con boca CERRADA]
        │
        ▼ TTS comienza a hablar
[Web Audio API monitorea el output de audio del sistema]
        │
        ├── Volumen/habla detectado → imagen BOCA ABIERTA
        │
        └── Silencio → imagen BOCA CERRADA
        │
        ▼ (mensaje terminado / timeout)
[Animación de SALIDA]
        │
        ▼
[Persona desaparece]
```

---

## 2. Detección de Audio — Web Audio API + VAD

### Estrategia dual de detección

Se usa una **estrategia dual** porque el TTS reproduce audio desde el proceso Rust, y el WebView del overlay necesita "escuchar" cuándo hay voz activa para sincronizar la boca.

#### Opción A — Análisis de amplitud (Web Audio API nativo, simple)

Para sincronizar con el TTS del sistema, capturar el audio output:

```typescript
// audio-detector.ts

export class AudioLevelDetector {
  private context: AudioContext;
  private analyser: AnalyserNode;
  private dataArray: Uint8Array;
  private animFrameId: number | null = null;
  private onSpeaking: (isSpeaking: boolean) => void;

  // Threshold configurable desde el panel
  private threshold: number = 20; // 0-255

  constructor(onSpeaking: (isSpeaking: boolean) => void) {
    this.onSpeaking = onSpeaking;
    this.context = new AudioContext();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
  }

  // Captura el audio de salida del sistema (loopback)
  // En Tauri: usamos el microfono con getUserMedia apuntando al dispositivo
  // "loopback" o simplemente monitoreamos el nodo de audio del TTS
  async attachToTTSNode(ttsAudioSource: MediaStream): Promise<void> {
    const source = this.context.createMediaStreamSource(ttsAudioSource);
    source.connect(this.analyser);
    this.startAnalysis();
  }

  // Para cuando el TTS es nativo del OS y no tenemos stream directo:
  // Análisis de volumen vía evento Tauri emitido por Rust
  private startAnalysis(): void {
    const tick = () => {
      this.analyser.getByteFrequencyData(this.dataArray);
      const avg = this.dataArray.reduce((a, b) => a + b) / this.dataArray.length;
      this.onSpeaking(avg > this.threshold);
      this.animFrameId = requestAnimationFrame(tick);
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    this.context.close();
  }
}
```

#### Opción B — VAD con Silero (ML en browser, más preciso)

La librería `@ricky0123/vad-web` corre el modelo Silero VAD mediante ONNX Runtime Web directamente en el browser, con callbacks `onSpeechStart` y `onSpeechEnd`. Esto es más preciso para detectar habla real vs. ruido.

```typescript
// vad-detector.ts
import { MicVAD } from "@ricky0123/vad-web";

export class VADDetector {
  private vad: Awaited<ReturnType<typeof MicVAD.new>> | null = null;
  private onSpeaking: (speaking: boolean) => void;

  constructor(onSpeaking: (speaking: boolean) => void) {
    this.onSpeaking = onSpeaking;
  }

  async init(): Promise<void> {
    this.vad = await MicVAD.new({
      // Apunta al dispositivo de loopback o salida de audio del sistema
      onSpeechStart: () => this.onSpeaking(true),
      onSpeechEnd: () => this.onSpeaking(false),
      positiveSpeechThreshold: 0.6,
      negativeSpeechThreshold: 0.35,
      // Assets servidos desde el bundle local de Vite
      baseAssetPath: "/vad/",
      onnxWASMBasePath: "/vad/",
    });
  }

  start(): void { this.vad?.start(); }
  stop(): void { this.vad?.pause(); }
}
```

### Elección recomendada según escenario

| Escenario | Método recomendado |
|---|---|
| TTS nativo del OS (SAPI/espeak) sin stream | **Opción A** — Rust emite evento `tts-speaking` / `tts-silent` por Tauri |
| TTS reproducido como AudioNode en WebView | **Opción A** — Conectar AnalyserNode al nodo de audio |
| Microfono del streamer hablando | **Opción B** — VAD con Silero |
| Mayor precisión general | **Opción B** |

### Integración con Rust (TTS vía Tauri Events)

Cuando el TTS del OS habla, Rust emite el estado:

```rust
// tts/mod.rs
use tts::Tts;
use tauri::{AppHandle, Manager};

pub async fn speak_message(
    app: AppHandle,
    text: String,
    user_id: i64,
) -> anyhow::Result<()> {
    let mut tts = Tts::default()?;

    // Notifica al overlay que empieza el habla
    app.emit("tts-state", TtsStatePayload {
        user_id,
        speaking: true,
    })?;

    tts.speak(&text, false)?;

    // Polling hasta que termina (o usar callback si la plataforma lo soporta)
    while tts.is_speaking()? {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    // Notifica que terminó
    app.emit("tts-state", TtsStatePayload {
        user_id,
        speaking: false,
    })?;

    Ok(())
}
```

```typescript
// overlay.ts — escuchar el estado TTS
import { listen } from "@tauri-apps/api/event";

await listen<{ user_id: number; speaking: boolean }>("tts-state", (e) => {
  const persona = activePersonas.get(e.payload.user_id);
  if (persona) {
    persona.setMouth(e.payload.speaking ? "open" : "closed");
  }
});
```

---

## 3. Pipeline de Lip-Sync

### Clase `PersonaController`

```typescript
// persona-controller.ts
import { animate, spring } from "motion";

export type MouthState = "open" | "closed";

export interface PersonaConfig {
  userId: number;
  displayName: string;
  mouthOpenUrl: string;
  mouthClosedUrl: string;
  animationType: AnimationType;  // Configurado por el streamer
  position: { x: number; y: number };
}

export class PersonaController {
  private element: HTMLElement;
  private imgOpen: HTMLImageElement;
  private imgClosed: HTMLImageElement;
  private currentMouth: MouthState = "closed";
  private config: PersonaConfig;

  // Debounce para evitar parpadeo rápido
  private mouthDebounce: ReturnType<typeof setTimeout> | null = null;
  private readonly MOUTH_DEBOUNCE_MS = 80;

  constructor(container: HTMLElement, config: PersonaConfig) {
    this.config = config;
    this.element = this.buildDOM(container);
    this.imgOpen = this.element.querySelector(".mouth-open")!;
    this.imgClosed = this.element.querySelector(".mouth-closed")!;
  }

  private buildDOM(container: HTMLElement): HTMLElement {
    const el = document.createElement("div");
    el.className = "persona-wrapper";
    el.innerHTML = `
      <div class="persona-inner">
        <img class="mouth-open" src="${this.config.mouthOpenUrl}" />
        <img class="mouth-closed" src="${this.config.mouthClosedUrl}" style="opacity:1" />
        <div class="persona-name">${this.config.displayName}</div>
      </div>
    `;
    container.appendChild(el);
    return el;
  }

  setMouth(state: MouthState): void {
    if (this.mouthDebounce) clearTimeout(this.mouthDebounce);

    this.mouthDebounce = setTimeout(() => {
      if (state === this.currentMouth) return;
      this.currentMouth = state;

      const showOpen = state === "open";
      // Cross-fade suave entre imágenes
      animate(this.imgOpen, { opacity: showOpen ? 1 : 0 }, { duration: 0.05 });
      animate(this.imgClosed, { opacity: showOpen ? 0 : 1 }, { duration: 0.05 });
    }, this.MOUTH_DEBOUNCE_MS);
  }

  // Ejecutar animación de entrada según tipo configurado
  async animateIn(): Promise<void> {
    await AnimationEngine.playIn(this.element, this.config.animationType);
  }

  // Ejecutar animación de salida
  async animateOut(): Promise<void> {
    await AnimationEngine.playOut(this.element, this.config.animationType);
  }

  destroy(): void {
    this.element.remove();
  }
}
```

---

## 4. Motor de Animaciones — Motion.js para Vanilla JS

### Por qué Motion.js

Motion (anteriormente Framer Motion) es un motor híbrido que combina JavaScript con APIs nativas del browser para lograr animaciones a 120fps con aceleración GPU, disponible para React, JavaScript vanilla y Vue, con soporte para springs, gestos, timelines y layout transitions. Es la opción más madura para un overlay de stream que necesita animaciones fluidas y configurables.

```bash
npm install motion
```

```typescript
// En el overlay TypeScript
import { animate, spring, stagger } from "motion";
```

### `AnimationEngine` — clase central

```typescript
// animation-engine.ts
import { animate, spring } from "motion";

export type AnimationType =
  | "bounce"        // Entra rebotando desde abajo
  | "slide-up"      // Sube desde la parte inferior
  | "slide-left"    // Entra desde la derecha
  | "slide-right"   // Entra desde la izquierda
  | "pop"           // Escala desde 0 con spring
  | "flip"          // Volteo 3D en Y
  | "shake"         // Shake horizontal al entrar
  | "rubber"        // Rubber band: escala exagerada → normal
  | "glitch"        // Desplazamientos rápidos estilo glitch
  | "float";        // Fade + flotación suave desde abajo

export class AnimationEngine {
  static async playIn(
    el: HTMLElement,
    type: AnimationType
  ): Promise<void> {
    el.style.visibility = "visible";

    switch (type) {
      case "bounce":
        await animate(el,
          { y: [120, -20, 10, -5, 0], opacity: [0, 1, 1, 1, 1] },
          { duration: 0.6, easing: [0.215, 0.61, 0.355, 1] }
        ).finished;
        break;

      case "slide-up":
        await animate(el,
          { y: [100, 0], opacity: [0, 1] },
          { duration: 0.45, easing: spring({ stiffness: 280, damping: 22 }) }
        ).finished;
        break;

      case "slide-left":
        await animate(el,
          { x: [200, 0], opacity: [0, 1] },
          { duration: 0.4, easing: spring({ stiffness: 300, damping: 25 }) }
        ).finished;
        break;

      case "slide-right":
        await animate(el,
          { x: [-200, 0], opacity: [0, 1] },
          { duration: 0.4, easing: spring({ stiffness: 300, damping: 25 }) }
        ).finished;
        break;

      case "pop":
        await animate(el,
          { scale: [0, 1.15, 0.95, 1], opacity: [0, 1, 1, 1] },
          { duration: 0.5, easing: spring({ stiffness: 400, damping: 20 }) }
        ).finished;
        break;

      case "flip":
        el.style.perspective = "600px";
        await animate(el,
          { rotateY: [-90, 10, 0], opacity: [0, 1, 1] },
          { duration: 0.55, easing: spring({ stiffness: 250, damping: 18 }) }
        ).finished;
        break;

      case "shake":
        await animate(el,
          { x: [0, -15, 12, -8, 5, -3, 0], opacity: [0, 1, 1, 1, 1, 1, 1] },
          { duration: 0.5 }
        ).finished;
        break;

      case "rubber":
        await animate(el,
          {
            scaleX: [0.1, 1.25, 0.75, 1.15, 0.95, 1],
            scaleY: [0.1, 0.75, 1.25, 0.85, 1.05, 1],
            opacity: [0, 1, 1, 1, 1, 1]
          },
          { duration: 0.7 }
        ).finished;
        break;

      case "glitch":
        // Efecto glitch: desplazamientos rápidos + cambios de clip
        animate(el, { opacity: 1 }, { duration: 0.05 });
        for (let i = 0; i < 5; i++) {
          await animate(el,
            { x: [0, Math.random() * 16 - 8, 0] },
            { duration: 0.06 }
          ).finished;
        }
        await animate(el, { x: 0, skewX: [5, -3, 0] }, { duration: 0.2 }).finished;
        break;

      case "float":
        await animate(el,
          { y: [30, 0], opacity: [0, 1] },
          { duration: 0.8, easing: "ease-out" }
        ).finished;
        // Loop de flotación continua mientras está visible
        animate(el,
          { y: [0, -8, 0] },
          { duration: 3, repeat: Infinity, easing: "ease-in-out" }
        );
        break;
    }
  }

  static async playOut(
    el: HTMLElement,
    type: AnimationType
  ): Promise<void> {
    switch (type) {
      case "bounce":
      case "pop":
        await animate(el,
          { scale: [1, 1.1, 0], opacity: [1, 1, 0] },
          { duration: 0.35 }
        ).finished;
        break;

      case "slide-up":
        await animate(el,
          { y: [0, -80], opacity: [1, 0] },
          { duration: 0.35, easing: "ease-in" }
        ).finished;
        break;

      case "slide-left":
        await animate(el,
          { x: [0, 200], opacity: [1, 0] },
          { duration: 0.35, easing: "ease-in" }
        ).finished;
        break;

      case "slide-right":
        await animate(el,
          { x: [0, -200], opacity: [1, 0] },
          { duration: 0.35, easing: "ease-in" }
        ).finished;
        break;

      case "flip":
        await animate(el,
          { rotateY: [0, 90], opacity: [1, 0] },
          { duration: 0.35 }
        ).finished;
        break;

      case "float":
        // Cancelar el loop antes de salir
        el.getAnimations().forEach(a => a.cancel());
        await animate(el,
          { y: [0, 30], opacity: [1, 0] },
          { duration: 0.4, easing: "ease-in" }
        ).finished;
        break;

      case "glitch":
        for (let i = 0; i < 3; i++) {
          await animate(el,
            { x: [0, Math.random() * 12 - 6, 0] },
            { duration: 0.05 }
          ).finished;
        }
        await animate(el, { opacity: 0, scaleY: 0.1 }, { duration: 0.15 }).finished;
        break;

      default:
        await animate(el,
          { opacity: [1, 0] },
          { duration: 0.3 }
        ).finished;
    }

    el.style.visibility = "hidden";
  }
}
```

---

## 5. Tipos de Animación Disponibles

| ID | Nombre | Descripción | Estilo |
|---|---|---|---|
| `bounce` | **Bounce** | Entra rebotando desde abajo, múltiples saltos | Cartoon, energético |
| `slide-up` | **Slide Up** | Sube suavemente con spring physics | Limpio, profesional |
| `slide-left` | **Slide Left** | Entra desde la derecha con spring | Limpio, direccional |
| `slide-right` | **Slide Right** | Entra desde la izquierda con spring | Limpio, direccional |
| `pop` | **Pop** | Escala desde 0 con overshot pronunciado | Moderno, playful |
| `flip` | **Flip 3D** | Volteo en eje Y en perspectiva | Dramático, llamativo |
| `shake` | **Shake** | Vibración horizontal al entrar | Cómico, agresivo |
| `rubber` | **Rubber Band** | Deformación rubber band elástica | Cartoon, exagerado |
| `glitch` | **Glitch** | Desplazamientos estilo glitch digital | Cyberpunk, streamer gamer |
| `float` | **Float** | Fade + flotación continua suave | Tranquilo, mágico |

### Efectos adicionales aplicables en CSS (se combinan con cualquier animación)

Configurables por toggle en el panel del streamer:

```css
/* overlay.css */

/* Sombra de contorno — mejora legibilidad en cualquier fondo */
.persona-wrapper.outline-effect img {
  filter: drop-shadow(0 0 3px rgba(0,0,0,0.8));
}

/* Glow de color */
.persona-wrapper.glow-effect img {
  filter: drop-shadow(0 0 12px var(--accent-color));
}

/* Wiggle idle — movimiento sutil cuando no habla */
@keyframes idle-wiggle {
  0%, 100% { rotate: 0deg; }
  25%       { rotate: -1.5deg; }
  75%       { rotate: 1.5deg; }
}
.persona-wrapper.idle-wiggle .persona-inner {
  animation: idle-wiggle 2.5s ease-in-out infinite;
}

/* Breathing idle — sube y baja levemente */
@keyframes idle-breathe {
  0%, 100% { transform: scaleY(1); }
  50%       { transform: scaleY(1.015); }
}
.persona-wrapper.idle-breathe .persona-inner {
  animation: idle-breathe 3s ease-in-out infinite;
}
```

---

## 6. Panel de Selección de Animación (Streamer)

### Vista `/config/animations`

El streamer accede desde el panel principal a la configuración de animaciones:

```
┌─────────────────────────────────────────────────────────────┐
│  ANIMACIONES DEL OVERLAY                                    │
├────────────────────────────┬────────────────────────────────┤
│  Animación de entrada      │  [dropdown: Bounce ▼]          │
│  Animación de salida       │  [dropdown: Slide Up ▼]        │
│  Tiempo visible (seg)      │  [slider: ━━●━━━ 8s]           │
│                            │                                │
│  Efectos adicionales       │                                │
│  ☑ Wiggle idle             │                                │
│  ☐ Breathing idle          │                                │
│  ☐ Glow effect             │  Color: [#00c896 ████]         │
│  ☑ Outline (drop shadow)   │                                │
│                            │                                │
│  Tamaño de persona         │  [slider: ━━━●━ 256px]         │
│  Posición                  │  [drag en preview]             │
│                            │                                │
│  Umbral de detección audio │  [slider: ━●━━━ 20]            │
│                            │                                │
│       [▶ PREVIEW ANIMACIÓN]    [💾 GUARDAR]                 │
└────────────────────────────┴────────────────────────────────┘
```

### Tauri Command para guardar configuración de animación

```rust
#[derive(Deserialize)]
pub struct AnimationConfig {
    pub animation_in: String,
    pub animation_out: String,
    pub visible_duration_secs: f64,
    pub idle_wiggle: bool,
    pub idle_breathe: bool,
    pub glow_effect: bool,
    pub glow_color: String,
    pub outline_effect: bool,
    pub persona_size_px: u32,
    pub audio_threshold: u8,
}

#[tauri::command]
pub async fn save_animation_config(
    config: AnimationConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let db = state.db.lock().await;
    // Persiste cada campo en tabla config como key-value
    db.set_config("animation_in", &config.animation_in)?;
    db.set_config("animation_out", &config.animation_out)?;
    // ... resto de campos
    Ok(())
}
```

### TypeScript — cargar y aplicar configuración

```typescript
// animation-config.ts
import { invoke } from "@tauri-apps/api/core";

export interface AnimationConfig {
  animationIn: AnimationType;
  animationOut: AnimationType;
  visibleDurationSecs: number;
  idleWiggle: boolean;
  idleBreathe: boolean;
  glowEffect: boolean;
  glowColor: string;
  outlineEffect: boolean;
  personaSizePx: number;
  audioThreshold: number;
}

export async function loadAnimationConfig(): Promise<AnimationConfig> {
  return invoke<AnimationConfig>("get_animation_config");
}

export function applyPersonaEffects(
  el: HTMLElement,
  config: AnimationConfig
): void {
  el.classList.toggle("idle-wiggle", config.idleWiggle);
  el.classList.toggle("idle-breathe", config.idleBreathe);
  el.classList.toggle("glow-effect", config.glowEffect);
  el.classList.toggle("outline-effect", config.outlineEffect);
  el.style.setProperty("--accent-color", config.glowColor);
  el.style.width = `${config.personaSizePx}px`;
  el.style.height = `${config.personaSizePx}px`;
}
```

---

## 7. Arquitectura del Módulo Frontend

```
src/
├── overlay/
│   ├── overlay.ts              # Entry point del overlay, maneja la cola de personas
│   ├── persona-controller.ts   # Clase PersonaController (lip-sync + lifecycle)
│   ├── animation-engine.ts     # AnimationEngine con todos los tipos de animación
│   ├── audio-detector.ts       # Web Audio API — detección de amplitud del TTS
│   ├── vad-detector.ts         # VAD con @ricky0123/vad-web (opcional, para mic)
│   ├── animation-config.ts     # Carga/aplica config de animaciones desde DB
│   └── persona-queue.ts        # Cola de personas activas, evita solapamientos
│
├── panel/
│   └── views/
│       └── animations.ts       # Vista de configuración de animaciones
│
└── styles/
    ├── overlay.css             # Estilos overlay + efectos CSS
    └── persona.css             # Estilos específicos de persona (responsive)
```

### `PersonaQueue` — evitar chaos cuando hablan múltiples usuarios

```typescript
// persona-queue.ts
import { PersonaController } from "./persona-controller";

export class PersonaQueue {
  private active = new Map<number, PersonaController>();
  private readonly MAX_VISIBLE = 4; // Máximo simultáneo (configurable)

  add(userId: number, controller: PersonaController): void {
    if (this.active.size >= this.MAX_VISIBLE) {
      // Eliminar la más antigua
      const oldest = this.active.keys().next().value;
      this.remove(oldest!);
    }
    this.active.set(userId, controller);
    controller.animateIn();
  }

  async remove(userId: number): Promise<void> {
    const c = this.active.get(userId);
    if (!c) return;
    await c.animateOut();
    c.destroy();
    this.active.delete(userId);
  }

  get(userId: number): PersonaController | undefined {
    return this.active.get(userId);
  }
}
```

---

## 8. Integración con Tauri Events

### Flujo completo de eventos

```
[Rust detecta mensaje en Twitch/TikTok]
    │
    ├── emit("chat-message", { userId, platform, message, ... })
    │       │
    │       └── [overlay.ts] → PersonaQueue.add() → animateIn()
    │                        → PersonaController muestra boca cerrada
    │
    ├── [Rust lanza TTS async]
    │       │
    │       ├── emit("tts-state", { userId, speaking: true })
    │       │       └── [overlay.ts] → persona.setMouth("open")
    │       │
    │       └── emit("tts-state", { userId, speaking: false })
    │               └── [overlay.ts] → persona.setMouth("closed")
    │
    └── [Timeout configurable, ej. 8s]
            └── emit("persona-dismiss", { userId })
                    └── [overlay.ts] → PersonaQueue.remove() → animateOut()
```

### Registro de listeners en overlay.ts

```typescript
import { listen } from "@tauri-apps/api/event";
import { PersonaQueue } from "./persona-queue";
import { PersonaController } from "./persona-controller";
import { loadAnimationConfig } from "./animation-config";

const queue = new PersonaQueue();
const config = await loadAnimationConfig();
const container = document.getElementById("overlay-container")!;

// Mensaje nuevo del chat
await listen<ChatMessagePayload>("chat-message", async (e) => {
  const { userId, displayName, mouthOpenUrl, mouthClosedUrl } = e.payload;

  // Si ya está visible, solo resetear el timeout
  if (queue.get(userId)) {
    resetTimeout(userId, config.visibleDurationSecs);
    return;
  }

  const controller = new PersonaController(container, {
    userId,
    displayName,
    mouthOpenUrl,
    mouthClosedUrl,
    animationType: config.animationIn,
    position: getNextPosition(queue),
  });

  queue.add(userId, controller);
  scheduleRemoval(userId, config.visibleDurationSecs, config.animationOut, queue);
});

// Estado TTS (lip-sync)
await listen<TtsStatePayload>("tts-state", (e) => {
  const persona = queue.get(e.payload.userId);
  if (persona) {
    persona.setMouth(e.payload.speaking ? "open" : "closed");
  }
});
```

---

## 9. Schema de DB — Campos nuevos

```sql
-- Añadir a tabla config los nuevos keys de animación:
INSERT OR IGNORE INTO config (key, value) VALUES
  ('animation_in',          'bounce'),
  ('animation_out',         'slide-up'),
  ('visible_duration_secs', '8'),
  ('idle_wiggle',           'true'),
  ('idle_breathe',          'false'),
  ('glow_effect',           'false'),
  ('glow_color',            '#00c896'),
  ('outline_effect',        'true'),
  ('persona_size_px',       '256'),
  ('audio_threshold',       '20'),
  ('max_visible_personas',  '4');
```

---

## 10. Dependencias Nuevas

### Package.json (frontend)

```json
{
  "dependencies": {
    "motion": "^11.x",
    "@ricky0123/vad-web": "^0.0.29"
  },
  "devDependencies": {
    "onnxruntime-web": "^1.22.0"
  }
}
```

### Vite config — assets necesarios para VAD

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import { resolve } from "path";
import { copyFileSync } from "fs";

export default defineConfig({
  plugins: [
    {
      name: "copy-vad-assets",
      buildEnd() {
        // Copiar WASM y archivos ONNX al directorio público
        const assets = [
          "vad.worklet.bundle.min.js",
          "silero_vad_v5.onnx",
          "ort-wasm-simd.wasm",
        ];
        assets.forEach(file => {
          // Los archivos están en node_modules, copiar a public/vad/
          try {
            copyFileSync(
              resolve(`node_modules/@ricky0123/vad-web/dist/${file}`),
              resolve(`public/vad/${file}`)
            );
          } catch {}
        });
      }
    }
  ],
});
```

### Tauri `capabilities` — permisos de micrófono

```json
// src-tauri/capabilities/overlay.json
{
  "identifier": "overlay",
  "windows": ["overlay"],
  "permissions": [
    "core:default",
    "core:window:allow-set-focus"
  ]
}
```

Para el micrófono (VAD), el WebView de Tauri hereda los permisos del OS. En Windows requiere que el usuario acepte el prompt de permisos de micrófono la primera vez.

---

## Resumen de cambios al plan original

| Área | Cambio |
|---|---|
| **Frontend deps** | Añadir `motion` (animaciones) + `@ricky0123/vad-web` (VAD opcional) |
| **Overlay** | Nuevo sistema de `PersonaQueue` + `PersonaController` con lifecycle completo |
| **Audio** | Dual strategy: Web Audio API para amplitud TTS + VAD ML para mic |
| **Rust TTS** | Emitir eventos `tts-state` con `speaking: bool` durante el habla |
| **DB** | 11 nuevas claves en tabla `config` para configuración de animaciones |
| **Panel** | Nueva vista `/config/animations` con preview interactivo |
| **Tauri Commands** | `get_animation_config` + `save_animation_config` |

---

*Addendum generado el 2026-05-18 — Stream Persona Overlay — Animaciones v1.0*
