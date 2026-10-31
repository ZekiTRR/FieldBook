import { App } from "obsidian";
import type { PluginSettings, SoundCategory } from "../types";

// pencil.wav is a trimmed loop of BigSoundBank "Pencil #1" by Joseph SARDIN (CC0).
const BUNDLED_SOUNDS: Partial<Record<SoundCategory, string>> = {
  page: "assets/page-turn.mp3",
  writing: "assets/pencil.wav",
};

/**
 * Small procedural sound engine with optional recorded sounds. The notebook
 * never makes noise unless the user has explicitly enabled sound in settings.
 */
export class AudioManager {
  private app: App;
  private settings: PluginSettings;
  private pluginDir: string;
  private context: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private customCache = new Map<string, HTMLAudioElement>();
  private defaultCache = new Map<string, HTMLAudioElement>();
  private lastWritingAt = 0;
  private lastStrokeAt = 0;
  private lastTypingAt = 0;
  private writingBuffer: AudioBuffer | null = null;
  private writingBufferPath = "";
  private writingBufferLoading: Promise<void> | null = null;
  private writingBufferFailedAt = 0;
  private writingVoice: {
    source: AudioBufferSourceNode;
    gain: GainNode;
    filter: BiquadFilterNode;
  } | null = null;
  private writingStop: number | null = null;

  constructor(app: App, settings: PluginSettings, pluginDir = "") {
    this.app = app;
    this.settings = settings;
    this.pluginDir = pluginDir.replace(/\\/g, "/").replace(/\/+$/, "");
  }

  updateSettings(settings: PluginSettings): void {
    const previousWritingPath = this.writingPath();
    this.settings = settings;
    if (!settings.soundEnabled || this.writingPath() !== previousWritingPath) {
      this.stopWritingVoice(true);
    }
  }

  unlock(): void {
    if (!this.settings.soundEnabled) return;
    const context = this.ensureContext();
    if (context && context.state === "suspended") void context.resume();
    this.defaultFile("page");
    this.ensureWritingBuffer();
  }

  setEnabled(enabled: boolean): void {
    this.settings.soundEnabled = enabled;
    if (!enabled) {
      this.stopWritingVoice(true);
      this.context?.suspend();
      for (const audio of this.customCache.values()) audio.pause();
      for (const audio of this.defaultCache.values()) audio.pause();
    } else {
      this.unlock();
    }
  }

  private ensureContext(): AudioContext | null {
    if (!this.settings.soundEnabled) return null;
    if (!this.context) {
      const Ctor = window.AudioContext;
      if (!Ctor) return null;
      this.context = new Ctor();
    }
    if (this.context.state === "suspended") void this.context.resume();
    return this.context;
  }

  private getNoise(context: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.floor(context.sampleRate * 1.4);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }

  private volumeFor(category: SoundCategory): number {
    const categoryVolume = this.settings.soundVolumes[category] ?? 0.5;
    return Math.max(0, Math.min(1, this.settings.masterVolume * categoryVolume));
  }

  private elementFor(path: string, cache: Map<string, HTMLAudioElement>): HTMLAudioElement | null {
    const clean = path.trim();
    if (!clean) return null;
    const cached = cache.get(clean);
    if (cached) return cached;
    try {
      const audio = new Audio(this.app.vault.adapter.getResourcePath(clean));
      audio.preload = "auto";
      cache.set(clean, audio);
      try {
        audio.load();
      } catch {
        /* some environments load lazily */
      }
      return audio;
    } catch {
      return null;
    }
  }

  private customFile(category: SoundCategory): HTMLAudioElement | null {
    return this.elementFor(this.settings.customSounds[category] ?? "", this.customCache);
  }

  private defaultFile(category: SoundCategory): HTMLAudioElement | null {
    const asset = BUNDLED_SOUNDS[category];
    if (!asset || !this.pluginDir) return null;
    return this.elementFor(`${this.pluginDir}/${asset}`, this.defaultCache);
  }

  private writingPath(): string {
    const custom = (this.settings.customSounds.writing ?? "").trim();
    if (custom) return custom;
    if (!this.pluginDir) return "";
    return `${this.pluginDir}/${BUNDLED_SOUNDS.writing}`;
  }

  /** Returns the decoded pencil loop, `undefined` while loading, or null if unavailable. */
  private ensureWritingBuffer(): AudioBuffer | null | undefined {
    const path = this.writingPath();
    if (!path) return null;
    if (path !== this.writingBufferPath) {
      this.writingBufferPath = path;
      this.writingBuffer = null;
      this.writingBufferLoading = null;
      this.writingBufferFailedAt = 0;
    }
    if (this.writingBuffer) return this.writingBuffer;
    if (this.writingBufferLoading) return undefined;
    if (Date.now() - this.writingBufferFailedAt < 20000) return null;
    const context = this.ensureContext();
    if (!context) return null;
    this.writingBufferLoading = (async () => {
      try {
        let data: ArrayBuffer;
        try {
          data = await this.app.vault.adapter.readBinary(path);
        } catch {
          const url = this.app.vault.adapter.getResourcePath(path);
          const response = await fetch(url);
          if (!response.ok) throw new Error(`status ${response.status}`);
          data = await response.arrayBuffer();
        }
        const buffer = await context.decodeAudioData(data);
        if (this.writingBufferPath === path) this.writingBuffer = buffer;
      } catch {
        if (this.writingBufferPath === path) this.writingBufferFailedAt = Date.now();
      } finally {
        if (this.writingBufferPath === path) this.writingBufferLoading = null;
      }
    })();
    return undefined;
  }

