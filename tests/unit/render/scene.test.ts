import { describe, expect, it } from 'vitest';
import {
  BombFlag,
  Dir,
  FLAME_TICKS,
  FUSE_TICKS,
  GHOST_BOMB_FUSE,
  Hdr,
  NO_SIDE,
  Phase,
  Pickup,
  TILE,
  addBomb,
  cellIndex,
  encodeInput,
  step,
  tileCenter,
} from '../../../src/core';
import {
  SNAP_DISTANCE,
  TickHistory,
  bombPrevIndexValid,
  interpolateCoord,
  lerp,
} from '../../../src/render/interpolation';
import { FramePool } from '../../../src/render/pool';
import {
  Arm,
  BLINK_PERIOD,
  EYE_BLINK,
  EYE_SCARED,
  Scene,
  extractScene,
  eyeVariant,
  flameArms,
  fuseFraction,
  fuseFrame,
  isBlinking,
  isRoundWinner,
  isScared,
  popInScale,
  popPulse,
  HOT_FUSE_TICKS,
  POP_IN_TICKS,
} from '../../../src/render/scene';
import { only, tinyArena } from '../core/helpers';

describe('interpolation', () => {
  it('lerps and clamps alpha', () => {
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(interpolateCoord(100, 116, 0.5)).toBe(108);
    expect(interpolateCoord(100, 116, -1)).toBe(100);
    expect(interpolateCoord(100, 116, 2)).toBe(116);
  });

  it('snaps teleports instead of sliding across the arena', () => {
    expect(interpolateCoord(0, SNAP_DISTANCE + 1, 0.5)).toBe(SNAP_DISTANCE + 1);
    expect(interpolateCoord(0, SNAP_DISTANCE, 0.5)).toBe(SNAP_DISTANCE / 2);
  });

  it('captures the previous tick and knows when it is exactly one behind', () => {
    const state = tinyArena(['#####', '#0..#', '#####']);
    const history = new TickHistory();
    expect(history.isPreviousOf(state)).toBe(false);
    history.capture(state);
    step(state, only(0, encodeInput(Dir.RIGHT)));
    expect(history.isPreviousOf(state)).toBe(true);
    expect(history.px[0]).toBe(tileCenter(1));
    step(state, [0, 0, 0, 0]);
    expect(history.isPreviousOf(state)).toBe(false);
  });

  it('matches bombs across ticks by index and owner', () => {
    const state = tinyArena(['#####', '#0..#', '#####']);
    addBomb(state, 2, 1, 0, FUSE_TICKS, 2);
    const history = new TickHistory();
    history.capture(state);
    expect(bombPrevIndexValid(history, 0, 0)).toBe(true);
    expect(bombPrevIndexValid(history, 0, 1)).toBe(false);
    expect(bombPrevIndexValid(history, 1, 0)).toBe(false);
  });
});

