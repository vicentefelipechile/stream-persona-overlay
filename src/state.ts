// =========================================================================================================
// STATE & TYPES
// =========================================================================================================
// Global state management and TypeScript interfaces.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { invoke } from "@tauri-apps/api/core";

// =========================================================================================================
// Types
// =========================================================================================================

export interface Persona {
  id: number;
  user_id: number;
  mouth_open_path: string;
  mouth_closed_path: string;
  uploaded_at: string;
}

export interface User {
  id: number;
  discord_id: string;
  display_name: string;
  twitch_username: string | null;
  tiktok_username: string | null;
  voice_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  persona: Persona | null;
}

export interface AppConfig {
  chroma_color: string;
  overlay_width: number;
  overlay_height: number;
  tts_enabled: boolean;
  twitch_channel: string;
  twitch_bot_username: string;
  twitch_bot_token: string;
  tiktok_username: string;
  discord_bot_token: string;
  discord_guild_id: string;
  discord_channel_id: string;
  /** "parallel" (default) | "queue" */
  overlay_display_mode: string;
}

export interface VoiceInfo {
  id: string;
  name: string;
}

export interface ChatMessagePayload {
  platform: string;
  username: string;
  message: string;
  user_id: number;
  display_name: string;
  mouth_open_path: string;
  mouth_closed_path: string;
  voice_id: string;
}

export interface LogEntry {
  id: number;
  platform: string;
  username: string;
  message: string;
  user_id: number | null;
  shown: boolean;
  created_at: string;
}

// =========================================================================================================
// AppState Singleton
// =========================================================================================================

class AppStateClass {
  private static instance: AppStateClass;

  public config: AppConfig = {
    chroma_color: "#00FF00",
    overlay_width: 1920,
    overlay_height: 1080,
    tts_enabled: true,
    twitch_channel: "",
    twitch_bot_username: "",
    twitch_bot_token: "",
    tiktok_username: "",
    discord_bot_token: "",
    discord_guild_id: "",
    discord_channel_id: "",
    overlay_display_mode: "parallel",
  };

  public users: User[] = [];
  public voices: VoiceInfo[] = [];
  public isConnected = false;

  public static getInstance(): AppStateClass {
    if (!AppStateClass.instance) {
      AppStateClass.instance = new AppStateClass();
    }
    return AppStateClass.instance;
  }

  async loadConfig(): Promise<void> {
    try {
      this.config = await invoke<AppConfig>("get_config_cmd");
    } catch (e) {
      console.error("Error cargando config:", e);
    }
  }

  async loadUsers(): Promise<void> {
    try {
      this.users = await invoke<User[]>("get_users");
    } catch (e) {
      console.error("Error cargando usuarios:", e);
    }
  }

  async loadVoices(): Promise<void> {
    try {
      this.voices = await invoke<VoiceInfo[]>("get_available_voices_cmd");
    } catch (e) {
      // TTS puede no estar disponible en todos los sistemas
      this.voices = [{ id: "default", name: "Voz por defecto" }];
    }
  }

  async setConfig(key: string, value: string): Promise<void> {
    await invoke("set_config_cmd", { key, value });
    await this.loadConfig();
  }
}

export const AppState = AppStateClass.getInstance();

// =========================================================================================================
// Toast Helper
// =========================================================================================================

let toastContainer: HTMLElement | null = null;

function getToastContainer(): HTMLElement {
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "toast-container";
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function showToast(
  message: string,
  type: "success" | "error" | "info" = "success",
  duration = 3000
): void {
  const container = getToastContainer();
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
