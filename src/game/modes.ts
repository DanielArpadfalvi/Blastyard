/**
 * First-playable modes (T2.3): who sits where, which seats are bots, and the touch zones each
 * mode puts into the layout solver's side strips (PLAN §1.3–1.5).
 *
 * - `solo`: one player holding the device (seat 0, orientation 0) against an in-simulation
 *   bot (seat 1). Two-thumb scheme: the floating stick starts anywhere in the left strip, the bomb
 *   button sits in the right strip.
 * - `faceoff`: two players at the short sides of a device laid flat. Seat 0 owns the left strip
 *   (sits at the left edge, orientation 90), seat 1 the right strip (orientation 270); both use
 *   the two-thumb scheme inside their own strip.
 * - `corners` (T2.4 four-corner prototype, PLAN §1.3): up to four players along the long sides
 *   of a device laid flat, each strip split into a top and a bottom corner zone with the
 *   one-finger scheme. Seats follow the spawns (1 top-left, 2 top-right, 3 bottom-left,
 *   4 bottom-right); the top seats sit at the top edge (orientation 180), the bottom ones at the
 *   bottom edge (0). `bots` (0–3) hands the last seats to bots and drops their zones.
 * - `attract`: four bots playing behind the start screen (no zones, no keyboard).
 *
 * Pure: no DOM, no Pixi.
 */

import { DEFAULT_KEY_BINDINGS, type KeyBinding } from '../input/keyboard';
import type { Rect } from '../input/geometry';
import { localSize, zoneScreenPoint, type SeatOrientation, type Vec } from '../input/rotation';
import {
  DEFAULT_TOUCH_PARAMS,
  type ControlScheme,
  type TouchParams,
  type ZoneSpec,
} from '../input/zones';
import type { ArenaLayout } from '../render/layout';
import { BotLevel, MAX_SEATS, type ArenaDef, type MatchSetup } from '../core';

export type GameMode = 'solo' | 'faceoff' | 'corners' | 'attract' | 'party' | 'challenge';
export type SeatKind = 'human' | 'bot' | 'off';

/**
 * Which zone layout a match uses. `party` (T5.1) picks one of the first three from its seat setup;
 * `challenge` (T5.2) is always a single player holding the device (`solo`).
 */
export type LayoutKind = 'solo' | 'faceoff' | 'corners' | 'attract';

export interface SeatPlan {
  readonly seat: number;
  readonly kind: SeatKind;
  /** Where the seat's player sits (HUD rotation, zone layout). */
  readonly orientation: SeatOrientation;
  /** Bot difficulty (`BotLevel` 1–4) of a bot seat; default Normal. */
  readonly botLevel?: number;
}

/** The zone layout a fixed mode uses (`party` carries its own: see `PartyPlan.layout`). */
export function layoutKindOf(mode: GameMode): LayoutKind {
  if (mode === 'challenge') return 'solo';
  if (mode === 'party') return 'faceoff';
  return mode;
}

/** Zones keep this far from the screen edges (system gestures, PLAN §1.3)… */
export const ZONE_EDGE_MM = 8;
/** …and this far from the arena. */
export const ZONE_ARENA_GAP_MM = 2;
/** Gap between the top and bottom corner zones of a strip (= the touch dead band). */
export const CORNER_GUTTER_MM = 4;

const OFF = (seat: number): SeatPlan => ({ seat, kind: 'off', orientation: 0 });

/** Most seats a bot may take in the four-corner prototype (at least one human stays). */
export const MAX_CORNER_BOTS = MAX_SEATS - 1;

/** Corner seats in seat (= spawn) order: top-left, top-right, bottom-left, bottom-right. */
const CORNER_ORIENTATION: readonly SeatOrientation[] = [180, 180, 0, 0];

function clampBots(bots: number): number {
  return Math.min(MAX_CORNER_BOTS, Math.max(0, Math.floor(bots) || 0));
}

