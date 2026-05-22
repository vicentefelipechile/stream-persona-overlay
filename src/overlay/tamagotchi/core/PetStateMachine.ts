// =========================================================================================================
// PET STATE MACHINE
// =========================================================================================================
// FSM for a single tamagotchi pet. Tracks state transitions and fires
// onEnter callbacks so BasePet can react (start walking, start sleeping, etc.)
// =========================================================================================================

export type PetState =
  | "spawning"    // Initial spawn animation playing
  | "idle"        // Walking left/right on the floor
  | "approaching" // Moving toward camera because user spoke in chat
  | "talking"     // At front of screen, lip-sync active
  | "action"      // Executing a special action (jump, dance, etc.)
  | "returning"   // Moving back to floor after talking
  | "sleeping"    // Inactive due to inactivity timeout
  | "despawning"; // Fade-out animation, then DOM removal

export const VALID_TRANSITIONS: Record<PetState, PetState[]> = {
  spawning:    ["idle"],
  idle:        ["approaching", "action", "sleeping", "despawning"],
  approaching: ["talking"],
  talking:     ["returning"],
  returning:   ["idle"],
  action:      ["idle"],
  sleeping:    ["idle", "despawning"],
  despawning:  [],
};

export class PetStateMachine {
  private current: PetState = "spawning";
  private listeners = new Map<PetState, Array<() => void>>();

  get state(): PetState { return this.current; }

  transition(next: PetState): boolean {
    const allowed = VALID_TRANSITIONS[this.current];
    if (!allowed.includes(next)) {
      console.warn(`[PetFSM] Invalid: ${this.current} -> ${next}`);
      return false;
    }
    this.current = next;
    this.listeners.get(next)?.forEach(fn => fn());
    return true;
  }

  onEnter(state: PetState, fn: () => void): void {
    if (!this.listeners.has(state)) this.listeners.set(state, []);
    this.listeners.get(state)!.push(fn);
  }

  canDo(state: PetState): boolean {
    return VALID_TRANSITIONS[this.current].includes(state);
  }
}
