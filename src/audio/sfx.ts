/**
 * Procedural sound effects (PLAN §1.13): every cue is synthesized on the fly from oscillators
 * and filtered noise. Blast = noise burst + deep sine thump, pickup = arpeggio, elimination =
 * descending "pfff", fuse = rising beeps in the final half second.
 */

import { CueId, type Cue } from './cues';
import { noise, tone } from './synth';

/** Length of each cue in seconds (voice bookkeeping). */
export const CUE_SECONDS: Readonly<Record<CueId, number>> = {
  countdown: 0.2,
  go: 0.45,
  place: 0.12,
  blast: 0.7,
  crate: 0.25,
  pickup: 0.3,
  burn: 0.3,
  death: 0.7,
  suddenDeath: 1.2,
  blockDrop: 0.35,
  ghostBomb: 0.6,
  roundWin: 0.9,
  roundDraw: 0.7,
  matchEnd: 1.6,
  fuseBeep: 0.08,
};

/** Plays `cue` at time `t` into `dest` (already panned / on the SFX bus). */
export function playCue(
  ctx: BaseAudioContext,
  noiseBuf: AudioBuffer,
  dest: AudioNode,
  cue: Cue,
  t: number,
): void {
  const k = cue.intensity;
  switch (cue.id) {
    case CueId.COUNTDOWN:
      tone(ctx, dest, { type: 'sine', freq: 660, t, dur: 0.16, gain: 0.35 });
      break;
    case CueId.GO:
      tone(ctx, dest, { type: 'triangle', freq: 990, t, dur: 0.4, gain: 0.3 });
      tone(ctx, dest, { type: 'triangle', freq: 1320, t: t + 0.04, dur: 0.38, gain: 0.22 });
      break;
    case CueId.PLACE:
      tone(ctx, dest, { type: 'sine', freq: 320, freqEnd: 170, t, dur: 0.1, gain: 0.45 });
      noise(ctx, noiseBuf, dest, { t, dur: 0.05, gain: 0.08, filter: 'lowpass', freq: 900 });
      break;
    case CueId.BLAST: {
      // Noise impulse through a closing low-pass + a deep sine "dobbanás".
      noise(ctx, noiseBuf, dest, {
        t,
        dur: 0.55 + 0.15 * k,
        gain: 0.55 * k + 0.15,
        filter: 'lowpass',
        freq: 2600,
        freqEnd: 180,
        q: 0.8,
      });
      tone(ctx, dest, { type: 'sine', freq: 130, freqEnd: 38, t, dur: 0.42, gain: 0.7 * k + 0.2 });
      tone(ctx, dest, {
        type: 'triangle',
        freq: 70,
        freqEnd: 30,
        t: t + 0.01,
        dur: 0.3,
        gain: 0.25 * k,
      });
      break;
    }
    case CueId.CRATE:
      noise(ctx, noiseBuf, dest, {
        t: t + 0.03,
        dur: 0.18,
        gain: 0.3 * k,
        filter: 'bandpass',
        freq: 1400,
        freqEnd: 600,
        q: 2,
      });
      tone(ctx, dest, {
        type: 'square',
        freq: 210,
        freqEnd: 120,
        t: t + 0.03,
        dur: 0.08,
        gain: 0.1,
      });
      break;
    case CueId.PICKUP: {
      // Quick major arpeggio, a little higher for the rarer power-ups.
      const base = 784 * 2 ** (Math.min(8, Math.max(0, cue.variant - 1)) / 24);
      [1, 1.26, 1.5, 2].forEach((m, i) => {
        tone(ctx, dest, {
          type: 'triangle',
          freq: base * m,
          t: t + i * 0.055,
          dur: 0.12,
          gain: 0.28,
        });
      });
      break;
    }
    case CueId.BURN:
      noise(ctx, noiseBuf, dest, { t, dur: 0.28, gain: 0.18, filter: 'highpass', freq: 3000 });
      tone(ctx, dest, { type: 'sine', freq: 500, freqEnd: 250, t, dur: 0.2, gain: 0.08 });
      break;
    case CueId.DEATH:
      // Descending "pfff": a deflating whistle with a breathy tail.
      tone(ctx, dest, {
        type: 'sine',
        freq: 620,
        freqEnd: 110,
        t,
        dur: 0.6,
        gain: 0.38,
        vibrato: 18,
      });
      noise(ctx, noiseBuf, dest, {
        t: t + 0.05,
        dur: 0.6,
        gain: 0.22,
        filter: 'bandpass',
        freq: 1800,
        freqEnd: 300,
        q: 1.2,
      });
      break;
    case CueId.SUDDEN_DEATH:
      for (let i = 0; i < 3; i++) {
        tone(ctx, dest, {
          type: 'sawtooth',
          freq: 660,
          t: t + i * 0.36,
          dur: 0.17,
          gain: 0.14,
          lowpass: 2400,
        });
        tone(ctx, dest, {
          type: 'sawtooth',
          freq: 880,
          t: t + i * 0.36 + 0.18,
          dur: 0.17,
          gain: 0.14,
          lowpass: 2400,
        });
      }
      break;
    case CueId.BLOCK_DROP:
      tone(ctx, dest, { type: 'sine', freq: 95, freqEnd: 42, t: t + 0.17, dur: 0.22, gain: 0.45 });
      noise(ctx, noiseBuf, dest, {
        t: t + 0.17,
        dur: 0.16,
        gain: 0.18,
        filter: 'lowpass',
        freq: 800,
      });
      break;
    case CueId.GHOST_BOMB:
      tone(ctx, dest, {
        type: 'sine',
        freq: 420,
        freqEnd: 300,
        t,
        dur: 0.55,
        gain: 0.16,
        vibrato: 30,
      });
      break;
    case CueId.ROUND_WIN:
      [523, 659, 784, 1047].forEach((f, i) => {
        tone(ctx, dest, {
          type: 'square',
          freq: f,
          t: t + i * 0.11,
          dur: 0.22,
          gain: 0.12,
          lowpass: 3000,
        });
      });
      break;
    case CueId.ROUND_DRAW:
      tone(ctx, dest, { type: 'triangle', freq: 523, t, dur: 0.3, gain: 0.25 });
      tone(ctx, dest, { type: 'triangle', freq: 392, t: t + 0.25, dur: 0.4, gain: 0.25 });
      break;
    case CueId.MATCH_END:
      [523, 659, 784, 659, 784, 1047].forEach((f, i) => {
        tone(ctx, dest, {
          type: 'square',
          freq: f,
          t: t + i * 0.13,
          dur: i === 5 ? 0.8 : 0.16,
          gain: 0.12,
          lowpass: 3200,
        });
      });
      tone(ctx, dest, { type: 'triangle', freq: 262, t: t + 0.65, dur: 0.9, gain: 0.2 });
      break;
    case CueId.FUSE_BEEP:
      tone(ctx, dest, {
        type: 'square',
        freq: 1250 + cue.variant * 140,
        t,
        dur: 0.06,
        gain: 0.09,
        lowpass: 4000,
      });
      break;
  }
}
