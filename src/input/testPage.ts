import { inputBomb, inputMain, inputSecondary } from '../core/input';
import { InputController } from './controller';
import { attachKeyboardInput, attachPointerInput } from './dom';
import { DEFAULT_DP_PER_MM, mmToDp, type Rect } from './geometry';
import { KeyboardSeats } from './keyboard';
import { TouchZones, type ZoneSpec } from './zones';

/**
 * Standalone touch-input harness (`?test&input`, optionally `&layout=corners`): draws the zones
 * as plain DOM boxes, samples the controller once per animation frame and exposes the result on
 * `window.__blastyardInput` for e2e tests. With `&clock=manual` gesture time comes from
 * `window.__blastyardInputClock.now` instead of the event timestamp, so tests can classify taps
 * deterministically regardless of machine load. It does not touch the renderer or the game loop.
 * Only numbers and arrow glyphs are shown, so there is nothing to translate.
 */

export type TestLayout = 'faceoff' | 'corners';

export interface InputTestState {
  layout: TestLayout;
  zones: ZoneSpec[];
  arena: Rect;
  /** Latest sampled byte per seat. */
  bytes: number[];
  /** Ticks with the bomb bit set, per seat. */
  bombs: number[];
  /** Ticks with each main direction (index = Direction) per seat. */
  moves: number[][];
  ticks: number;
}

declare global {
  interface Window {
    __blastyardInput?: InputTestState;
    __blastyardInputClock?: { now: number };
  }
}

const SEAT_COLORS = ['#f2c14e', '#5bc0eb', '#e4572e', '#9bc53d'];
const ARROWS = ['·', '▲', '▶', '▼', '◀'];

/** Simplified PLAN §1.5 layout (the real solver lives in the renderer). */
export function testLayout(
  layout: TestLayout,
  width: number,
  height: number,
  dpPerMm = DEFAULT_DP_PER_MM,
): { arena: Rect; zones: ZoneSpec[] } {
  const strip = Math.max(mmToDp(38, dpPerMm), 0.22 * width);
  const side = Math.max(0, Math.min(0.94 * height, width - 2 * strip));
  const arena: Rect = { x: (width - side) / 2, y: (height - side) / 2, w: side, h: side };
  // Zones keep 8 mm from the screen edges (system gestures) and 2 mm from the arena.
  const edge = mmToDp(8, dpPerMm);
  const gap = mmToDp(2, dpPerMm);
  const w = Math.max(0, arena.x - edge - gap);
  const left: Rect = { x: edge, y: edge, w, h: Math.max(0, height - edge * 2) };
  const right: Rect = { ...left, x: arena.x + arena.w + gap };
  if (layout === 'faceoff') {
    return {
      arena,
      zones: [
        { seat: 0, rect: left, orientation: 90, scheme: 'twoThumb' },
        { seat: 1, rect: right, orientation: 270, scheme: 'twoThumb' },
      ],
    };
  }
  const half = left.h / 2;
  const top = (r: Rect): Rect => ({ ...r, h: half });
  const bottom = (r: Rect): Rect => ({ ...r, y: r.y + half, h: half });
  return {
    arena,
    zones: [
      { seat: 0, rect: bottom(left), orientation: 0, scheme: 'oneFinger' },
      { seat: 1, rect: top(right), orientation: 180, scheme: 'oneFinger' },
      { seat: 2, rect: top(left), orientation: 180, scheme: 'oneFinger' },
      { seat: 3, rect: bottom(right), orientation: 0, scheme: 'oneFinger' },
    ],
  };
}

function box(parent: HTMLElement, r: Rect, style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'absolute',
    left: `${r.x}px`,
    top: `${r.y}px`,
    width: `${r.w}px`,
    height: `${r.h}px`,
    ...style,
  });
  parent.appendChild(el);
  return el;
}

