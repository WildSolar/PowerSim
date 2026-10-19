/**
 * Sound: the effects (sfx.ts) and the ambient music (music.ts), all made in the browser with the
 * Web Audio API — no recordings, nothing to license. This module owns the audio context, the
 * player's settings (kept in this browser, not in saves) and the mix: a bus for the music and one
 * for the effects, and a shared reverb.
 *
 * Browsers only allow sound after the player has done something, so the context is made on the
 * first click or key press; nothing ever plays on load. Music is off until the player turns it on.
 */

import { hasModifier, isTypingTarget } from "../ui/keyboard";

export interface SoundSettings {
  music: boolean;
  /** 0–1. */
  musicVolume: number;
  effects: boolean;
  /** 0–1. */
  effectsVolume: number;
  /** Everything off at once (the M key), the rest kept as set. */
  muted: boolean;
}

const STORAGE_KEY = "commune-zero.sound";
const DEFAULTS: SoundSettings = { music: false, musicVolume: 0.5, effects: true, effectsVolume: 0.5, muted: false };
// The loudest each bus gets at full volume: both sit well under the game's own attention.
const MUSIC_LEVEL = 0.8;
const EFFECTS_LEVEL = 1;
// How far the music dips while something wants attention (the Year in Review).
const DUCKED = 0.35;

function load(): SoundSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SoundSettings>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

/** A short room for the bells and pings to ring out in: decaying noise, made once. */
function makeImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }
  return buffer;
}

export interface AudioGraph {
  ctx: AudioContext;
  /** Into the music's volume. */
  music: AudioNode;
  /** Into the effects' volume. */
  effects: AudioNode;
  /** The reverb, for the music (it comes out on the music's bus). */
  musicReverb: AudioNode;
  /** The reverb, for the effects. */
  effectsReverb: AudioNode;
}

class Sound {
  private settings = load();
  private readonly listeners = new Set<() => void>();
  private graph: AudioGraph | null = null;
  private musicGain: GainNode | null = null;
  private effectsGain: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private ducked = false;
  private started = false;
  private musicListener: ((on: boolean) => void) | null = null;

  /** Waits for the first click or key press, then sets up the audio (and the M key). */
  init(): void {
    if (this.started) return;
    this.started = true;
    const unlock = () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      this.ensure();
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() !== "m" || hasModifier(e) || isTypingTarget(e.target) || e.repeat) return;
      this.set({ muted: !this.settings.muted });
    });
  }

  get(): SoundSettings {
    return this.settings;
  }

  set(patch: Partial<SoundSettings>): void {
    this.settings = { ...this.settings, ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Not kept: the settings still apply for this visit.
    }
    this.applyLevels();
    this.musicListener?.(this.musicOn());
    this.listeners.forEach((l) => l());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Whether the music should be playing now. */
  musicOn(): boolean {
    return this.settings.music && !this.settings.muted && this.settings.musicVolume > 0;
  }

  effectsOn(): boolean {
    return this.settings.effects && !this.settings.muted && this.settings.effectsVolume > 0;
  }

  /** music.ts: told when the music should start or stop. */
  onMusicChange(listener: (on: boolean) => void): void {
    this.musicListener = listener;
    if (this.graph) listener(this.musicOn());
  }

  /** The music dips (the Year in Review is open) or comes back. */
  duck(on: boolean): void {
    this.ducked = on;
    if (!this.graph || !this.duckGain) return;
    const t = this.graph.ctx.currentTime;
    this.duckGain.gain.cancelScheduledValues(t);
    this.duckGain.gain.setTargetAtTime(on ? DUCKED : 1, t, 0.4);
  }

  /** The audio graph, made on first use once the player has interacted; null before that. */
  ensure(): AudioGraph | null {
    if (this.graph) {
      if (this.graph.ctx.state === "suspended") void this.graph.ctx.resume();
      return this.graph;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 3;
    compressor.connect(ctx.destination);

    this.musicGain = ctx.createGain();
    this.duckGain = ctx.createGain();
    this.effectsGain = ctx.createGain();
    this.musicGain.gain.value = 0;
    this.effectsGain.gain.value = 0;
    this.duckGain.gain.value = this.ducked ? DUCKED : 1;
    this.musicGain.connect(this.duckGain).connect(compressor);
    this.effectsGain.connect(compressor);

    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(ctx, 3.2);
    const musicWet = ctx.createGain();
    musicWet.gain.value = 0.5;
    const effectsWet = ctx.createGain();
    effectsWet.gain.value = 0.25;
    // One reverb, fed from both buses and returned to each: the music's tail stays in the music's
    // volume, the effects' in the effects'.
    const musicSend = ctx.createGain();
    const effectsSend = ctx.createGain();
    const musicReverb = ctx.createConvolver();
    musicReverb.buffer = reverb.buffer;
    musicSend.connect(musicReverb).connect(musicWet).connect(this.musicGain);
    effectsSend.connect(reverb).connect(effectsWet).connect(this.effectsGain);

    this.graph = { ctx, music: this.musicGain, effects: this.effectsGain, musicReverb: musicSend, effectsReverb: effectsSend };
    this.applyLevels();
    this.musicListener?.(this.musicOn());
    return this.graph;
  }

  private applyLevels(): void {
    if (!this.graph || !this.musicGain || !this.effectsGain) return;
    const t = this.graph.ctx.currentTime;
    // Volume heard roughly follows the square of the slider.
    const music = this.musicOn() ? MUSIC_LEVEL * this.settings.musicVolume ** 2 : 0;
    const effects = this.effectsOn() ? EFFECTS_LEVEL * this.settings.effectsVolume ** 2 : 0;
    this.musicGain.gain.cancelScheduledValues(t);
    this.musicGain.gain.setTargetAtTime(music, t, music > 0 ? 0.8 : 0.3);
    this.effectsGain.gain.cancelScheduledValues(t);
    this.effectsGain.gain.setTargetAtTime(effects, t, 0.02);
  }
}

export const sound = new Sound();
