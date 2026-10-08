import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { SessionSnapshot } from '../game/session';
import { TIP_MS, type TipId } from '../game/tips';
import { t, type TranslationKey } from '../i18n';

const TIP_KEY: Readonly<Record<TipId, TranslationKey>> = {
  kick: 'tipKick',
  jinx: 'tipJinx',
  suddenDeath: 'tipSuddenDeath',
};

/**
 * Tutorial step card (T5.4): what to do in this step, in the left strip right under the player's
 * seat panel (it lets touches through to the move zone), and a Skip button next to the pause
 * button. The arena stays fully visible.
 */
export function TutorialHint(props: {
  snapshot: SessionSnapshot;
  retry: boolean;
  onSkip: () => void;
}) {
  const { snapshot, retry, onSkip } = props;
  // Sits right under the player's seat panel, wherever the HUD put it.
  const [panelBottom, setPanelBottom] = useState<number | null>(null);
  useLayoutEffect(() => {
    const panel = document.querySelector('[data-testid="seat-panel-0"]');
    const bottom = panel ? Math.round(panel.getBoundingClientRect().bottom) : null;
    if (bottom !== panelBottom) setPanelBottom(bottom);
  });
  const progress = snapshot.challenge?.progress;
  if (!progress) return null;
  const strip = snapshot.zones.left;
  const a = snapshot.layout.arena;
  const topY = Math.max(14, a.y / 2);
  const n = progress.stage;
  return (
    <>
      <div
        class="tutorial-hint"
        data-testid="tutorial-hint"
        data-step={n}
        style={{
          left: `${strip.x + strip.w / 2}px`,
          top: `${(panelBottom ?? strip.y + 64) + 8}px`,
          width: `${strip.w * 0.92}px`,
        }}
      >
        <span class="tutorial-step">
          {t('tutStepLabel', { n, total: progress.stages })}
          {retry && <b data-testid="tutorial-retry"> · {t('tutRetry')}</b>}
        </span>
        <span class="tutorial-text">{t(`tutStep${n}` as TranslationKey)}</span>
      </div>
      <button
        type="button"
        class="tutorial-skip"
        data-testid="tutorial-skip"
        style={{ left: `${a.x + a.w / 2 + 34}px`, top: `${topY + 34}px` }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onSkip}
      >
        {t('tutSkip')}
      </button>
    </>
  );
}

/** A first-time tip: one line over the arena for {@link TIP_MS}. */
export function TipBanner(props: { tip: TipId; snapshot: SessionSnapshot; onDone: () => void }) {
  const { tip, snapshot, onDone } = props;
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const timer = setTimeout(() => done.current(), TIP_MS);
    return () => clearTimeout(timer);
  }, [tip]);
  const a = snapshot.layout.arena;
  return (
    <div
      class="tip-banner"
      role="status"
      data-testid="tip-banner"
      data-tip={tip}
      style={{
        left: `${a.x + a.w / 2}px`,
        top: `${a.y + a.h * 0.3}px`,
        maxWidth: `${a.w * 0.9}px`,
      }}
    >
      {t(TIP_KEY[tip])}
    </div>
  );
}

/** End of the tutorial: on to a Quick match or back to the menu. */
export function TutorialDone(props: { onQuick: () => void; onMenu: () => void }) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => primary.current?.focus(), []);
  return (
    <div class="screen result-screen" data-testid="tutorial-done">
      <div class="card result-card">
        <p class="result-kicker">{t('tutorialTitle')}</p>
        <h2 class="result-title">{t('tutDoneTitle')}</h2>
        <p class="tagline">{t('tutDoneText')}</p>
        <div class="result-buttons">
          <button
            type="button"
            ref={primary}
            class="mode-button"
            data-testid="tutorial-quick"
            onClick={props.onQuick}
          >
            <span class="mode-name">{t('modeQuick')}</span>
          </button>
          <button
            type="button"
            class="mode-button secondary"
            data-testid="tutorial-menu"
            onClick={props.onMenu}
          >
            <span class="mode-name">{t('backToMenu')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
