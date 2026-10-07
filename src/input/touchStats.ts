/**
 * Touch tester bookkeeping (T2.4 device spike, PLAN §1.3 "Érintés-teszt"): which touches are down
 * right now, the most the device ever reported at once, and how often the system cancelled a
 * touch. Cancels are the tell-tale of a system edge gesture (back swipe, notification shade,
 * home indicator) or palm rejection stealing a finger, so each one is also binned by the nearest
 * screen edge.
 *
 * Two independent views are kept because browsers differ: Pointer Events (what the game's touch
 * zones use) and the legacy TouchEvent `touches` list. Pure: the DOM adapter feeds plain numbers.
 */

export type Edge = 'left' | 'right' | 'top' | 'bottom';

export const EDGES: readonly Edge[] = ['left', 'right', 'top', 'bottom'];

export interface ActiveTouch {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** `PointerEvent.pointerType` ("touch", "pen", "mouse"). */
  readonly type: string;
}

export interface CancelRecord {
  readonly source: 'pointer' | 'touch';
  readonly x: number;
  readonly y: number;
  readonly edge: Edge;
  /** Distance to that edge in CSS px. */
  readonly edgeDistance: number;
}

/** The screen edge nearest to (x, y) in a `width` × `height` viewport, and its distance. */
export function nearestEdge(
  x: number,
  y: number,
  width: number,
  height: number,
): { edge: Edge; distance: number } {
  const candidates: Array<[Edge, number]> = [
    ['left', x],
    ['right', width - x],
    ['top', y],
    ['bottom', height - y],
  ];
  let best = candidates[0] as [Edge, number];
  for (const c of candidates) if (c[1] < best[1]) best = c;
  return { edge: best[0], distance: Math.max(0, best[1]) };
}

export class TouchStats {
  private readonly active = new Map<number, ActiveTouch>();
  private width = 1;
  private height = 1;
  maxPointers = 0;
  maxTouches = 0;
  pointerCancels = 0;
  touchCancels = 0;
  /** Pointer downs since the last reset. */
  totalPointers = 0;
  readonly cancelsByEdge: Record<Edge, number> = { left: 0, right: 0, top: 0, bottom: 0 };
  lastCancel: CancelRecord | null = null;

  /** Viewport size (CSS px) used to classify cancels by edge. */
  setViewport(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  pointerDown(id: number, x: number, y: number, type: string): void {
    if (!this.active.has(id)) this.totalPointers++;
    this.active.set(id, { id, x, y, type });
    this.maxPointers = Math.max(this.maxPointers, this.active.size);
  }

  pointerMove(id: number, x: number, y: number): void {
    const p = this.active.get(id);
    if (p) this.active.set(id, { ...p, x, y });
  }

  pointerUp(id: number): void {
    this.active.delete(id);
  }

  /** The system took a pointer: counted and binned by the edge it was nearest to. */
  pointerCancel(id: number, x?: number, y?: number): void {
    const p = this.active.get(id);
    this.active.delete(id);
    this.pointerCancels++;
    // Some browsers report 0,0 on pointercancel; fall back to the last known position.
    const known = x !== undefined && y !== undefined && (x !== 0 || y !== 0);
    const cx = known ? x : (p?.x ?? 0);
    const cy = known ? y : (p?.y ?? 0);
    this.recordCancel('pointer', cx, cy);
  }

  /** `TouchEvent.touches.length` after any touch event. */
  touchCount(count: number): void {
    this.maxTouches = Math.max(this.maxTouches, count);
  }

  /** One `touchcancel` event with the positions of the cancelled touches. */
  touchCancel(points: ReadonlyArray<{ x: number; y: number }>): void {
    this.touchCancels++;
    const first = points[0];
    if (first) this.recordCancel('touch', first.x, first.y);
  }

  /** Active pointers in id order. */
  points(): ActiveTouch[] {
    return [...this.active.values()].sort((a, b) => a.id - b.id);
  }

  get activeCount(): number {
    return this.active.size;
  }

  reset(): void {
    this.active.clear();
    this.maxPointers = 0;
    this.maxTouches = 0;
    this.pointerCancels = 0;
    this.touchCancels = 0;
    this.totalPointers = 0;
    for (const e of EDGES) this.cancelsByEdge[e] = 0;
    this.lastCancel = null;
  }

  private recordCancel(source: CancelRecord['source'], x: number, y: number): void {
    const { edge, distance } = nearestEdge(x, y, this.width, this.height);
    // A system gesture usually fires both a touchcancel and a pointercancel; bin each lost finger
    // once, by the API the game's touch zones listen to.
    if (source === 'pointer') this.cancelsByEdge[edge]++;
    this.lastCancel = { source, x, y, edge, edgeDistance: distance };
  }
}

export interface ScreenMetrics {
  /** CSS px (= dp on mobile WebViews). */
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly dpr: number;
  /** Device pixels. */
  readonly pxWidth: number;
  readonly pxHeight: number;
  /** Estimated physical size from the dp/mm assumption. */
  readonly mmWidth: number;
  readonly mmHeight: number;
  readonly diagonalInch: number;
  readonly dpPerMm: number;
}

/**
 * Screen size in CSS px, device px and an estimate in millimetres. The browser does not expose
 * the physical density, so mm assume `dpPerMm` CSS px per millimetre (≈ 6.3 on the 160 dpi
 * Android/iOS baseline, PLAN §1.4) – good to ±15 % on phones, less exact on tablets.
 */
export function screenMetrics(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  dpPerMm: number,
): ScreenMetrics {
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const mmWidth = cssWidth / dpPerMm;
  const mmHeight = cssHeight / dpPerMm;
  return {
    cssWidth,
    cssHeight,
    dpr: ratio,
    pxWidth: Math.round(cssWidth * ratio),
    pxHeight: Math.round(cssHeight * ratio),
    mmWidth,
    mmHeight,
    diagonalInch: Math.hypot(mmWidth, mmHeight) / 25.4,
    dpPerMm,
  };
}

/** Labels of the copied report (translated by the caller). */
export interface ReportLabels {
  readonly title: string;
  readonly device: string;
  readonly screen: string;
  readonly maxTouches: string;
  readonly cancels: string;
  readonly edges: string;
  readonly pointer: string;
  readonly touch: string;
}

const round1 = (n: number): string => (Math.round(n * 10) / 10).toString();

/** Short plain-text summary for the owner to paste into `docs/touch-spike.md`. */
export function touchReport(
  stats: TouchStats,
  screen: ScreenMetrics,
  userAgent: string,
  labels: ReportLabels,
): string {
  const edges = EDGES.map((e) => `${e[0]?.toUpperCase()}${stats.cancelsByEdge[e]}`).join(' ');
  return [
    labels.title,
    `${labels.device}: ${userAgent}`,
    `${labels.screen}: ${screen.cssWidth}×${screen.cssHeight} dp @${round1(screen.dpr)}x = ` +
      `${screen.pxWidth}×${screen.pxHeight} px ≈ ${Math.round(screen.mmWidth)}×` +
      `${Math.round(screen.mmHeight)} mm (${round1(screen.diagonalInch)}″)`,
    `${labels.maxTouches}: ${stats.maxPointers} (${labels.pointer}) / ${stats.maxTouches} (${labels.touch})`,
    `${labels.cancels}: ${stats.pointerCancels} (${labels.pointer}) / ${stats.touchCancels} ` +
      `(${labels.touch}); ${labels.edges}: ${edges}`,
  ].join('\n');
}