describe('scene extraction', () => {
  it('interpolates a walking Puff between ticks', () => {
    const state = tinyArena(['#######', '#0....#', '#######']);
    const history = new TickHistory();
    const scene = new Scene();
    history.capture(state);
    step(state, only(0, encodeInput(Dir.RIGHT)));
    const prev = history.px[0] as number;
    const cur = state.px[0] as number;
    expect(cur).toBeGreaterThan(prev);
    extractScene(state, history, 0, scene);
    expect(scene.players[0]!.x).toBeCloseTo(prev / TILE);
    extractScene(state, history, 0.5, scene);
    expect(scene.players[0]!.x).toBeCloseTo((prev + cur) / 2 / TILE);
    extractScene(state, history, 1, scene);
    expect(scene.players[0]!.x).toBeCloseTo(cur / TILE);
    expect(scene.players[0]!.moving).toBe(true);
    expect(scene.players[0]!.facing).toBe(Dir.RIGHT);
    expect(scene.players[0]!.visible).toBe(true);
    expect(scene.players[1]!.visible).toBe(false);
  });

  it('shows the exact state when the history is stale', () => {
    const state = tinyArena(['#######', '#0....#', '#######']);
    const history = new TickHistory();
    step(state, only(0, encodeInput(Dir.RIGHT)));
    const scene = extractScene(state, history, 0, new Scene());
    expect(scene.players[0]!.x).toBe((state.px[0] as number) / TILE);
  });

  it('shows ghosts and hides eliminated seats without ghosts', () => {
    const state = tinyArena(['#####', '#0.1#', '#####']);
    state.alive[0] = 0;
    state.ghost[0] = 1;
    state.alive[1] = 0;
    const scene = extractScene(state, new TickHistory(), 1, new Scene());
    expect(scene.players[0]!.visible).toBe(true);
    expect(scene.players[0]!.ghost).toBe(true);
    expect(scene.players[1]!.visible).toBe(false);
  });

  it('copies tiles, and pickups only where they lie open', () => {
    const state = tinyArena(['#####', '#0.+#', '#####']);
    state.pickup[cellIndex(2, 1)] = Pickup.FLAME;
    state.pickup[cellIndex(3, 1)] = Pickup.KICK; // stale value under a crate is never drawn
    const scene = extractScene(state, new TickHistory(), 1, new Scene());
    expect(scene.pickups[cellIndex(2, 1)]).toBe(Pickup.FLAME);
    expect(scene.pickups[cellIndex(3, 1)]).toBe(0);
    expect(scene.tiles[cellIndex(3, 1)]).toBe(state.tiles[cellIndex(3, 1)]);
  });

  it('lists every burning cell with its arms and fading strength', () => {
    const state = tinyArena(['#######', '#0....#', '#.o.o.#', '#.....#', '#######']);
    // A plus-shaped blast around (3, 1)… clipped by the wall above: centre + left/right/down.
    for (const [x, y] of [
      [2, 1],
      [3, 1],
      [4, 1],
      [3, 2],
    ] as const) {
      state.flame[cellIndex(x, y)] = FLAME_TICKS;
    }
    state.flame[cellIndex(3, 2)] = FLAME_TICKS / 2;
    expect(flameArms(state, cellIndex(3, 1))).toBe(Arm.LEFT | Arm.RIGHT | Arm.DOWN);
    expect(flameArms(state, cellIndex(2, 1))).toBe(Arm.RIGHT);
    expect(flameArms(state, cellIndex(3, 2))).toBe(Arm.UP);
    expect(flameArms(state, cellIndex(5, 3))).toBe(0);
    const scene = extractScene(state, new TickHistory(), 1, new Scene());
    expect(scene.flameCount).toBe(4);
    const down = scene.flames.slice(0, 4).find((f) => f.cell === cellIndex(3, 2));
    expect(down?.strength).toBeCloseTo(0.5);
  });

  it('reports the fuse of regular and ghost pops', () => {
    const state = tinyArena(['#######', '#0....#', '#######']);
    addBomb(state, 2, 1, 0, FUSE_TICKS / 2, 2);
    addBomb(state, 4, 1, 0, GHOST_BOMB_FUSE, 1, BombFlag.GHOST);
    expect(fuseFraction(state, 0)).toBeCloseTo(0.5);
    expect(fuseFraction(state, 1)).toBe(1);
    const scene = extractScene(state, new TickHistory(), 1, new Scene());
    expect(scene.bombCount).toBe(2);
    expect(scene.bombs[0]!.x).toBe(2.5);
    expect(scene.bombs[1]!.ghost).toBe(true);
  });

  it('interpolates a sliding (kicked) pop but not a re-used bomb slot', () => {
    const state = tinyArena(['#######', '#0....#', '#######']);
    addBomb(state, 2, 1, 0, FUSE_TICKS, 2);
    const history = new TickHistory();
    history.capture(state);
    state.hdr[Hdr.TICK] = (state.hdr[Hdr.TICK] as number) + 1;
    state.bombX[0] = (state.bombX[0] as number) + 32;
    const scene = new Scene();
    extractScene(state, history, 0.5, scene);
    expect(scene.bombs[0]!.x).toBeCloseTo(2.5 + 16 / TILE);
    state.bombOwner[0] = 1; // a different bomb now lives in slot 0
    extractScene(state, history, 0.5, scene);
    expect(scene.bombs[0]!.x).toBeCloseTo(2.5 + 32 / TILE);
  });
});

