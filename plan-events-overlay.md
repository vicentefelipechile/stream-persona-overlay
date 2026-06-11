# Plan: Centralizar el sistema de eventos en una sola pestaña

## Contexto

Hoy la configuración de eventos está **dispersa en tres vistas**, lo que confunde al streamer:

- **Twitch** (`src/views/twitch.ts`): conexión + filtros de chat + anti-spam + cooldowns de evento + **tipos de evento** (cheer/sub/raid/follow/hype_train/online) + TTS + EventSub.
- **TikTok** (`src/views/tiktok.ts`): conexión + filtros de chat + anti-spam + cooldowns de evento + **tipos de evento** (gift/like/follow/share/subscribe/envelope) + TTS.
- **Eventos TikTok** (`src/views/eventos.ts`): feed en vivo (solo TikTok) + **alertas visuales** (imagen/sonido/texto/duración/transición), pero SOLO para TikTok.

El streamer no sabe dónde tocar cada cosa. El objetivo es **una sola pestaña "Eventos"** que sea la fuente de verdad para todo lo relacionado con eventos de ambas plataformas; las pestañas Twitch y TikTok quedan **solo para conexión + filtros básicos de chat + anti-spam**.

### Decisiones confirmadas con el usuario
1. **Estructura**: una sola página larga con secciones por plataforma (cards con cabecera Twitch / cabecera TikTok).
2. **Feed en vivo**: unificado Twitch + TikTok, con badge de origen (icono de plataforma) por fila.
3. **Alertas visuales**: **extender también a Twitch** (cheer/sub/raid/follow/hype_train) — toca backend.
4. **Naming**: **renombrar** la infraestructura de alertas de `tiktok`→genérico (`event-alert`, `EventAlertPayload`, `overlay-alerts.html`, `alerts_config`, comandos `*_alert_asset` / `test_event_alert`), con **migración** de la config key existente.
5. **Reparto**: a Eventos se mueven **tipos de evento + cooldowns de evento + alertas + TTS**. El **anti-spam de chat se queda** en Twitch/TikTok (es más sobre chat que sobre eventos).

## Qué se mueve y qué se queda

| Sección | Vista origen | Destino |
|---|---|---|
| Conexión (credenciales, conectar/desconectar) | twitch/tiktok | **se queda** |
| Filtros de chat (long. mín/máx, ignorar comandos) | twitch/tiktok | **se queda** |
| Anti-spam de chat (presets + sliders) | twitch/tiktok | **se queda** |
| Tope global de mensajes | twitch | **se queda** en Twitch (es global de chat) |
| EventSub (toggle) | twitch | **→ Eventos** (es config de recepción de eventos) |
| Tipos de evento activos + parámetros (min_bits, min_coins…) | twitch/tiktok | **→ Eventos** |
| Cooldowns de evento (presets + sliders) | twitch/tiktok | **→ Eventos** |
| TTS de eventos | twitch/tiktok | **→ Eventos** |
| Alertas visuales (imagen/sonido/texto/duración/transición) | eventos (solo TikTok) | **→ Eventos**, ampliado a Twitch |
| Feed en vivo | eventos (solo TikTok) | **→ Eventos**, ampliado a Twitch |

Ninguna **config key** de la DB cambia de nombre (salvo `tiktok_alerts_config`, ver migración). Solo cambia **dónde se editan** en la UI. Esto minimiza el riesgo: el backend que lee esas keys (twitch/tiktok/eventsub) no se toca para el reparto de controles.

---

## Parte A — Backend: renombrar alertas a genérico + extender a Twitch