  private playElement(audio: HTMLAudioElement, volume: number, stopAfter = 0, fallback?: () => void): void {
    try {
      const clone = audio.cloneNode(true) as HTMLAudioElement;
      clone.volume = Math.max(0, Math.min(1, volume));
      clone.preload = "auto";
      const promise = clone.play();
      if (stopAfter > 0) {
        window.setTimeout(() => {
          try {
            clone.pause();
          } catch {
            /* the element may already have ended */
          }
        }, stopAfter);
      }
      if (promise) {
        void promise.catch(() => {
          try {
            clone.pause();
          } catch {
            /* ignore */
          }
          fallback?.();
        });
      }
    } catch {
      fallback?.();
    }
  }

  play(category: SoundCategory): void {
    if (!this.settings.soundEnabled) return;
    const volume = this.volumeFor(category);
    const custom = this.customFile(category);
    if (custom) {
      this.playElement(custom, volume, 0, () => {
        const bundled = this.defaultFile(category);
        if (bundled) {
          this.playElement(bundled, volume, 0, () => this.playProcedural(category, volume));
        } else {
          this.playProcedural(category, volume);
        }
      });
      return;
    }
    const bundled = this.defaultFile(category);
    if (bundled) {
      this.playElement(bundled, volume, 0, () => this.playProcedural(category, volume));
      return;
    }
    this.playProcedural(category, volume);
  }

  private playProcedural(category: SoundCategory, volume: number): void {
    const context = this.ensureContext();
    if (!context) return;
    switch (category) {
      case "page":
        this.paperFlip(context, volume);
        break;
      case "tabs":
        this.tabClick(context, volume);
        break;
      case "objects":
        this.objectMove(context, volume);
        break;
      case "ui":
        this.tick(context, volume);
        break;
      case "writing":
        this.scratch(context, volume, 0.9);
        break;
    }
  }

  /** A soft contact sound when the pen first touches the paper. */
  playPenDown(): void {
    if (!this.settings.soundEnabled) return;
    const now = performance.now();
    if (now - this.lastWritingAt < 40) return;
    this.lastWritingAt = now;
    const volume = this.volumeFor("writing");
    if (volume <= 0.001) return;
    const context = this.ensureContext();
    if (!context) return;
    const buffer = this.ensureWritingBuffer();
    if (buffer === undefined) return;
    if (buffer === null) {
      const recorded = this.customFile("writing");
      if (recorded) {
        this.playElement(recorded, volume * 0.9, 0, () => this.scratch(context, volume * 1.15, 1));
      } else {
        this.scratch(context, volume * 1.15, 1);
      }
      return;
    }
    this.startWritingVoice(context, buffer, 0.55, volume * 1.05);
  }

  /**
   * Continuous paper scratch while a stroke moves. `intensity` is the
   * normalised pointer speed, so slow lines whisper and fast strokes rasp.
   */
  continueWriting(intensity = 0.5): void {
    if (!this.settings.soundEnabled) return;
    const now = performance.now();
    if (now - this.lastStrokeAt < 42) return;
    this.lastStrokeAt = now;
    const volume = this.volumeFor("writing");
    if (volume <= 0.001) return;
    const context = this.ensureContext();
    if (!context) return;
    const buffer = this.ensureWritingBuffer();
    if (buffer === undefined) return;
    if (buffer === null) {
      this.scratch(context, volume * (0.55 + Math.min(1, Math.max(0, intensity)) * 0.7), intensity);
      return;
    }
    this.startWritingVoice(context, buffer, intensity, volume);
  }

