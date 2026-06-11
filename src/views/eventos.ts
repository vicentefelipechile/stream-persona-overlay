// =========================================================================================================
// EVENTOS VIEW (centralized)
// =========================================================================================================
// Single source of truth for everything event-related on both platforms:
//   • a unified live event feed (Twitch + TikTok, with a platform badge per row),
//   • per-platform event types + parameters + cooldowns + TTS (+ EventSub for Twitch),
//   • per-event visual alerts (image / sound / text / duration / transition) for the
//     dedicated alert overlay (overlay-alerts.html), now covering Twitch kinds too.
//
// Connection, chat filters and chat anti-spam stay in the Twitch / TikTok views.
// The shared event-config plumbing (presets/sliders/save) lives in _eventConfig.ts.
// =========================================================================================================

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { animate } from "motion";
import { showToast, isPlatformConnected, type ChatEventPayload } from "../state";
import { Icons } from "../icons";
import { twitchEventSection, tiktokEventSection } from "./_eventConfig";

// =========================================================================================================
// Alert metadata
// =========================================================================================================

interface AlertEntry {
  enabled: boolean;
  image: string;
  sound: string;
  text: string;
  duration_ms: number;
  transition: string;
}

interface AlertEventMeta {
  kind: string;
  label: string;
  platform: "twitch" | "tiktok";
  /** Tokens this event supports, used to render insert-chips below the text field. */
  tokens: string[];
  noisy: boolean;
  /** Icon for the card header. */
  icon: (size?: number) => string;
  /** Accent color (hex) for the header icon chip + active card border. */
  color: string;
  /** Sample {amount} used in the in-panel preview, or null when the event has none. */
  sampleAmount: number | null;
}

// Events that support a configurable alert (must match the Rust ALERT_EVENT_KINDS).
const ALERT_EVENTS: AlertEventMeta[] = [
  // ── Twitch ──────────────────────────────────────────────────────────────────
  { kind: "cheer",            label: "Bits (Cheer)",      platform: "twitch", tokens: ["{user}", "{amount}"], noisy: false, icon: Icons.zap,   color: "#9146ff", sampleAmount: 100 },
  { kind: "sub",              label: "Suscripción",       platform: "twitch", tokens: ["{user}"],             noisy: false, icon: Icons.star,  color: "#a970ff", sampleAmount: null },
  { kind: "raid",             label: "Raid",              platform: "twitch", tokens: ["{user}", "{amount}"], noisy: false, icon: Icons.users, color: "#772ce8", sampleAmount: 25 },
  { kind: "follow",           label: "Nuevo seguidor",    platform: "twitch", tokens: ["{user}"],             noisy: false, icon: Icons.heart, color: "#22c55e", sampleAmount: null },
  { kind: "hype_train",       label: "Hype Train",        platform: "twitch", tokens: ["{user}"],             noisy: false, icon: Icons.zap,   color: "#ff4d8d", sampleAmount: null },
  // ── TikTok ──────────────────────────────────────────────────────────────────
  { kind: "tiktok_gift",      label: "Donación (regalo)", platform: "tiktok", tokens: ["{user}", "{amount}"], noisy: false, icon: Icons.gift,  color: "#ff4d8d", sampleAmount: 100 },
  { kind: "tiktok_gift_big",  label: "Donación grande",   platform: "tiktok", tokens: ["{user}", "{amount}"], noisy: false, icon: Icons.gift,  color: "#ff2d55", sampleAmount: 500 },
  { kind: "tiktok_follow",    label: "Nuevo seguidor",    platform: "tiktok", tokens: ["{user}"],             noisy: false, icon: Icons.heart, color: "#22c55e", sampleAmount: null },
  { kind: "tiktok_share",     label: "Compartir",         platform: "tiktok", tokens: ["{user}"],             noisy: false, icon: Icons.share, color: "#3b82f6", sampleAmount: null },
  { kind: "tiktok_subscribe", label: "Suscripción",       platform: "tiktok", tokens: ["{user}"],             noisy: false, icon: Icons.star,  color: "#f0b429", sampleAmount: null },
  { kind: "tiktok_like",      label: "Like",              platform: "tiktok", tokens: ["{user}"],             noisy: true,  icon: Icons.heart, color: "#ec4899", sampleAmount: null },
  { kind: "tiktok_member",    label: "Entrada (member)",  platform: "tiktok", tokens: ["{user}"],             noisy: true,  icon: Icons.login, color: "#a855f7", sampleAmount: null },
];

