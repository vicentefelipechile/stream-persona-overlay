# Plan de trabajo — Streamer Persona

> Nueva característica: un overlay `overlay-streamer.html` que muestra el personaje
> del streamer (estilo PNGTuber) con 4 sprites, parpadeo programado y animación al
> hablar. Configurable desde el menú principal. OBS Browser Source en el puerto 6767,
> consistente con `overlay-browser.html` y `overlay-tiktok.html`.

---

## 0. Decisiones de diseño (confirmadas)

- **Detección de voz:** micrófono en el overlay vía Web Audio (`getUserMedia` +
  `AnalyserNode`). Sin dependencias nuevas en Rust. Selector de micrófono y umbral
  configurables en el menú.
- **Sprites:** el streamer sube 4 PNG desde el menú (nuevo comando estilo
  `set_guest_image`). Se guardan en `app_data_dir` y se sirven por `/persona`.
- **Tipo de overlay:** OBS Browser Source nuevo (`/overlay-streamer`), no la ventana
  chroma. Transporte WS (`ws-transport.ts`), igual que los overlays modernos.

### Los 4 sprites (matriz boca × ojos)

| Slot | Boca | Ojos | Config key (path) |
|---|---|---|---|
| 1 | abierta | abiertos | `streamer_sprite_mo_eo` |
| 2 | cerrada | abiertos | `streamer_sprite_mc_eo` |
| 3 | abierta | cerrados | `streamer_sprite_mo_ec` |
| 4 | cerrada | cerrados | `streamer_sprite_mc_ec` |

El sprite mostrado en cada frame se elige por `(boca, ojos)`:
- **boca** = abierta si el nivel del micrófono supera el umbral, si no cerrada.
- **ojos** = lo decide el *cronómetro de parpadeo* (independiente de si habla o no).

---

## 1. El cronómetro de parpadeo (núcleo de la feature)

Tal como pediste: **no se recalcula nada por frame ni se generan números aleatorios
constantemente**. Es una máquina de estados basada en *timestamps absolutos* que solo
guarda **el siguiente instante a alcanzar**. Cada frame únicamente compara `now` contra
ese instante guardado; cuando lo cruza, voltea el estado y calcula **un solo**
siguiente instante, partiendo desde donde terminó la transición anterior.

```
v = inicio (t0)
OOOOOO XX OOOOOO XX OOOOOO ...
       ^        ^
       └ parpadeo (ojos cerrados, dura blink_duration_ms)
O = ojos abiertos durante blink_interval_ms
```

### `src/overlay/streamer/BlinkScheduler.ts`

```ts
export type EyeState = "open" | "closed";

export class BlinkScheduler {
  private eyeState: EyeState = "open";
  private nextAt = 0;                 // performance.now() del próximo cambio (lo único que se "consulta")
  constructor(private intervalMs: number, private durationMs: number) {}

  /** Marca el 0 y calcula UNA vez el primer parpadeo. */
  start(now: number): void {
    this.eyeState = "open";
    this.nextAt = now + this.intervalMs;
  }

  /** Se llama cada frame. Solo compara now contra el instante guardado. */
  tick(now: number): EyeState {
    if (now >= this.nextAt) {
      if (this.eyeState === "open") {
        this.eyeState = "closed";
        this.nextAt = now + this.durationMs;   // dura el parpadeo
      } else {
        this.eyeState = "open";
        this.nextAt = now + this.intervalMs;   // reanuda DESDE donde terminó el parpadeo
      }
    }
    return this.eyeState;
  }

  /** Aplicar cambios de config en caliente sin reiniciar el reloj. */
  setTiming(intervalMs: number, durationMs: number): void {
    this.intervalMs = intervalMs;
    this.durationMs = durationMs;
  }
}
```

Notas de robustez (mencionadas, no sobre-ingeniería):
- Usa `performance.now()` (monotónico). Si el frame se atrasa mucho, voltea una vez y
  sigue — **no intenta "recuperar" parpadeos perdidos**, exactamente como describiste
  ("siempre consulta el siguiente").
- `setTiming()` permite que el menú cambie intervalo/duración en vivo (evento
  `streamer-config-changed`) sin reconstruir el scheduler.
- (Opcional, futuro) `streamer_blink_jitter_ms`: si se quiere variación, se suma un
  jitter aleatorio **solo en el momento de calcular el siguiente `nextAt`** — sigue
  siendo "un cálculo por transición", no por frame. Lo dejo fuera del MVP porque tu
  diagrama muestra espaciado fijo.

