import { peaksFromLevels } from "../elements/VoiceWave";

export interface VoiceRecording {
  blob: Blob;
  durationMs: number;
  peaks: number[];
  extension: string;
}

export type VoiceRecorderFailure = "unsupported" | "denied" | "failed";

const LEVEL_INTERVAL = 60;
const MAX_DURATION_MS = 5 * 60 * 1000;

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickMime(): string {
  const recorder = (window as unknown as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  if (!recorder?.isTypeSupported) return "";
  for (const candidate of MIME_CANDIDATES) {
    try {
      if (recorder.isTypeSupported(candidate)) return candidate;
    } catch {
      continue;
    }
  }
  return "";
}

function extensionFor(mime: string): string {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return "m4a";
  return "webm";
}

/**
 * Records one voice note from the microphone, collecting an input level trace at the
 * same time so the waveform is ready the moment the recording stops.
 */
export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private levels: number[] = [];
  private samples: Float32Array<ArrayBuffer> | null = null;
  private timer: number | null = null;
  private startedAt = 0;
  private stoppedAt = 0;
  private mimeType = "";

  get active(): boolean {
    return this.recorder !== null && this.stoppedAt === 0;
  }

  get seconds(): number {
    if (!this.startedAt) return 0;
    const end = this.stoppedAt || Date.now();
    return Math.max(0, (end - this.startedAt) / 1000);
  }

  /** Current input level, 0..1, for the dock meter. */
  level(): number {
    return this.levels.length ? this.levels[this.levels.length - 1] : 0;
  }

  /** Peaks of everything captured so far, ready to store on the element. */
  currentPeaks(target = 96): number[] {
    return peaksFromLevels(this.levels, target);
  }

  async start(): Promise<void> {
    if (this.active) return;
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw failure("unsupported");
    }
    this.stream = await media.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.mimeType = pickMime();
    const context = new AudioContext();
    this.context = context;
    const source = context.createMediaStreamSource(this.stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    this.analyser = analyser;
    this.samples = new Float32Array(analyser.fftSize);

    this.chunks = [];
    this.levels = [];
    this.recorder = this.mimeType
      ? new MediaRecorder(this.stream, { mimeType: this.mimeType })
      : new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size) this.chunks.push(event.data);
    };
    this.recorder.onerror = () => {
      this.discard();
    };
    this.recorder.start(200);

    this.startedAt = Date.now();
    this.stoppedAt = 0;
    this.timer = window.setInterval(() => this.sampleLevel(), LEVEL_INTERVAL);
  }

  private sampleLevel(): void {
    if (!this.analyser) return;
    const buffer = this.samples;
    if (!buffer) return;
    this.analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    const rms = Math.sqrt(sum / Math.max(1, buffer.length));
    this.levels.push(Math.min(1, rms * 3.4));
    if (Date.now() - this.startedAt >= MAX_DURATION_MS) void this.stop().catch(() => undefined);
  }

  async stop(): Promise<VoiceRecording> {
    const recorder = this.recorder;
    if (!recorder) throw failure("failed");
    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        resolve(new Blob(this.chunks, { type: recorder.mimeType || this.mimeType || "audio/webm" }));
      };
      recorder.onerror = () => reject(failure("failed"));
      try {
        recorder.stop();
      } catch (error) {
        reject(error instanceof Error ? error : failure("failed"));
      }
    });
    this.stoppedAt = Date.now();
    const durationMs = this.stoppedAt - this.startedAt;
    const peaks = this.currentPeaks();
    this.releaseStream();
    if (!blob.size) throw failure("failed");
    return {
      blob,
      durationMs: Math.max(200, durationMs),
      peaks: peaks.length ? peaks : [0.2],
      extension: extensionFor(this.mimeType || blob.type),
    };
  }

  cancel(): void {
    try {
      if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    } catch {
      // The stream is released below either way.
    }
    this.discard();
  }

  dispose(): void {
    this.cancel();
  }

  private discard(): void {
    this.chunks = [];
    this.releaseStream();
  }

  private releaseStream(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.recorder = null;
    this.analyser = null;
    this.samples = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.context) {
      const context = this.context;
      this.context = null;
      void context.close().catch(() => undefined);
    }
  }
}

function failure(kind: VoiceRecorderFailure): Error {
  const error = new Error(`Fieldbook: microphone ${kind}`);
  (error as Error & { voiceFailure: VoiceRecorderFailure }).voiceFailure = kind;
  return error;
}

export function voiceFailureKind(error: unknown): VoiceRecorderFailure | null {
  const value = (error as (Error & { voiceFailure?: VoiceRecorderFailure }) | null)?.voiceFailure;
  if (value) return value;
  const name = (error as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return "denied";
  }
  if (name === "NotFoundError" || name === "NotReadableError" || name === "OverconstrainedError") {
    return "failed";
  }
  return null;
}
