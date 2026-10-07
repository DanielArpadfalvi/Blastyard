/**
 * Game-feel effects model (T3.1): particles (blast sparks, fire puffs, smoke, crate debris, dust,
 * pickup sparkles, victory confetti), screen shake (≤ {@link MAX_SHAKE_PX} px), blast flash,
 * sudden-death block drops, elimination "deflate" and per-Puff squash pulses.
 *
 * Driven only by simulation events (plus a read-only look at the state at event time). Every
 * effect is a closed-form function of its age in simulation ticks (`tick + alpha`), so nothing is
 * integrated per frame: a paused or slowed-down game (game speed 70/85 %) shows exactly the same
 * picture for the same moment, and particle randomness comes from a per-event seed – no
 * `Math.random`. Pure and Pixi-free (unit-tested); `effectsView.ts` puts the numbers on sprites.
 *
 * Reduced motion (PLAN §1.12): no shake, no flash, half the particles.
 */

import {
  EventKind,
  GRID_H,
  GRID_W,
  Hdr,
  MAX_SEATS,
  NO_OWNER,
  NO_SIDE,
  RuleFlag,
  TILE,
  type SimEvent,
} from '../core';
import * as P from './palette';
import type { ReadonlySimState } from './readonlyState';

/** Particle pool size (PLAN §3.3: max 300). */
export const MAX_PARTICLES = 300;
/** Particles per quality level (0 = minimal, 1 = reduced, 2 = full). */
export const QUALITY_PARTICLES: readonly number[] = [60, 150, MAX_PARTICLES];
export const MAX_SHAKE_PX = 6;
export const FLASH_TICKS = 7;
export const FLASH_ALPHA = 0.32;
/** A sudden-death block falls for this long before it lands. */
export const BLOCK_DROP_TICKS = 12;
/** Height (tiles) a sudden-death block falls from. */
export const BLOCK_DROP_HEIGHT = 1.6;
export const DEATH_TICKS = 32;
export const PULSE_TICKS = 10;

export type EffectQuality = 0 | 1 | 2;

export interface FxSettings {
  readonly reducedMotion: boolean;
  readonly quality: EffectQuality;
}

export const DEFAULT_FX: FxSettings = { reducedMotion: false, quality: 2 };

/** Particle kinds (= texture per kind in the view). */
export const Fx = {
  SPARK: 0,
  FIRE: 1,
  SMOKE: 2,
  CHIP: 3,
  DUST: 4,
  STAR: 5,
  CONFETTI: 6,
} as const;
export const FX_KINDS = 7;

/** Squash pulse kinds per seat. */
export const Pulse = { NONE: 0, PLACE: 1, PICKUP: 2 } as const;

const SHAKE_SLOTS = 12;
const FLASH_SLOTS = 6;
const MAX_DROPS = 64;

/** Small deterministic generator for effect variety (seeded per event). */
class FxRng {
  private s = 1;
  seed(n: number): void {
    this.s = (Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) ^ 0x27d4eb2f) >>> 0 || 1;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
}

interface ParticleSpec {
  kind: number;
  t0: number;
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  drag: number;
  vz: number;
  g: number;
  rot: number;
  spin: number;
  s0: number;
  s1: number;
  tint: number;
  alpha: number;
}

/** What the view draws this frame (refilled by {@link Effects.update}). */
export class FxFrame {
  /** Live particles in [0, count). Positions in grid tiles, scale relative to a tile. */
  count = 0;
  readonly kind = new Uint8Array(MAX_PARTICLES);
  readonly x = new Float32Array(MAX_PARTICLES);
  readonly y = new Float32Array(MAX_PARTICLES);
  readonly rotation = new Float32Array(MAX_PARTICLES);
  readonly scale = new Float32Array(MAX_PARTICLES);
  readonly alpha = new Float32Array(MAX_PARTICLES);
  readonly tint = new Uint32Array(MAX_PARTICLES);
  /** Screen shake offset (px). */
  shakeX = 0;
  shakeY = 0;
  /** White flash over the arena, 0–1 alpha. */
  flash = 0;
  /** Falling sudden-death blocks: cell and progress 0–1 (1 = landed). */
  dropCount = 0;
  readonly dropCell = new Int16Array(MAX_DROPS);
  readonly dropProgress = new Float32Array(MAX_DROPS);
  /** Per seat: elimination progress 0–1 (−1 = none) and where (tiles). */
  readonly deathProgress = new Float32Array(MAX_SEATS).fill(-1);
  readonly deathX = new Float32Array(MAX_SEATS);
  readonly deathY = new Float32Array(MAX_SEATS);
  /** Per seat squash multipliers (1 = none). */
  readonly pulseX = new Float32Array(MAX_SEATS).fill(1);
  readonly pulseY = new Float32Array(MAX_SEATS).fill(1);
}

