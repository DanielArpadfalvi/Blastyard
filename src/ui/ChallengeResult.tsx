import { useEffect, useRef } from 'preact/hooks';
import type { ChallengeResult } from '../game/session';
import { formatClock } from '../game/hud';
import { t } from '../i18n';
import { levelName } from './ChallengeMap';
import { starCondText } from './challengeText';
import { StarIcon, Stars } from './Stars';

const LOSS_KEY = {
  died: 'lostDied',
  time: 'lostTime',
  round: 'lostRound',
} as const;

/** Challenge result (T5.2): stars earned, what was asked for, retry / next / map. */
export function ChallengeResultScreen(props: {
  result: ChallengeResult;
  hasNext: boolean;
  onRetry: () => void;
  onNext: () => void;
  onMap: () => void;
}) {
  const { result, hasNext, onRetry, onNext, onMap } = props;
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => primary.current?.focus(), []);
  const seconds = Math.ceil(result.stats.ticks / 60);
  return (
    <div class="screen result-screen" data-testid="challenge-result">
      <div class="card result-card challenge-result-card">
        <p class="result-kicker">{levelName(result.level)}</p>
        <h2 class="result-title" data-testid="challenge-result-title">
          {result.won ? t('challengeWon') : t(LOSS_KEY[result.reason ?? 'died'])}
        </h2>
        {result.won && (
          <div class="result-stars" data-testid="result-stars" data-stars={result.stars}>
            <Stars earned={result.stars} size={44} />
          </div>
        )}
        <ul class="star-goals result-goals">
          <li>
            <StarIcon on={result.won} size={14} /> {t('starDone')}
            {result.won && (
              <span class="goal-note">
                {' '}
                · {formatClock(seconds)} · {t('statBombsUsed', { n: result.stats.bombs })}
              </span>
            )}
          </li>
          {result.conds.map((c, i) => (
            <li key={i}>
              <StarIcon on={c.met} size={14} /> {starCondText(c.cond)}
            </li>
          ))}
        </ul>
        <div class="result-buttons">
          <button
            type="button"
            ref={result.won && hasNext ? undefined : primary}
            class="mode-button"
            data-testid="challenge-retry"
            onClick={onRetry}
          >
            <span class="mode-name">{result.won ? t('challengeReplay') : t('challengeRetry')}</span>
          </button>
          {result.won && hasNext && (
            <button
              type="button"
              ref={primary}
              class="mode-button"
              data-testid="challenge-next"
              onClick={onNext}
            >
              <span class="mode-name">{t('challengeNext')}</span>
            </button>
          )}
          <button
            type="button"
            class="mode-button secondary"
            data-testid="challenge-to-map"
            onClick={onMap}
          >
            <span class="mode-name">{t('challengeMap')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
