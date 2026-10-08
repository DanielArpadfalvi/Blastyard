import { useState } from 'preact/hooks';
import {
  LEVELS,
  WORLD_COUNT,
  isGauntlet,
  tuningOf,
  worldLevels,
  worldNeedsPlus,
} from '../content/challenges';
import type { LevelDef } from '../game/challenge';
import { MAX_STARS, type ChallengeProgress } from '../game/progress';
import { t, type TranslationKey } from '../i18n';
import { levelObjectiveText, starCondText } from './challengeText';
import { StarIcon, Stars } from './Stars';

export function levelName(level: LevelDef): string {
  return t(level.nameKey as TranslationKey);
}

function worldName(world: number): string {
  return t(`worldName${world}` as TranslationKey);
}

/** Challenge map (T5.2): three worlds of twelve levels, stars, locks and the level card. */
export function ChallengeMap(props: {
  progress: ChallengeProgress;
  hasPlus: boolean;
  /** World to show first (e.g. the one just played). */
  world?: number;
  onPlay: (id: string) => void;
  onBack: () => void;
  /** Show the paywall (a Blastyard+ world is selected). */
  onPlus?: () => void;
}) {
  const { progress, hasPlus, onPlay, onBack, onPlus } = props;
  const [world, setWorld] = useState(props.world ?? 1);
  const [selected, setSelected] = useState<string>(() => {
    const first = worldLevels(props.world ?? 1).find((l) => progress.starsOf(l.id) === 0);
    return (first ?? worldLevels(props.world ?? 1)[0])!.id;
  });
  const level = LEVELS.find((l) => l.id === selected) ?? (LEVELS[0] as LevelDef);
  const lock = progress.lockOf(level, hasPlus);
  const tuning = tuningOf(level.id);
  const total = LEVELS.length * MAX_STARS;
  const pickWorld = (w: number): void => {
    setWorld(w);
    const first = worldLevels(w).find((l) => progress.starsOf(l.id) === 0);
    setSelected((first ?? worldLevels(w)[0])!.id);
  };
  return (
    <div class="screen map-screen" data-testid="challenge-map">
      <div class="card map-card">
        <div class="map-head">
          <h2 class="settings-title">{t('challengesTitle')}</h2>
          <span class="map-total" data-testid="map-total">
            <StarIcon on size={16} /> {progress.totalStars()}/{total}
          </span>
        </div>
        <div class="world-tabs" role="tablist">
          {Array.from({ length: WORLD_COUNT }, (_, i) => i + 1).map((w) => (
            <button
              key={w}
              type="button"
              role="tab"
              aria-selected={w === world}
              class={w === world ? 'world-tab world-on' : 'world-tab'}
              data-testid={`world-tab-${w}`}
              onClick={() => pickWorld(w)}
            >
              <span>{worldName(w)}</span>
              {worldNeedsPlus(w) && !hasPlus && (
                <span class="lock-badge" data-testid={`world-lock-${w}`}>
                  {t('plusBadge')}
                </span>
              )}
            </button>
          ))}
        </div>
        <div class="map-body">
          <div class="level-grid" data-testid="level-grid">
            {worldLevels(world).map((l) => {
              const state = progress.lockOf(l, hasPlus);
              const stars = progress.starsOf(l.id);
              const cls = [
                'level-node',
                l.id === selected ? 'level-on' : '',
                state !== 'open' ? 'level-locked' : '',
                isGauntlet(l) ? 'level-gauntlet' : '',
              ]
                .join(' ')
                .trim();
              return (
                <button
                  key={l.id}
                  type="button"
                  class={cls}
                  data-testid={`level-${l.id}`}
                  data-lock={state}
                  data-stars={stars}
                  onClick={() => setSelected(l.id)}
                >
                  <span class="level-num">{isGauntlet(l) ? t('gauntletMark') : l.index}</span>
                  {state === 'open' ? (
                    <Stars earned={stars} size={11} />
                  ) : (
                    <span class="level-lock" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
          <div class="level-card" data-testid="level-card">
            <h3 class="level-title">{levelName(level)}</h3>
            <p class="level-goal">{levelObjectiveText(level)}</p>
            <ul class="star-goals">
              <li>
                <StarIcon on size={14} /> {t('starDone')}
              </li>
              {tuning.stars.map((cond, i) => (
                <li key={i}>
                  <StarIcon on={progress.starsOf(level.id) >= i + 2} size={14} />{' '}
                  {starCondText(cond)}
                </li>
              ))}
            </ul>
            {lock === 'open' ? (
              <button
                type="button"
                class="mode-button compact"
                data-testid="challenge-play"
                onClick={() => onPlay(level.id)}
              >
                <span class="mode-name">{t('challengePlay')}</span>
              </button>
            ) : (
              <>
                <p class="level-lock-hint" data-testid="level-lock-hint" role="status">
                  {lock === 'locked-plus' ? t('plusWorldHint') : t('levelLockedHint')}
                </p>
                {lock === 'locked-plus' && onPlus && (
                  <button
                    type="button"
                    class="mode-button compact"
                    data-testid="challenge-plus"
                    onClick={onPlus}
                  >
                    <span class="mode-name">{t('paywallMore')}</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        <div class="result-buttons">
          <button
            type="button"
            class="mode-button secondary compact"
            data-testid="map-back"
            onClick={onBack}
          >
            <span class="mode-name">{t('back')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
