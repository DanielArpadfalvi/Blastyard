/**
 * Schedules the generative music (`music.ts`) on Web Audio with a short look-ahead: a timer wakes
 * up every {@link SCHEDULER_MS} and queues every note that starts within the next
 * {@link LOOKAHEAD_S}, so timing stays sample-accurate even when the main thread is busy.
 * Switching tracks fades the old one out and starts the new one on a fresh bar.
 */

import {
  BEATS_PER_BAR,
  barSeconds,
  composeBar,
  midiToHz,
  type MusicTrack,
  type NoteEvent,
} from './music';
import { noise, tone } from './synth';

export const SCHEDULER_MS = 50;
export const LOOKAHEAD_S = 0.3;
const FADE_S = 0.6;

interface Playing {
  readonly track: MusicTrack;
  readonly bus: GainNode;
  readonly seed: number;
  bar: number;
  barStart: number;
}

export class MusicPlayer {
  private current: Playing | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly out: AudioNode,
    private readonly noiseBuf: AudioBuffer,
  ) {}

  track(): MusicTrack | null {
    return this.current?.track ?? null;
  }

  /** Switches to `track` (null = silence). Same track again keeps playing. */
  play(track: MusicTrack | null, seed = 1): void {
    if (this.current?.track === track) return;
    const now = this.ctx.currentTime;
    if (this.current) {
      const old = this.current.bus;
      old.gain.cancelScheduledValues(now);
      old.gain.setValueAtTime(old.gain.value, now);
      old.gain.linearRampToValueAtTime(0.0001, now + FADE_S);
      setTimeout(() => old.disconnect(), (FADE_S + LOOKAHEAD_S + 0.2) * 1000);
      this.current = null;
    }
    if (track === null) {
      this.stopTimer();
      return;
    }
    const bus = this.ctx.createGain();
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.linearRampToValueAtTime(1, now + 0.25);
    bus.connect(this.out);
    this.current = { track, bus, seed, bar: 0, barStart: now + 0.1 };
    this.startTimer();
    this.schedule();
  }

  stop(): void {
    this.play(null);
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.schedule(), SCHEDULER_MS);
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    const p = this.current;
    if (!p) return;
    const now = this.ctx.currentTime;
    const barLen = barSeconds(p.track);
    // After a long suspension (background) jump to the present instead of catching up.
    if (p.barStart + barLen < now) {
      const skipped = Math.floor((now - p.barStart) / barLen);
      p.bar += skipped;
      p.barStart += skipped * barLen;
    }
    while (p.barStart < now + LOOKAHEAD_S) {
      const beatLen = barLen / BEATS_PER_BAR;
      for (const note of composeBar(p.track, p.bar, p.seed)) {
        const t = p.barStart + note.beat * beatLen;
        if (t < now - 0.01) continue;
        this.voice(note, t, note.dur * beatLen, p.bus);
      }
      p.bar++;
      p.barStart += barLen;
    }
  }

  private voice(n: NoteEvent, t: number, dur: number, bus: GainNode): void {
    const ctx = this.ctx;
    const f = midiToHz(n.midi);
    switch (n.voice) {
      case 'pad':
        for (const detune of [-7, 7]) {
          tone(ctx, bus, {
            type: 'triangle',
            freq: f,
            t,
            dur,
            gain: n.vel * 0.07,
            attack: 0.25,
            detune,
            lowpass: 1400,
          });
        }
        break;
      case 'bass':
        tone(ctx, bus, { type: 'square', freq: f, t, dur, gain: n.vel * 0.13, lowpass: 520 });
        break;
      case 'lead':
        tone(ctx, bus, { type: 'square', freq: f, t, dur, gain: n.vel * 0.06, lowpass: 2600 });
        break;
      case 'bell':
        tone(ctx, bus, { type: 'sine', freq: f, t, dur: dur + 0.4, gain: n.vel * 0.12 });
        tone(ctx, bus, { type: 'sine', freq: f * 2.76, t, dur: 0.25, gain: n.vel * 0.03 });
        break;
      case 'kick':
        tone(ctx, bus, { type: 'sine', freq: 150, freqEnd: 42, t, dur: 0.22, gain: n.vel * 0.5 });
        break;
      case 'snare':
        noise(ctx, this.noiseBuf, bus, {
          t,
          dur: 0.14,
          gain: n.vel * 0.22,
          filter: 'bandpass',
          freq: 1900,
          q: 0.9,
        });
        tone(ctx, bus, {
          type: 'triangle',
          freq: 190,
          freqEnd: 140,
          t,
          dur: 0.08,
          gain: n.vel * 0.12,
        });
        break;
      case 'hat':
        noise(ctx, this.noiseBuf, bus, {
          t,
          dur: 0.04,
          gain: n.vel * 0.12,
          filter: 'highpass',
          freq: 7500,
        });
        break;
    }
  }
}