### A1. Renombrar la infraestructura de alertas (Rust)
Patrón de renombrado (aplicar en cada sitio):
- `TiktokAlertPayload` → `EventAlertPayload` — `src-tauri/src/state.rs`
- Evento `"tiktok-alert"` → `"event-alert"` — emisores en `tiktok/mod.rs`, consumidores
- Comandos: `tiktok_test_alert` → `test_event_alert`, `set_tiktok_alert_asset` → `set_event_alert_asset`, `clear_tiktok_alert_asset` → `clear_event_alert_asset` — `src-tauri/src/commands/alerts.rs`, registro en `lib.rs`
- Evento `"tiktok-alerts-changed"` → `"event-alerts-changed"`
- Mover `resolve_alert` / `maybe_emit_alert` / `emit_alert` / `emit_test_alert` de `tiktok/mod.rs` a un **módulo compartido nuevo** `src-tauri/src/alerts/mod.rs` (no pueden vivir en `tiktok/` si Twitch también los usa). `tiktok/mod.rs` y `eventsub.rs` los importan desde ahí.

### A2. Config key + migración
- Renombrar `tiktok_alerts_config` → `alerts_config` en: `state.rs` (campo `AppConfig`), `commands/config.rs`, `db/config.rs`, `commands/alerts.rs`, `migrations.rs`.
- **Migración idempotente** en `db/migrations.rs`: si existe `tiktok_alerts_config` y no existe `alerts_config`, copiar el valor a la nueva key (y opcionalmente borrar la vieja). Usa el patrón de migración existente del archivo.
- El default `TIKTOK_ALERTS_DEFAULT` → `ALERTS_DEFAULT`, **añadiendo entradas Twitch**: `cheer`, `sub`, `raid`, `follow`, `hype_train` (las keys de Twitch NO llevan prefijo `tiktok_` — usan el `event_kind` tal como lo emite `eventsub.rs`: `"cheer"`, `"sub"`, `"raid"`, `"follow"`).

### A3. Ampliar `ALERT_EVENT_KINDS`
En `commands/alerts.rs`, añadir los kinds de Twitch al array (hoy solo TikTok):
```
"cheer", "sub", "raid", "follow", "hype_train"   // Twitch
"tiktok_gift", "tiktok_gift_big", ...            // TikTok (existentes)
```
Esto valida los uploads de assets para los nuevos eventos.

### A4. Emitir alertas de Twitch
En `src-tauri/src/twitch/eventsub.rs`, en cada punto donde hoy se hace `app.emit("chat-event", ...)` + `broadcast_ws` (líneas ~239, ~283, ~327, ~371 para cheer/sub/raid/follow), añadir una llamada a `alerts::maybe_emit_alert(state, app_handle, &cfg, event_kind, user_label, amount)` — exactamente como ya hace `tiktok/mod.rs`. Requiere tener `&cfg` (AppConfig) disponible en ese scope (leer del `config_cache`).

### A5. Renombrar el overlay de alertas
- `overlay-tiktok.html` → `overlay-alerts.html`
- `src/views/overlay-tiktok.ts` → `src/views/overlay-alerts.ts`
- `src/styles/entry-tiktok.css` → `src/styles/entry-alerts.css`
- Entry de Vite en `vite.config.ts`: `overlay_tiktok` → `overlay_alerts`
- Ruta servida en `src-tauri/src/server/mod.rs`: `/overlay-tiktok` → `/overlay-alerts` (rust-embed + ServeDir). **Compatibilidad**: mantener un alias `/overlay-tiktok` → `/overlay-alerts` para no romper la Browser Source que el streamer ya tenga en OBS.
- `AlertManager.ts`: actualizar el nombre del evento escuchado (`tiktok-alert` → `event-alert`) y el tipo importado.

---

## Parte B — Frontend: nueva vista Eventos centralizada

### B1. Reescribir `src/views/eventos.ts`
Estructura de la página (una sola página, secciones con cabecera de plataforma):

1. **Feed en vivo unificado** (card arriba)
   - Escuchar `chat-event` SIN filtrar por plataforma (hoy filtra `p.platform !== "tiktok"`).
   - Cada fila lleva un badge con el icono de la plataforma (`Icons.twitchMono` / `Icons.tiktokMono`) según `p.platform`.
   - Ampliar `FEED_LABELS` con los kinds de Twitch (`cheer`, `sub`, `raid`, `follow`, `hype_train`, `stream_online`/`offline`).

