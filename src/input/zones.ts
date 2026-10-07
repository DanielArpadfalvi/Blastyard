import { DEFAULT_DP_PER_MM, distanceToRect, type Rect, rectContains } from './geometry';
import { DEFAULT_TAP_PARAMS, isTap, type TapParams } from './gestures';
import { type InputSource, MAX_SEATS, offerDirection, type SeatFrame } from './frame';
import {
  localSize,
  type SeatOrientation,
  type Vec,
  zoneLocalPoint,
  zoneScreenPoint,
} from './rotation';
import { DEFAULT_STICK_PARAMS, FloatingStick, type StickParams } from './stick';

/**
 * - `twoThumb` (solo, face-off): floating stick in the seat-left 55% of the zone, bomb button in
 *   the seat-bottom-right quarter (mirrored when left-handed).
 * - `oneFinger` (four corners): the whole zone is a floating stick; a short tap or a second
 *   finger in the zone is a bomb.
 */
export type ControlScheme = 'twoThumb' | 'oneFinger';

/** A control zone, provided by the layout solver in viewport CSS pixels. */
export interface ZoneSpec {
  seat: number;
  rect: Rect;
  orientation: SeatOrientation;
  scheme: ControlScheme;
  /** twoThumb: stick on the seat-right, bomb button on the seat-left. */
  leftHanded?: boolean;
  /** twoThumb: explicit bomb button centre (screen dp); default derived from the zone. */
  bombCenter?: Vec;
}

export interface TouchParams {
  stick: StickParams;
  tap: TapParams;
  /** twoThumb: share of the zone's seat-local width that starts the stick. */
  stickShare: number;
  /** Bomb button: drawn diameter / touch-target diameter (dp). */
  bombVisibleDiameter: number;
  bombHitDiameter: number;
  /** Dead band between neighbouring zones (mm). */
  gutterMm: number;
  /** Physical density from the layout solver; used for the mm-based gutter. */
  dpPerMm: number;
}

export const DEFAULT_TOUCH_PARAMS: TouchParams = {
  stick: DEFAULT_STICK_PARAMS,
  tap: DEFAULT_TAP_PARAMS,
  stickShare: 0.55,
  bombVisibleDiameter: 72,
  bombHitDiameter: 96,
  gutterMm: 4,
  dpPerMm: DEFAULT_DP_PER_MM,
};

type Role = 'stick' | 'bomb' | 'second' | 'idle';

interface PointerRecord {
  zone: number;
  role: Role;
  downX: number;
  downY: number;
  downT: number;
  travel: number;
}

interface ZoneState {
  spec: ZoneSpec;
  stick: FloatingStick;
  stickPointer: number | null;
  bombCenter: Vec;
  bombFingers: number;
  bombPending: boolean;
}

/** Read-only zone state for drawing the controls. */
export interface ZoneView {
  seat: number;
  rect: Rect;
  orientation: SeatOrientation;
  scheme: ControlScheme;
  stickActive: boolean;
  stickCenter: Vec;
  stickFinger: Vec;
  /** twoThumb only (null for oneFinger). */
  bombCenter: Vec | null;
  bombRadius: number;
  bombDown: boolean;
}

/** Default bomb button centre: middle of the seat-local bottom-right (or -left) quarter. */
export function defaultBombCenter(spec: ZoneSpec): Vec {
  const size = localSize(spec.rect, spec.orientation);
  const lx = spec.leftHanded ? size.w * 0.25 : size.w * 0.75;
  return zoneScreenPoint(spec.rect, spec.orientation, lx, size.h * 0.75);
}

/**
 * Multi-touch zone manager. A pointer belongs to the zone it started in until release, even if
 * it slides out; pointers starting over the arena, outside every zone or inside the gutter
 * between two zones are ignored for their whole life.
 */
export class TouchZones implements InputSource {
  readonly params: TouchParams;
  private zones: ZoneState[] = [];
  private arena: Rect | null = null;
  private readonly pointers = new Map<number, PointerRecord>();

  constructor(params: Partial<TouchParams> = {}) {
    this.params = { ...DEFAULT_TOUCH_PARAMS, ...params };
  }

  /** Replaces the layout; active touches are dropped (no tap/bomb is produced). */
  setLayout(zones: readonly ZoneSpec[], arena: Rect | null): void {
    this.pointers.clear();
    this.arena = arena;
    this.zones = zones.map((spec) => ({
      spec,
      stick: new FloatingStick(this.params.stick),
      stickPointer: null,
      bombCenter: spec.bombCenter ?? defaultBombCenter(spec),
      bombFingers: 0,
      bombPending: false,
    }));
  }

  get gutter(): number {
    return this.params.gutterMm * this.params.dpPerMm;
  }

