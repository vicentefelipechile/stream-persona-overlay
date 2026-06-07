// =========================================================================================================
// EVENTOS VIEW
// =========================================================================================================
// Live event feed of the current stream + per-event alert configuration for the
// dedicated TikTok alert overlay (overlay-tiktok.html). The streamer configures,
// for each event kind: enabled, image, sound, text template, duration, transition.
// =========================================================================================================

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { showToast, isPlatformConnected, type ChatEventPayload } from "../state";
import { Icons } from "../icons";

// =========================================================================================================
// Metadata
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
  tokens: string;
  noisy: boolean;
}

// Events that support a configurable alert (must match the Rust ALERT_EVENT_KINDS).
const ALERT_EVENTS: AlertEventMeta[] = [
  { kind: "tiktok_gift",      label: "Donación (regalo)", tokens: "{user}, {amount}", noisy: false },
  { kind: "tiktok_gift_big",  label: "Donación grande",   tokens: "{user}, {amount}", noisy: false },
  { kind: "tiktok_follow",    label: "Nuevo seguidor",    tokens: "{user}",           noisy: false },
  { kind: "tiktok_share",     label: "Compartir",         tokens: "{user}",           noisy: false },
  { kind: "tiktok_subscribe", label: "Suscripción",       tokens: "{user}",           noisy: false },
  { kind: "tiktok_like",      label: "Like",              tokens: "{user}",           noisy: true  },
  { kind: "tiktok_member",    label: "Entrada (member)",  tokens: "{user}",           noisy: true  },
];

const TRANSITIONS: { value: string; label: string }[] = [
  { value: "fade",       label: "Desvanecer" },
  { value: "slide-down", label: "Deslizar desde arriba" },
  { value: "slide-up",   label: "Deslizar desde abajo" },
  { value: "scale",      label: "Escalar (pop)" },
  { value: "none",       label: "Sin transición" },
];

// Human labels for the live feed (TikTok event kinds only — the feed is filtered
// to platform === "tiktok").
const FEED_LABELS: Record<string, string> = {
  tiktok_gift: "Regalo", tiktok_gift_big: "Regalo grande", tiktok_like: "Like",
  tiktok_follow: "Seguidor", tiktok_share: "Compartir", tiktok_subscribe: "Suscripción",
  tiktok_envelope: "Sobre", tiktok_member: "Entrada",
};

// Event kinds considered high-frequency — dimmed in the feed.
const NOISY_KINDS = new Set(["tiktok_like", "tiktok_member"]);

const DEFAULT_ENTRY: AlertEntry = {
  enabled: false, image: "", sound: "", text: "{user}", duration_ms: 4000, transition: "fade",
};

const FEED_MAX = 50;

// Module-level so we can detach the previous listener when the view re-renders.
let feedUnlisten: UnlistenFn | null = null;

// =========================================================================================================
// Slider helpers (mirrors the sRow/syncSlider pattern used across views — AGENTS §9)
// =========================================================================================================