/** Resolve {user}/{amount} tokens in a text template for the in-panel preview,
 *  mirroring how the backend formats `test_event_alert`. */
function resolveTokens(text: string, m: AlertEventMeta): string {
  return text
    .replace(/\{user\}/g, "TestUser")
    .replace(/\{amount\}/g, m.sampleAmount != null ? String(m.sampleAmount) : "100");
}

/** Entry transform per transition — mirrors AlertManager.ENTER so the panel
 *  preview animates exactly like the real overlay. */
const PREVIEW_ENTER: Record<string, string> = {
  fade: "none",
  "slide-down": "translateY(-24px)",
  "slide-up": "translateY(24px)",
  scale: "scale(0.6)",
  none: "none",
};

const TRANSITIONS: { value: string; label: string }[] = [
  { value: "fade",       label: "Desvanecer" },
  { value: "slide-down", label: "Deslizar desde arriba" },
  { value: "slide-up",   label: "Deslizar desde abajo" },
  { value: "scale",      label: "Escalar (pop)" },
  { value: "none",       label: "Sin transición" },
];

// Human labels for the unified live feed (Twitch + TikTok event kinds).
const FEED_LABELS: Record<string, string> = {
  // Twitch
  cheer: "Bits", sub: "Suscripción", raid: "Raid", follow: "Seguidor",
  hype_train: "Hype Train", stream_online: "En directo", stream_offline: "Offline",
  // TikTok
  tiktok_gift: "Regalo", tiktok_gift_big: "Regalo grande", tiktok_like: "Like",
  tiktok_follow: "Seguidor", tiktok_share: "Compartir", tiktok_subscribe: "Suscripción",
  tiktok_envelope: "Sobre", tiktok_member: "Entrada",
};

// Event kinds considered high-frequency — dimmed in the feed.
const NOISY_KINDS = new Set(["tiktok_like", "tiktok_member"]);

const DEFAULT_ENTRY: AlertEntry = {
  enabled: false, image: "", sound: "", text: "{user}", duration_ms: 4000, transition: "fade",
};

// Accepted MIME types per asset kind (file picker + drag & drop validation).
const ACCEPT: Record<"image" | "sound", string[]> = {
  image: ["image/png", "image/jpeg", "image/gif", "image/webp"],
  sound: ["audio/mpeg", "audio/ogg", "audio/wav"],
};

const FEED_MAX = 50;
const OBS_URL = "http://localhost:6767/overlay-alerts";

// Module-level so we can detach the previous listener when the view re-renders.
let feedUnlisten: UnlistenFn | null = null;

// =========================================================================================================
// Collapsed-card persistence (remembers which alert cards are collapsed between sessions)
// =========================================================================================================

const COLLAPSE_KEY = "spo-eventos-collapsed";

/** Set of alert event kinds whose card is currently collapsed. */
function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveCollapsed(set: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore quota / disabled storage */
  }
}

// =========================================================================================================
// Small helpers
// =========================================================================================================

const durLabel = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Platform badge (icon) for a feed row. */
function platformBadge(platform: string): string {
  if (platform === "twitch") return `<span class="evt-feed-platform" title="Twitch">${Icons.twitchMono(14)}</span>`;
  if (platform === "tiktok") return `<span class="evt-feed-platform" title="TikTok">${Icons.tiktokMono(14)}</span>`;
  return "";
}

/** Image thumbnail markup for the dropzone (or the empty-state placeholder). */
function imgThumb(path: string): string {
  return path
    ? `<img src="${convertFileSrc(path)}" alt=""/>`
    : `<span class="evt-dropzone-empty">${Icons.image(22)}</span>`;
}

/** Inner content of the in-panel preview alert (image + resolved text). */
function previewInner(e: AlertEntry, m: AlertEventMeta): string {
  const img = e.image ? `<img class="evt-preview-img" src="${convertFileSrc(e.image)}" alt=""/>` : "";
  const txt = e.text ? `<div class="evt-preview-text">${escapeHtml(resolveTokens(e.text, m))}</div>` : "";
  return img + txt || `<span class="evt-preview-placeholder">Sin contenido</span>`;
}

