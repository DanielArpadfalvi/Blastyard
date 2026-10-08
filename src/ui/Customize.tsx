import { useEffect, useState } from 'preact/hooks';
import {
  HATS,
  POP_SKINS,
  PUFFS,
  TRAILS,
  tierOf,
  type Appearance,
  type CosmeticItem,
  type TrailDef,
  type Unlock,
} from '../content/cosmetics';
import { TROPHIES, trophyEarned, type TrophyContext } from '../content/trophies';
import { arenaById } from '../content/arenas';
import type { LooksStore } from '../game/looks';
import type { LifetimeStats } from '../game/stats';
import { isUnlocked, unlockProgress, type ProgressContext } from '../game/unlocks';
import { t, type TranslationKey } from '../i18n';
import { arenaName } from './ArenaPicker';
import { SeatBadge } from './SeatBadge';
import { Segmented } from './Segmented';
import { StarIcon } from './Stars';

type Category = 'puff' | 'hat' | 'pop' | 'trail';
const CATEGORIES: readonly Category[] = ['puff', 'hat', 'pop', 'trail'];
const CATEGORY_LABEL: Record<Category, TranslationKey> = {
  puff: 'catPuff',
  hat: 'catHat',
  pop: 'catPop',
  trail: 'catTrail',
};
const ITEMS: Record<Category, readonly CosmeticItem[]> = {
  puff: PUFFS,
  hat: HATS,
  pop: POP_SKINS,
  trail: TRAILS,
};
/** The `Appearance` field each category sets. */
const FIELD: Record<Category, keyof Appearance> = {
  puff: 'puff',
  hat: 'hat',
  pop: 'pop',
  trail: 'trail',
};

export function itemName(category: Category, id: string): string {
  return t(`item_${category}_${id}` as TranslationKey);
}

