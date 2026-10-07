import { useEffect, useState } from 'preact/hooks';
import {
  GAME_SPEEDS,
  HAPTICS_OPTIONS,
  type HapticsSetting,
  type Settings,
  type SettingsStore,
} from '../game/settings';
import { t, type TranslationKey } from '../i18n';

const HAPTIC_LABEL: Record<HapticsSetting, TranslationKey> = {
  auto: 'hapticsAuto',
  on: 'hapticsOn',
  off: 'hapticsOff',
};

function Segmented<T extends string | number | boolean>(props: {
  testId: string;
  value: T;
  options: readonly T[];
  label: (v: T) => string;
  onChange: (v: T) => void;
}) {
  return (
    <div class="segmented" role="radiogroup" data-testid={props.testId}>
      {props.options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={o === props.value}
          class={o === props.value ? 'segment segment-on' : 'segment'}
          data-testid={`${props.testId}-${String(o)}`}
          onClick={() => props.onChange(o)}
        >
          {props.label(o)}
        </button>
      ))}
    </div>
  );
}

function Volume(props: {
  testId: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const pct = Math.round(props.value * 100);
  return (
    <label class="setting-row">
      <span class="setting-name">{props.label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={10}
        value={pct}
        data-testid={props.testId}
        onInput={(e) => props.onChange(Number((e.currentTarget as HTMLInputElement).value) / 100)}
      />
      <span class="setting-value">{t('percent', { n: pct })}</span>
    </label>
  );
}

/** Game-feel settings (T3.2/T3.3): volumes, game speed, vibration, reduced motion. */
export function SettingsPanel({ store, onBack }: { store: SettingsStore; onBack: () => void }) {
  const [s, setS] = useState<Settings>(store.get());
  useEffect(() => store.subscribe(setS), [store]);
  const update = (patch: Partial<Settings>): void => {
    store.update(patch);
  };
  return (
    <div class="screen settings-screen" data-testid="settings-screen">
      <div class="card settings-card">
        <h2 class="settings-title">{t('settingsTitle')}</h2>
        <Volume
          testId="music-volume"
          label={t('musicVolume')}
          value={s.musicVolume}
          onChange={(v) => update({ musicVolume: v })}
        />
        <Volume
          testId="sfx-volume"
          label={t('sfxVolume')}
          value={s.sfxVolume}
          onChange={(v) => update({ sfxVolume: v })}
        />
        <div class="setting-row">
          <span class="setting-name">{t('gameSpeed')}</span>
          <Segmented
            testId="game-speed"
            value={s.gameSpeed}
            options={GAME_SPEEDS}
            label={(v) => t('percent', { n: v })}
            onChange={(v) => update({ gameSpeed: v })}
          />
        </div>
        <p class="setting-hint">{t('gameSpeedHint')}</p>
        <div class="setting-row">
          <span class="setting-name">{t('haptics')}</span>
          <Segmented
            testId="haptics"
            value={s.haptics}
            options={HAPTICS_OPTIONS}
            label={(v) => t(HAPTIC_LABEL[v])}
            onChange={(v) => update({ haptics: v })}
          />
        </div>
        <p class="setting-hint">{t('hapticsHint')}</p>
        <div class="setting-row">
          <span class="setting-name">{t('reducedMotion')}</span>
          <Segmented
            testId="reduced-motion"
            value={s.reducedMotion}
            options={[true, false] as const}
            label={(v) => t(v ? 'toggleOn' : 'toggleOff')}
            onChange={(v) => update({ reducedMotion: v })}
          />
        </div>
        <p class="setting-hint">{t('reducedMotionHint')}</p>
        <div class="result-buttons">
          <button
            type="button"
            class="mode-button compact"
            data-testid="settings-back"
            onClick={onBack}
          >
            <span class="mode-name">{t('back')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