function dot(parent: HTMLElement, radius: number, color: string): HTMLDivElement {
  return box(
    parent,
    { x: 0, y: 0, w: radius * 2, h: radius * 2 },
    { borderRadius: '50%', border: `2px solid ${color}`, display: 'none', pointerEvents: 'none' },
  );
}

export function mountInputTestPage(root: HTMLElement, search: string): void {
  const layout: TestLayout =
    new URLSearchParams(search).get('layout') === 'corners' ? 'corners' : 'faceoff';
  const { arena, zones: specs } = testLayout(layout, window.innerWidth, window.innerHeight);
  const zones = new TouchZones();
  zones.setLayout(specs, arena);
  const keyboard = new KeyboardSeats();
  const controller = new InputController([zones, keyboard]);
  if (new URLSearchParams(search).get('clock') === 'manual') {
    const manual = { now: 0 };
    window.__blastyardInputClock = manual;
    attachPointerInput(zones, window, () => manual.now);
  } else {
    attachPointerInput(zones);
  }
  attachKeyboardInput(keyboard);

  const layer = document.createElement('div');
  layer.dataset['testid'] = 'input-test';
  Object.assign(layer.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
  root.appendChild(layer);
  box(layer, arena, { background: '#2f4a33', outline: '2px solid #4f7a55' });

  const status = box(
    layer,
    { x: arena.x + 8, y: arena.y + 8, w: arena.w - 16, h: arena.h - 16 },
    { font: '600 15px system-ui, sans-serif', color: '#f4f1e6', whiteSpace: 'pre' },
  );
  status.dataset['testid'] = 'input-state';

  const knobs = specs.map((spec, i) => {
    const color = SEAT_COLORS[spec.seat] ?? '#fff';
    const zone = box(layer, spec.rect, {
      border: `2px dashed ${color}`,
      borderRadius: '12px',
      background: 'rgba(255,255,255,0.04)',
    });
    zone.dataset['testid'] = `zone-${i}`;
    const view = zones.views()[i];
    if (view?.bombCenter) {
      const r = view.bombRadius;
      const bomb = box(
        layer,
        { x: view.bombCenter.x - r, y: view.bombCenter.y - r, w: r * 2, h: r * 2 },
        { borderRadius: '50%', border: `3px solid ${color}` },
      );
      bomb.dataset['testid'] = `bomb-${i}`;
    }
    return { center: dot(layer, 30, color), finger: dot(layer, 14, color) };
  });

  const state: InputTestState = {
    layout,
    zones: specs,
    arena,
    bytes: [0, 0, 0, 0],
    bombs: [0, 0, 0, 0],
    moves: [0, 1, 2, 3].map(() => [0, 0, 0, 0, 0]),
    ticks: 0,
  };
  window.__blastyardInput = state;

  const out = new Uint8Array(4);
  const place = (el: HTMLDivElement, x: number, y: number, show: boolean): void => {
    el.style.display = show ? 'block' : 'none';
    el.style.transform = `translate(${x - el.offsetWidth / 2}px, ${y - el.offsetHeight / 2}px)`;
  };
  const frame = (): void => {
    controller.sample(out);
    state.ticks++;
    const lines: string[] = [];
    for (let seat = 0; seat < 4; seat++) {
      const byte = out[seat] ?? 0;
      state.bytes[seat] = byte;
      if (inputBomb(byte)) state.bombs[seat] = (state.bombs[seat] ?? 0) + 1;
      const moves = state.moves[seat] as number[];
      const main = inputMain(byte);
      moves[main] = (moves[main] ?? 0) + 1;
      lines.push(
        `${seat + 1}  ${ARROWS[main]} ${ARROWS[inputSecondary(byte)]}  ✹${state.bombs[seat]}`,
      );
    }
    status.textContent = lines.join('\n');
    zones.views().forEach((view, i) => {
      const k = knobs[i];
      if (!k) return;
      place(k.center, view.stickCenter.x, view.stickCenter.y, view.stickActive);
      place(k.finger, view.stickFinger.x, view.stickFinger.y, view.stickActive);
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
