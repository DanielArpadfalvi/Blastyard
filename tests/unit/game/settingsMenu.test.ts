import { describe, expect, it } from 'vitest';
import { DEFAULT_TOUCH_PARAMS } from '../../../src/input/zones';
import {
  DEFAULT_CONTROL_PREFS,
  seatPlan,
  touchParamsFor,
  zonesForPlan,
} from '../../../src/game/modes';
import { SettingsStore, defaultSettings, sanitizeSettings } from '../../../src/game/settings';
import { webBack } from '../../../src/platform/back';
import { mockEntitlements } from '../../../src/platform/entitlement';
import { memoryStore } from '../../../src/platform/storage';
import { solveLayout } from '../../../src/render/layout';

describe('settings (T6.1)', () => {
  it('validates every new field and keeps good values', () => {
    const d = defaultSettings();
    expect(d).toMatchObject({
      language: 'auto',
      scheme: 'twoThumb',
      leftHanded: false,
      zoneScale: 100,
      cornerAssist: 'normal',
      friendly: false,
      largeText: false,
    });
    const good = sanitizeSettings(
      {
        language: 'hu',
        scheme: 'oneFinger',
        leftHanded: true,
        zoneScale: 120,
        cornerAssist: 'high',
        friendly: true,
        largeText: true,
      },
      d,
    );
    expect(good).toMatchObject({
      language: 'hu',
      scheme: 'oneFinger',
      leftHanded: true,
      zoneScale: 120,
      cornerAssist: 'high',
      friendly: true,
      largeText: true,
    });
    const bad = sanitizeSettings(
      { language: 'de', scheme: 'dpad', leftHanded: 1, zoneScale: 150, cornerAssist: 9 },
      d,
    );
    expect(bad).toEqual(d);
  });

  it('persists across a restart', () => {
    const store = memoryStore();
    new SettingsStore(store).update({ friendly: true, zoneScale: 80 });
    expect(new SettingsStore(store).get()).toMatchObject({ friendly: true, zoneScale: 80 });
  });
});

describe('control preferences', () => {
  const layout = solveLayout({ width: 1600, height: 720 });

  it('zone size scales the pop button and the stick follow radius (80–120 %)', () => {
    const big = touchParamsFor({ ...DEFAULT_CONTROL_PREFS, zoneScale: 120 });
    expect(big.bombVisibleDiameter).toBe(
      Math.round(DEFAULT_TOUCH_PARAMS.bombVisibleDiameter * 1.2),
    );
    expect(big.bombHitDiameter).toBe(Math.round(DEFAULT_TOUCH_PARAMS.bombHitDiameter * 1.2));
    expect(big.stick.followRadius).toBe(Math.round(DEFAULT_TOUCH_PARAMS.stick.followRadius * 1.2));
    expect(touchParamsFor({ ...DEFAULT_CONTROL_PREFS, zoneScale: 500 }).bombHitDiameter).toBe(
      Math.round(DEFAULT_TOUCH_PARAMS.bombHitDiameter * 1.2),
    );
    expect(touchParamsFor(DEFAULT_CONTROL_PREFS)).toEqual(DEFAULT_TOUCH_PARAMS);
  });

  it('left-handed solo puts the pop button in the left strip', () => {
    const right = zonesForPlan('solo', layout, seatPlan('solo'));
    const left = zonesForPlan('solo', layout, seatPlan('solo'), {
      ...DEFAULT_CONTROL_PREFS,
      leftHanded: true,
    });
    const r = right.zones[0]!;
    const l = left.zones[0]!;
    expect(r.bombCenter!.x).toBeGreaterThan(layout.arena.x + layout.arena.w);
    expect(l.bombCenter!.x).toBeLessThan(layout.arena.x);
    expect(l.leftHanded).toBe(true);
    expect(left.stickHints[0]!.x).toBeGreaterThan(layout.arena.x + layout.arena.w);
  });

  it('one-finger scheme for solo and face-off; corners stay one-finger', () => {
    const prefs = { ...DEFAULT_CONTROL_PREFS, scheme: 'oneFinger' as const };
    expect(zonesForPlan('solo', layout, seatPlan('solo'), prefs).zones[0]!.scheme).toBe(
      'oneFinger',
    );
    const face = zonesForPlan('faceoff', layout, seatPlan('faceoff'), prefs);
    expect(face.zones.map((z) => z.scheme)).toEqual(['oneFinger', 'oneFinger']);
    const corners = zonesForPlan('corners', layout, seatPlan('corners'), DEFAULT_CONTROL_PREFS);
    expect(corners.zones.every((z) => z.scheme === 'oneFinger')).toBe(true);
  });
});

describe('platform back and restore', () => {
  it('runs the installed handler; without one the platform may leave', () => {
    const back = webBack();
    expect(back.trigger()).toBe(false);
    let steps = 2;
    back.setHandler(() => steps-- > 0);
    expect(back.trigger()).toBe(true);
    expect(back.trigger()).toBe(true);
    expect(back.trigger()).toBe(false);
  });

  it('mock restore reports what the flag says', async () => {
    expect(await mockEntitlements(false).restore()).toBe('nothing');
    expect(await mockEntitlements(true).restore()).toBe('restored');
  });
});
