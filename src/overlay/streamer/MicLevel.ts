// =========================================================================================================
// MicLevel
// =========================================================================================================
// Microphone level meter for the streamer persona. Opens a getUserMedia stream,
// runs it through a Web Audio AnalyserNode and exposes a smoothed 0–100 level so
// the renderer can decide when the mouth is open (level > threshold).
//
// Used only by the OBS Browser Source overlay. If mic permission is denied the
// meter stays at 0 (mouth closed) instead of throwing, so the overlay never
// breaks — see the note shown in the admin panel about granting mic access.
// =========================================================================================================

export class MicLevel {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private data: Uint8Array = new Uint8Array(0);
  private smoothed = 0;
  /** True once a stream is live; false on failure (permission denied, no device). */
  private active = false;

  /**
   * (Re)starts capture on the given device. Pass an empty deviceId for the
   * system default. Safe to call repeatedly (e.g. on config change).
   */
  async start(deviceId: string): Promise<boolean> {
    await this.stop();
    try {
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false,
      };
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);

      this.ctx = new AudioContext();
      const source = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.data = new Uint8Array(this.analyser.fftSize);
      source.connect(this.analyser);

      this.active = true;
      return true;
    } catch (err) {
      console.warn("[streamer] No se pudo abrir el micrófono:", err);
      this.active = false;
      return false;
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch {
        /* already closed */
      }
      this.ctx = null;
    }
    this.analyser = null;
  }

  get isActive(): boolean {
    return this.active;
  }

  /**
   * Current smoothed level (0–100). Computes RMS over the time-domain buffer and
   * applies a short moving average so the mouth doesn't flicker between syllables.
   */
  level(): number {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.data);

    let sumSq = 0;
    for (let i = 0; i < this.data.length; i++) {
      const v = (this.data[i] - 128) / 128; // -1..1
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / this.data.length); // 0..1
    const raw = Math.min(100, rms * 200); // scale into 0..100 (speech rarely hits 0.5 RMS)

    // Asymmetric smoothing: rise fast (responsive mouth open), fall slower
    // (small "hang time" so the mouth doesn't snap shut between syllables).
    const k = raw > this.smoothed ? 0.5 : 0.15;
    this.smoothed += (raw - this.smoothed) * k;
    return this.smoothed;
  }
}
