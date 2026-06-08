// =========================================================================================================
// Icons — centralized icon module
// =========================================================================================================
// Single source of truth for all icons used in the admin panel.
// Brand icons come from simple-icons; UI icons come from lucide.
// All consumers import from this file only — never from simple-icons or lucide directly.
// =========================================================================================================

import { siTwitch, siTiktok, siDiscord } from "simple-icons";
import {
    Settings, Users, User, List, AlertTriangle, PawPrint,
    Pencil, Play, Pause, Trash2, RefreshCw,
    Check, X, Copy, Zap, Unplug, Save, Eye, ShieldOff, ExternalLink, Bot, CircleHelp,
    Webcam, RotateCcw,
} from "lucide";
import type { IconNode } from "lucide";

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

function renderChildren(nodes: IconNode): string {
    return nodes.map(([tag, attrs]) => {
        const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ");
        return `<${tag} ${attrStr}/>`;
    }).join("");
}

function ui(icon: IconNode, size: number): string {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg">${renderChildren(icon)}</svg>`;
}

function filled(icon: IconNode, size: number): string {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg">${renderChildren(icon)}</svg>`;
}

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
    settings:      (size = 16) => ui(Settings, size),
    users:         (size = 16) => ui(Users, size),
    person:        (size = 16) => ui(User, size),
    logs:          (size = 16) => ui(List, size),
    warning:       (size = 16) => ui(AlertTriangle, size),

    // UI icons — fill-based, inherit currentColor
    paw:           (size = 16) => filled(PawPrint, size),

    // Action/button icons
    pencil:        (size = 14) => ui(Pencil, size),
    play:          (size = 14) => filled(Play, size),
    pause:         (size = 14) => ui(Pause, size),
    trash:         (size = 14) => ui(Trash2, size),
    refresh:       (size = 14) => ui(RefreshCw, size),
    check:         (size = 14) => ui(Check, size),
    close:         (size = 14) => ui(X, size),
    copy:          (size = 14) => ui(Copy, size),
    zap:           (size = 14) => filled(Zap, size),
    unplug:        (size = 14) => ui(Unplug, size),
    save:          (size = 14) => ui(Save, size),
    eye:           (size = 14) => ui(Eye, size),
    shieldOff:     (size = 14) => ui(ShieldOff, size),
    externalLink:  (size = 14) => ui(ExternalLink, size),
    bot:           (size = 14) => ui(Bot, size),
    help:          (size = 14) => ui(CircleHelp, size),
    webcam:        (size = 16) => ui(Webcam, size),
    reset:         (size = 14) => ui(RotateCcw, size),
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
    eventos:     Icons.zap,
    streamer:    Icons.webcam,
};

export function injectNavIcons(): void {
    document.querySelectorAll<HTMLElement>(".nav-icon[data-icon]").forEach(el => {
        const key = el.dataset.icon!;
        el.innerHTML = NAV_ICON_MAP[key]?.(16) ?? "";
    });
}