---

## 2. Detección de micrófono (boca)

### `src/overlay/streamer/MicLevel.ts`

- `navigator.mediaDevices.getUserMedia({ audio: { deviceId } })`.
- `AudioContext` → `AnalyserNode` (`fftSize` pequeño, p.ej. 512).
- Por frame: `getByteTimeDomainData` → RMS normalizado 0–100.
- Expone `level(): number`. El render compara `level() > streamer_mic_threshold`.
- Suavizado simple (media móvil corta) para evitar parpadeo de boca; opcional un
  pequeño "hang time" (~80 ms) para que la boca no titile entre sílabas.
- Manejo de permisos: si `getUserMedia` falla (sin permiso en OBS), mostrar un aviso
  discreto y caer a "boca siempre cerrada" en lugar de romper el overlay.
- Selección de dispositivo: `enumerateDevices()`; el `deviceId` elegido se persiste en
  `streamer_mic_device_id`. Si está vacío → micrófono por defecto.

> OBS Browser Source: el usuario debe permitir el micrófono. Se documentará en el menú
> con una nota ("Si no ves movimiento de boca, permite el micrófono en la fuente").

---

## 3. Render loop y selección de sprite

### `src/overlay/streamer/StreamerPersona.ts`

- Monta 4 `<img>` apiladas (una por slot) y alterna `visibility`/`opacity` en vez de
  cambiar `src` (evita recargas/flicker). Tamaño desde `streamer_size_px`.
- Un único `requestAnimationFrame`:
  1. `mouthOpen = mic.level() > threshold`
  2. `eyes = blink.tick(now)`
  3. elige slot `(mouthOpen, eyes)` y muestra ese `<img>`.
  4. animación al hablar: si `mouthOpen` (o `speaking` con hang time) añade la clase
     CSS de `streamer_talk_animation`; si no, la quita.
- Anclaje/posición vía CSS (default abajo-centro). Config: `streamer_size_px` +
  `streamer_anchor` (`left`/`center`/`right`).

### Animaciones al hablar (CSS keyframes, sin librerías)

`src/styles/streamer-overlay.css` — clases aplicadas al contenedor:
- `talk-none` (sin animación)
- `talk-bounce` (saltito vertical — "jumping")
- `talk-tremor` (vibración/shake X-Y)
- `talk-sway` (balanceo/rotación leve)
- `talk-pulse` (escala suave)

Valor en `streamer_talk_animation`. (Se usa CSS y no `motion` para mantener el overlay
ligero, igual que los overlays de alertas.)

---

## 4. Backend (Rust)

### 4.1 Config nuevas (`db/migrations.rs` — añadir a `defaults[]`)

| Key | Default | Descripción |
|---|---|---|
| `streamer_persona_enabled` | `"true"` | Activa/desactiva el overlay del streamer |
| `streamer_sprite_mo_eo` | `""` | Path PNG boca abierta / ojos abiertos |
| `streamer_sprite_mc_eo` | `""` | Path PNG boca cerrada / ojos abiertos |
| `streamer_sprite_mo_ec` | `""` | Path PNG boca abierta / ojos cerrados |
| `streamer_sprite_mc_ec` | `""` | Path PNG boca cerrada / ojos cerrados |
| `streamer_blink_interval_ms` | `"4000"` | Tiempo entre cada parpadeo (ojos abiertos) |
| `streamer_blink_duration_ms` | `"150"` | Tiempo que dura cada parpadeo (ojos cerrados) |
| `streamer_talk_animation` | `"bounce"` | `none`/`bounce`/`tremor`/`sway`/`pulse` |
| `streamer_size_px` | `"512"` | Tamaño del sprite en px |
| `streamer_anchor` | `"center"` | `left`/`center`/`right` |
| `streamer_mic_threshold` | `"20"` | Umbral de nivel de mic para abrir boca |
| `streamer_mic_device_id` | `""` | deviceId del micrófono elegido (vacío = default) |

### 4.2 `state.rs` — añadir campos a `AppConfig`

Mismos nombres/tipos (`String`/`u32`/`bool`). `get_config()` en `db/config.rs` ya hace
el mapeo genérico key→campo, así que solo hay que añadir los campos al struct y a la
lectura (revisar `db/config.rs` para replicar el patrón existente).

### 4.3 `commands/config.rs` — `set_config_cmd`

