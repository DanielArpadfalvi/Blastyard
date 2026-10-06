/**
 * Pixi view of the touch controls in the side strips: each seat's control area, an idle stick
 * hint, the floating stick (base ring + knob) while a thumb is down, and the bomb button.
 *
 * The control areas are a `Graphics` redrawn only when the layout changes; everything that moves
 * is a sprite with a texture baked once (`bakeControlTextures`), tinted with the seat colour.
 * The view only reads plain numbers (structurally the input layer's `ZoneView`), so the renderer
 * does not depend on the input state machines.
 */

import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import * as P from './palette';
import type { ArenaTextures, ControlTextures } from './textures';
import { CONTROL_TEX, TEX } from './textures';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** What one control zone looks like this frame (the input layer's `ZoneView` fits this). */
export interface ControlVisual {
  readonly seat: number;
  readonly stickActive: boolean;
  readonly stickCenter: Point;
  readonly stickFinger: Point;
  readonly bombCenter: Point | null;
  readonly bombRadius: number;
  readonly bombDown: boolean;
}

/** A strip area drawn as a seat's control pad. */
export interface ControlArea {
  readonly seat: number;
  readonly rect: Box;
}

/** Radius of the drawn stick base (dp) – the stick's follow radius. */
export const STICK_BASE_RADIUS = 60;
export const STICK_KNOB_RADIUS = 24;

interface ZoneSprites {
  readonly hint: Sprite;
  readonly hintKnob: Sprite;
  readonly base: Sprite;
  readonly knob: Sprite;
  readonly bombDisc: Sprite;
  readonly bombRing: Sprite;
  readonly bombIcon: Sprite;
}

function centred(texture: Texture): Sprite {
  const s = new Sprite(texture);
  s.anchor.set(0.5);
  return s;
}

function seatColor(seat: number): number {
  return P.SEAT_COLORS[seat] ?? 0xffffff;
}

/** Scale that makes a `CONTROL_TEX` texture `radius` dp in radius. */
function scaleFor(radius: number): number {
  return (radius * 2) / CONTROL_TEX;
}

export class ControlsView {
  readonly root = new Container({ label: 'controls-view' });
  private readonly pads = new Graphics();
  private readonly layer = new Container();
  private zones: ZoneSprites[] = [];

  constructor(
    private readonly tex: ControlTextures,
    private readonly arenaTex: ArenaTextures,
  ) {
    this.root.addChild(this.pads, this.layer);
  }

  /**
   * Rebuilds for a new layout: `areas` are drawn as pads, `visuals` give the zones (seat, bomb
   * button), `hints` the idle stick position per zone.
   */
  setZones(
    areas: readonly ControlArea[],
    visuals: readonly ControlVisual[],
    hints: readonly Point[],
  ): void {
    const g = this.pads.clear();
    for (const area of areas) {
      const r = area.rect;
      if (r.w <= 0 || r.h <= 0) continue;
      const color = seatColor(area.seat);
      g.roundRect(r.x, r.y, r.w, r.h, 22)
        .fill({ color, alpha: 0.06 })
        .stroke({ width: 2, color, alpha: 0.4 });
    }
    this.layer.removeChildren().forEach((c) => c.destroy());
    this.zones = visuals.map((v, i) => {
      const color = seatColor(v.seat);
      const hint = centred(this.tex.ring);
      hint.tint = color;
      hint.alpha = 0.28;
      hint.scale.set(scaleFor(STICK_BASE_RADIUS));
      const at = hints[i] ?? v.stickCenter;
      hint.position.set(at.x, at.y);
      const hintKnob = centred(this.tex.disc);
      hintKnob.tint = color;
      hintKnob.alpha = 0.22;
      hintKnob.scale.set(scaleFor(STICK_KNOB_RADIUS));
      hintKnob.position.set(at.x, at.y);
      const base = centred(this.tex.ring);
      base.tint = color;
      base.alpha = 0.75;
      base.scale.set(scaleFor(STICK_BASE_RADIUS));
      const knob = centred(this.tex.knob);
      knob.tint = color;
      knob.scale.set(scaleFor(STICK_KNOB_RADIUS));
      const bombDisc = centred(this.tex.disc);
      bombDisc.tint = color;
      const bombRing = centred(this.tex.ring);
      bombRing.tint = color;
      const bombIcon = centred(this.arenaTex.pop);
      const sprites = { hint, hintKnob, base, knob, bombDisc, bombRing, bombIcon };
      if (v.bombCenter) {
        for (const s of [bombDisc, bombRing, bombIcon])
          s.position.set(v.bombCenter.x, v.bombCenter.y);
        bombRing.scale.set(scaleFor(v.bombRadius));
        bombIcon.scale.set((v.bombRadius * 1.25) / TEX);
      } else {
        bombDisc.visible = bombRing.visible = bombIcon.visible = false;
      }
      this.layer.addChild(hint, hintKnob, bombDisc, bombRing, bombIcon, base, knob);
      return sprites;
    });
  }

  /** Per frame: stick and bomb-button state. */
  render(visuals: readonly ControlVisual[]): void {
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i] as ZoneSprites;
      const v = visuals[i];
      if (!v) continue;
      z.hint.visible = z.hintKnob.visible = !v.stickActive;
      z.base.visible = z.knob.visible = v.stickActive;
      if (v.stickActive) {
        z.base.position.set(v.stickCenter.x, v.stickCenter.y);
        z.knob.position.set(v.stickFinger.x, v.stickFinger.y);
      }
      if (v.bombCenter) {
        const press = v.bombDown ? 0.92 : 1;
        z.bombDisc.alpha = v.bombDown ? 0.6 : 0.22;
        z.bombDisc.scale.set(scaleFor(v.bombRadius) * press);
        z.bombIcon.scale.set(((v.bombRadius * 1.25) / TEX) * press);
      }
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
