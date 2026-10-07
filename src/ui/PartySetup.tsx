import { useState } from 'preact/hooks';
import { arenaById } from '../content/arenas';
import { BotLevel, RULE_PRESETS, WINS_TO_MATCH_OPTIONS, type PresetId } from '../core';
import {
  RANDOM_ARENA,
  cycleSeat,
  isPlayable,
  setArena,
  setLayout,
  setPreset,
  setTeams,
  setWins,
  type PartyConfig,
  type PartyLayout,
  type PartySeat,
} from '../game/party';
import { t, type TranslationKey } from '../i18n';
import { ArenaPicker, arenaName } from './ArenaPicker';
import { Segmented } from './Segmented';
import { SeatBadge } from './SeatBadge';

const LEVEL_KEY: Record<number, TranslationKey> = {
  [BotLevel.EASY]: 'levelEasy',
  [BotLevel.NORMAL]: 'levelNormal',
  [BotLevel.HARD]: 'levelHard',
  [BotLevel.EXPERT]: 'levelExpert',
};

const PRESET_KEY: Record<PresetId, TranslationKey> = {
  classic: 'presetClassic',
  fast: 'presetFast',
  chaos: 'presetChaos',
};

const PRESET_HINT: Record<PresetId, TranslationKey> = {
  classic: 'presetClassicHint',
  fast: 'presetFastHint',
  chaos: 'presetChaosHint',
};

/** Name of a bot difficulty. */
export function levelName(level: number): string {
  return t(LEVEL_KEY[level] ?? 'levelNormal');
}

function seatLabel(seat: PartySeat): string {
  if (seat.kind === 'human') return t('seatHuman');
  if (seat.kind === 'bot') return t('seatBotLevel', { level: levelName(seat.level) });
  return t('seatOff');
}

/** Party setup (T5.1): table layout, the four seats, rules preset, best-of, 2v2 and the arena. */
export function PartySetup(props: {
  config: PartyConfig;
  hasPlus: boolean;
  onChange: (config: PartyConfig) => void;
  onPlay: (config: PartyConfig) => void;
  onBack: () => void;
}) {
  const { config, hasPlus, onChange, onPlay, onBack } = props;
  const [picking, setPicking] = useState(false);
  const full = config.seats.every((s) => s.kind !== 'off');
  const arena = arenaById(config.arena);
  const arenaLabel = arena ? arenaName(arena) : t('arenaRandom');
  return (
    <div class="screen party-screen" data-testid="party-setup">
      <div class="card party-card">
        <h2 class="settings-title">{t('partyTitle')}</h2>
        <div class="setting-row">
          <span class="setting-name">{t('partyLayout')}</span>
          <Segmented<PartyLayout>
            testId="party-layout"
            value={config.layout}
            options={['faceoff', 'corners']}
            label={(v) => t(v === 'faceoff' ? 'layoutFaceoff' : 'layoutCorners')}
            onChange={(v) => onChange(setLayout(config, v))}
          />
        </div>
        <p class="setting-hint">
          {t(config.layout === 'faceoff' ? 'layoutFaceoffHint' : 'layoutCornersHint')}
        </p>
        <div class="seat-grid" data-testid="party-seats">
          {config.seats.map((seat, i) => (
            <button
              key={i}
              type="button"
              class={`seat-card seat-${seat.kind}`}
              data-testid={`party-seat-${i}`}
              onClick={() => onChange(cycleSeat(config, i))}
            >
              <SeatBadge seat={i} />
              <span class="seat-card-name">{seatLabel(seat)}</span>
            </button>
          ))}
        </div>
        <p class="setting-hint">{t('partySeatsHint')}</p>
        <div class="setting-row">
          <span class="setting-name">{t('partyRules')}</span>
          <Segmented<PresetId>
            testId="party-preset"
            value={config.preset}
            options={Object.keys(RULE_PRESETS) as PresetId[]}
            label={(v) => t(PRESET_KEY[v])}
            onChange={(v) => onChange(setPreset(config, v))}
          />
        </div>
        <p class="setting-hint">{t(PRESET_HINT[config.preset])}</p>
        <div class="setting-row">
          <span class="setting-name">{t('partyWins')}</span>
          <Segmented<number>
            testId="party-wins"
            value={config.winsToMatch}
            options={WINS_TO_MATCH_OPTIONS}
            label={(v) => String(v)}
            onChange={(v) => onChange(setWins(config, v))}
          />
        </div>
        <div class="setting-row">
          <span class="setting-name">{t('partyTeams')}</span>
          <Segmented<boolean>
            testId="party-teams"
            value={config.teams}
            options={[false, true]}
            label={(v) => t(v ? 'toggleOn' : 'toggleOff')}
            disabled={(v) => v && !full}
            onChange={(v) => onChange(setTeams(config, v))}
          />
        </div>
        <div class="setting-row">
          <span class="setting-name">{t('partyArena')}</span>
          <button
            type="button"
            class="mode-button secondary compact arena-choose"
            data-testid="party-arena"
            onClick={() => setPicking(true)}
          >
            <span class="mode-name">
              {config.arena === RANDOM_ARENA ? t('arenaRandom') : arenaLabel}
            </span>
          </button>
        </div>
        <div class="result-buttons">
          <button
            type="button"
            class="mode-button"
            data-testid="party-start"
            disabled={!isPlayable(config)}
            onClick={() => onPlay(config)}
          >
            <span class="mode-name">{t('partyStart')}</span>
          </button>
          <button
            type="button"
            class="mode-button secondary"
            data-testid="party-back"
            onClick={onBack}
          >
            <span class="mode-name">{t('back')}</span>
          </button>
        </div>
      </div>
      {picking && (
        <ArenaPicker
          selected={config.arena}
          hasPlus={hasPlus}
          onSelect={(id) => onChange(setArena(config, id))}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
