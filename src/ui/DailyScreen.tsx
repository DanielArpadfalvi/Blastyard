import { useEffect, useState } from 'preact/hooks';
import { dateOfDay, type DailyChallenge } from '../game/daily';
import type { DailyRecord, DailyView } from '../game/dailyStore';
import { formatClock } from '../game/hud';
import { getLanguage, t, type TranslationKey } from '../i18n';
import { arenaName } from './ArenaPicker';
import { objectiveText, starCondText } from './challengeText';
import { StarIcon } from './Stars';

/** Long local date of a day number (`8 October 2026` / `2026. október 8.`). */
export function dailyDate(day: number): string {
  const d = dateOfDay(day);
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).toLocaleDateString(
    getLanguage() === 'hu' ? 'hu-HU' : 'en-GB',
    { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' },
  );
}

function recordText(key: 'dailyOfficialWon' | 'dailyBest', r: DailyRecord): string {
  return t(key, { stars: r.stars, time: formatClock(Math.ceil(r.ticks / 60)) });
}

function officialText(view: DailyView): string {
  const o = view.official;
  if (o === 'none') return t('dailyOfficialFirst');
  if (o === 'started') return t('dailyOfficialOpen');
  return o.won ? recordText('dailyOfficialWon', o) : t('dailyOfficialLost');
}

/** Streak and today's record lines (shared by the daily card and the result screen). */
export function DailyStatus(props: { view: DailyView }) {
  const { view } = props;
  return (
    <ul class="daily-status" data-testid="daily-status">
      <li data-testid="daily-official">{officialText(view)}</li>
      {view.best?.won && <li data-testid="daily-best">{recordText('dailyBest', view.best)}</li>}
      <li data-testid="daily-streak" data-streak={view.streak}>
        <b>{t('dailyStreak', { n: view.streak })}</b> ·{' '}
        {t('dailyBestStreak', { n: view.bestStreak })}
      </li>
    </ul>
  );
}

/**
 * Daily challenge card (T5.3): today's arena variant, twist and objective, the star goals, the
 * official attempt, today's best and the streak. The challenge is prepared (proven winnable by the
 * bot) when the card opens; that takes a moment the first time each day.
 */
export function DailyScreen(props: {
  prepare: () => Promise<DailyChallenge>;
  view: (day: number) => DailyView;
  onPlay: () => void;
  onBack: () => void;
}) {
  const { prepare, view, onPlay, onBack } = props;
  const [daily, setDaily] = useState<DailyChallenge | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    prepare().then(
      (d) => live && setDaily(d),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [prepare]);
  const stage = daily?.level.stages[0];
  const v = daily ? view(daily.day) : null;
  return (
    <div class="screen map-screen" data-testid="daily-screen">
      <div class="card map-card daily-card">
        <div class="map-head">
          <h2 class="settings-title">{t('dailyTitle')}</h2>
          {daily && (
            <span class="map-total" data-testid="daily-date">
              {dailyDate(daily.day)}
            </span>
          )}
        </div>
        {!daily || !stage || !v ? (
          <p class="level-goal" role="status" data-testid="daily-preparing">
            {failed ? t('dailyFailed') : t('dailyPreparing')}
          </p>
        ) : (
          <div class="map-body daily-body">
            <div class="level-card" data-testid="daily-card" data-level={daily.level.id}>
              <h3 class="level-title">
                {t('dailyArena', {
                  arena: arenaName(daily.baseArena),
                  density: stage.arena.crateDensity ?? 0,
                })}
              </h3>
              <p class="daily-mod" data-testid="daily-modifier" data-modifier={daily.modifier}>
                {t(`dailyMod_${daily.modifier}` as TranslationKey)}
              </p>
              <p class="level-goal" data-testid="daily-objective">
                {objectiveText(stage.objective)}
              </p>
              <ul class="star-goals">
                <li>
                  <StarIcon on size={14} /> {t('starDone')}
                </li>
                {daily.tuning.stars.map((cond, i) => (
                  <li key={i}>
                    <StarIcon on={(v.best?.stars ?? 0) >= i + 2} size={14} /> {starCondText(cond)}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                class="mode-button compact"
                data-testid="daily-play"
                data-official={v.official === 'none'}
                onClick={onPlay}
              >
                <span class="mode-name">
                  {v.official === 'none' ? t('dailyPlayOfficial') : t('dailyPractice')}
                </span>
              </button>
            </div>
            <div class="level-card">
              <DailyStatus view={v} />
              <p class="mode-hint">{t('dailyStreakHint')}</p>
            </div>
          </div>
        )}
        <div class="result-buttons">
          <button
            type="button"
            class="mode-button secondary compact"
            data-testid="daily-back"
            onClick={onBack}
          >
            <span class="mode-name">{t('back')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
