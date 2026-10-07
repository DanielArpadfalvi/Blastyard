/**
 * Audio engine (T3.2): one `AudioContext`, created only on the first user gesture (browsers and
 * WebViews refuse to start audio before one, and the game must stay silent until the player
 * touches it). Routing:
 *
 *   music player ─→ music bus ─┐
 *   sfx cues ─→ panner ─→ sfx bus ─┼─→ master (compressor) ─→ speakers
 *   fuse sizzle loop ─→ sfx bus ─┘
 *
 * Music and effects have separate volumes. Before the unlock every call is a cheap no-op.
 */

import { onAppVisibility } from '../platform/lifecycle';
import type { Cue } from './cues';
import type { MusicTrack } from './music';
import { MusicPlayer } from './musicPlayer';
import { CUE_SECONDS, playCue } from './sfx';
import { createNoiseBuffer } from './synth';

export type AudioContextFactory = () => AudioContext;

/** Events that count as the first user gesture. */
export const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const;
/** Concurrent effect voices; extra cues are dropped (a huge chain still sounds like one). */
export const MAX_SFX_VOICES = 14;
/** The same cue never restarts faster than this (s). */
export const CUE_MIN_GAP_S = 0.035;

export function defaultAudioContextFactory(): AudioContextFactory | null {
  const g = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? () => new Ctor({ latencyHint: 'interactive' }) : null;
}

/** Perceptual volume curve (slider 0–1 → gain). */
export function volumeGain(volume: number): number {
  const v = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0));
  return v * v;
}

export interface AudioStats {
  readonly unlocked: boolean;
  readonly contexts: number;
  readonly state: string;
  readonly track: MusicTrack | null;
  readonly cuesPlayed: number;
  readonly lastCue: string | null;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private sizzleGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private music: MusicPlayer | null = null;
  private musicVolume = 0.6;
  private sfxVolume = 0.8;
  private wantedTrack: MusicTrack | null = null;
  private trackSeed = 1;
  private contexts = 0;
  private cuesPlayed = 0;
  private lastCue: string | null = null;
  private readonly voiceEnds: number[] = [];
  private readonly lastStart = new Map<string, number>();
  private detachUnlock: (() => void) | null = null;
  private detachLifecycle: (() => void) | null = null;

  constructor(
    private readonly factory: AudioContextFactory | null = defaultAudioContextFactory(),
  ) {}

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  /** Waits for the first user gesture on `target`, then unlocks. Returns a detach function. */
  attachUnlock(target: EventTarget = globalThis as unknown as EventTarget): () => void {
    if (this.ctx || this.detachUnlock) return this.detachUnlock ?? (() => undefined);
    const handler = (): void => {
      this.unlock();
    };
    for (const type of UNLOCK_EVENTS) target.addEventListener(type, handler, { capture: true });
    this.detachUnlock = () => {
      for (const type of UNLOCK_EVENTS)
        target.removeEventListener(type, handler, { capture: true });
      this.detachUnlock = null;
    };
    return this.detachUnlock;
  }

  /** Creates and starts the audio graph. Call from inside a user gesture handler. */
  unlock(): void {
    if (this.ctx || !this.factory) return;
    let ctx: AudioContext;
    try {
      ctx = this.factory();
    } catch {
      return;
    }
    this.contexts++;
    this.ctx = ctx;
    this.detachUnlock?.();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    const musicBus = ctx.createGain();
    const sfxBus = ctx.createGain();
    musicBus.connect(master);
    sfxBus.connect(master);
    this.musicBus = musicBus;
    this.sfxBus = sfxBus;
    this.applyVolumes();
    void ctx.resume?.().catch(() => undefined);
    // iOS: a sound started inside the gesture keeps the context running.
    const blip = ctx.createBufferSource();
    blip.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    blip.connect(master);
    blip.start();
    this.noiseBuf = createNoiseBuffer(ctx);
    this.music = new MusicPlayer(ctx, musicBus, this.noiseBuf);
    this.startSizzle();
    if (this.wantedTrack) this.music.play(this.wantedTrack, this.trackSeed);
    this.detachLifecycle = onAppVisibility((visible) => {
      if (visible) void ctx.resume?.().catch(() => undefined);
      else void ctx.suspend?.().catch(() => undefined);
    });
  }

  setVolumes(music: number, sfx: number): void {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || !this.sfxBus) return;
    this.musicBus.gain.setTargetAtTime(volumeGain(this.musicVolume) * 0.55, ctx.currentTime, 0.03);
    this.sfxBus.gain.setTargetAtTime(volumeGain(this.sfxVolume), ctx.currentTime, 0.03);
  }

  /** Music to play (remembered until the unlock). */
  setTrack(track: MusicTrack | null, seed = this.trackSeed): void {
    this.wantedTrack = track;
    this.trackSeed = seed;
    this.music?.play(track, seed);
  }

  /** Plays an effect cue now (ignored before the unlock, while suspended or when saturated). */
  play(cue: Cue): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noiseBuf || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const last = this.lastStart.get(cue.id);
    if (last !== undefined && now - last < CUE_MIN_GAP_S) return;
    for (let i = this.voiceEnds.length - 1; i >= 0; i--) {
      if ((this.voiceEnds[i] as number) <= now) this.voiceEnds.splice(i, 1);
    }
    if (this.voiceEnds.length >= MAX_SFX_VOICES) return;
    this.lastStart.set(cue.id, now);
    this.voiceEnds.push(now + CUE_SECONDS[cue.id]);
    let dest: AudioNode = this.sfxBus;
    if (cue.pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = cue.pan;
      p.connect(this.sfxBus);
      dest = p;
      setTimeout(() => p.disconnect(), (CUE_SECONDS[cue.id] + 0.3) * 1000);
    }
    playCue(ctx, this.noiseBuf, dest, cue, now + 0.005);
    this.cuesPlayed++;
    this.lastCue = cue.id;
  }

  /** Fuse hiss level 0–1 (lit pops on the field). */
  setSizzle(level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sizzleGain) return;
    const target = Math.min(1, Math.max(0, level)) * 0.05;
    this.sizzleGain.gain.setTargetAtTime(target, ctx.currentTime, 0.05);
  }

  private startSizzle(): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf || !this.sfxBus) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5200;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(hp);
    hp.connect(gain);
    gain.connect(this.sfxBus);
    src.start();
    this.sizzleGain = gain;
  }

  stats(): AudioStats {
    return {
      unlocked: this.unlocked,
      contexts: this.contexts,
      state: this.ctx?.state ?? 'none',
      track: this.music?.track() ?? null,
      cuesPlayed: this.cuesPlayed,
      lastCue: this.lastCue,
    };
  }

  dispose(): void {
    this.detachUnlock?.();
    this.detachLifecycle?.();
    this.music?.stop();
    void this.ctx?.close?.().catch(() => undefined);
    this.ctx = null;
  }
}