2. **Sección Twitch** (cabecera con `Icons.twitch`)
   - Banner si Twitch no conectado (reutilizar `isPlatformConnected`).
   - **Tipos de evento** (toggles + parámetros): mover el bloque "Eventos" de `twitch.ts` (cheer+min_bits, sub, raid, follow, hype_train, online/offline) y el toggle TTS.
   - **EventSub** (toggle): mover de `twitch.ts`.
   - **Cooldowns de evento** (presets + sliders): mover el bloque "Cooldown de Eventos" de `twitch.ts`.
   - **Alertas por evento**: las tarjetas de alerta (ya rediseñadas en `eventos.ts`) para los kinds de Twitch que las soporten.

3. **Sección TikTok** (cabecera con `Icons.tiktok`)
   - Banner si TikTok no conectado.
   - **Tipos de evento** (toggles + parámetros): mover el bloque "Eventos" de `tiktok.ts` (gift+min/big coins, like, follow, share, subscribe, envelope) y el toggle TTS.
   - **Cooldowns de evento**: mover el bloque de `tiktok.ts`.
   - **Alertas por evento**: las tarjetas actuales de TikTok (ya existen, se conservan).

4. **OBS Browser Source** (card): actualizar la URL a `/overlay-alerts` (mantener nota de compatibilidad).

**Reutilización**: el helper `sRow`, `presetRadios`, `syncSlider`, las tablas `CHAT_PRESETS`/`EVENT_PRESETS`/`GLOBAL_PRESETS`, `eventPresetDescription`, y el patrón de "slider → flip a custom → save" ya existen en twitch.ts/tiktok.ts. **Extraer a un módulo compartido** `src/views/_eventConfig.ts` (o similar) para no duplicarlos entre la sección Twitch y TikTok de Eventos. Las tarjetas de alerta + dropzones + preview + confirmación de borrado ya están en el `eventos.ts` actual y se conservan tal cual (parametrizadas por lista de `ALERT_EVENTS`, que ahora incluye los kinds Twitch).

### B2. Adelgazar `src/views/twitch.ts`
Quitar de la vista (HTML + handlers + entradas en `saveConfig`):
- Bloque "Eventos" (toggles + min_bits + TTS)
- Bloque "Cooldown de Eventos" (preset + sliders)
- Bloque "EventSub"

Conservar: Conexión, Filtros de Chat, Anti-spam (chat), Tope Global de Mensajes. `saveConfig` se reduce a esas keys.

### B3. Adelgazar `src/views/tiktok.ts`
Quitar de la vista:
- Bloque "Eventos" (toggles + min/big coins + TTS)
- Bloque "Cooldown de Eventos" (preset + sliders)

Conservar: Conexión, Filtros de Chat, Anti-spam (chat). `saveConfig` reducido.

### B4. Navegación / etiquetas
- `index.html`: renombrar el label del nav de "Eventos TikTok" → **"Eventos"** (id `nav-eventos`, `data-view="eventos"` se mantienen).
- `vite.config.ts`, `router.ts`: el entry `overlay_tiktok`→`overlay_alerts` (ver A5). La ruta de panel `eventos` no cambia de id.
- Revisar `src/onboarding/tour.ts` por si referencia textos/pasos de las vistas movidas (usa `router.navigate(step.view)`; comprobar que ningún paso apunte a un control que ya no exista en twitch/tiktok).

---

## Parte C — Documentación