/**
 * Seat plan per mode, always `MAX_SEATS` entries in seat order. `bots` only applies to
 * `corners`: the last `bots` seats are bots instead of players.
 */
export function seatPlan(mode: GameMode, bots = 0): SeatPlan[] {
  switch (mode) {
    case 'solo':
      return [
        { seat: 0, kind: 'human', orientation: 0 },
        { seat: 1, kind: 'bot', orientation: 0 },
        OFF(2),
        OFF(3),
      ];
    case 'faceoff':
      return [
        { seat: 0, kind: 'human', orientation: 90 },
        { seat: 1, kind: 'human', orientation: 270 },
        OFF(2),
        OFF(3),
      ];
    case 'corners': {
      const firstBot = MAX_SEATS - clampBots(bots);
      return CORNER_ORIENTATION.map((orientation, seat) => ({
        seat,
        kind: seat < firstBot ? ('human' as const) : ('bot' as const),
        orientation,
      }));
    }
    case 'attract':
      return Array.from({ length: MAX_SEATS }, (_, seat) => ({
        seat,
        kind: 'bot' as const,
        orientation: 0 as const,
      }));
    case 'party':
    case 'challenge':
      // Plans of these modes come from the party setup / the challenge stage (see `party.ts`).
      return [{ seat: 0, kind: 'human', orientation: 0 }, OFF(1), OFF(2), OFF(3)];
  }
}

export interface MatchOptions {
  readonly seed: number;
  readonly arena: ArenaDef;
  readonly winsToMatch: number;
  /** Bot seats in the four-corner prototype (default 0). */
  readonly bots?: number;
  /** Difficulty of every bot seat (`BotLevel` 1–4, default Normal). */
  readonly botLevel?: number;
}

export function matchSetupFor(mode: GameMode, options: MatchOptions): MatchSetup {
  return {
    seed: options.seed,
    arena: options.arena,
    seats: seatPlan(mode, options.bots).map((p) => p.kind !== 'off'),
    bots: seatPlan(mode, options.bots).map((p) =>
      p.kind === 'bot' ? (options.botLevel ?? BotLevel.NORMAL) : BotLevel.NONE,
    ),
    rules: { winsToMatch: options.winsToMatch },
  };
}

/**
 * Keyboard seats for desktop play: solo takes both key sets, face-off and corners one set per
 * seat (seats 1 and 2).
 */
export function keyBindingsFor(mode: GameMode, plan?: readonly SeatPlan[]): KeyBinding[] {
  if (mode === 'attract') return [];
  if (mode === 'party' && plan) {
    // One key set per human seat (the first two); a lone human gets both sets.
    const humans = plan.filter((p) => p.kind === 'human').map((p) => p.seat);
    const [wasd, arrows] = DEFAULT_KEY_BINDINGS as [KeyBinding, KeyBinding];
    if (humans.length === 1) {
      return [
        { ...wasd, seat: humans[0] as number },
        { ...arrows, seat: humans[0] as number },
      ];
    }
    return humans.slice(0, 2).map((seat, i) => ({
      ...(i === 0 ? wasd : arrows),
      seat,
    }));
  }
  if (mode === 'faceoff' || mode === 'corners') return DEFAULT_KEY_BINDINGS.map((b) => ({ ...b }));
  const [wasd, arrows] = DEFAULT_KEY_BINDINGS as [KeyBinding, KeyBinding];
  return [
    { ...wasd, seat: 0 },
    { ...arrows, seat: 0 },
  ];
}

export interface ZonePlan {
  readonly zones: ZoneSpec[];
  /** Touches starting here are ignored (palm rejection). */
  readonly arena: Rect;
  /** Per zone: where an idle stick is hinted (centre of the stick area). */
  readonly stickHints: Vec[];
  /** The usable rectangles inside the left / right strips (screen dp). */
  readonly left: Rect;
  readonly right: Rect;
}

