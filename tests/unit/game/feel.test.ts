import { describe, expect, it } from 'vitest';
import { EventKind, NO_OWNER, type SimEvent } from '../../../src/core';
import { FramePacer, LOW_FPS_MS, QualityGovernor, type Quality } from '../../../src/game/frameRate';
import { HAPTIC_MIN_GAP_TICKS, HapticsDirector, hapticFor } from '../../../src/game/haptics';
import {
  SETTINGS_KEY,
  SettingsStore,
  defaultSettings,
  hapticsEnabled,
  sanitizeSettings,
  speedFactor,
} from '../../../src/game/settings';
import { recordingHaptics } from '../../../src/platform/haptics';
import { memoryStore } from '../../../src/platform/storage';

describe('settings', () => {
  it('falls back field by field on invalid values', () => {
    const d = defaultSettings();
    expect(sanitizeSettings(null, d)).toEqual(d);
    expect(
      sanitizeSettings(
        { musicVolume: 3, sfxVolume: -1, haptics: 'loud', gameSpeed: 50, reducedMotion: 'yes' },
        d,
      ),
    ).toEqual({ ...d, musicVolume: 1, sfxVolume: 0 });
    expect(sanitizeSettings({ gameSpeed: 70, haptics: 'off', reducedMotion: true }, d)).toEqual({
      ...d,
      gameSpeed: 70,
      haptics: 'off',
      reducedMotion: true,
    });
  });

  it('follows the OS reduced-motion preference by default', () => {
    expect(defaultSettings(true).reducedMotion).toBe(true);
    expect(defaultSettings(false).reducedMotion).toBe(false);
  });

  it('persists updates and survives a corrupt entry', () => {
    const kv = memoryStore();
    const store = new SettingsStore(kv);
    const seen: number[] = [];
    store.subscribe((s) => seen.push(s.gameSpeed));
    store.update({ gameSpeed: 85, musicVolume: 0.3 });
    expect(seen).toEqual([85]);
    expect(new SettingsStore(kv).get()).toMatchObject({ gameSpeed: 85, musicVolume: 0.3 });
    kv.set(SETTINGS_KEY, '{not json');
    expect(new SettingsStore(kv).get()).toEqual(defaultSettings());
  });

  it('session overrides are not saved', () => {
    const kv = memoryStore();
    const store = new SettingsStore(kv);
    store.override({ gameSpeed: 70 });
    expect(store.get().gameSpeed).toBe(70);
    expect(kv.get(SETTINGS_KEY)).toBeNull();
  });

  it('haptics: auto = on alone, off at the table; never in the attract match', () => {
    expect(hapticsEnabled('auto', 'solo')).toBe(true);
    expect(hapticsEnabled('auto', 'faceoff')).toBe(false);
    expect(hapticsEnabled('auto', 'corners')).toBe(false);
    expect(hapticsEnabled('on', 'faceoff')).toBe(true);
    expect(hapticsEnabled('off', 'solo')).toBe(false);
    expect(hapticsEnabled('on', 'attract')).toBe(false);
  });

  it('maps game speed to a clock factor', () => {
    expect(speedFactor(70)).toBe(0.7);
    expect(speedFactor(85)).toBe(0.85);
    expect(speedFactor(100)).toBe(1);
  });
});

/** Frames accepted by a pacer during `seconds` of a `hz` display with ±`jitter` ms noise. */
function acceptedFrames(cap: number, hz: number, seconds: number, jitter = 0): number {
  const pacer = new FramePacer(cap);
  let n = 0;
  const frames = Math.round(hz * seconds);
  for (let i = 0; i < frames; i++) {
    const noise = jitter * Math.sin(i * 12.9898);
    if (pacer.accept(1000 + (i * 1000) / hz + noise)) n++;
  }
  return n;
}

describe('frame pacer', () => {
  it('never drops a frame on a 60 Hz display, even with timer jitter', () => {
    expect(acceptedFrames(60, 60, 10)).toBe(600);
    expect(acceptedFrames(60, 60, 10, 1.5)).toBe(600);
  });

  it('caps 90/120/144 Hz displays at ~60 FPS', () => {
    for (const hz of [90, 120, 144]) {
      const n = acceptedFrames(60, hz, 10);
      expect(n, `${hz} Hz`).toBeGreaterThanOrEqual(590);
      expect(n, `${hz} Hz`).toBeLessThanOrEqual(605);
    }
  });

  it('runs menus at 30 FPS', () => {
    expect(acceptedFrames(30, 60, 10)).toBeGreaterThanOrEqual(298);
    expect(acceptedFrames(30, 60, 10)).toBeLessThanOrEqual(302);
    const pacer = new FramePacer();
    pacer.setCap(30);
    expect(pacer.getCap()).toBe(30);
  });

  it('restarts the schedule after a stall instead of bursting', () => {
    const pacer = new FramePacer(60);
    expect(pacer.accept(0)).toBe(true);
    expect(pacer.accept(5000)).toBe(true);
    expect(pacer.accept(5005)).toBe(false);
    expect(pacer.accept(5016.7)).toBe(true);
  });
});