  private startWritingVoice(
    context: AudioContext,
    buffer: AudioBuffer,
    intensity: number,
    volume: number,
  ): void {
    if (this.writingVoice) {
      this.updateWritingVoice(context, intensity, volume);
      return;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 9500;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(context.currentTime, Math.random() * Math.max(0, buffer.duration - 0.3));
    this.writingVoice = { source, gain, filter };
    this.updateWritingVoice(context, intensity, volume);
  }

  private updateWritingVoice(context: AudioContext, intensity: number, volume: number): void {
    const voice = this.writingVoice;
    if (!voice) return;
    const speed = Math.min(1, Math.max(0, intensity));
    const now = context.currentTime;
    const target = Math.max(0.0001, volume * (0.72 + speed * 0.6));
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(target, now, 0.02);
    voice.source.playbackRate.setTargetAtTime(0.9 + speed * 0.2, now, 0.06);
    voice.filter.frequency.setTargetAtTime(7600 + speed * 2600, now, 0.06);
    if (this.writingStop !== null) window.clearTimeout(this.writingStop);
    this.writingStop = window.setTimeout(() => this.stopWritingVoice(), 150);
  }

  private stopWritingVoice(immediate = false): void {
    if (this.writingStop !== null) {
      window.clearTimeout(this.writingStop);
      this.writingStop = null;
    }
    const voice = this.writingVoice;
    if (!voice) return;
    this.writingVoice = null;
    try {
      if (immediate) {
        voice.source.stop();
      } else {
        const now = voice.gain.context.currentTime;
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(0.0001, now, 0.03);
        voice.source.stop(now + 0.15);
      }
    } catch {
      /* the source may already have stopped */
    }
  }

  /** Typing sound for keyboard text entry; obeys its own on/off switch. */
  playTyping(): void {
    if (!this.settings.soundEnabled || !this.settings.typingSoundEnabled) return;
    const now = performance.now();
    if (now - this.lastTypingAt < 26) return;
    this.lastTypingAt = now;
    const volume = this.volumeFor("writing");
    if (volume <= 0.001) return;
    const recorded = this.customFile("writing");
    if (recorded) {
      this.playElement(recorded, volume * 0.8, 170, () => {
        const context = this.ensureContext();
        if (context) this.typeClick(context, volume);
      });
      return;
    }
    const context = this.ensureContext();
    if (!context) return;
    this.typeClick(context, volume);
  }

  private paperFlip(context: AudioContext, volume: number): void {
    const now = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = this.getNoise(context);
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2800, now);
    filter.frequency.exponentialRampToValueAtTime(600, now + 0.42);
    filter.Q.value = 0.7;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22 * volume, now + 0.045);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(now);
    source.stop(now + 0.52);

    const rustle = context.createBufferSource();
    rustle.buffer = this.getNoise(context);
    const highpass = context.createBiquadFilter();
    highpass.type = "bandpass";
    highpass.frequency.value = 1500;
    highpass.Q.value = 0.6;
    const rustleGain = context.createGain();
    rustleGain.gain.setValueAtTime(0.0001, now + 0.12);
    rustleGain.gain.exponentialRampToValueAtTime(0.05 * volume, now + 0.2);
    rustleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.46);
    rustle.connect(highpass).connect(rustleGain).connect(context.destination);
    rustle.start(now + 0.1);
    rustle.stop(now + 0.48);
  }

  private tabClick(context: AudioContext, volume: number): void {
    const now = context.currentTime;
    const osc = context.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.09);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.08 * volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    osc.connect(gain).connect(context.destination);
    osc.start(now);
    osc.stop(now + 0.12);
    this.rub(context, now, 0.09, 900, volume * 0.14);
  }

  private objectMove(context: AudioContext, volume: number): void {
    const now = context.currentTime;
    this.rub(context, now, 0.16, 1800, volume * 0.12);
    const osc = context.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(95, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.13);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.05 * volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(gain).connect(context.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  private tick(context: AudioContext, volume: number): void {
    const now = context.currentTime;
    const osc = context.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.04);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.03 * volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    osc.connect(gain).connect(context.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  private scratch(context: AudioContext, volume: number, intensity = 1): void {
    const now = context.currentTime;
    const strength = 0.55 + Math.min(1, Math.max(0.15, intensity)) * 0.45;
    const source = context.createBufferSource();
    source.buffer = this.getNoise(context);
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 2400 + Math.random() * 1900;
    filter.Q.value = 0.9;
    const gain = context.createGain();
    const duration = 0.075 + Math.random() * 0.045;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.17 * volume * strength, now + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(now);
    source.stop(now + duration + 0.01);

    const body = context.createBufferSource();
    body.buffer = this.getNoise(context);
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 760 + Math.random() * 320;
    const bodyGain = context.createGain();
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.045 * volume * strength, now + 0.016);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.02);
    body.connect(lowpass).connect(bodyGain).connect(context.destination);
    body.start(now);
    body.stop(now + duration + 0.03);
  }

  private typeClick(context: AudioContext, volume: number): void {
    const now = context.currentTime;
    const duration = 0.045 + Math.random() * 0.02;
    const source = context.createBufferSource();
    source.buffer = this.getNoise(context);
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 3200 + Math.random() * 2300;
    filter.Q.value = 1.4;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.075 * volume, now + 0.007);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(now);
    source.stop(now + duration + 0.01);

    const thump = context.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(150 + Math.random() * 40, now);
    const thumpGain = context.createGain();
    thumpGain.gain.setValueAtTime(0.02 * volume, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    thump.connect(thumpGain).connect(context.destination);
    thump.start(now);
    thump.stop(now + 0.05);
  }

  private rub(context: AudioContext, at: number, duration: number, frequency: number, volume: number): void {
    const source = context.createBufferSource();
    source.buffer = this.getNoise(context);
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = 0.8;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), at + duration * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(at);
    source.stop(at + duration + 0.02);
  }

  dispose(): void {
    this.stopWritingVoice(true);
    this.writingBuffer = null;
    this.writingBufferLoading = null;
    if (this.context) {
      void this.context.close();
      this.context = null;
    }
    this.customCache.clear();
    this.defaultCache.clear();
  }
}