describe('animation helpers', () => {
  it('maps the fuse to ring frames, never showing an empty ring for a live pop', () => {
    expect(fuseFrame(1, 24)).toBe(24);
    expect(fuseFrame(0.5, 24)).toBe(12);
    expect(fuseFrame(0.001, 24)).toBe(1);
    expect(fuseFrame(0, 24)).toBe(0);
  });

  it('pulses faster and deeper as the fuse burns down', () => {
    let calmMax = 0;
    let urgentMax = 0;
    for (let t = 0; t < 120; t++) {
      calmMax = Math.max(calmMax, popPulse(1, t));
      urgentMax = Math.max(urgentMax, popPulse(0.05, t));
    }
    expect(urgentMax).toBeGreaterThan(calmMax);
    expect(calmMax).toBeLessThan(1.06);
  });

  it('blinks briefly and deterministically per seat', () => {
    let blinks = 0;
    for (let t = 0; t < BLINK_PERIOD; t++) if (isBlinking(t, 2)) blinks++;
    expect(blinks).toBe(7);
    expect(isBlinking(0, 0)).toBe(true);
    expect(isBlinking(0, 1)).toBe(false);
  });

  it('scares Puffs next to flames or in the line of a pop about to go off', () => {
    const state = tinyArena(['#######', '#0....#', '#.o.o.#', '#.....#', '#######']);
    expect(isScared(state, 1, 1)).toBe(false);
    addBomb(state, 4, 1, 1, 200, 2);
    expect(isScared(state, 1, 1)).toBe(false);
    state.bombFuse[0] = 30;
    expect(isScared(state, 3, 1)).toBe(true);
    expect(isScared(state, 1, 1)).toBe(false); // out of range 2
    state.flame[cellIndex(2, 2)] = 5;
    expect(isScared(state, 1, 1)).toBe(true);
  });

  it('picks blink over scared over facing for the eyes', () => {
    const base = {
      visible: true,
      ghost: false,
      x: 0,
      y: 0,
      facing: Dir.LEFT,
      moving: false,
      scared: false,
      blink: false,
      scaleX: 1,
      scaleY: 1,
      hop: 0,
      rotation: 0,
      victory: false,
    };
    expect(eyeVariant(base)).toBe(Dir.LEFT);
    expect(eyeVariant({ ...base, scared: true, victory: true })).toBe(EYE_BLINK);
    expect(eyeVariant({ ...base, scared: true })).toBe(EYE_SCARED);
    expect(eyeVariant({ ...base, scared: true, blink: true })).toBe(EYE_BLINK);
  });
});

describe('feel animations (T3.1)', () => {
  it('pops pop in with an overshoot, then rest at full size', () => {
    expect(popInScale(0)).toBeCloseTo(0.6);
    const peak = Math.max(...[1, 2, 3, 4, 5, 6, 7].map(popInScale));
    expect(peak).toBeGreaterThan(1);
    expect(popInScale(POP_IN_TICKS)).toBe(1);
    expect(popInScale(500)).toBe(1);
  });

  it('a pop in its final half second blinks hot', () => {
    const state = tinyArena(['#######', '#0....#', '#######']);
    addBomb(state, 4, 1, 0, HOT_FUSE_TICKS + 8, 1);
    const scene = new Scene();
    const history = new TickHistory();
    const hot: boolean[] = [];
    for (let t = 0; t < 30; t++) {
      history.capture(state);
      step(state, only(0, 0));
      hot.push(extractScene(state, history, 0, scene).bombs[0]!.hot);
    }
    expect(hot.slice(0, 7).some(Boolean)).toBe(false);
    expect(hot.slice(8).some(Boolean)).toBe(true);
    expect(hot.slice(8).every(Boolean)).toBe(false);
  });

  it('the round winner dances with happy eyes; losers and running rounds do not', () => {
    const state = tinyArena(['#######', '#0..1.#', '#######']);
    const scene = new Scene();
    expect(isRoundWinner(state, 0)).toBe(false);
    state.hdr[Hdr.PHASE] = Phase.ROUND_OVER;
    state.hdr[Hdr.ROUND_WINNER] = 0;
    state.alive[1] = 0;
    expect(isRoundWinner(state, 0)).toBe(true);
    expect(isRoundWinner(state, 1)).toBe(false);
    const view = extractScene(state, new TickHistory(), 0, scene).players[0]!;
    expect(view.victory).toBe(true);
    expect(eyeVariant(view)).toBe(EYE_BLINK);
    let maxHop = 0;
    let maxTilt = 0;
    for (let t = 0; t < 60; t++) {
      state.hdr[Hdr.TICK] = t;
      const v = extractScene(state, new TickHistory(), 0, scene).players[0]!;
      maxHop = Math.max(maxHop, -v.hop);
      maxTilt = Math.max(maxTilt, Math.abs(v.rotation));
    }
    expect(maxHop).toBeGreaterThan(0.15);
    expect(maxTilt).toBeGreaterThan(0.1);
    state.hdr[Hdr.ROUND_WINNER] = NO_SIDE;
    expect(isRoundWinner(state, 0)).toBe(false);
  });
});

describe('FramePool', () => {
  it('reuses items across frames and hides the unused ones', () => {
    let created = 0;
    const pool = new FramePool(
      () => ({ id: created++, visible: false }),
      (item, visible) => {
        item.visible = visible;
      },
    );
    pool.begin();
    const a = pool.next();
    const b = pool.next();
    pool.end();
    expect(created).toBe(2);
    expect(a.visible && b.visible).toBe(true);
    pool.begin();
    expect(pool.next()).toBe(a);
    pool.end();
    expect(pool.active).toBe(1);
    expect(b.visible).toBe(false);
    expect(pool.size).toBe(2);
  });
});