function syncDurSlider(id: string): void {
  const el = document.getElementById(id) as HTMLInputElement | null;
  const lbl = document.getElementById(`${id}-val`);
  if (!el) return;
  if (lbl) lbl.textContent = durLabel(Number(el.value));
  const pct = ((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100;
  el.style.setProperty("--slider-fill", `${pct}%`);
}

/** Two-step destructive confirmation: the first click arms the button (it turns
 *  red and reads "¿Borrar?"), a second click within 3 s confirms. */
function bindConfirmClick(btn: HTMLElement | null, hasTarget: () => boolean, onConfirm: () => void): void {
  if (!btn) return;
  const original = btn.innerHTML;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const disarm = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    btn.classList.remove("is-armed");
    btn.innerHTML = original;
  };
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (!hasTarget()) return;
    if (btn.classList.contains("is-armed")) {
      disarm();
      onConfirm();
      return;
    }
    btn.classList.add("is-armed");
    btn.innerHTML = "¿Borrar?";
    timer = setTimeout(disarm, 3000);
  });
}

// =========================================================================================================
// Render
// =========================================================================================================

export async function renderEventos(pane: HTMLElement): Promise<void> {
  const container = pane;

  let cfg: Record<string, unknown> = {};
  try {
    cfg = await invoke<Record<string, unknown>>("get_config_cmd");
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><span class="empty-state-icon">${Icons.warning(48)}</span><p>${String(e)}</p></div>`;
    return;
  }

  // Parse the alerts JSON into a mutable in-memory model (the source of truth
  // while editing). Every field change writes the whole object back via setConfig.
  let alerts: Record<string, AlertEntry> = {};
  try {
    alerts = JSON.parse(String(cfg["alerts_config"] || "{}"));
  } catch {
    alerts = {};
  }
  const entryFor = (kind: string): AlertEntry => ({ ...DEFAULT_ENTRY, ...(alerts[kind] || {}) });

  // Which alert cards are collapsed (persisted between sessions).
  const collapsed = loadCollapsed();

  // Build the per-platform event-config sections (types + cooldowns + TTS + EventSub).
  const twitchSection = twitchEventSection(cfg);
  const tiktokSection = tiktokEventSection(cfg);

  const cardHtml = (m: AlertEventMeta): string => {
    const e = entryFor(m.kind);
    const k = m.kind;
    const soundName = e.sound ? e.sound.split(/[\\/]/).pop() : "";

    const tokenChips = m.tokens
      .map((t) => `<button type="button" class="evt-token-chip" data-token="${t}" title="Insertar ${t}">${t}</button>`)
      .join("");

    return `
    <div class="evt-card${m.noisy ? " evt-card-noisy" : ""}${e.enabled ? " is-enabled" : ""}${collapsed.has(k) ? " is-collapsed" : ""}"
         data-kind="${k}" style="--evt-accent:${m.color};">
      <div class="evt-card-head" id="evt-${k}-head">
        <span class="evt-card-icon">${m.icon(18)}</span>
        <span class="evt-card-title">${m.label}</span>
        ${m.noisy ? `<span class="badge evt-noisy-badge" title="Evento muy frecuente">muy frecuente</span>` : ""}
        <span class="evt-card-status" id="evt-${k}-status">${e.enabled ? "Activa" : "Desactivada"}</span>
        <label class="switch evt-head-switch" title="Activar/desactivar esta alerta">
          <input type="checkbox" id="evt-${k}-enabled" ${e.enabled ? "checked" : ""}/>
          <span class="switch-track"></span>
        </label>
        <button class="btn btn-secondary" id="evt-${k}-test" title="Disparar en el overlay de OBS">${Icons.play()} Probar</button>
        <button type="button" class="evt-collapse-btn" id="evt-${k}-collapse" title="Mostrar/ocultar">${Icons.chevronDown(18)}</button>
      </div>

      <div class="evt-card-body" id="evt-${k}-body">
        <div class="evt-card-cols">
          <div class="evt-card-form">
            <div class="evt-grid">
              <div class="form-group">
                <label>${Icons.image(13)} Imagen</label>
                <div class="evt-dropzone evt-dropzone-image" id="evt-${k}-img-zone" tabindex="0">
                  <div class="evt-dropzone-preview" id="evt-${k}-img-preview">${imgThumb(e.image)}</div>
                  <div class="evt-dropzone-hint">
                    <span>Arrastra o</span>
                    <button type="button" class="btn btn-secondary" id="evt-${k}-img-btn">Subir</button>
                    <button type="button" class="btn btn-secondary evt-clear-btn" id="evt-${k}-img-clear" title="Quitar imagen">${Icons.trash()}</button>
                  </div>
                </div>
              </div>

              <div class="form-group">
                <label>${Icons.music(13)} Sonido</label>
                <div class="evt-dropzone evt-dropzone-sound" id="evt-${k}-sound-zone" tabindex="0">
                  <div class="evt-sound-name" id="evt-${k}-sound-name">${soundName ? escapeHtml(soundName) : "Sin sonido"}</div>
                  <div class="evt-dropzone-hint">
                    <button type="button" class="btn btn-secondary" id="evt-${k}-sound-play" title="Reproducir">${Icons.play()}</button>
                    <button type="button" class="btn btn-secondary" id="evt-${k}-sound-btn">Subir</button>
                    <button type="button" class="btn btn-secondary evt-clear-btn" id="evt-${k}-sound-clear" title="Quitar sonido">${Icons.trash()}</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="form-group evt-text-group">
              <label>Texto de la alerta</label>
              <input type="text" id="evt-${k}-text" value="${escapeAttr(e.text)}" placeholder="Texto de la alerta"/>
              <div class="evt-token-row">
                <span class="evt-token-hint">Tokens:</span>
                ${tokenChips}
              </div>
            </div>

            <div class="evt-grid">
              <div class="form-group" style="gap:4px;">
                <div class="evt-slider-head">
                  <label style="margin:0;">Duración</label>
                  <span class="evt-slider-val" id="evt-${k}-dur-val">${durLabel(e.duration_ms)}</span>
                </div>
                <input type="range" id="evt-${k}-dur" min="1000" max="15000" step="500" value="${e.duration_ms}"/>
              </div>
              <div class="form-group">
                <label>Transición</label>
                <select id="evt-${k}-trans">
                  ${TRANSITIONS.map((t) => `<option value="${t.value}" ${e.transition === t.value ? "selected" : ""}>${t.label}</option>`).join("")}
                </select>
              </div>
            </div>
          </div>

          <div class="evt-card-preview">
            <div class="evt-preview-label">Vista previa ${Icons.eye(13)}</div>
            <div class="evt-preview-stage" id="evt-${k}-stage">
              <div class="evt-preview-alert" id="evt-${k}-prev">${previewInner(e, m)}</div>
            </div>
            <button type="button" class="btn btn-secondary evt-replay-btn" id="evt-${k}-replay">${Icons.refresh()} Reproducir animación</button>
          </div>
        </div>
      </div>
    </div>`;
  };

  const twitchAlertCards = ALERT_EVENTS.filter((m) => m.platform === "twitch").map(cardHtml).join("");
  const tiktokAlertCards = ALERT_EVENTS.filter((m) => m.platform === "tiktok").map(cardHtml).join("");

  const twitchConnected = isPlatformConnected("twitch");
  const tiktokConnected = isPlatformConnected("tiktok");

  container.innerHTML = `
    <div class="view-header">
      <h1>${Icons.zap(22)} Eventos</h1>
      <p class="view-subtitle">Centro de eventos de Twitch y TikTok: tipos de evento, cooldowns, TTS y alertas en el overlay.</p>
    </div>

    <!-- Sticky quick-jump bar — the page is long, so let the streamer jump to a section. -->
    <nav class="evt-jumpbar" aria-label="Saltar a sección">
      <button type="button" class="evt-jump" data-target="evt-sec-feed">${Icons.zap(14)} Feed</button>
      <button type="button" class="evt-jump" data-target="evt-sec-obs">${Icons.externalLink(14)} OBS</button>
      <button type="button" class="evt-jump" data-target="evt-sec-twitch">${Icons.twitchMono(14)} Twitch</button>
      <button type="button" class="evt-jump" data-target="evt-sec-tiktok">${Icons.tiktokMono(14)} TikTok</button>
    </nav>

    <div id="evt-sec-feed" class="card">
      <div class="card-header">
        <h2 class="section-title">Feed de eventos en vivo</h2>
      </div>
      <p style="margin:0 0 12px;font-size:0.85rem;color:var(--color-text-muted);">
        Eventos de Twitch y TikTok de la transmisión actual. Cada fila lleva el icono de su plataforma. Los eventos muy frecuentes (like, entradas) aparecen atenuados.
      </p>
      <div id="evt-feed" class="evt-feed">
        <div class="evt-feed-empty">Esperando eventos…</div>
      </div>
    </div>

    <!-- ── OBS Browser Source (directly under the live feed) ──────────────────── -->
    <div id="evt-sec-obs" class="card" style="margin-top: var(--space-5);">
      <div class="section-title" style="display:flex;align-items:center;gap:6px;">${Icons.externalLink(16)} OBS Browser Source</div>
      <p class="view-subtitle" style="margin:8px 0;">
        Agregá esta URL como <strong>Browser Source</strong> en OBS y posicionála/escalála a tu gusto.
        Pulsá <strong>Probar</strong> en cualquier evento para previsualizarla.
      </p>
      <div style="display:flex;gap:8px;">
        <input id="evt-obs-url" type="text" readonly value="${OBS_URL}" style="flex:1;"/>
        <button id="evt-copy-url" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;">${Icons.copy(14)} Copiar</button>
      </div>
    </div>

    <!-- ── Twitch section ──────────────────────────────────────────────────── -->
    <div id="evt-sec-twitch" class="evt-platform-header" style="margin-top: var(--space-6);">
      ${Icons.twitch(22)} <h2 class="section-title" style="margin:0;">Twitch</h2>
    </div>
    ${twitchConnected ? "" : `
    <div class="conn-banner">
      ${Icons.twitchMono(18)}
      <div><strong>Twitch no está conectado.</strong> No llegarán eventos hasta que conectes desde la vista <strong>Twitch</strong>. Igual puedes configurar todo aquí y usar <strong>Probar</strong>.</div>
    </div>`}
    <div style="margin-top: var(--space-4);">${twitchSection.html}</div>
    <div style="margin-top: var(--space-5);">
      <h3 class="section-title">Alertas por evento — Twitch</h3>
      ${twitchAlertCards}
    </div>

    <!-- ── TikTok section ──────────────────────────────────────────────────── -->
    <div id="evt-sec-tiktok" class="evt-platform-header" style="margin-top: var(--space-6);">
      ${Icons.tiktok(22)} <h2 class="section-title" style="margin:0;">TikTok</h2>
    </div>
    ${tiktokConnected ? "" : `
    <div class="conn-banner">
      ${Icons.tiktokMono(18)}
      <div><strong>TikTok no está conectado.</strong> No llegarán eventos hasta que conectes desde la vista <strong>TikTok</strong>. Igual puedes configurar todo aquí y usar <strong>Probar</strong>.</div>
    </div>`}
    <div style="margin-top: var(--space-4);">${tiktokSection.html}</div>
    <div style="margin-top: var(--space-5);">
      <h3 class="section-title">Alertas por evento — TikTok</h3>
      <p style="margin:4px 0 0;font-size:0.85rem;color:var(--color-text-muted);">
        Para limitar la saturación de like/entradas usa los cooldowns por evento de arriba.
      </p>
      ${tiktokAlertCards}
    </div>
  `;

  // ── Quick-jump bar ─────────────────────────────────────────────────────────
  container.querySelectorAll<HTMLButtonElement>(".evt-jump").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById(btn.dataset.target!)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  // ── Wire the per-platform event-config sections ────────────────────────────
  twitchSection.bind();
  tiktokSection.bind();

  // ── OBS Browser Source URL copy ───────────────────────────────────────────
  container.querySelector("#evt-copy-url")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(OBS_URL);
      showToast("URL copiada al portapapeles", "success");
    } catch {
      showToast("No se pudo copiar al portapapeles", "error");
    }
  });

  // ── Sliders initial fill ──────────────────────────────────────────────────
  for (const m of ALERT_EVENTS) syncDurSlider(`evt-${m.kind}-dur`);

  // ── Persist helper ────────────────────────────────────────────────────────
  const saveAlerts = async (): Promise<void> => {
    try {
      await invoke("set_config_cmd", {
        key: "alerts_config",
        value: JSON.stringify(alerts),
      });
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  const metaFor = (kind: string) => ALERT_EVENTS.find((m) => m.kind === kind)!;

  const refreshPreview = (kind: string): void => {
    const prev = document.getElementById(`evt-${kind}-prev`);
    if (prev) prev.innerHTML = previewInner(alerts[kind], metaFor(kind));
  };

  const playPreview = async (kind: string): Promise<void> => {
    const prev = document.getElementById(`evt-${kind}-prev`);
    if (!prev) return;
    refreshPreview(kind);
    const trans = alerts[kind].transition || "fade";
    const from = PREVIEW_ENTER[trans] ?? "none";
    const dur = trans === "none" ? 0 : 0.4;
    try {
      await animate(prev, { opacity: [0, 1], transform: [from, "none"] }, { duration: dur });
    } catch {
      /* noop */
    }
  };

  const refreshEnabledUi = (kind: string): void => {
    const on = alerts[kind].enabled;
    document.querySelector(`.evt-card[data-kind="${kind}"]`)?.classList.toggle("is-enabled", on);
    const status = document.getElementById(`evt-${kind}-status`);
    if (status) status.textContent = on ? "Activa" : "Desactivada";
  };

  // ── Per-card bindings ─────────────────────────────────────────────────────
  for (const m of ALERT_EVENTS) {
    const k = m.kind;
    alerts[k] = entryFor(k);

    const $ = (suffix: string) => document.getElementById(`evt-${k}-${suffix}`);

    const toggleCollapse = () => {
      const card = document.querySelector(`.evt-card[data-kind="${k}"]`);
      const isCollapsed = card?.classList.toggle("is-collapsed");
      // Persist so the collapsed/expanded state survives a reload / next session.
      if (isCollapsed) collapsed.add(k);
      else collapsed.delete(k);
      saveCollapsed(collapsed);
    };
    $("head")?.addEventListener("click", (ev) => {
      if ((ev.target as HTMLElement).closest("input,button,label,.switch")) return;
      toggleCollapse();
    });
    $("collapse")?.addEventListener("click", (ev) => { ev.stopPropagation(); toggleCollapse(); });

    $("enabled")?.addEventListener("change", (ev) => {
      alerts[k].enabled = (ev.target as HTMLInputElement).checked;
      refreshEnabledUi(k);
      void saveAlerts();
    });

    const textEl = $("text") as HTMLInputElement | null;
    textEl?.addEventListener("input", () => { alerts[k].text = textEl.value; refreshPreview(k); });
    textEl?.addEventListener("change", () => { alerts[k].text = textEl.value; void saveAlerts(); });

    document.querySelectorAll<HTMLButtonElement>(`#evt-${k}-body .evt-token-chip`).forEach((chip) => {
      chip.addEventListener("click", () => {
        if (!textEl) return;
        const token = chip.dataset.token!;
        const start = textEl.selectionStart ?? textEl.value.length;
        const end = textEl.selectionEnd ?? textEl.value.length;
        textEl.value = textEl.value.slice(0, start) + token + textEl.value.slice(end);
        const caret = start + token.length;
        textEl.setSelectionRange(caret, caret);
        textEl.focus();
        alerts[k].text = textEl.value;
        refreshPreview(k);
        void saveAlerts();
      });
    });

    const dur = $("dur") as HTMLInputElement | null;
    dur?.addEventListener("input", () => syncDurSlider(`evt-${k}-dur`));
    dur?.addEventListener("change", () => {
      alerts[k].duration_ms = Number(dur.value);
      void saveAlerts();
    });

    $("trans")?.addEventListener("change", (ev) => {
      alerts[k].transition = (ev.target as HTMLSelectElement).value;
      void saveAlerts();
      void playPreview(k);
    });

    $("test")?.addEventListener("click", async () => {
      try {
        await invoke("test_event_alert", { eventKind: k });
      } catch (e) {
        showToast(String(e), "error");
      }
    });

    $("replay")?.addEventListener("click", () => void playPreview(k));

    $("img-btn")?.addEventListener("click", () => pickAsset(k, "image"));
    bindConfirmClick($("img-clear"), () => !!alerts[k].image, () => void clearAsset(k, "image"));
    setupDropzone($("img-zone"), k, "image");

    $("sound-btn")?.addEventListener("click", () => pickAsset(k, "sound"));
    bindConfirmClick($("sound-clear"), () => !!alerts[k].sound, () => void clearAsset(k, "sound"));
    $("sound-play")?.addEventListener("click", () => {
      const path = alerts[k].sound;
      if (!path) return;
      try {
        new Audio(convertFileSrc(path)).play().catch(() => {});
      } catch {
        /* noop */
      }
    });
    setupDropzone($("sound-zone"), k, "sound");
  }

  // ── Asset handling (shared by file picker + drag & drop) ──────────────────
  async function uploadFile(kind: string, assetType: "image" | "sound", file: File): Promise<void> {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    try {
      const path = await invoke<string>("set_event_alert_asset", {
        eventKind: kind,
        assetType,
        fileName: file.name,
        data: bytes,
      });
      alerts[kind][assetType] = path;
      refreshAssetUi(kind, assetType);
      refreshPreview(kind);
      showToast(`${assetType === "image" ? "Imagen" : "Sonido"} guardado`, "success");
    } catch (e) {
      showToast(String(e), "error");
    }
  }

  function pickAsset(kind: string, assetType: "image" | "sound"): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT[assetType].join(",");
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void uploadFile(kind, assetType, file);
    };
    input.click();
  }

  function setupDropzone(zone: HTMLElement | null, kind: string, assetType: "image" | "sound"): void {
    if (!zone) return;
    const accept = ACCEPT[assetType];
    const stop = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); };

    ["dragenter", "dragover"].forEach((t) =>
      zone.addEventListener(t, (ev) => { stop(ev); zone.classList.add("is-dragover"); }));
    ["dragleave", "dragend"].forEach((t) =>
      zone.addEventListener(t, (ev) => { stop(ev); zone.classList.remove("is-dragover"); }));

    zone.addEventListener("drop", (ev) => {
      stop(ev);
      zone.classList.remove("is-dragover");
      const file = (ev as DragEvent).dataTransfer?.files?.[0];
      if (!file) return;
      if (!accept.includes(file.type)) {
        showToast(`Tipo de archivo no válido para ${assetType === "image" ? "imagen" : "sonido"}`, "error");
        return;
      }
      void uploadFile(kind, assetType, file);
    });

    zone.addEventListener("click", (ev) => {
      if ((ev.target as HTMLElement).closest("button")) return;
      pickAsset(kind, assetType);
    });
  }

  async function clearAsset(kind: string, assetType: "image" | "sound"): Promise<void> {
    try {
      await invoke("clear_event_alert_asset", { eventKind: kind, assetType });
      alerts[kind][assetType] = "";
      refreshAssetUi(kind, assetType);
      refreshPreview(kind);
    } catch (e) {
      showToast(String(e), "error");
    }
  }

  function refreshAssetUi(kind: string, assetType: "image" | "sound"): void {
    if (assetType === "image") {
      const el = document.getElementById(`evt-${kind}-img-preview`);
      if (el) el.innerHTML = imgThumb(alerts[kind].image);
    } else {
      const el = document.getElementById(`evt-${kind}-sound-name`);
      if (el) el.textContent = alerts[kind].sound ? alerts[kind].sound.split(/[\\/]/).pop()! : "Sin sonido";
    }
  }

  // ── Live feed ─────────────────────────────────────────────────────────────
  await setupFeed();
}

