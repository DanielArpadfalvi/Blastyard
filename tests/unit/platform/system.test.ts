import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import config from '../../../capacitor.config';
import {
  gestureBands,
  GESTURE_BAND,
  seatPlan,
  zonesForPlan,
  DEFAULT_CONTROL_PREFS,
} from '../../../src/game/modes';
import { dedupedSystem, webSystem, type SystemPort } from '../../../src/platform/system';
import { solveLayout } from '../../../src/render/layout';

function recorder(): SystemPort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    keepAwake: (on) => calls.push(`awake:${on}`),
    lockOrientation: (l) => calls.push(`lock:${l}`),
    excludeGestures: (r) => calls.push(`rects:${r.length}`),
  };
}

describe('device port (T7.1)', () => {
  it('skips calls that change nothing and reports its state', () => {
    const raw = recorder();
    const sys = dedupedSystem(raw);
    sys.keepAwake(true);
    sys.keepAwake(true);
    sys.lockOrientation(true);
    sys.excludeGestures([{ x: 0, y: 0, w: 10, h: 10 }]);
    sys.excludeGestures([{ x: 0.2, y: 0, w: 10, h: 10 }]);
    sys.keepAwake(false);
    sys.excludeGestures([]);
    expect(raw.calls).toEqual(['awake:true', 'lock:true', 'rects:1', 'awake:false', 'rects:0']);
    expect(sys.state()).toEqual({ awake: false, locked: true, rects: [] });
  });

  it('the web implementation never throws without browser APIs', () => {
    const web = webSystem();
    expect(() => {
      web.keepAwake(true);
      web.keepAwake(false);
      web.lockOrientation(true);
      web.lockOrientation(false);
      web.excludeGestures([{ x: 0, y: 0, w: 1, h: 1 }]);
    }).not.toThrow();
  });
});

describe('gesture-exclusion bands', () => {
  const layout = solveLayout({ width: 1600, height: 720 });

  it('one band per zone, at most 200 dp high, in the strip the stick lives in', () => {
    for (const mode of ['solo', 'faceoff', 'corners'] as const) {
      const kind = mode;
      const plan = zonesForPlan(kind, layout, seatPlan(mode), DEFAULT_CONTROL_PREFS);
      const bands = gestureBands(plan);
      expect(bands).toHaveLength(plan.zones.length);
      for (const [i, b] of bands.entries()) {
        expect(b.h).toBeLessThanOrEqual(GESTURE_BAND);
        const zone = plan.zones[i]!.rect;
        expect(b.y).toBeGreaterThanOrEqual(zone.y - 0.01);
        expect(b.y + b.h).toBeLessThanOrEqual(zone.y + zone.h + 0.01);
        const inArena = b.x < layout.arena.x + layout.arena.w && b.x + b.w > layout.arena.x;
        expect(inArena).toBe(false);
      }
    }
    // Left-handed solo: the band follows the stick into the right strip.
    const lh = zonesForPlan('solo', layout, seatPlan('solo'), {
      ...DEFAULT_CONTROL_PREFS,
      leftHanded: true,
    });
    expect(gestureBands(lh)[0]!.x).toBeGreaterThan(layout.arena.x);
  });
});

describe('bundle id', () => {
  it('is written in exactly one tracked file: capacitor.config.ts', () => {
    expect(config.appId).toBe('com.arpadfalvi.blastyard');
    const hits = execSync(`git grep -l -F "${config.appId}" -- . ':!package-lock.json'`, {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter((f) => !f.startsWith('docs/') && f !== 'CLAUDE.md' && !f.startsWith('tests/'));
    expect(hits).toEqual(['capacitor.config.ts']);
  });
});