describe('quality governor', () => {
  function feed(g: QualityGovernor, fps: number, ms: number): void {
    const dt = 1000 / fps;
    for (let t = 0; t < ms; t += dt) g.frame(dt);
  }

  it('drops one quality step after 3 s below 50 FPS', () => {
    const changes: Quality[] = [];
    const g = new QualityGovernor((q) => changes.push(q));
    feed(g, 45, LOW_FPS_MS - 600);
    expect(changes).toEqual([]);
    feed(g, 45, 700);
    expect(changes).toEqual([1]);
    expect(g.getQuality()).toBe(1);
    expect(g.getFps()).toBeCloseTo(45, 0);
    feed(g, 40, 3100);
    expect(changes).toEqual([1, 0]);
    feed(g, 20, 10_000);
    expect(g.getQuality()).toBe(0);
  });

  it('drops straight to minimal quality on a very slow device', () => {
    const changes: Quality[] = [];
    const g = new QualityGovernor((q) => changes.push(q));
    feed(g, 30, LOW_FPS_MS + 700);
    expect(changes).toEqual([0]);
  });

  it('keeps full quality at 55–60 FPS and when slow spells are short', () => {
    const changes: Quality[] = [];
    const g = new QualityGovernor((q) => changes.push(q));
    feed(g, 58, 20_000);
    for (let i = 0; i < 10; i++) {
      feed(g, 40, 2000);
      feed(g, 60, 1000);
    }
    expect(changes).toEqual([]);
    expect(g.getQuality()).toBe(2);
  });

  it('treats long frames as stalls (background tab), not as a slow device', () => {
    const changes: Quality[] = [];
    const g = new QualityGovernor((q) => changes.push(q));
    for (let i = 0; i < 20; i++) {
      feed(g, 45, 2500);
      g.frame(1000);
    }
    expect(changes).toEqual([]);
  });
});

describe('haptics', () => {
  const at = (kind: SimEvent['kind'], seat: number, tick = 10, value = 0): SimEvent => ({
    tick,
    kind,
    seat,
    cell: 20,
    value,
  });

  it('buzzes for the human seats’ own moments, strongest wins', () => {
    expect(hapticFor([at(EventKind.BOMB_PLACED, 0)], [0])).toBe('light');
    expect(hapticFor([at(EventKind.BOMB_PLACED, 1)], [0])).toBeNull();
    expect(hapticFor([at(EventKind.BOMB_EXPLODED, 0)], [0])).toBe('medium');
    expect(hapticFor([at(EventKind.BOMB_EXPLODED, 1)], [0])).toBe('light');
    expect(hapticFor([at(EventKind.DEATH, 0), at(EventKind.PICKUP_COLLECTED, 0)], [0])).toBe(
      'heavy',
    );
    expect(hapticFor([at(EventKind.ROUND_END, NO_OWNER, 10, 0)], [0])).toBe('medium');
    expect(hapticFor([at(EventKind.COUNTDOWN, NO_OWNER)], [0])).toBeNull();
  });

  it('throttles pulses and stays silent when disabled', () => {
    const port = recordingHaptics();
    const d = new HapticsDirector(port, [0], true);
    d.onEvents([at(EventKind.BOMB_PLACED, 0, 10)]);
    d.onEvents([at(EventKind.BOMB_EXPLODED, 0, 10 + HAPTIC_MIN_GAP_TICKS - 1)]);
    d.onEvents([at(EventKind.DEATH, 0, 10 + HAPTIC_MIN_GAP_TICKS)]);
    expect(port.pulses).toEqual(['light', 'heavy']);
    d.setEnabled(false);
    d.onEvents([at(EventKind.DEATH, 0, 100)]);
    expect(port.pulses).toHaveLength(2);
    expect(d.isEnabled()).toBe(false);
  });
});
