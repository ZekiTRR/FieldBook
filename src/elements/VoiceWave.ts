import type { AudioElement } from "../types";

/**
 * The voice note is laid out in plain pixels rather than flex ratios so the DOM,
 * the page hit-testing and the PNG snapshot all agree on where the play button and
 * the waveform live.
 */
export const VOICE_HEIGHT = 68;
export const VOICE_MIN_WIDTH = 250;
export const VOICE_MAX_WIDTH = 900;
export const VOICE_PAD_X = 13;
export const VOICE_PLAY_SIZE = 42;
export const VOICE_GAP = 12;
export const VOICE_META_WIDTH = 76;
export const VOICE_WAVE_HEIGHT = 40;
export const VOICE_BAR_STEP = 6;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VoiceBar {
  x: number;
  top: number;
  bottom: number;
  tilt: number;
}

export function voiceParts(width: number, height = VOICE_HEIGHT): { play: Rect; wave: Rect } {
  const playX = VOICE_PAD_X;
  const playY = (height - VOICE_PLAY_SIZE) / 2;
  const waveX = playX + VOICE_PLAY_SIZE + VOICE_GAP;
  const waveW = Math.max(48, width - waveX - VOICE_META_WIDTH - VOICE_PAD_X);
  return {
    play: { x: playX, y: playY, w: VOICE_PLAY_SIZE, h: VOICE_PLAY_SIZE },
    wave: { x: waveX, y: (height - VOICE_WAVE_HEIGHT) / 2, w: waveW, h: VOICE_WAVE_HEIGHT },
  };
}

export function voiceBarCount(waveWidth: number): number {
  return Math.max(10, Math.min(140, Math.round(waveWidth / VOICE_BAR_STEP)));
}

/**
 * Peaks are stored normalised to 0..1. The per-bar tilt and offset come from the
 * element seed, so a stroke looks identical on screen, after a reload and in export.
 */
export function voiceBars(peaks: number[], seed: number, width: number): VoiceBar[] {
  const { wave } = voiceParts(width);
  const count = voiceBarCount(wave.w);
  const source = peaks.length ? peaks : [0.2];
  const mid = wave.h / 2;
  const bars: VoiceBar[] = [];
  for (let i = 0; i < count; i++) {
    const position = count === 1 ? 0 : (i / (count - 1)) * (source.length - 1);
    const low = Math.floor(position);
    const high = Math.min(source.length - 1, low + 1);
    const mix = position - low;
    const raw = source[low] * (1 - mix) + source[high] * mix;
    const amp = Math.max(0.06, Math.min(1, raw));
    const noise = pseudo(seed, i);
    const len = Math.max(3, amp * (wave.h - 6));
    bars.push({
      x: i * VOICE_BAR_STEP + 3 + (noise(0) - 0.5) * 0.8,
      top: mid - len / 2,
      bottom: mid + len / 2,
      tilt: (noise(1) - 0.5) * 1.2,
    });
  }
  return bars;
}

function pseudo(seed: number, index: number): (slot: number) => number {
  return (slot: number) => {
    const value = Math.sin((seed + index * 97 + slot * 31) * 12.9898) * 43758.5453;
    return value - Math.floor(value);
  };
}

export function formatVoiceDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function formatVoiceStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${date.toLocaleDateString("en", { day: "numeric", month: "short" })}, ${time}`;
}

/** Reduces a live level stream to the stored peaks, keeping the loudest sample per bucket. */
export function peaksFromLevels(levels: number[], target = 96): number[] {
  if (!levels.length) return [];
  const bucket = Math.max(1, Math.ceil(levels.length / target));
  const out: number[] = [];
  for (let i = 0; i < levels.length; i += bucket) {
    let peak = 0;
    for (let k = i; k < Math.min(levels.length, i + bucket); k++) peak = Math.max(peak, levels[k]);
    out.push(Math.round(Math.min(1, peak) * 100) / 100);
  }
  let loudest = 0;
  for (const value of out) loudest = Math.max(loudest, value);
  if (loudest <= 0) return out.map(() => 0.08);
  return out.map((value) => Math.round(Math.max(0.06, value / loudest) * 100) / 100);
}

export function isAudioElement(el: { type: string }): el is AudioElement {
  return el.type === "audio";
}