- Añadir los `match key` para sincronizar la `config_cache` de las nuevas keys.
- Replicar el patrón `tama_`: cuando `key.starts_with("streamer_")`, emitir
  `streamer-config-changed` con el `AppConfig` completo **y** `broadcast_ws(...)` para
  que el overlay (OBS) reciba el cambio en vivo.

### 4.4 Nuevo `commands/streamer.rs`

Espejo de `set_guest_image` / `reset_guest_image`, pero con 4 slots:

```rust
// set_streamer_sprite { slot: "mo_eo"|"mc_eo"|"mo_ec"|"mc_ec", image_data: Vec<u8> }
// reset_streamer_sprite { slot }
```

- Valida ≤ 2 MB, `image::load_from_memory`, `resize_exact(512,512, Lanczos3)`.
- Guarda en `app_data_dir/streamer_{slot}.png`.
- `set_config_value` de la key correspondiente + actualiza cache + emite
  `streamer-config-changed` + `broadcast_ws`.
- `reset_*` limpia la key a `""`.

Registrar el módulo en `commands/mod.rs` y los comandos en `lib.rs`
(`generate_handler![]`).

### 4.5 `server/mod.rs` — ruta del overlay

- Añadir en `build_router()`:
  `.route("/overlay-streamer", get(serve_overlay_streamer))`
- `serve_overlay_streamer` → `serve_overlay_file(&s, "overlay-streamer.html")`
  (idéntico a `serve_overlay_tiktok`).
- Los sprites se sirven por la ruta `/persona?path=...` ya existente (los paths viven en
  `app_data_dir`, que ya está en la allow-list). **No hay que tocar la seguridad de
  rutas.**
- El test `router_builds_without_panicking` cubre la nueva ruta automáticamente.

---

## 5. Frontend — menú principal

### 5.1 Nueva vista `src/views/streamer.ts` (`renderStreamer`)

Sección en el menú con:
- **Toggle** activar overlay (`streamer_persona_enabled`).
- **4 cuadros de subida** de imagen (boca×ojos) con preview y botón "restablecer",
  reutilizando el patrón `_pickGuestImage` de `tamagotchi.ts`
  (`<input type=file>` → `arrayBuffer` → `Array.from(Uint8Array)` →
  `invoke("set_streamer_sprite", { slot, imageData })`).
- **Sliders** (`sRow`/`syncSlider`, patrón de AGENTS.md §9):
  - Tiempo entre parpadeos (`streamer_blink_interval_ms`, p.ej. 500–10000 ms)
  - Duración del parpadeo (`streamer_blink_duration_ms`, p.ej. 50–600 ms)
  - Tamaño (`streamer_size_px`)
  - Umbral de micrófono (`streamer_mic_threshold`)
- **Select** tipo de animación al hablar (`streamer_talk_animation`).
- **Select** ancla (`streamer_anchor`).
- **Select** de micrófono: `navigator.mediaDevices.enumerateDevices()` →
  guarda `deviceId` en `streamer_mic_device_id`.
- **URL del Browser Source**: mostrar `http://localhost:6767/overlay-streamer` con botón
  copiar (igual que los otros overlays en sus vistas).
- **Preview en vivo** (opcional pero recomendado): mini-canvas con los 4 sprites
  reutilizando `BlinkScheduler` + animación, para ver intervalo/duración/animación sin
  abrir OBS. Usa `convertFileSrc` en contexto Tauri.

Guardado: cada control llama `invoke("set_config_cmd", { key, value })`
(o `set_streamer_sprite`). No hace falta un comando "save all" salvo que prefieras
agruparlo (puedo replicar `save_animation_config` si lo quieres atómico).

### 5.2 Routing y navegación

- `router.ts`: añadir `"streamer"` a `ViewId` y a `routes` (`renderStreamer`).
- `index.html`: nuevo `<li>` en el sidebar con `data-view="streamer"` y
  `<span class="nav-icon" data-icon="streamer">`.
- `icons.ts`: añadir icono `streamer` (lucide, p.ej. `user-round`/`webcam`) e inyectarlo
  en `injectNavIcons()` de `main.ts`.

---

## 6. Frontend — overlay

### 6.1 `overlay-streamer.html` (raíz)

```html
<link rel="stylesheet" href="/src/styles/entry-streamer.css" />
<script type="module" src="/src/views/overlay-streamer.ts" defer></script>
<body style="background: transparent;">
  <div id="streamer-container"></div>
</body>
```

