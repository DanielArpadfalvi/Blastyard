import { describe, expect, it } from 'vitest';
import {
  nearestEdge,
  screenMetrics,
  TouchStats,
  touchReport,
  type ReportLabels,
} from '../../../src/input/touchStats';

const LABELS: ReportLabels = {
  title: 'T',
  device: 'Device',
  screen: 'Screen',
  maxTouches: 'Max',
  cancels: 'Cancels',
  edges: 'Edges',
  pointer: 'p',
  touch: 't',
};

describe('touch tester stats', () => {
  it('tracks active pointers in id order and the most seen at once', () => {
    const s = new TouchStats();
    s.pointerDown(5, 10, 10, 'touch');
    s.pointerDown(2, 20, 20, 'touch');
    s.pointerDown(9, 30, 30, 'touch');
    s.pointerMove(2, 25, 26);
    expect(s.points().map((p) => p.id)).toEqual([2, 5, 9]);
    expect(s.points()[0]).toMatchObject({ x: 25, y: 26, type: 'touch' });
    s.pointerUp(5);
    s.pointerUp(9);
    s.pointerDown(7, 1, 1, 'touch');
    expect(s.activeCount).toBe(2);
    expect(s.maxPointers).toBe(3);
    expect(s.totalPointers).toBe(4);
    // A move for an unknown pointer does not create one.
    s.pointerMove(42, 0, 0);
    expect(s.activeCount).toBe(2);
  });

  it('keeps the TouchEvent maximum separately', () => {
    const s = new TouchStats();
    s.touchCount(2);
    s.touchCount(5);
    s.touchCount(1);
    expect(s.maxTouches).toBe(5);
    expect(s.maxPointers).toBe(0);
  });

  it('counts cancels and bins pointer cancels by the nearest edge', () => {
    const s = new TouchStats();
    s.setViewport(800, 400);
    s.pointerDown(1, 5, 200, 'touch');
    s.pointerDown(2, 400, 396, 'touch');
    s.pointerCancel(1, 4, 200);
    // pointercancel at 0,0 (some browsers): fall back to the last known position.
    s.pointerCancel(2, 0, 0);
    s.touchCancel([{ x: 400, y: 396 }]);
    expect(s.pointerCancels).toBe(2);
    expect(s.touchCancels).toBe(1);
    expect(s.cancelsByEdge).toEqual({ left: 1, right: 0, top: 0, bottom: 1 });
    expect(s.lastCancel).toMatchObject({ source: 'touch', edge: 'bottom', edgeDistance: 4 });
    expect(s.activeCount).toBe(0);
  });

  it('reset clears everything', () => {
    const s = new TouchStats();
    s.pointerDown(1, 5, 5, 'touch');
    s.pointerCancel(1);
    s.touchCount(3);
    s.reset();
    expect([s.activeCount, s.maxPointers, s.maxTouches, s.pointerCancels]).toEqual([0, 0, 0, 0]);
    expect(s.cancelsByEdge).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
    expect(s.lastCancel).toBeNull();
  });

  it('nearest edge', () => {
    expect(nearestEdge(10, 100, 800, 400)).toEqual({ edge: 'left', distance: 10 });
    expect(nearestEdge(795, 100, 800, 400)).toEqual({ edge: 'right', distance: 5 });
    expect(nearestEdge(400, 3, 800, 400)).toEqual({ edge: 'top', distance: 3 });
    expect(nearestEdge(400, 390, 800, 400)).toEqual({ edge: 'bottom', distance: 10 });
  });

  it('screen metrics: device px and an mm estimate from dp/mm', () => {
    const m = screenMetrics(915, 412, 2.625, 160 / 25.4);
    expect([m.pxWidth, m.pxHeight]).toEqual([2402, 1082]);
    expect(m.mmWidth).toBeCloseTo(145.3, 1);
    expect(m.mmHeight).toBeCloseTo(65.4, 1);
    expect(m.diagonalInch).toBeCloseTo(6.27, 1);
    expect(screenMetrics(100, 100, Number.NaN, 6.3).dpr).toBe(1);
  });

  it('report summarises device, screen, max touches and cancels', () => {
    const s = new TouchStats();
    s.setViewport(915, 412);
    for (let id = 1; id <= 4; id++) s.pointerDown(id, 100 * id, 200, 'touch');
    s.touchCount(4);
    s.pointerCancel(4, 910, 200);
    const text = touchReport(s, screenMetrics(915, 412, 2.625, 160 / 25.4), 'UA/1.0', LABELS);
    expect(text.split('\n')).toEqual([
      'T',
      'Device: UA/1.0',
      'Screen: 915×412 dp @2.6x = 2402×1082 px ≈ 145×65 mm (6.3″)',
      'Max: 4 (p) / 4 (t)',
      'Cancels: 1 (p) / 0 (t); Edges: L0 R1 T0 B0',
    ]);
  });
});
