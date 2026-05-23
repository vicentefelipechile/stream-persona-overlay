// =========================================================================================================
// Icons — centralized icon module
// =========================================================================================================
// Single source of truth for all icons used in the admin panel.
// Brand icons come from simple-icons; UI icons are inline SVG paths.
// All consumers import from this file only — never from simple-icons directly.
// =========================================================================================================

import { siTwitch, siTiktok, siDiscord } from "simple-icons";

// =========================================================================================================
// Private helpers
// =========================================================================================================

function brand(icon: { svg: string; hex: string }, size: number): string {
    return icon.svg.replace(
        "<svg ",
        `<svg width="${size}" height="${size}" style="fill:#${icon.hex};flex-shrink:0;vertical-align:middle;" `,
    );
}

function brandMono(icon: { svg: string }, size: number): string {
    return icon.svg.replace(
        "<svg ",
        `<svg width="${size}" height="${size}" style="fill:currentColor;flex-shrink:0;vertical-align:middle;" `,
    );
}

function ui(paths: string, size: number): string {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
}

function filled(paths: string, size: number): string {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
}

// =========================================================================================================
// SVG path data for UI icons
// =========================================================================================================

const P = {
    settings:
        `<circle cx="12" cy="12" r="3"/>` +
        `<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
    users:
        `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>` +
        `<circle cx="9" cy="7" r="4"/>` +
        `<path d="M23 21v-2a4 4 0 0 0-3-3.87"/>` +
        `<path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
    person:
        `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>` +
        `<circle cx="12" cy="7" r="4"/>`,
    logs:
        `<line x1="8" y1="6" x2="21" y2="6"/>` +
        `<line x1="8" y1="12" x2="21" y2="12"/>` +
        `<line x1="8" y1="18" x2="21" y2="18"/>` +
        `<line x1="3" y1="6" x2="3.01" y2="6"/>` +
        `<line x1="3" y1="12" x2="3.01" y2="12"/>` +
        `<line x1="3" y1="18" x2="3.01" y2="18"/>`,
    warning:
        `<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>` +
        `<line x1="12" y1="9" x2="12" y2="13"/>` +
        `<line x1="12" y1="17" x2="12.01" y2="17"/>`,
    paw:
        `<path d="M12 14c-3.3 0-6 1.8-6 4 0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2 0-2.2-2.7-4-6-4z"/>` +
        `<circle cx="6.5" cy="9.5" r="2.5"/>` +
        `<circle cx="17.5" cy="9.5" r="2.5"/>` +
        `<circle cx="10" cy="5.5" r="2.5"/>` +
        `<circle cx="14" cy="5.5" r="2.5"/>`,
    pencil:
        `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>` +
        `<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`,
    play:
        `<polygon points="5 3 19 12 5 21 5 3"/>`,
    pause:
        `<rect x="6" y="4" width="4" height="16"/>` +
        `<rect x="14" y="4" width="4" height="16"/>`,
    trash:
        `<polyline points="3 6 5 6 21 6"/>` +
        `<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>` +
        `<path d="M10 11v6"/>` +
        `<path d="M14 11v6"/>` +
        `<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>`,
    refresh:
        `<polyline points="23 4 23 10 17 10"/>` +
        `<polyline points="1 20 1 14 7 14"/>` +
        `<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>`,
} as const;

// =========================================================================================================
// Public icon catalog
// =========================================================================================================

export const Icons = {
    // Brand icons — colored (official brand color)
    twitch:        (size = 16) => brand(siTwitch, size),
    tiktok:        (size = 16) => brand(siTiktok, size),
    discord:       (size = 16) => brand(siDiscord, size),

    // Brand icons — monochrome (inherits currentColor, used in nav where active/hover states apply)
    twitchMono:    (size = 16) => brandMono(siTwitch, size),
    tiktokMono:    (size = 16) => brandMono(siTiktok, size),
    discordMono:   (size = 16) => brandMono(siDiscord, size),

    // UI icons — stroke-based, inherit currentColor
    settings:      (size = 16) => ui(P.settings, size),
    users:         (size = 16) => ui(P.users, size),
    person:        (size = 16) => ui(P.person, size),
    logs:          (size = 16) => ui(P.logs, size),
    warning:       (size = 16) => ui(P.warning, size),

    // UI icons — fill-based, inherit currentColor
    paw:           (size = 16) => filled(P.paw, size),

    // Action/button icons
    pencil:        (size = 14) => ui(P.pencil, size),
    play:          (size = 14) => filled(P.play, size),
    pause:         (size = 14) => ui(P.pause, size),
    trash:         (size = 14) => ui(P.trash, size),
    refresh:       (size = 14) => ui(P.refresh, size),
} as const;

// =========================================================================================================
// Nav icon injection
// =========================================================================================================

// Map from data-icon attribute values to icon functions (mono brand + UI icons for the sidebar).
const NAV_ICON_MAP: Record<string, (size?: number) => string> = {
    twitch:      Icons.twitchMono,
    tiktok:      Icons.tiktokMono,
    config:      Icons.settings,
    users:       Icons.users,
    logs:        Icons.logs,
    tamagotchi:  Icons.paw,
};

export function injectNavIcons(): void {
    document.querySelectorAll<HTMLElement>(".nav-icon[data-icon]").forEach(el => {
        const key = el.dataset.icon!;
        el.innerHTML = NAV_ICON_MAP[key]?.(16) ?? "";
    });
}