function unlockText(unlock: Unlock, ctx: ProgressContext): string {
  const p = unlockProgress(unlock, ctx);
  switch (unlock.kind) {
    case 'plus':
      return t('unlockPlus');
    case 'supporter':
      return t('unlockSupporter');
    case 'matches':
      return t('unlockMatches', { n: p.need, have: p.have });
    case 'wins':
      return t('unlockWins', { n: p.need, have: p.have });
    case 'stars':
      return t('unlockStars', { n: p.need, have: p.have });
    case 'streak':
      return t('unlockStreak', { n: p.need, have: p.have });
    default:
      return '';
  }
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** A cosmetic item's picture: baked from the arena textures (trails: their colours). */
function Thumb(props: {
  category: Category;
  id: string | null;
  seat: number;
  thumbnail: (kind: 'puff' | 'hat' | 'pop', id: string, seat: number) => Promise<string>;
}) {
  const { category, id, seat, thumbnail } = props;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (id === null || category === 'trail') return undefined;
    let live = true;
    thumbnail(category, id, seat).then(
      (url) => live && setSrc(url),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [category, id, seat, thumbnail]);
  if (id === null) return <span class="thumb thumb-none">∅</span>;
  if (category === 'trail') {
    const def = TRAILS.find((tr) => tr.id === id) as TrailDef;
    return (
      <span class="thumb thumb-trail" aria-hidden="true">
        {def.tints.slice(0, 4).map((c, i) => (
          <i key={i} style={{ background: hex(c) }} />
        ))}
      </span>
    );
  }
  return src ? <img class="thumb" src={src} alt="" /> : <span class="thumb" />;
}

function StatRow(props: { label: string; value: string | number; testId?: string }) {
  return (
    <li>
      <span>{props.label}</span>
      <b data-testid={props.testId}>{props.value}</b>
    </li>
  );
}

/**
 * Customize (T6.2): what each seat wears – Puff, hat, pop skin, trail – with milestone locks
 * (play / win / stars / daily streak) and Blastyard+ items; and the trophies and lifetime stats.
 */
export function Customize(props: {
  looks: LooksStore;
  progress: ProgressContext;
  trophies: TrophyContext;
  stats: LifetimeStats;
  favouriteArena: string | null;
  thumbnail: (kind: 'puff' | 'hat' | 'pop', id: string, seat: number) => Promise<string>;
  onBack: () => void;
  /** A Blastyard+ / Supporter item was tapped while locked: show the paywall. */
  onLocked?: () => void;
}) {
  const { looks, progress, trophies, stats, thumbnail, onBack, onLocked } = props;
  const [tab, setTab] = useState<'looks' | 'trophies'>('looks');
  const [seat, setSeat] = useState(0);
  const [category, setCategory] = useState<Category>('puff');
  const [, setRev] = useState(0);
  useEffect(() => looks.subscribe(() => setRev((r) => r + 1)), [looks]);
  const look = looks.get(seat);
  const current = look[FIELD[category]];
  const optional = category === 'hat' || category === 'trail';
  const earned = TROPHIES.filter((d) => trophyEarned(d, trophies)).length;
  const fav = props.favouriteArena ? arenaById(props.favouriteArena) : undefined;
  return (
    <div class="screen map-screen" data-testid="customize-screen">
      <div class="card map-card customize-card">
        <div class="map-head">
          <h2 class="settings-title">{t('customizeTitle')}</h2>
          <Segmented
            testId="customize-tab"
            value={tab}
            options={['looks', 'trophies'] as const}
            label={(v) => t(v === 'looks' ? 'tabLooks' : 'tabTrophies')}
            onChange={setTab}
          />
        </div>
        {tab === 'looks' ? (
          <>
            <div class="world-tabs" role="tablist">
              {[0, 1, 2, 3].map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={s === seat}
                  class={s === seat ? 'world-tab world-on' : 'world-tab'}
                  data-testid={`look-seat-${s}`}
                  aria-label={t('seatPlayer', { n: s + 1 })}
                  onClick={() => setSeat(s)}
                >
                  <SeatBadge seat={s} />
                  <Thumb category="puff" id={looks.get(s).puff} seat={s} thumbnail={thumbnail} />
                </button>
              ))}
            </div>
            <Segmented
              testId="look-category"
              value={category}
              options={CATEGORIES}
              label={(c) => t(CATEGORY_LABEL[c])}
              onChange={setCategory}
            />
            <div class="item-grid" data-testid="item-grid">
              {optional && (
                <button
                  type="button"
                  class={current === null ? 'item-cell item-on' : 'item-cell'}
                  data-testid="item-none"
                  aria-pressed={current === null}
                  onClick={() => looks.set(seat, { [FIELD[category]]: null })}
                >
                  <Thumb category={category} id={null} seat={seat} thumbnail={thumbnail} />
                  <span class="item-name">{t('itemNone')}</span>
                </button>
              )}
              {ITEMS[category].map((item) => {
                const open = isUnlocked(item, progress);
                const on = current === item.id;
                // Paid items open the paywall; milestone items just show what is missing.
                const buyable = !open && tierOf(item) !== 'free' && onLocked !== undefined;
                return (
                  <button
                    key={item.id}
                    type="button"
                    class={`item-cell${on ? ' item-on' : ''}${open ? '' : ' item-locked'}`}
                    data-testid={`item-${item.id}`}
                    data-locked={!open}
                    aria-pressed={on}
                    disabled={!open && !buyable}
                    title={open ? itemName(category, item.id) : unlockText(item.unlock, progress)}
                    onClick={() =>
                      open ? looks.set(seat, { [FIELD[category]]: item.id }) : onLocked?.()
                    }
                  >
                    <Thumb category={category} id={item.id} seat={seat} thumbnail={thumbnail} />
                    <span class="item-name">{itemName(category, item.id)}</span>
                    {!open && <span class="item-lock">{unlockText(item.unlock, progress)}</span>}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div class="trophy-body">
            <ul class="stat-list" data-testid="stat-list">
              <StatRow label={t('statMatches')} value={stats.matches} testId="stat-matches" />
              <StatRow label={t('statWins')} value={stats.wins} testId="stat-wins" />
              <StatRow label={t('statKnockouts')} value={stats.knockouts} />
              <StatRow label={t('statSelfKnockouts')} value={stats.selfKnockouts} />
              <StatRow label={t('statPops')} value={stats.pops} />
              <StatRow label={t('statPowerUps')} value={stats.powerUps} />
              <StatRow label={t('statStars')} value={progress.stars} />
              <StatRow label={t('statChallengesWon')} value={stats.challengesWon} />
              <StatRow label={t('statDailyWins')} value={stats.dailyWins} />
              <StatRow label={t('statBestStreak')} value={progress.bestStreak} />
              <StatRow label={t('statFavourite')} value={fav ? arenaName(fav) : t('statNone')} />
            </ul>
            <div class="trophy-list">
              <p class="map-total" data-testid="trophy-count">
                {t('trophiesEarned', { n: earned, total: TROPHIES.length })}
              </p>
              <ul>
                {TROPHIES.map((d) => {
                  const p = d.progress(trophies);
                  const done = p.have >= p.need;
                  return (
                    <li
                      key={d.id}
                      class={done ? 'trophy trophy-earned' : 'trophy'}
                      data-testid={`trophy-${d.id}`}
                      data-earned={done}
                    >
                      <span class="trophy-icon" aria-hidden="true">
                        <StarIcon on={done} size={18} />
                      </span>
                      <span class="trophy-text">
                        <b>{t(`trophy_${d.id}` as TranslationKey)}</b>
                        <small>{t(`trophyDesc_${d.id}` as TranslationKey)}</small>
                      </span>
                      {!done && p.need > 1 && (
                        <span class="trophy-progress">
                          {p.have}/{p.need}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
        <div class="result-buttons">
          <button
            type="button"
            class="mode-button secondary compact"
            data-testid="customize-back"
            onClick={onBack}
          >
            <span class="mode-name">{t('back')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
