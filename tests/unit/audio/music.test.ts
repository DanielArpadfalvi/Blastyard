import { describe, expect, it } from 'vitest';
import {
  BEATS_PER_BAR,
  MATCH_BPM,
  MUSIC_TRACKS,
  SUDDEN_DEATH_TEMPO,
  barSeconds,
  composeBar,
  midiToHz,
  trackBpm,
} from '../../../src/audio/music';

describe('generative music', () => {
  it('plays sudden death 15 % faster than the match', () => {
    expect(SUDDEN_DEATH_TEMPO).toBe(1.15);
    expect(trackBpm('suddenDeath') / trackBpm('match')).toBeCloseTo(1.15, 10);
    expect(trackBpm('match')).toBe(MATCH_BPM);
    expect(trackBpm('menu')).toBeLessThan(trackBpm('match'));
    expect(barSeconds('match')).toBeCloseTo((BEATS_PER_BAR * 60) / MATCH_BPM);
  });

  it('is deterministic per track, bar and seed, and varies with the seed', () => {
    for (const track of MUSIC_TRACKS) {
      expect(composeBar(track, 5, 77)).toEqual(composeBar(track, 5, 77));
    }
    const a = JSON.stringify([0, 1, 2, 3].map((b) => composeBar('match', b, 1)));
    const b = JSON.stringify([0, 1, 2, 3].map((b) => composeBar('match', b, 2)));
    expect(a).not.toBe(b);
  });

  it('keeps every note inside its bar and in a sane range', () => {
    for (const track of MUSIC_TRACKS) {
      for (let bar = 0; bar < 32; bar++) {
        const notes = composeBar(track, bar, 9);
        expect(notes.length).toBeGreaterThan(4);
        for (const n of notes) {
          expect(n.beat).toBeGreaterThanOrEqual(0);
          expect(n.beat).toBeLessThan(BEATS_PER_BAR);
          expect(n.dur).toBeGreaterThan(0);
          expect(n.vel).toBeGreaterThan(0);
          expect(n.vel).toBeLessThanOrEqual(1);
          if (n.voice !== 'kick' && n.voice !== 'snare' && n.voice !== 'hat') {
            expect(n.midi).toBeGreaterThanOrEqual(24);
            expect(n.midi).toBeLessThanOrEqual(96);
          }
        }
      }
    }
  });

  it('gives each track its own character', () => {
    const voices = (track: (typeof MUSIC_TRACKS)[number]) =>
      new Set(composeBar(track, 0, 3).map((n) => n.voice));
    expect(voices('menu').has('bell')).toBe(true);
    expect(voices('match').has('snare')).toBe(true);
    const hats = (track: (typeof MUSIC_TRACKS)[number]) =>
      composeBar(track, 0, 3).filter((n) => n.voice === 'hat').length;
    expect(hats('suddenDeath')).toBeGreaterThan(hats('match'));
  });

  it('converts MIDI notes to Hz', () => {
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(81)).toBeCloseTo(880);
  });
});