function sideOf(state: ReadonlySimState, seat: number): number {
  return ((state.hdr[Hdr.RULE_FLAGS] as number) & RuleFlag.TEAMS) !== 0
    ? (state.team[seat] as number)
    : seat;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const CHIP_TINTS = [P.WOOD, P.WOOD_DARK, P.WOOD_LIGHT];
const CONFETTI_TINTS = [...P.SEAT_COLORS, 0xffffff, P.FUSE];

export class Effects {
  readonly frame = new FxFrame();
  private settings: FxSettings = DEFAULT_FX;
  // Particle store (struct of arrays, ring buffer over the active budget).
  private readonly pKind = new Uint8Array(MAX_PARTICLES);
  private readonly pT0 = new Float64Array(MAX_PARTICLES);
  private readonly pLife = new Float32Array(MAX_PARTICLES);
  private readonly pX = new Float32Array(MAX_PARTICLES);
  private readonly pY = new Float32Array(MAX_PARTICLES);
  private readonly pVx = new Float32Array(MAX_PARTICLES);
  private readonly pVy = new Float32Array(MAX_PARTICLES);
  private readonly pDrag = new Float32Array(MAX_PARTICLES);
  private readonly pVz = new Float32Array(MAX_PARTICLES);
  private readonly pG = new Float32Array(MAX_PARTICLES);
  private readonly pRot = new Float32Array(MAX_PARTICLES);
  private readonly pSpin = new Float32Array(MAX_PARTICLES);
  private readonly pS0 = new Float32Array(MAX_PARTICLES);
  private readonly pS1 = new Float32Array(MAX_PARTICLES);
  private readonly pTint = new Uint32Array(MAX_PARTICLES);
  private readonly pAlpha = new Float32Array(MAX_PARTICLES);
  private cursor = 0;
  private spawned = 0;
  // Shake / flash impulses: start, length, strength.
  private readonly shakeT0 = new Float64Array(SHAKE_SLOTS).fill(-1e9);
  private readonly shakeLen = new Float32Array(SHAKE_SLOTS).fill(1);
  private readonly shakeAmp = new Float32Array(SHAKE_SLOTS);
  private shakeNext = 0;
  private readonly flashT0 = new Float64Array(FLASH_SLOTS).fill(-1e9);
  private readonly flashAmp = new Float32Array(FLASH_SLOTS);
  private flashNext = 0;
  private readonly dropCells: number[] = [];
  private readonly dropT0: number[] = [];
  private readonly deathT0 = new Float64Array(MAX_SEATS).fill(-1e9);
  /** Ticks the deflate waits after the elimination (a falling block has to land first). */
  private readonly deathDelay = new Float32Array(MAX_SEATS);
  private readonly deathX = new Float32Array(MAX_SEATS);
  private readonly deathY = new Float32Array(MAX_SEATS);
  private readonly pulseT0 = new Float64Array(MAX_SEATS).fill(-1e9);
  private readonly pulseKind = new Uint8Array(MAX_SEATS);
  private lastTick = -1;
  private readonly rng = new FxRng();
  private readonly spec: ParticleSpec = {
    kind: 0,
    t0: 0,
    life: 1,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    drag: 0,
    vz: 0,
    g: 0,
    rot: 0,
    spin: 0,
    s0: 1,
    s1: 1,
    tint: 0xffffff,
    alpha: 1,
  };

  setSettings(settings: FxSettings): void {
    this.settings = settings;
    if (settings.reducedMotion) {
      this.shakeAmp.fill(0);
      this.flashAmp.fill(0);
    }
  }

  getSettings(): FxSettings {
    return this.settings;
  }

  /** Particle budget for the current settings. */
  budget(): number {
    const base = QUALITY_PARTICLES[this.settings.quality] ?? MAX_PARTICLES;
    return this.settings.reducedMotion ? Math.round(base / 2) : base;
  }

  /** Particles spawned since creation (stats / tests). */
  get totalSpawned(): number {
    return this.spawned;
  }

  /** Scales a full-quality particle count to the current budget (at least one). */
  private n(full: number): number {
    return Math.max(1, Math.round((full * this.budget()) / MAX_PARTICLES));
  }

  private emit(): void {
    const s = this.spec;
    const cap = this.budget();
    if (this.cursor >= cap) this.cursor = 0;
    const i = this.cursor++;
    this.pKind[i] = s.kind;
    this.pT0[i] = s.t0;
    this.pLife[i] = s.life;
    this.pX[i] = s.x;
    this.pY[i] = s.y;
    this.pVx[i] = s.vx;
    this.pVy[i] = s.vy;
    this.pDrag[i] = s.drag;
    this.pVz[i] = s.vz;
    this.pG[i] = s.g;
    this.pRot[i] = s.rot;
    this.pSpin[i] = s.spin;
    this.pS0[i] = s.s0;
    this.pS1[i] = s.s1;
    this.pTint[i] = s.tint;
    this.pAlpha[i] = s.alpha;
    this.spawned++;
  }

  private reset(kind: number, t0: number, x: number, y: number): ParticleSpec {
    const s = this.spec;
    s.kind = kind;
    s.t0 = t0;
    s.x = x;
    s.y = y;
    s.vx = 0;
    s.vy = 0;
    s.drag = 0;
    s.vz = 0;
    s.g = 0;
    s.rot = 0;
    s.spin = 0;
    s.s0 = 1;
    s.s1 = 1;
    s.tint = 0xffffff;
    s.alpha = 1;
    s.life = 20;
    return s;
  }

  private shake(t0: number, amp: number, len: number): void {
    if (this.settings.reducedMotion) return;
    const i = this.shakeNext;
    this.shakeNext = (i + 1) % SHAKE_SLOTS;
    this.shakeT0[i] = t0;
    this.shakeAmp[i] = amp;
    this.shakeLen[i] = len;
  }

  private flash(t0: number, amp: number): void {
    if (this.settings.reducedMotion) return;
    const i = this.flashNext;
    this.flashNext = (i + 1) % FLASH_SLOTS;
    this.flashT0[i] = t0;
    this.flashAmp[i] = amp;
  }

  private burst(
    kind: number,
    count: number,
    t0: number,
    cx: number,
    cy: number,
    opts: {
      speed: [number, number];
      life: [number, number];
      scale: [number, number];
      end: number;
      tints: readonly number[];
      drag?: number;
      vz?: [number, number];
      g?: number;
      spin?: number;
      jitter?: number;
      alpha?: number;
      delay?: number;
    },
  ): void {
    const r = this.rng;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + r.range(-0.4, 0.4);
      const v = r.range(opts.speed[0], opts.speed[1]);
      const j = opts.jitter ?? 0;
      const s = this.reset(
        kind,
        t0 + (opts.delay ?? 0) + r.range(0, 1.5),
        cx + r.range(-j, j),
        cy + r.range(-j, j),
      );
      s.vx = Math.cos(a) * v;
      s.vy = Math.sin(a) * v;
      s.drag = opts.drag ?? 0;
      if (opts.vz) s.vz = r.range(opts.vz[0], opts.vz[1]);
      s.g = opts.g ?? 0;
      s.rot = r.range(0, Math.PI * 2);
      s.spin = opts.spin ? r.range(-opts.spin, opts.spin) : 0;
      s.life = r.range(opts.life[0], opts.life[1]);
      const sc = r.range(opts.scale[0], opts.scale[1]);
      s.s0 = sc;
      s.s1 = sc * opts.end;
      s.tint = opts.tints[Math.floor(r.next() * opts.tints.length)] as number;
      s.alpha = opts.alpha ?? 1;
      this.emit();
    }
  }

  /**
   * Spawns effects for one simulated tick's events. `state` is the state right after that tick
   * (read only). Events of a tick that was already seen are ignored (re-simulated ticks).
   */
  push(events: readonly SimEvent[], state: ReadonlySimState): void {
    if (events.length === 0) return;
    const tick = events[0]!.tick;
    if (tick <= this.lastTick) return;
    this.lastTick = tick;
    for (const e of events) this.spawnFor(e, state);
  }

  private spawnFor(e: SimEvent, state: ReadonlySimState): void {
    const t0 = e.tick;
    const cx = e.cell >= 0 ? (e.cell % GRID_W) + 0.5 : GRID_W / 2;
    const cy = e.cell >= 0 ? Math.floor(e.cell / GRID_W) + 0.5 : GRID_H / 2;
    this.rng.seed(Math.imul(e.tick, 7919) + e.cell * 31 + e.kind * 977 + e.seat);
    switch (e.kind) {
      case EventKind.BOMB_EXPLODED:
        this.blast(e, state, t0, cx, cy);
        break;
      case EventKind.CRATE_DESTROYED:
        this.burst(Fx.CHIP, this.n(9), t0, cx, cy, {
          speed: [0.03, 0.075],
          life: [30, 42],
          scale: [0.32, 0.5],
          end: 0.9,
          tints: CHIP_TINTS,
          drag: 0.05,
          vz: [0.09, 0.15],
          g: 0.011,
          spin: 0.35,
          jitter: 0.2,
        });
        this.burst(Fx.DUST, this.n(4), t0, cx, cy, {
          speed: [0.005, 0.02],
          life: [26, 34],
          scale: [0.45, 0.6],
          end: 1.8,
          tints: [0xe2d3b0],
          alpha: 0.7,
          jitter: 0.25,
        });
        if (e.value !== 0) {
          this.burst(Fx.STAR, this.n(4), t0 + 4, cx, cy, {
            speed: [0.02, 0.035],
            life: [16, 22],
            scale: [0.25, 0.35],
            end: 0.2,
            tints: [0xffffff, P.FUSE],
            drag: 0.08,
          });
        }
        break;
      case EventKind.PICKUP_COLLECTED:
        this.burst(Fx.STAR, this.n(7), t0, cx, cy, {
          speed: [0.03, 0.05],
          life: [16, 24],
          scale: [0.28, 0.4],
          end: 0.15,
          tints: [P.FUSE, 0xffffff, P.FLAME_CORE],
          drag: 0.07,
          vz: [0.02, 0.04],
          spin: 0.2,
        });
        this.pulse(e.seat, t0, Pulse.PICKUP);
        break;
      case EventKind.PICKUP_BURNED:
        this.burst(Fx.SMOKE, this.n(3), t0, cx, cy, {
          speed: [0.004, 0.012],
          life: [26, 36],
          scale: [0.35, 0.5],
          end: 2,
          tints: [0x8a8178],
          vz: [0.008, 0.014],
          alpha: 0.6,
        });
        break;
      case EventKind.BOMB_PLACED:
        this.pulse(e.seat, t0, Pulse.PLACE);
        this.burst(Fx.DUST, this.n(3), t0, cx, cy + 0.3, {
          speed: [0.01, 0.02],
          life: [14, 20],
          scale: [0.25, 0.35],
          end: 1.6,
          tints: [0xe2d3b0],
          alpha: 0.55,
        });
        break;
      case EventKind.DEATH: {
        // Crushed by a sudden-death block: the Puff stands until the block lands on it.
        const delay = e.value === NO_OWNER ? BLOCK_DROP_TICKS : 0;
        if (e.seat < MAX_SEATS) {
          this.deathT0[e.seat] = t0;
          this.deathDelay[e.seat] = delay;
          this.deathX[e.seat] = cx;
          this.deathY[e.seat] = cy;
        }
        this.burst(Fx.SMOKE, this.n(10), t0 + delay + 8, cx, cy, {
          speed: [0.03, 0.05],
          life: [26, 36],
          scale: [0.3, 0.45],
          end: 2.1,
          tints: [0xf1ece4, 0xd9d2c8],
          drag: 0.09,
          alpha: 0.85,
        });
        this.shake(t0 + delay, 4, 14);
        break;
      }
      case EventKind.BLOCK_DROPPED:
        if (this.dropCells.length >= MAX_DROPS) {
          this.dropCells.shift();
          this.dropT0.shift();
        }
        this.dropCells.push(e.cell);
        this.dropT0.push(t0);
        this.burst(Fx.DUST, this.n(7), t0, cx, cy + 0.3, {
          speed: [0.03, 0.05],
          life: [22, 30],
          scale: [0.35, 0.5],
          end: 2,
          tints: [0xd9c7a0, 0xc7b38a],
          drag: 0.1,
          alpha: 0.8,
          delay: BLOCK_DROP_TICKS,
        });
        this.shake(t0 + BLOCK_DROP_TICKS, 2.5, 9);
        break;
      case EventKind.GHOST_BOMB:
        this.burst(Fx.STAR, this.n(5), t0, cx, cy, {
          speed: [0.02, 0.035],
          life: [18, 26],
          scale: [0.25, 0.35],
          end: 0.2,
          tints: [P.POP_GHOST, 0xffffff],
          drag: 0.06,
        });
        break;
      case EventKind.ROUND_END:
        if (e.value === NO_SIDE) break;
        for (let s = 0; s < MAX_SEATS; s++) {
          if (!state.alive[s] || sideOf(state, s) !== e.value) continue;
          const px = (state.px[s] as number) / TILE;
          const py = (state.py[s] as number) / TILE;
          this.rng.seed(e.tick * 13 + s);
          this.burst(Fx.CONFETTI, this.n(26), t0, px, py, {
            speed: [0.02, 0.06],
            life: [60, 85],
            scale: [0.22, 0.3],
            end: 1,
            tints: CONFETTI_TINTS,
            drag: 0.03,
            vz: [0.12, 0.2],
            g: 0.006,
            spin: 0.3,
          });
        }
        break;
      default:
        break;
    }
  }

  private blast(e: SimEvent, state: ReadonlySimState, t0: number, cx: number, cy: number): void {
    const range = Math.max(1, e.value);
    // Fire puffs along the burning arms (read from the state right after the blast).
    const fire = this.n(2);
    const puff = (x: number, y: number, k: number): void => {
      for (let i = 0; i < fire; i++) {
        const s = this.reset(Fx.FIRE, t0 + k * 0.6 + this.rng.range(0, 1), x, y);
        s.x += this.rng.range(-0.18, 0.18);
        s.y += this.rng.range(-0.18, 0.18);
        s.vx = this.rng.range(-0.008, 0.008);
        s.vy = this.rng.range(-0.008, 0.008);
        s.vz = this.rng.range(0.004, 0.012);
        s.life = this.rng.range(12, 18);
        s.s0 = this.rng.range(0.55, 0.75);
        s.s1 = s.s0 * 1.5;
        s.tint = this.rng.next() < 0.5 ? P.FLAME_MID : P.FLAME_OUTER;
        s.rot = this.rng.range(0, Math.PI * 2);
        this.emit();
      }
    };
    puff(cx, cy, 0);
    const center = e.cell;
    const x0 = center % GRID_W;
    const y0 = Math.floor(center / GRID_W);
    let tips = 0;
    for (const [dx, dy] of DIRS) {
      let reach = 0;
      for (let d = 1; d <= range; d++) {
        const x = x0 + dx * d;
        const y = y0 + dy * d;
        if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) break;
        if ((state.flame[y * GRID_W + x] as number) === 0) break;
        reach = d;
        if (this.settings.quality > 0 || d === 1) puff(x + 0.5, y + 0.5, d);
      }
      if (reach > 0) tips++;
    }
    this.burst(Fx.SPARK, this.n(12 + 2 * tips), t0, cx, cy, {
      speed: [0.06, 0.16],
      life: [12, 20],
      scale: [0.16, 0.24],
      end: 0.3,
      tints: [P.FLAME_CORE, 0xffffff, P.FUSE],
      drag: 0.09,
      spin: 0.2,
    });
    if (this.settings.quality > 0) {
      this.burst(Fx.SMOKE, this.n(4), t0 + 6, cx, cy, {
        speed: [0.004, 0.012],
        life: [36, 50],
        scale: [0.45, 0.6],
        end: 2.2,
        tints: [0x5f5852, 0x766d64],
        vz: [0.008, 0.014],
        alpha: 0.55,
        jitter: 0.2,
      });
    }
    this.shake(t0, 2.5 + Math.min(2, range * 0.4), 14);
    this.flash(t0, FLASH_ALPHA);
  }

  private pulse(seat: number, t0: number, kind: number): void {
    if (seat >= MAX_SEATS) return;
    this.pulseT0[seat] = t0;
    this.pulseKind[seat] = kind;
  }

  /** Evaluates every effect at `time` (= tick + alpha) into {@link frame}. */
  update(time: number): FxFrame {
    const f = this.frame;
    let n = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const life = this.pLife[i] as number;
      if (life <= 0) continue;
      const age = time - (this.pT0[i] as number);
      if (age > life) {
        this.pLife[i] = 0;
        continue;
      }
      if (age < 0) continue;
      const drag = this.pDrag[i] as number;
      const travel = drag > 0 ? (1 - Math.exp(-drag * age)) / drag : age;
      const g = this.pG[i] as number;
      let z = (this.pVz[i] as number) * age - 0.5 * g * age * age;
      if (z < 0) z = 0;
      const p = age / life;
      const kind = this.pKind[i] as number;
      f.kind[n] = kind;
      // Debris stays over the arena (it never flies onto the control strips).
      const px = (this.pX[i] as number) + (this.pVx[i] as number) * travel;
      const py = (this.pY[i] as number) + (this.pVy[i] as number) * travel - z;
      f.x[n] = px < 0.2 ? 0.2 : px > GRID_W - 0.2 ? GRID_W - 0.2 : px;
      f.y[n] = py < -0.6 ? -0.6 : py > GRID_H - 0.2 ? GRID_H - 0.2 : py;
      f.rotation[n] = (this.pRot[i] as number) + (this.pSpin[i] as number) * age;
      f.scale[n] =
        (this.pS0[i] as number) + ((this.pS1[i] as number) - (this.pS0[i] as number)) * p;
      const fadeIn = kind === Fx.SMOKE || kind === Fx.DUST ? Math.min(1, age / 4) : 1;
      const fadeOut = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
      f.alpha[n] = (this.pAlpha[i] as number) * fadeIn * fadeOut;
      f.tint[n] = this.pTint[i] as number;
      n++;
    }
    f.count = n;

    // Shake: decaying impulses, total capped; the offset vector never exceeds the amplitude.
    let amp = 0;
    for (let i = 0; i < SHAKE_SLOTS; i++) {
      const age = time - (this.shakeT0[i] as number);
      const len = this.shakeLen[i] as number;
      if (age < 0 || age >= len) continue;
      const k = 1 - age / len;
      amp += (this.shakeAmp[i] as number) * k * k;
    }
    amp = this.settings.reducedMotion ? 0 : Math.min(MAX_SHAKE_PX, amp);
    const phi = time * 2.1 + Math.sin(time * 0.83) * 2;
    f.shakeX = amp > 0 ? amp * Math.cos(phi) : 0;
    f.shakeY = amp > 0 ? amp * Math.sin(phi) : 0;

    let flash = 0;
    for (let i = 0; i < FLASH_SLOTS; i++) {
      const age = time - (this.flashT0[i] as number);
      if (age < 0 || age >= FLASH_TICKS) continue;
      flash = Math.max(flash, (this.flashAmp[i] as number) * (1 - age / FLASH_TICKS));
    }
    f.flash = this.settings.reducedMotion ? 0 : flash;

    // Block drops (oldest first; finished ones are dropped from the list).
    let d = 0;
    while (this.dropT0.length > 0 && time - (this.dropT0[0] as number) > BLOCK_DROP_TICKS) {
      this.dropT0.shift();
      this.dropCells.shift();
    }
    for (let i = 0; i < this.dropCells.length; i++) {
      const age = time - (this.dropT0[i] as number);
      if (age < 0) continue;
      f.dropCell[d] = this.dropCells[i] as number;
      f.dropProgress[d] = Math.min(1, age / BLOCK_DROP_TICKS);
      d++;
    }
    f.dropCount = d;

    for (let s = 0; s < MAX_SEATS; s++) {
      const sinceDeath = time - (this.deathT0[s] as number);
      const dAge = sinceDeath - (this.deathDelay[s] as number);
      f.deathProgress[s] =
        sinceDeath < 0 || dAge >= DEATH_TICKS ? -1 : Math.max(0, dAge) / DEATH_TICKS;
      f.deathX[s] = this.deathX[s] as number;
      f.deathY[s] = this.deathY[s] as number;
      const pAge = time - (this.pulseT0[s] as number);
      if (pAge >= 0 && pAge < PULSE_TICKS) {
        const k = Math.sin((pAge / PULSE_TICKS) * Math.PI) * (1 - pAge / PULSE_TICKS / 2);
        if (this.pulseKind[s] === Pulse.PLACE) {
          // Squash down onto the pop, then spring back.
          f.pulseX[s] = 1 + 0.16 * k;
          f.pulseY[s] = 1 - 0.2 * k;
        } else {
          f.pulseX[s] = 1 + 0.14 * k;
          f.pulseY[s] = 1 + 0.14 * k;
        }
      } else {
        f.pulseX[s] = 1;
        f.pulseY[s] = 1;
      }
    }
    return f;
  }
}