### 6.2 `src/views/overlay-streamer.ts` (entry point)

- Usa `wsInvoke("get_config_cmd")` para leer config inicial y
  `browserConvertFileSrc(path)` para los 4 sprites.
- Instancia `MicLevel`, `BlinkScheduler`, `StreamerPersona`.
- `wsListen("streamer-config-changed", cfg => persona.applyConfig(cfg))` para aplicar
  cambios en vivo (timing, animación, tamaño, sprites, umbral).
- Si `streamer_persona_enabled` es `"false"`, oculta el contenedor.

### 6.3 CSS

- Nuevo `src/styles/entry-streamer.css` → `@import "overlay-base.css"; @import
  "streamer-overlay.css";`
- `src/styles/streamer-overlay.css` → layout del contenedor, apilado de sprites,
  anclas y keyframes `talk-*`.

### 6.4 `vite.config.ts`

Añadir 5º entry point:
```ts
overlay_streamer: resolve(__dirname, "overlay-streamer.html"),
```

---

## 7. Eventos nuevos

| Evento | Payload | Emisor | Listener | WS |
|---|---|---|---|---|
| `streamer-config-changed` | `AppConfig` (full) | `config.rs` (`set_config_cmd` con prefijo `streamer_`), `commands/streamer.rs` | `overlay-streamer.ts`; opcional `streamer.ts` para refrescar preview | Sí |

(Se broadcastea por WS porque el overlay corre en OBS.)

---

## 8. Documentación (obligatorio por reglas del repo)

Actualizar **AGENTS.md** (en inglés):
- §2 tabla de Vite entry points → añadir `overlay_streamer`.
- §3 tabla de overlays / rutas → `/overlay-streamer`.
- §4 árbol de directorios → `overlay-streamer.html`, `src/views/overlay-streamer.ts`,
  `src/overlay/streamer/`, `src/views/streamer.ts`, CSS nuevos.
- §5 tabla de Config Keys → las 12 keys nuevas.
- §7 tabla de comandos → `set_streamer_sprite`, `reset_streamer_sprite`.
- §8 tabla de eventos → `streamer-config-changed`.
- ViewRouter (§9) → nuevo `ViewId "streamer"`.

---

## 9. Orden de implementación sugerido

1. **Backend base:** config keys (`migrations.rs`), campos en `AppConfig`
   (`state.rs` + `db/config.rs`), cache + evento en `set_config_cmd`.
2. **Comandos de sprites:** `commands/streamer.rs` + registro en `lib.rs`/`mod.rs`.
3. **Ruta del servidor:** `/overlay-streamer` en `server/mod.rs`.
4. **Overlay:** `overlay-streamer.html`, módulos `streamer/` (BlinkScheduler →
   MicLevel → StreamerPersona), `overlay-streamer.ts`, CSS, entry de Vite.
5. **Menú:** `views/streamer.ts`, router, sidebar, icono, (preview en vivo).
6. **Docs:** AGENTS.md.
7. **Pruebas.**

---

## 10. Pruebas / verificación

- `cargo test` (cubre el panic de la ruta nueva vía `router_builds_without_panicking`).
- `cargo check` / `npm run build` (TS) sin errores.
- **Manual:**
  - Subir los 4 sprites desde el menú → se ven en la preview.
  - Ajustar intervalo/duración → el parpadeo cambia en vivo (preview + OBS).
  - Añadir `http://localhost:6767/overlay-streamer` como Browser Source, permitir mic,
    hablar → la boca abre/cierra y se dispara la animación elegida; el parpadeo ocurre
    también mientras se habla (slots boca-abierta/ojos-cerrados).
  - Desactivar el toggle → overlay vacío.

---

## 11. Riesgos / notas

- **Permiso de micrófono en OBS:** principal punto de fricción para el usuario; se
  mitiga con una nota en el menú y fallback a boca cerrada.
- **Mismatch de `deviceId`** entre el webview del panel y OBS CEF: el `deviceId` puede
  no coincidir; por eso el default vacío (= micrófono por defecto del sistema) es la
  opción segura, y la selección concreta es un extra.
- **Sin dependencias nuevas** en Rust ni en npm (Web Audio y CSS son nativos).
- El sistema de parpadeo está aislado en `BlinkScheduler` (testeable de forma unitaria
  si se quiere añadir un test TS más adelante).
```
