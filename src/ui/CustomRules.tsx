import {
  CHANCE_OPTIONS,
  DEFAULT_CUSTOM,
  POWER_LEVELS,
  ROUND_OPTIONS,
  START_BOMB_OPTIONS,
  START_RANGE_OPTIONS,
  START_SPEED_OPTIONS,
  noPowerups,
  type CustomRules,
  type PowerLevel,
} from '../game/customRules';
import { t, type TranslationKey } from '../i18n';
import { Segmented } from './Segmented';

function Row<T extends string | number | boolean>(props: {
  testId: string;
  label: string;
  value: T;
  options: readonly T[];
  text: (v: T) => string;
  onChange: (v: T) => void;
}) {
  return (
    <div class="setting-row">
      <span class="setting-name">{props.label}</span>
      <Segmented<T>
        testId={props.testId}
        value={props.value}
        options={props.options}
        label={props.text}
        onChange={props.onChange}
      />
    </div>
  );
}

const num = (v: number): string => String(v);

/**
 * Custom rules editor (Blastyard+, PLAN §1.6): round time, start stats, power-up chance, every
 * power-up off / rare / normal / often, sudden death, ghost revenge. Edits apply at once.
 */
export function CustomRulesEditor(props: {
  value: CustomRules;
  onChange: (next: CustomRules) => void;
  onClose: () => void;
}) {
  const { value: c, onChange, onClose } = props;
  const set = (patch: Partial<CustomRules>): void => onChange({ ...c, ...patch });
  const setPower = (i: number, level: PowerLevel): void =>
    set({ powerups: c.powerups.map((l, k) => (k === i ? level : l)) });
  return (
    <div class="screen custom-screen" data-testid="custom-rules">
      <div class="card custom-card">
        <h2 class="settings-title">{t('customTitle')}</h2>
        <Row
          testId="custom-round"
          label={t('customRound')}
          value={c.roundSeconds}
          options={ROUND_OPTIONS}
          text={(v) => (v === 0 ? t('customRoundNone') : t('customSeconds', { n: v }))}
          onChange={(v) => set({ roundSeconds: v })}
        />
        <Row
          testId="custom-bombs"
          label={t('customStartPops')}
          value={c.startBombs}
          options={START_BOMB_OPTIONS}
          text={num}
          onChange={(v) => set({ startBombs: v })}
        />
        <Row
          testId="custom-range"
          label={t('customStartFlame')}
          value={c.startRange}
          options={START_RANGE_OPTIONS}
          text={num}
          onChange={(v) => set({ startRange: v })}
        />
        <Row
          testId="custom-speed"
          label={t('customStartSpeed')}
          value={c.startSpeed}
          options={START_SPEED_OPTIONS}
          text={num}
          onChange={(v) => set({ startSpeed: v })}
        />
        <Row
          testId="custom-chance"
          label={t('customChance')}
          value={c.powerupChance}
          options={CHANCE_OPTIONS}
          text={(v) => t('customPercent', { n: v })}
          onChange={(v) => set({ powerupChance: v })}
        />
        <Row<'spiral' | 'none'>
          testId="custom-sudden"
          label={t('customSuddenDeath')}
          value={c.suddenDeath}
          options={['spiral', 'none']}
          text={(v) => t(v === 'spiral' ? 'customSpiral' : 'customDraw')}
          onChange={(v) => set({ suddenDeath: v })}
        />
        <Row<boolean>
          testId="custom-ghosts"
          label={t('customGhosts')}
          value={c.ghosts}
          options={[true, false]}
          text={(v) => t(v ? 'toggleOn' : 'toggleOff')}
          onChange={(v) => set({ ghosts: v })}
        />
        <h3 class="paywall-subtitle">{t('customPowerups')}</h3>
        <div class="custom-power">
          {c.powerups.map((level, i) => (
            <div key={i} class="setting-row">
              <span class="setting-name">{t(`pickup${i + 1}` as TranslationKey)}</span>
              <Segmented<PowerLevel>
                testId={`custom-power-${i + 1}`}
                value={level}
                options={POWER_LEVELS}
                label={(v) => t(`powerLevel${v}` as TranslationKey)}
                onChange={(v) => setPower(i, v)}
              />
            </div>
          ))}
        </div>
        {noPowerups(c) && (
          <p class="setting-hint custom-warning" role="status">
            {t('customAllOff')}
          </p>
        )}
        <div class="result-buttons">
          <button
            type="button"
            class="mode-button compact"
            data-testid="custom-done"
            onClick={onClose}
          >
            <span class="mode-name">{t('customDone')}</span>
          </button>
          <button
            type="button"
            class="mode-button secondary compact"
            data-testid="custom-reset"
            onClick={() => onChange(DEFAULT_CUSTOM)}
          >
            <span class="mode-name">{t('customReset')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