const durLabel = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function syncSlider(id: string, fmt: (v: number) => string): void {
  const el = document.getElementById(id) as HTMLInputElement | null;
  const lbl = document.getElementById(`${id}-val`);
  if (!el) return;
  if (lbl) lbl.textContent = fmt(Number(el.value));
  const pct = ((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100;
  el.style.setProperty("--slider-fill", `${pct}%`);
}

// =========================================================================================================
// Render
// =========================================================================================================

export async function renderEventos(): Promise<void> {
  const container = document.getElementById("view-container")!;

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
    alerts = JSON.parse(String(cfg["tiktok_alerts_config"] || "{}"));
  } catch {
    alerts = {};
  }
  const entryFor = (kind: string): AlertEntry => ({ ...DEFAULT_ENTRY, ...(alerts[kind] || {}) });

  const cardHtml = (m: AlertEventMeta): string => {
    const e = entryFor(m.kind);
    const k = m.kind;
    const imgPreview = e.image
      ? `<img src="${convertFileSrc(e.image)}" alt="" style="max-width:64px;max-height:64px;border-radius:4px;object-fit:contain;"/>`
      : `<span style="color:var(--text-muted);font-size:0.8rem;">Sin imagen</span>`;
    const soundName = e.sound ? e.sound.split(/[\\/]/).pop() : "Sin sonido";

    return `
    <div class="card evt-card${m.noisy ? " evt-card-noisy" : ""}" data-kind="${k}" style="margin-top: var(--space-4);">
      <div class="evt-card-head">
        <label class="switch">
          <input type="checkbox" id="evt-${k}-enabled" ${e.enabled ? "checked" : ""}/>
          <span class="switch-track"></span>
        </label>
        <span class="section-title" style="font-size:1rem;">${m.label}</span>
        ${m.noisy ? `<span class="badge" title="Evento muy frecuente">muy frecuente</span>` : ""}
        <button class="btn btn-secondary btn-sm" id="evt-${k}-test" style="margin-left:auto;">${Icons.play()} Probar</button>
      </div>

      <div class="evt-grid">
        <div class="form-group">
          <label>Imagen</label>
          <div class="evt-asset-row">
            <span id="evt-${k}-img-preview">${imgPreview}</span>
            <button class="btn btn-secondary btn-sm" id="evt-${k}-img-btn">Subir</button>
            <button class="btn btn-secondary btn-sm" id="evt-${k}-img-clear">${Icons.trash()}</button>
          </div>
        </div>

        <div class="form-group">
          <label>Sonido</label>
          <div class="evt-asset-row">
            <span id="evt-${k}-sound-name" style="font-size:0.8rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px;">${soundName}</span>
            <button class="btn btn-secondary btn-sm" id="evt-${k}-sound-play" title="Reproducir">${Icons.play()}</button>
            <button class="btn btn-secondary btn-sm" id="evt-${k}-sound-btn">Subir</button>
            <button class="btn btn-secondary btn-sm" id="evt-${k}-sound-clear">${Icons.trash()}</button>
          </div>
        </div>
      </div>

      <div class="form-group" style="margin-top:8px;">
        <label>Texto <span style="color:var(--text-muted);font-weight:normal;font-size:0.8rem;">— tokens: ${m.tokens}</span></label>
        <input type="text" id="evt-${k}-text" value="${escapeAttr(e.text)}" placeholder="Texto de la alerta"/>
      </div>

      <div class="evt-grid" style="margin-top:8px;">
        <div class="form-group" style="gap:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <label style="margin:0;">Duración</label>
            <span id="evt-${k}-dur-val">${durLabel(e.duration_ms)}</span>
          </div>
          <input type="range" id="evt-${k}-dur" min="1000" max="15000" step="500" value="${e.duration_ms}" style="width:100%;margin-top:4px;"/>
        </div>
        <div class="form-group">
          <label>Transición</label>
          <select id="evt-${k}-trans">
            ${TRANSITIONS.map((t) => `<option value="${t.value}" ${e.transition === t.value ? "selected" : ""}>${t.label}</option>`).join("")}
          </select>
        </div>
      </div>
    </div>`;
  };

  container.innerHTML = `
    <div class="view-header">
      <h1>${Icons.tiktokMono(22)} Eventos TikTok</h1>
      <p class="view-subtitle">Feed en vivo de eventos de TikTok y alertas configurables en el overlay.</p>
    </div>

    ${isPlatformConnected("tiktok") ? "" : `
    <div class="conn-banner">
      ${Icons.tiktokMono(18)}
      <div>
        <strong>TikTok no está conectado.</strong> No llegarán eventos al feed hasta que conectes desde la vista
        <strong>TikTok</strong>. Aun así puedes configurar las alertas y usar <strong>Probar</strong>.
      </div>
    </div>`}

    <div class="card">
      <div class="card-header">
        <h2 class="section-title">Feed de eventos de TikTok en vivo</h2>
      </div>
      <p style="margin:0 0 12px;font-size:0.85rem;color:var(--text-muted);">
        Solo eventos de TikTok de la transmisión actual. Los eventos muy frecuentes (like, entradas) aparecen atenuados.
      </p>
      <div id="evt-feed" class="evt-feed">
        <div class="evt-feed-empty">Esperando eventos…</div>
      </div>
    </div>

    <div class="card" style="margin-top: var(--space-5);">
      <div class="card-header">
        <h2 class="section-title">Overlay de alertas (OBS)</h2>
      </div>
      <p style="margin:0;font-size:0.85rem;color:var(--text-muted);">
        Añade una <strong>Fuente de Navegador</strong> en OBS apuntando a
        <code>http://localhost:6767/overlay-tiktok</code> y posiciónala/escálala a tu gusto.
        Pulsa <strong>Probar</strong> en cualquier evento para previsualizarla.
      </p>
    </div>

    <div style="margin-top: var(--space-5);">
      <h2 class="section-title">Alertas por evento</h2>
      <p style="margin:4px 0 0;font-size:0.85rem;color:var(--text-muted);">
        Para limitar la saturación de like/entradas usa los cooldowns por evento en la vista TikTok.
      </p>
      ${ALERT_EVENTS.map(cardHtml).join("")}
    </div>
  `;

  // ── Sliders initial fill ──────────────────────────────────────────────────
  for (const m of ALERT_EVENTS) syncSlider(`evt-${m.kind}-dur`, durLabel);

  // ── Persist helper ────────────────────────────────────────────────────────
  const saveAlerts = async (): Promise<void> => {
    try {
      await invoke("set_config_cmd", {
        key: "tiktok_alerts_config",
        value: JSON.stringify(alerts),
      });
    } catch (e) {
      showToast(String(e), "error");
    }
  };

  // ── Per-card bindings ─────────────────────────────────────────────────────
  for (const m of ALERT_EVENTS) {
    const k = m.kind;
    // ensure the entry exists in the model
    alerts[k] = entryFor(k);

    const $ = (suffix: string) => document.getElementById(`evt-${k}-${suffix}`);

    $("enabled")?.addEventListener("change", (ev) => {
      alerts[k].enabled = (ev.target as HTMLInputElement).checked;
      void saveAlerts();
    });

    $("text")?.addEventListener("change", (ev) => {
      alerts[k].text = (ev.target as HTMLInputElement).value;
      void saveAlerts();
    });

    const dur = $("dur") as HTMLInputElement | null;
    dur?.addEventListener("input", () => syncSlider(`evt-${k}-dur`, durLabel));
    dur?.addEventListener("change", () => {
      alerts[k].duration_ms = Number(dur.value);
      void saveAlerts();
    });

    $("trans")?.addEventListener("change", (ev) => {
      alerts[k].transition = (ev.target as HTMLSelectElement).value;
      void saveAlerts();
    });

    $("test")?.addEventListener("click", async () => {
      try {
        await invoke("tiktok_test_alert", { eventKind: k });
      } catch (e) {
        showToast(String(e), "error");
      }
    });

    // Image upload / clear
    $("img-btn")?.addEventListener("click", () => pickAsset(k, "image"));
    $("img-clear")?.addEventListener("click", () => clearAsset(k, "image"));
    // Sound upload / clear / play
    $("sound-btn")?.addEventListener("click", () => pickAsset(k, "sound"));
    $("sound-clear")?.addEventListener("click", () => clearAsset(k, "sound"));
    $("sound-play")?.addEventListener("click", () => {
      const path = alerts[k].sound;
      if (!path) return;
      try {
        new Audio(convertFileSrc(path)).play().catch(() => {});
      } catch {
        /* noop */
      }
    });
  }

  // ── Asset upload / clear ──────────────────────────────────────────────────
  function pickAsset(kind: string, assetType: "image" | "sound"): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = assetType === "image" ? "image/png,image/jpeg,image/gif,image/webp" : "audio/mpeg,audio/ogg,audio/wav";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      try {
        const path = await invoke<string>("set_tiktok_alert_asset", {
          eventKind: kind,
          assetType,
          fileName: file.name,
          data: bytes,
        });
        alerts[kind][assetType === "image" ? "image" : "sound"] = path;
        refreshAssetUi(kind, assetType);
        showToast(`${assetType === "image" ? "Imagen" : "Sonido"} guardado`, "success");
      } catch (e) {
        showToast(String(e), "error");
      }
    };
    input.click();
  }

  async function clearAsset(kind: string, assetType: "image" | "sound"): Promise<void> {
    try {
      await invoke("clear_tiktok_alert_asset", { eventKind: kind, assetType });
      alerts[kind][assetType === "image" ? "image" : "sound"] = "";
      refreshAssetUi(kind, assetType);
    } catch (e) {
      showToast(String(e), "error");
    }
  }

  function refreshAssetUi(kind: string, assetType: "image" | "sound"): void {
    if (assetType === "image") {
      const el = document.getElementById(`evt-${kind}-img-preview`);
      if (el) {
        el.innerHTML = alerts[kind].image
          ? `<img src="${convertFileSrc(alerts[kind].image)}" alt="" style="max-width:64px;max-height:64px;border-radius:4px;object-fit:contain;"/>`
          : `<span style="color:var(--text-muted);font-size:0.8rem;">Sin imagen</span>`;
      }
    } else {
      const el = document.getElementById(`evt-${kind}-sound-name`);
      if (el) el.textContent = alerts[kind].sound ? alerts[kind].sound.split(/[\\/]/).pop()! : "Sin sonido";
    }
  }

  // ── Live feed ─────────────────────────────────────────────────────────────
  await setupFeed();
}

// =========================================================================================================
// Live feed wiring
// =========================================================================================================

async function setupFeed(): Promise<void> {
  // Detach a previous listener if the view was re-entered.
  if (feedUnlisten) {
    feedUnlisten();
    feedUnlisten = null;
  }

  const feed = document.getElementById("evt-feed");
  if (!feed) return;
  let count = 0;

  feedUnlisten = await listen<ChatEventPayload>("chat-event", (event) => {
    const p = event.payload;
    // This view is TikTok-only — ignore events from other platforms (e.g. Twitch).
    if (p.platform !== "tiktok") return;
    if (count === 0) feed.innerHTML = "";
    count++;

    const noisy = NOISY_KINDS.has(p.event_kind);
    const label = FEED_LABELS[p.event_kind] ?? p.event_kind;
    const time = new Date().toLocaleTimeString();
    const amount = p.amount != null ? `${p.amount} monedas` : "";

    const row = document.createElement("div");
    row.className = `evt-feed-row${noisy ? " evt-feed-row-noisy" : ""}`;
    row.innerHTML = `
      <span class="evt-feed-time">${time}</span>
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
