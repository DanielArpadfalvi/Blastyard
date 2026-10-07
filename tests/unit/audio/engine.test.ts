import { afterEach, describe, expect, it } from 'vitest';
import { GameAudio } from '../../../src/audio';
import { CueId, type Cue } from '../../../src/audio/cues';
import { AudioEngine, UNLOCK_EVENTS, volumeGain } from '../../../src/audio/engine';
import { EventKind, NO_OWNER } from '../../../src/core';

/** Minimal stand-in for Web Audio: every node accepts any call; counts created nodes. */
function fakeContext() {
  const created: string[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined,
    exponentialRampToValueAtTime: () => undefined,
    setTargetAtTime: () => undefined,
    cancelScheduledValues: () => undefined,
  });
  const node = (kind: string) => {
    created.push(kind);
    return {
      gain: param(),
      frequency: param(),
      detune: param(),
      Q: param(),
      pan: param(),
      type: '',
      buffer: null as unknown,
      loop: false,
      onended: null as unknown,
      connect: () => undefined,
      disconnect: () => undefined,
      start: () => undefined,
      stop: () => undefined,
    };
  };
  const ctx = {
    state: 'running',
    currentTime: 1,
    sampleRate: 8000,
    destination: node('destination'),
    resumed: 0,
    resume() {
      this.resumed++;
      return Promise.resolve();
    },
    suspend: () => Promise.resolve(),
    close: () => Promise.resolve(),
    createGain: () => node('gain'),
    createDynamicsCompressor: () => node('compressor'),
    createOscillator: () => node('oscillator'),
    createBiquadFilter: () => node('filter'),
    createStereoPanner: () => node('panner'),
    createBufferSource: () => node('source'),
    createBuffer: (_ch: number, length: number) => ({
      duration: length / 8000,
      getChannelData: () => new Float32Array(length),
    }),
  };
  return { ctx, created };
}

class FakeTarget {
  readonly listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, fn: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
  count(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}

const BLAST: Cue = { id: CueId.BLAST, intensity: 1, variant: 0, pan: 0.3 };

describe('audio engine', () => {
  let engine: AudioEngine | null = null;
  afterEach(() => {
    engine?.dispose();
    engine = null;
  });

  it('creates no audio context before the first user gesture', () => {
    let calls = 0;
    const { ctx } = fakeContext();
    engine = new AudioEngine(() => {
      calls++;
      return ctx as unknown as AudioContext;
    });
    const target = new FakeTarget();
    engine.attachUnlock(target as unknown as EventTarget);
    // Everything the game does before a gesture is a silent no-op.
    engine.setVolumes(0.5, 0.5);
    engine.setTrack('menu');
    engine.play(BLAST);
    engine.setSizzle(1);
    const audio = new GameAudio(engine);
    audio.onEvents([{ tick: 1, kind: EventKind.BOMB_EXPLODED, seat: 0, cell: 20, value: 2 }]);
    expect(calls).toBe(0);
    expect(engine.unlocked).toBe(false);
    expect(engine.stats()).toMatchObject({ unlocked: false, contexts: 0, cuesPlayed: 0 });
    expect(target.count()).toBe(UNLOCK_EVENTS.length);
  });

  it('unlocks once on the first gesture, resumes and starts the wanted music', () => {
    let calls = 0;
    const { ctx, created } = fakeContext();
    engine = new AudioEngine(() => {
      calls++;
      return ctx as unknown as AudioContext;
    });
    const target = new FakeTarget();
    engine.attachUnlock(target as unknown as EventTarget);
    engine.setTrack('menu');
    target.fire('pointerdown');
    target.fire('keydown');
    expect(calls).toBe(1);
    expect(ctx.resumed).toBe(1);
    expect(target.count()).toBe(0);
    expect(engine.stats()).toMatchObject({ unlocked: true, contexts: 1, track: 'menu' });
    expect(created.filter((k) => k === 'oscillator').length).toBeGreaterThan(0);
  });

  it('plays cues after the unlock and limits repeats of the same cue', () => {
    const { ctx } = fakeContext();
    engine = new AudioEngine(() => ctx as unknown as AudioContext);
    engine.unlock();
    engine.play(BLAST);
    engine.play(BLAST);
    expect(engine.stats().cuesPlayed).toBe(1);
    ctx.currentTime += 0.1;
    engine.play({ ...BLAST, pan: 0 });
    expect(engine.stats()).toMatchObject({ cuesPlayed: 2, lastCue: CueId.BLAST });
  });

  it('stays silent while the context is suspended', () => {
    const { ctx } = fakeContext();
    engine = new AudioEngine(() => ctx as unknown as AudioContext);
    engine.unlock();
    ctx.state = 'suspended';
    engine.play(BLAST);
    expect(engine.stats().cuesPlayed).toBe(0);
  });

  it('switches to the sudden-death track and back to the match groove', () => {
    const { ctx } = fakeContext();
    engine = new AudioEngine(() => ctx as unknown as AudioContext);
    engine.unlock();
    const audio = new GameAudio(engine);
    audio.match(42);
    expect(engine.stats().track).toBe('match');
    audio.onEvents([{ tick: 9, kind: EventKind.SUDDEN_DEATH, seat: NO_OWNER, cell: -1, value: 0 }]);
    expect(engine.stats().track).toBe('suddenDeath');
    audio.onEvents([{ tick: 99, kind: EventKind.ROUND_START, seat: NO_OWNER, cell: -1, value: 2 }]);
    expect(engine.stats().track).toBe('match');
    audio.menu();
    expect(engine.stats().track).toBe('menu');
  });

  it('works without Web Audio at all', () => {
    engine = new AudioEngine(null);
    engine.unlock();
    engine.play(BLAST);
    expect(engine.stats()).toMatchObject({ unlocked: false, contexts: 0 });
  });

  it('uses a perceptual volume curve', () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(1)).toBe(1);
    expect(volumeGain(0.5)).toBeCloseTo(0.25);
    expect(volumeGain(2)).toBe(1);
    expect(volumeGain(Number.NaN)).toBe(0);
  });
});