/** Usable control area of a strip: inset from the screen edges and from the arena. */
function stripArea(layout: ArenaLayout, side: 'left' | 'right'): Rect {
  const edge = ZONE_EDGE_MM * layout.dpPerMm;
  const gap = ZONE_ARENA_GAP_MM * layout.dpPerMm;
  const strip = side === 'left' ? layout.leftStrip : layout.rightStrip;
  const y = strip.y + edge;
  const h = Math.max(0, strip.h - 2 * edge);
  if (side === 'left') {
    const x = strip.x + edge;
    return { x, y, w: Math.max(0, strip.x + strip.w - gap - x), h };
  }
  const x = strip.x + gap;
  return { x, y, w: Math.max(0, strip.x + strip.w - edge - x), h };
}

/**
 * Player control preferences (settings, T6.1) for the solo and face-off zones; the four-corner
 * zones are always one-finger. `zoneScale` (percent) sizes the bomb button and the stick follow
 * radius ({@link touchParamsFor}).
 */
export interface ControlPrefs {
  readonly scheme: ControlScheme;
  readonly leftHanded: boolean;
  readonly zoneScale: number;
}

export const DEFAULT_CONTROL_PREFS: ControlPrefs = {
  scheme: 'twoThumb',
  leftHanded: false,
  zoneScale: 100,
};

/** Touch parameters for the preferences (bomb button and stick follow radius scaled). */
export function touchParamsFor(prefs: ControlPrefs): TouchParams {
  const k = Math.min(1.2, Math.max(0.8, prefs.zoneScale / 100));
  const d = DEFAULT_TOUCH_PARAMS;
  return {
    ...d,
    bombVisibleDiameter: Math.round(d.bombVisibleDiameter * k),
    bombHitDiameter: Math.round(d.bombHitDiameter * k),
    stick: { ...d.stick, followRadius: Math.round(d.stick.followRadius * k) },
  };
}

/** Splits a strip area into its top and bottom corner zones, `gutter` apart. */
export function splitCorners(area: Rect, gutter: number): { top: Rect; bottom: Rect } {
  const h = Math.max(0, (area.h - gutter) / 2);
  return {
    top: { x: area.x, y: area.y, w: area.w, h },
    bottom: { x: area.x, y: area.y + area.h - h, w: area.w, h },
  };
}

/**
 * Touch zones of a mode for the solved layout. `bots` only applies to `corners` (bot seats get
 * no zone).
 */
export function zonesFor(mode: GameMode, layout: ArenaLayout, bots = 0): ZonePlan {
  return zonesForPlan(layoutKindOf(mode), layout, seatPlan(mode, bots));
}

/**
 * Touch zones of a layout kind for an explicit seat plan: only human seats get a zone, placed by
 * the layout (solo: the whole device, face-off: seat 0 left strip / seat 1 right strip, corners:
 * one corner per seat) and oriented as the plan says.
 */
