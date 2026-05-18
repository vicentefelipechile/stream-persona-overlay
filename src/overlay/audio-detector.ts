// =========================================================================================================
// AUDIO DETECTOR
// =========================================================================================================
// Uses the Web Audio API to monitor the default recording device (which should
// be configured as Stereo Mix / Loopback in the OS for TTS lip-sync).
// It calculates the average amplitude and triggers a callback when it exceeds
// the configured threshold, enabling real-time syllable-level lip-sync.
// =========================================================================================================

export class AudioLevelDetector {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private animFrameId: number | null = null;
  private stream: MediaStream | null = null;
  private onSpeaking: (isSpeaking: boolean) => void;

  private threshold: number = 20;
  private isRunning: boolean = false;
  private currentSpeakingState: boolean = false;

  constructor(onSpeaking: (isSpeaking: boolean) => void) {
    this.onSpeaking = onSpeaking;
  }

  setThreshold(threshold: number): void {
    this.threshold = threshold;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });

      this.context = new window.AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 256;
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      const source = this.context.createMediaStreamSource(this.stream);
      source.connect(this.analyser);

      this.isRunning = true;
      this.tick();
      console.info("[audio-detector] Started listening to microphone/loopback.");
    } catch (e) {
      console.warn("[audio-detector] Could not access microphone. Ensure 'Stereo Mix' is enabled:", e);
    }
  }

  private tick = (): void => {
    if (!this.isRunning || !this.analyser || !this.dataArray) return;

    this.analyser.getByteFrequencyData(this.dataArray);
    
    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sum += this.dataArray[i];
    }
    const avg = sum / this.dataArray.length;

    const speaking = avg > this.threshold;
    if (speaking !== this.currentSpeakingState) {
      this.currentSpeakingState = speaking;
      this.onSpeaking(speaking);
    }

    this.animFrameId = requestAnimationFrame(this.tick);
  };

  stop(): void {
    this.isRunning = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.context) {
      this.context.close();
      this.context = null;
    }
  }
}
