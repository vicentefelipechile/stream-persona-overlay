import { listen } from "@tauri-apps/api/event";
import { PetManager } from "./core/PetManager";
import type { ChatEventPayload } from "../../state";

export async function setupEventReactions(): Promise<void> {
  try {
    await listen<ChatEventPayload>("chat-event", (event) => {
      onChatEvent(event.payload);
    });
    console.log("[eventReactions] Escuchador chat-event configurado");
  } catch (e) {
    console.error("[eventReactions] Error configurando escuchador:", e);
  }
}

const ACTION_MAP: Record<string, string> = {
  cheer:             "jump",
  sub:               "dance",
  gift_sub:          "popcorn",
  follow:            "jump",
  redemption:        "dance",
  tiktok_gift_big:   "explode",
  tiktok_gift:       "jump",
  tiktok_like:       "jump",
  tiktok_share:      "jump",
  tiktok_subscribe:  "dance",
  tiktok_envelope:   "explode",
};

function onChatEvent(payload: ChatEventPayload): void {
  const { event_kind, user_id } = payload;

  // All-pet events: trigger on a random pet
  if (event_kind === "raid" || event_kind === "hype_train") {
    const pet = PetManager.getRandomPet(-1);
    if (pet) pet.executeAction("jump").catch(() => {});
    return;
  }

  if (user_id !== null && user_id !== undefined) {
    const pet = PetManager.get(user_id);
    if (!pet) return;
    const action = ACTION_MAP[event_kind] ?? "jump";
    pet.executeAction(action).catch(() => {});
  }
}