export function zonesForPlan(
  kind: LayoutKind,
  layout: ArenaLayout,
  plan: readonly SeatPlan[],
  prefs: ControlPrefs = DEFAULT_CONTROL_PREFS,
): ZonePlan {
  const left = stripArea(layout, 'left');
  const right = stripArea(layout, 'right');
  const arena: Rect = { ...layout.arena };
  const human = (seat: number): boolean => plan[seat]?.kind === 'human';
  const orientationOf = (seat: number): SeatOrientation => plan[seat]?.orientation ?? 0;
  if (kind === 'attract') return { zones: [], arena, stickHints: [], left, right };
  if (kind === 'solo') {
    // One zone over both strips: its seat-left 55 % (the left strip) starts the stick, the bomb
    // button sits in the lower part of the right strip; the arena in between ignores touches.
    const seat = Math.max(
      0,
      plan.findIndex((p) => p.kind === 'human'),
    );
    // Left-handed: the stick starts in the right strip, the bomb button sits in the left one.
    const rect: Rect = { x: left.x, y: left.y, w: right.x + right.w - left.x, h: left.h };
    const [stickStrip, bombStrip] = prefs.leftHanded ? [right, left] : [left, right];
    const bombCenter = { x: bombStrip.x + bombStrip.w / 2, y: bombStrip.y + bombStrip.h * 0.68 };
    const stickHint =
      prefs.scheme === 'oneFinger'
        ? { x: rect.x + rect.w / 2, y: rect.y + rect.h * 0.62 }
        : { x: stickStrip.x + stickStrip.w / 2, y: stickStrip.y + stickStrip.h * 0.62 };
    return {
      zones: [
        {
          seat,
          rect,
          orientation: 0,
          scheme: prefs.scheme,
          bombCenter,
          ...(prefs.leftHanded ? { leftHanded: true } : {}),
        },
      ],
      arena,
      stickHints: [stickHint],
      left,
      right,
    };
  }
  if (kind === 'corners') {
    // One-finger corner zones; the 4 mm gutter between top and bottom matches the dead band
    // `TouchZones` keeps between neighbouring zones (PLAN §1.3).
    const gutter = CORNER_GUTTER_MM * layout.dpPerMm;
    const l = splitCorners(left, gutter);
    const r = splitCorners(right, gutter);
    const rects = [l.top, r.top, l.bottom, r.bottom];
    const zones: ZoneSpec[] = plan
      .filter((p) => p.kind === 'human')
      .map((p) => ({
        seat: p.seat,
        rect: rects[p.seat] as Rect,
        orientation: p.orientation,
        scheme: 'oneFinger',
      }));
    // The whole zone is the stick; hint at its middle.
    const stickHints = zones.map((z) => ({
      x: z.rect.x + z.rect.w / 2,
      y: z.rect.y + z.rect.h / 2,
    }));
    return { zones, arena, stickHints, left, right };
  }
  const zones: ZoneSpec[] = [];
  const faceZone = (seat: number, rect: Rect): ZoneSpec => ({
    seat,
    rect,
    orientation: orientationOf(seat),
    scheme: prefs.scheme,
    ...(prefs.leftHanded ? { leftHanded: true } : {}),
  });
  if (human(0)) zones.push(faceZone(0, left));
  if (human(1)) zones.push(faceZone(1, right));
  // Stick area: the seat-left 55 % of the zone (seat-right when left-handed, the whole zone with
  // one finger); hint at its middle.
  const stickHints = zones.map((z) => {
    const local = localSize(z.rect, z.orientation);
    const x = prefs.scheme === 'oneFinger' ? 0.5 : prefs.leftHanded ? 0.725 : 0.275;
    return zoneScreenPoint(z.rect, z.orientation, local.w * x, local.h * 0.5);
  });
  return { zones, arena, stickHints, left, right };
}

/** Height of a gesture-exclusion band (Android honours at most 200 dp per screen edge). */
export const GESTURE_BAND = 200;

/**
 * Areas the system edge swipes (Android back / home) should leave alone (T7.1): per touch zone a
 * band of {@link GESTURE_BAND} around where its stick starts, across the strip the stick lives in
 * – drags begin there, bomb taps are not swipes. Empty for zone-less layouts.
 */
export function gestureBands(plan: ZonePlan): Rect[] {
  return plan.zones.map((zone, i) => {
    const hint = plan.stickHints[i] ?? { x: zone.rect.x + zone.rect.w / 2, y: zone.rect.y };
    // A solo zone spans both strips: keep only the strip with the stick.
    let area = zone.rect;
    for (const strip of [plan.left, plan.right]) {
      if (hint.x >= strip.x && hint.x <= strip.x + strip.w && strip.w < zone.rect.w) area = strip;
    }
    const h = Math.min(GESTURE_BAND, area.h);
    const y = Math.min(Math.max(area.y, hint.y - h / 2), area.y + area.h - h);
    return { x: area.x, y, w: area.w, h };
  });
}