- **AGENTS.md**: actualizar §1 (tabla de módulos overlay: `overlay-tiktok.html`→`overlay-alerts.html`), §4 (estructura de archivos), §7 (comandos renombrados), §8 (evento `tiktok-alert`→`event-alert`, `TiktokAlertPayload`→`EventAlertPayload`), la fila de config `tiktok_alerts_config`→`alerts_config`, y la descripción de las vistas twitch/tiktok/eventos. Mantener AGENTS.md en inglés (regla del repo).
- **README.md**: actualizar la URL de OBS y cualquier mención a "Eventos TikTok".
- Actualizar el índice de memoria si procede (`project_tiktok_tiktool.md` menciona alertas).

---

## Archivos críticos

**Backend (Rust):**
- `src-tauri/src/alerts/mod.rs` (**nuevo** — resolve/maybe_emit/emit_test movidos de `tiktok/mod.rs`)
- `src-tauri/src/tiktok/mod.rs` (importar desde `alerts::`, quitar las fns movidas)
- `src-tauri/src/twitch/eventsub.rs` (llamar `alerts::maybe_emit_alert` en cheer/sub/raid/follow)
- `src-tauri/src/commands/alerts.rs` (renombres + `ALERT_EVENT_KINDS` ampliado)
- `src-tauri/src/state.rs` (`EventAlertPayload`, campo `alerts_config`)
- `src-tauri/src/db/{migrations.rs,config.rs}` (default ampliado + migración de key)
- `src-tauri/src/commands/config.rs`, `src-tauri/src/lib.rs` (registro de comandos renombrados)
- `src-tauri/src/server/mod.rs` (ruta `/overlay-alerts` + alias `/overlay-tiktok`)

**Frontend (TS/HTML/CSS):**
- `src/views/eventos.ts` (reescritura: feed unificado + secciones Twitch/TikTok)
- `src/views/_eventConfig.ts` (**nuevo** — helpers compartidos extraídos)
- `src/views/twitch.ts`, `src/views/tiktok.ts` (adelgazar)
- `src/views/overlay-tiktok.ts`→`overlay-alerts.ts`, `overlay-tiktok.html`→`overlay-alerts.html`, `src/styles/entry-tiktok.css`→`entry-alerts.css`
- `src/overlay/alerts/AlertManager.ts` (evento `event-alert`)
- `vite.config.ts`, `index.html`

---

## Verificación

1. **Compilación**: `npx tsc --noEmit` y `npx vite build` limpios; `cd src-tauri && cargo check` limpio.
2. **Migración**: arrancar la app sobre una DB existente con `tiktok_alerts_config` poblada → confirmar que `alerts_config` hereda el valor y las alertas TikTok siguen funcionando (no se pierden imágenes/sonidos configurados).
3. **Reparto UI**: la vista Eventos muestra ambas secciones; Twitch/TikTok ya no muestran tipos de evento / cooldowns / TTS / EventSub, pero sí conexión + filtros + anti-spam.
4. **Feed unificado**: con ambas plataformas conectadas (o usando "Probar"), el feed muestra filas de Twitch y TikTok con el badge de origen correcto.
5. **Alertas Twitch**: configurar una alerta para `sub`/`cheer`, pulsar "Probar" → aparece en `overlay-alerts.html` (abrir `http://localhost:6767/overlay-alerts`). Verificar también que el alias `http://localhost:6767/overlay-tiktok` sigue sirviendo el mismo overlay.
6. **Sin regresiones**: las alertas TikTok existentes (gift/follow/subscribe) siguen disparándose en eventos reales y por "Probar".
7. **Persistencia**: cambiar toggles/cooldowns/TTS en Eventos y recargar la vista → los valores persisten (se guardan en las mismas config keys de siempre).

## Notas / riesgos
- El renombrado de la URL de OBS se mitiga con el **alias** `/overlay-tiktok`; sin él, los streamers que ya tengan la Browser Source verían pantalla en blanco.
- Mover `resolve_alert` a un módulo compartido es lo que habilita las alertas de Twitch sin duplicar lógica; es el punto técnico central de la Parte A.
- El anti-spam de chat se queda intencionalmente en las vistas de plataforma; si en el futuro se quiere también centralizar, sería un paso aparte.