// =========================================================================================================
// Live feed wiring (unified Twitch + TikTok)
// =========================================================================================================

async function setupFeed(): Promise<void> {
  if (feedUnlisten) {
    feedUnlisten();
    feedUnlisten = null;
  }

  const feed = document.getElementById("evt-feed");
  if (!feed) return;
  let count = 0;

  feedUnlisten = await listen<ChatEventPayload>("chat-event", (event) => {
    const p = event.payload;
    if (count === 0) feed.innerHTML = "";
    count++;

    const noisy = NOISY_KINDS.has(p.event_kind);
    const label = FEED_LABELS[p.event_kind] ?? p.event_kind;
    const time = new Date().toLocaleTimeString();
    // Twitch cheers/raids carry a bits/viewers count; TikTok gifts carry coins.
    const unit = p.platform === "twitch"
      ? (p.event_kind === "raid" ? "viewers" : "bits")
      : "monedas";
    const amount = p.amount != null ? `${p.amount} ${unit}` : "";

    const row = document.createElement("div");
    row.className = `evt-feed-row${noisy ? " evt-feed-row-noisy" : ""}`;
    row.innerHTML = `
      <span class="evt-feed-time">${time}</span>
      ${platformBadge(p.platform)}
      <span class="evt-feed-badge">${escapeHtml(label)}</span>
      <span class="evt-feed-user">@${escapeHtml(p.username)}</span>
      <span class="evt-feed-meta">${escapeHtml(amount)}</span>`;

    feed.prepend(row);
    while (feed.childElementCount > FEED_MAX) feed.lastElementChild?.remove();
  });
}

// =========================================================================================================
// Small escaping helpers
// =========================================================================================================

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}
