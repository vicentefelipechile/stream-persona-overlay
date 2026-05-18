import { convertFileSrc } from "@tauri-apps/api/core";
import { User } from "../state";

// =========================================================================================================
// PERSONA CARD COMPONENT
// =========================================================================================================
// Renders a self-contained card for a single User, showing their avatar,
// platform badges, voice, and action buttons.
//
// Usage:
//   import { createPersonaCard } from "../components/persona-card";
//   const card = createPersonaCard(user, voices, { onToggle, onDelete, onEdit, onPreview });
//   container.appendChild(card);
// =========================================================================================================

// =========================================================================================================
// Types
// =========================================================================================================

export interface PersonaCardCallbacks {
  onToggle:  (userId: number) => Promise<void>;
  onDelete:  (userId: number, displayName: string) => Promise<void>;
  onEdit:    (user: User) => void;
  onPreview: (user: User) => Promise<void>;
}

/**
 * Creates and returns a fully wired <div class="persona-card"> element.
 */
export function createPersonaCard(
  user: User,
  callbacks: PersonaCardCallbacks
): HTMLElement {
  const card = document.createElement("div");
  card.className = "persona-card";
  card.dataset.userId = String(user.id);

  // =========================================================================================================
  // Avatar
  // =========================================================================================================
  const avatarEl = document.createElement("div");
  avatarEl.className = "persona-card-avatar";

  if (user.persona) {
    const img = document.createElement("img");
    img.src = convertFileSrc(user.persona.mouth_closed_path);
    img.alt = user.display_name;
    img.onerror = () => {
      img.style.display = "none";
      placeholder.style.display = "flex";
    };
    const placeholder = document.createElement("div");
    placeholder.className = "avatar-placeholder";
    placeholder.textContent = "👤";
    placeholder.style.display = "none";
    avatarEl.appendChild(img);
    avatarEl.appendChild(placeholder);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "avatar-placeholder";
    placeholder.textContent = "👤";
    avatarEl.appendChild(placeholder);
  }

  // =========================================================================================================
  // Info
  // =========================================================================================================
  const infoEl = document.createElement("div");
  infoEl.className = "persona-card-info";

  const nameEl = document.createElement("div");
  nameEl.className = "user-name";
  nameEl.textContent = user.display_name;

  const discordEl = document.createElement("div");
  discordEl.className = "user-discord mono";
  discordEl.textContent = user.discord_id;

  const badgesEl = document.createElement("div");
  badgesEl.className = "persona-card-badges";
  if (user.twitch_username) {
    const b = document.createElement("span");
    b.className = "badge badge-twitch";
    b.textContent = user.twitch_username;
    badgesEl.appendChild(b);
  }
  if (user.tiktok_username) {
    const b = document.createElement("span");
    b.className = "badge badge-tiktok";
    b.textContent = `@${user.tiktok_username}`;
    badgesEl.appendChild(b);
  }

  const voiceEl = document.createElement("div");
  voiceEl.className = "text-mono";
  voiceEl.style.fontSize = "12px";
  voiceEl.style.color = "var(--color-text-muted)";
  voiceEl.textContent = `🔊 ${user.voice_id}`;

  const statusEl = document.createElement("span");
  statusEl.className = `badge ${user.is_active ? "badge-active" : "badge-inactive"}`;
  statusEl.textContent = user.is_active ? "Active" : "Inactive";

  infoEl.appendChild(nameEl);
  infoEl.appendChild(discordEl);
  infoEl.appendChild(badgesEl);
  infoEl.appendChild(voiceEl);
  infoEl.appendChild(statusEl);

  // =========================================================================================================
  // Actions
  // =========================================================================================================
  const actionsEl = document.createElement("div");
  actionsEl.className = "persona-card-actions";

  const btnEdit = makeButton("✎", "btn-secondary btn-sm", "Edit");
  btnEdit.addEventListener("click", () => callbacks.onEdit(user));

  const btnPreview = makeButton("▶", "btn-outline btn-sm", "Preview in overlay");
  btnPreview.addEventListener("click", () => callbacks.onPreview(user));

  const btnToggle = makeButton(
    user.is_active ? "⏸" : "▶",
    "btn-secondary btn-sm",
    user.is_active ? "Deactivate" : "Activate"
  );
  btnToggle.addEventListener("click", () => callbacks.onToggle(user.id));

  const btnDelete = makeButton("✕", "btn-danger btn-sm", "Delete");
  btnDelete.addEventListener("click", () =>
    callbacks.onDelete(user.id, user.display_name)
  );

  actionsEl.appendChild(btnEdit);
  actionsEl.appendChild(btnPreview);
  actionsEl.appendChild(btnToggle);
  actionsEl.appendChild(btnDelete);

  card.appendChild(avatarEl);
  card.appendChild(infoEl);
  card.appendChild(actionsEl);

  return card;
}

// =========================================================================================================
// Helpers
// =========================================================================================================

function makeButton(label: string, classes: string, title: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = `btn ${classes}`;
  btn.textContent = label;
  btn.title = title;
  return btn;
}
