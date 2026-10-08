import { useState } from 'preact/hooks';
import { ALL_ARENAS, isPlusArena } from '../content/arenas';
import type { ArenaDef } from '../core';
import { RANDOM_ARENA, arenaUnlocked } from '../game/party';
import { t, type TranslationKey } from '../i18n';
import { ArenaThumb } from './ArenaThumb';

/** Display name of an arena (`arenaName_<id>` with dashes as underscores). */
export function arenaName(arena: ArenaDef): string {
  return t(`arenaName_${arena.id.replace(/-/g, '_')}` as TranslationKey);
}

/** The twelve arenas (plus "random"); Blastyard+ ones carry a lock badge unless owned. */
export function ArenaPicker(props: {
  selected: string;
  hasPlus: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  /** A locked arena was tapped: show the paywall. */
  onLocked?: () => void;
}) {
  const { selected, hasPlus, onSelect, onClose, onLocked } = props;
  const [hint, setHint] = useState(false);
  const pick = (arena: ArenaDef): void => {
    if (!arenaUnlocked(arena, hasPlus)) {
      setHint(true);
      onLocked?.();
      return;
    }
    setHint(false);
    onSelect(arena.id);
  };
  return (
    <div class="screen arena-picker" data-testid="arena-picker">
      <div class="card picker-card">
        <h2 class="settings-title">{t('arenaPickerTitle')}</h2>
        <div class="arena-grid">
          <button
            type="button"
            class={selected === RANDOM_ARENA ? 'arena-card arena-on' : 'arena-card'}
            data-testid="arena-random"
            onClick={() => {
              setHint(false);
              onSelect(RANDOM_ARENA);
            }}
          >
            <span class="arena-random-mark" aria-hidden="true">
              ?
            </span>
            <span class="arena-name">{t('arenaRandom')}</span>
          </button>
          {ALL_ARENAS.map((arena) => {
            const locked = !arenaUnlocked(arena, hasPlus);
            const cls = [
              'arena-card',
              selected === arena.id ? 'arena-on' : '',
              locked ? 'arena-locked' : '',
            ]
              .join(' ')
              .trim();
            return (
              <button
                key={arena.id}
                type="button"
                class={cls}
                data-testid={`arena-${arena.id}`}
                aria-disabled={locked && !onLocked}
                onClick={() => pick(arena)}
              >
                <ArenaThumb arena={arena} />
                <span class="arena-name">{arenaName(arena)}</span>
                {isPlusArena(arena) && !hasPlus && (
                  <span class="lock-badge" data-testid={`lock-${arena.id}`}>
                    {t('plusBadge')}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {hint && (
          <p class="picker-hint" data-testid="plus-hint" role="status">
            {t('plusHint')}
          </p>
        )}
        <div class="result-buttons">
          <button
            type="button"
            class="mode-button compact"
            data-testid="arena-close"
            onClick={onClose}
          >
            <span class="mode-name">{t('done')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