  /** Index of the zone that would own a touch starting at (x, y), or -1. */
  hitTest(x: number, y: number): number {
    if (this.arena && rectContains(this.arena, x, y)) return -1;
    const half = this.gutter / 2;
    for (let i = 0; i < this.zones.length; i++) {
      const rect = (this.zones[i] as ZoneState).spec.rect;
      if (!rectContains(rect, x, y)) continue;
      let clear = true;
      for (let j = 0; j < this.zones.length && clear; j++) {
        if (j !== i && distanceToRect((this.zones[j] as ZoneState).spec.rect, x, y) < half) {
          clear = false;
        }
      }
      return clear ? i : -1;
    }
    return -1;
  }

  /** Returns true when the touch was claimed by a zone. */
  pointerDown(id: number, x: number, y: number, timeMs: number): boolean {
    if (this.pointers.has(id)) this.pointerCancel(id);
    const index = this.hitTest(x, y);
    if (index < 0) return false;
    const zone = this.zones[index] as ZoneState;
    const role = this.roleFor(zone, x, y);
    this.pointers.set(id, { zone: index, role, downX: x, downY: y, downT: timeMs, travel: 0 });
    if (role === 'stick') {
      zone.stickPointer = id;
      zone.stick.press(x, y);
    } else if (role === 'bomb') {
      zone.bombFingers++;
      zone.bombPending = true;
    } else if (role === 'second') {
      zone.bombPending = true;
    }
    return true;
  }

  pointerMove(id: number, x: number, y: number): void {
    const p = this.pointers.get(id);
    if (!p) return;
    p.travel = Math.max(p.travel, Math.hypot(x - p.downX, y - p.downY));
    if (p.role === 'stick') (this.zones[p.zone] as ZoneState).stick.move(x, y);
  }

  pointerUp(id: number, x: number, y: number, timeMs: number): void {
    const p = this.pointers.get(id);
    if (!p) return;
    this.pointerMove(id, x, y);
    const zone = this.zones[p.zone] as ZoneState;
    if (
      p.role === 'stick' &&
      zone.spec.scheme === 'oneFinger' &&
      isTap(timeMs - p.downT, p.travel, this.params.tap)
    ) {
      zone.bombPending = true;
    }
    this.end(id, p);
  }

  /** The system took the touch (gesture, palm rejection…): release without a tap. */
  pointerCancel(id: number): void {
    const p = this.pointers.get(id);
    if (p) this.end(id, p);
  }

  reset(): void {
    for (const zone of this.zones) {
      zone.stick.release();
      zone.stickPointer = null;
      zone.bombFingers = 0;
      zone.bombPending = false;
    }
    this.pointers.clear();
  }

  /** Is a finger down in the zone of `seat` (any role, however it got there)? */
  touching(seat: number): boolean {
    for (const p of this.pointers.values()) {
      if ((this.zones[p.zone] as ZoneState).spec.seat === seat) return true;
    }
    return false;
  }

  /** Number of touches currently bound to a zone. */
  get activePointers(): number {
    return this.pointers.size;
  }

  contribute(frames: readonly SeatFrame[]): void {
    for (const zone of this.zones) {
      const seat = zone.spec.seat;
      if (seat < 0 || seat >= MAX_SEATS) continue;
      const frame = frames[seat] as SeatFrame;
      offerDirection(frame, zone.stick.main, zone.stick.secondary);
      if (zone.bombPending) frame.bomb = true;
      zone.bombPending = false;
    }
  }

  views(): ZoneView[] {
    return this.zones.map((zone) => ({
      seat: zone.spec.seat,
      rect: zone.spec.rect,
      orientation: zone.spec.orientation,
      scheme: zone.spec.scheme,
      stickActive: zone.stick.active,
      stickCenter: { x: zone.stick.cx, y: zone.stick.cy },
      stickFinger: { x: zone.stick.x, y: zone.stick.y },
      bombCenter: zone.spec.scheme === 'twoThumb' ? zone.bombCenter : null,
      bombRadius: this.params.bombVisibleDiameter / 2,
      bombDown: zone.bombFingers > 0,
    }));
  }

  private roleFor(zone: ZoneState, x: number, y: number): Role {
    const { spec, stick } = zone;
    if (spec.scheme === 'oneFinger') return stick.active ? 'second' : 'stick';
    const hitR = this.params.bombHitDiameter / 2;
    if (Math.hypot(x - zone.bombCenter.x, y - zone.bombCenter.y) <= hitR) return 'bomb';
    const local = zoneLocalPoint(spec.rect, spec.orientation, x, y);
    const w = localSize(spec.rect, spec.orientation).w;
    const share = this.params.stickShare;
    const inStickPart = spec.leftHanded ? local.x >= w * (1 - share) : local.x < w * share;
    return inStickPart && !stick.active ? 'stick' : 'idle';
  }

  private end(id: number, p: PointerRecord): void {
    const zone = this.zones[p.zone] as ZoneState;
    if (p.role === 'stick' && zone.stickPointer === id) {
      zone.stick.release();
      zone.stickPointer = null;
    } else if (p.role === 'bomb') {
      zone.bombFingers = Math.max(0, zone.bombFingers - 1);
    }
    this.pointers.delete(id);
  }
}
