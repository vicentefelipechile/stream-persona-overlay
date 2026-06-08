// =========================================================================================================
// BlinkScheduler
// =========================================================================================================
// Timestamp-based blink state machine. It does NOT recompute a schedule or roll
// random numbers every frame. It only stores the single next transition time
// (`nextAt`); each frame compares `now` against it. When crossed, it flips the
// eye state and computes ONE next transition, starting from where the previous
// one ended:
//
//   v = t0
//   OOOOOO XX OOOOOO XX OOOOOO ...
//          ^ blink (eyes closed, lasts durationMs)
//   O = eyes open during intervalMs
//
// Robustness: if a frame is delayed a lot, it flips once and moves on — it does
// not try to "catch up" missed blinks.
// =========================================================================================================

export type EyeState = "open" | "closed";

export class BlinkScheduler {
  private eyeState: EyeState = "open";
  /** performance.now() timestamp of the next state change — the only value consulted per frame. */
  private nextAt = 0;

  constructor(
    private intervalMs: number,
    private durationMs: number,
  ) {}

  /** Marks t0 and computes the first blink point once. */
  start(now: number): void {
    this.eyeState = "open";
    this.nextAt = now + this.intervalMs;
  }

  /** Called every frame. Only compares `now` against the stored target. */
  tick(now: number): EyeState {
    if (now >= this.nextAt) {
      if (this.eyeState === "open") {
        this.eyeState = "closed";
        this.nextAt = now + this.durationMs; // blink lasts durationMs
      } else {
        this.eyeState = "open";
        this.nextAt = now + this.intervalMs; // resume FROM where the blink ended
      }
    }
    return this.eyeState;
  }

  /**
   * Applies new timing live without rebuilding the clock. If the new interval
   * pulls the next "open → closed" transition into the past, re-anchor it from
   * `now` so the change feels immediate but the machine never stalls.
   */
  setTiming(intervalMs: number, durationMs: number, now: number): void {
    this.intervalMs = intervalMs;
    this.durationMs = durationMs;
    if (this.eyeState === "open") {
      this.nextAt = now + intervalMs;
    } else {
      this.nextAt = now + durationMs;
    }
  }

  get state(): EyeState {
    return this.eyeState;
  }
}
