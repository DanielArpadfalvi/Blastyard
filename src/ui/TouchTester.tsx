import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { EDGES, screenMetrics, TouchStats, touchReport } from '../input/touchStats';
import { webClipboard, type ClipboardPort } from '../platform/clipboard';
import { readDeviceInfo } from '../platform/device';
import { DP_PER_MM } from '../render/layout';
import { ZONE_EDGE_MM } from '../game/modes';
import { seatCss } from './seats';

const DOT_COLORS = [0, 1, 2, 3].map(seatCss);

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Device touch tester (T2.4 spike, PLAN §1.3 "Érintés-teszt"): every active touch with its id and
 * position, the most touches seen at once, cancelled touches (system edge gestures, palm
 * rejection) per edge, the screen size, and a "copy report" button for `docs/touch-spike.md`.
 * The dashed frame marks the 8 mm edge margin the game's control zones keep.
 */
export function TouchTester({
  onBack,
  clipboard = webClipboard,
}: {
  onBack: () => void;
  clipboard?: ClipboardPort;
}) {
  const stats = useRef(new TouchStats()).current;
  const [, setFrame] = useState(0);
  const [copy, setCopy] = useState<CopyState>('idle');
  const [device, setDevice] = useState(readDeviceInfo);

  useEffect(() => {
    let dirty = true;
    let raf = 0;
    const mark = (): void => {
      dirty = true;
    };
    const opts: AddEventListenerOptions = { passive: true };
    const down = (e: PointerEvent): void => {
      stats.pointerDown(e.pointerId, e.clientX, e.clientY, e.pointerType);
      mark();
    };
    const move = (e: PointerEvent): void => {
      stats.pointerMove(e.pointerId, e.clientX, e.clientY);
      mark();
    };
    const up = (e: PointerEvent): void => {
      stats.pointerUp(e.pointerId);
      mark();
    };
    const cancel = (e: PointerEvent): void => {
      stats.pointerCancel(e.pointerId, e.clientX, e.clientY);
      mark();
    };
    const touches = (e: TouchEvent): void => {
      stats.touchCount(e.touches.length);
      mark();
    };
    const touchCancel = (e: TouchEvent): void => {
      stats.touchCount(e.touches.length);
      stats.touchCancel(Array.from(e.changedTouches, (tp) => ({ x: tp.clientX, y: tp.clientY })));
      mark();
    };
    const resize = (): void => {
      const info = readDeviceInfo();
      stats.setViewport(info.width, info.height);
      setDevice(info);
    };
    resize();
    window.addEventListener('pointerdown', down, opts);
    window.addEventListener('pointermove', move, opts);
    window.addEventListener('pointerup', up, opts);
    window.addEventListener('pointercancel', cancel, opts);
    window.addEventListener('touchstart', touches, opts);
    window.addEventListener('touchmove', touches, opts);
    window.addEventListener('touchend', touches, opts);
    window.addEventListener('touchcancel', touchCancel, opts);
    window.addEventListener('resize', resize);
    const frame = (): void => {
      if (dirty) {
        dirty = false;
        setFrame((f) => f + 1);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchstart', touches);
      window.removeEventListener('touchmove', touches);
      window.removeEventListener('touchend', touches);
      window.removeEventListener('touchcancel', touchCancel);
      window.removeEventListener('resize', resize);
    };
  }, [stats]);

  const screen = screenMetrics(device.width, device.height, device.devicePixelRatio, DP_PER_MM);
  const report = touchReport(stats, screen, device.userAgent, {
    title: t('ttReportTitle'),
    device: t('ttDevice'),
    screen: t('ttScreen'),
    maxTouches: t('ttMaxTouches'),
    cancels: t('ttCancels'),
    edges: t('ttEdges'),
    pointer: t('ttPointer'),
    touch: t('ttTouch'),
  });
  const edgeMargin = ZONE_EDGE_MM * DP_PER_MM;
  const points = stats.points();
  const last = stats.lastCancel;

  const onCopy = async (): Promise<void> => {
    setCopy((await clipboard.writeText(report)) ? 'copied' : 'failed');
  };

  return (
    <div class="screen touch-tester" data-testid="touch-tester">
      <div
        class="tt-edge"
        style={{ inset: `${edgeMargin}px` }}
        aria-hidden="true"
        data-testid="tt-edge"
      />
      <div class="card tt-card">
        <h2 class="tt-title">{t('touchTestTitle')}</h2>
        <p class="tt-hint">{t('touchTestHint')}</p>
        <dl class="tt-stats">
          <dt>{t('ttActive')}</dt>
          <dd data-testid="tt-active">{stats.activeCount}</dd>
          <dt>{t('ttMaxTouches')}</dt>
          <dd>
            <b data-testid="tt-max">{stats.maxPointers}</b>
            <span class="tt-sub">
              {' '}
              ({t('ttTouch')}: <span data-testid="tt-max-touch">{stats.maxTouches}</span>)
            </span>
          </dd>
          <dt>{t('ttCancels')}</dt>
          <dd>
            <b data-testid="tt-pointer-cancels">{stats.pointerCancels}</b>
            <span class="tt-sub">
              {' '}
              ({t('ttTouch')}: <span data-testid="tt-touch-cancels">{stats.touchCancels}</span>)
            </span>
          </dd>
          <dt>{t('ttEdges')}</dt>
          <dd data-testid="tt-edges">
            {EDGES.map((e) => `${t(`ttEdge_${e}`)} ${stats.cancelsByEdge[e]}`).join(' · ')}
          </dd>
          {last && (
            <>
              <dt>{t('ttLastCancel')}</dt>
              <dd>
                {t(`ttEdge_${last.edge}`)}, {Math.round(last.edgeDistance / DP_PER_MM)} mm
              </dd>
            </>
          )}
          <dt>{t('ttScreen')}</dt>
          <dd data-testid="tt-screen">
            {screen.cssWidth}×{screen.cssHeight} dp · {screen.pxWidth}×{screen.pxHeight} px · ≈{' '}
            {Math.round(screen.mmWidth)}×{Math.round(screen.mmHeight)} mm (
            {(Math.round(screen.diagonalInch * 10) / 10).toString()}″)
          </dd>
        </dl>
        <pre class="tt-report" data-testid="tt-report">
          {report}
        </pre>
        <div class="tt-buttons">
          <button
            type="button"
            class="mode-button"
            data-testid="tt-copy"
            onClick={() => void onCopy()}
          >
            <span class="mode-name">
              {copy === 'copied'
                ? t('ttCopied')
                : copy === 'failed'
                  ? t('ttCopyFailed')
                  : t('ttCopy')}
            </span>
          </button>
          <button
            type="button"
            class="mode-button secondary"
            data-testid="tt-reset"
            onClick={() => {
              stats.reset();
              setCopy('idle');
              setFrame((f) => f + 1);
            }}
          >
            <span class="mode-name">{t('ttReset')}</span>
          </button>
          <button
            type="button"
            class="mode-button secondary"
            data-testid="tt-back"
            onClick={onBack}
          >
            <span class="mode-name">{t('backToMenu')}</span>
          </button>
        </div>
      </div>
      {points.map((p) => {
        const color = DOT_COLORS[p.id % DOT_COLORS.length];
        return (
          <div
            key={p.id}
            class={`tt-dot${p.x < 90 ? ' tt-near-left' : p.x > device.width - 90 ? ' tt-near-right' : ''}`}
            data-testid="tt-dot"
            style={{ left: `${p.x}px`, top: `${p.y}px`, borderColor: color }}
          >
            <span class="tt-label" style={{ color }}>
              #{p.id} {Math.round(p.x)},{Math.round(p.y)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
