import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  ASSIST_OPTIONS,
  GAME_SPEEDS,
  HAPTICS_OPTIONS,
  LANGUAGE_OPTIONS,
  SCHEME_OPTIONS,
  ZONE_SCALES,
  type AssistSetting,
  type HapticsSetting,
  type LanguageSetting,
  type SchemeSetting,
  type Settings,
  type SettingsStore,
} from '../game/settings';
import { getLanguage, t, type TranslationKey } from '../i18n';
import type { Entitlements, RestoreResult } from '../platform/entitlement';
import { openExternal, siteUrl } from '../platform/links';
import { Segmented } from './Segmented';

const HAPTIC_LABEL: Record<HapticsSetting, TranslationKey> = {
  auto: 'hapticsAuto',
  on: 'hapticsOn',
  off: 'hapticsOff',
};
const LANGUAGE_LABEL: Record<LanguageSetting, TranslationKey> = {
  auto: 'languageAuto',
  en: 'languageEn',
  hu: 'languageHu',
};
const SCHEME_LABEL: Record<SchemeSetting, TranslationKey> = {
  twoThumb: 'schemeTwoThumb',
  oneFinger: 'schemeOneFinger',
};
const ASSIST_LABEL: Record<AssistSetting, TranslationKey> = {
  low: 'assistLow',
  normal: 'assistNormal',
  high: 'assistHigh',
};
const RESTORE_LABEL: Record<RestoreResult, TranslationKey> = {
  restored: 'restoreRestored',
  nothing: 'restoreNothing',
  unavailable: 'restoreUnavailable',
};

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

/** A labelled row with a segmented choice and an optional hint line below it. */
function Choice<T extends string | number | boolean>(props: {
  testId: string;
  label: string;
  hint?: string;
  value: T;
  options: readonly T[];
  text: (v: T) => string;
  onChange: (v: T) => void;
}) {
  return (
    <>
      <div class="setting-row">
        <span class="setting-name">{props.label}</span>
        <Segmented
          testId={props.testId}
          value={props.value}
          options={props.options}
          label={props.text}
          onChange={props.onChange}
        />
      </div>
      {props.hint && <p class="setting-hint">{props.hint}</p>}
    </>
  );
}

function Section(props: { id: string; title: string; children: ComponentChildren }) {
  return (
    <section class="settings-section" data-testid={`settings-sec-${props.id}`}>
      <h3 class="settings-section-title">{props.title}</h3>
      {props.children}
    </section>
  );
}

const onOff = (v: boolean): string => t(v ? 'toggleOn' : 'toggleOff');
const BOOL = [true, false] as const;

/**
 * Settings (T3.2/T3.3, T6.1): game (language, speed, friendly rule, corner assist), controls
 * (scheme, left-handed, control size, vibration, touch test), accessibility (reduced motion,
 * larger text), sound, and about (version, privacy, support, restore purchases).
 */
export function SettingsPanel(props: {
  store: SettingsStore;
  entitlements?: Entitlements;
  onTouchTest?: () => void;
  onBack: () => void;
  /** Open the Blastyard+ / Supporter page. */
  onPlus?: () => void;
  /** Delete the online profile (only when online play is available). */
  onDeleteOnline?: () => Promise<void>;
}) {
  const { store, entitlements, onTouchTest, onBack, onPlus, onDeleteOnline } = props;
  const [onlineDeleted, setOnlineDeleted] = useState(false);
  const [s, setS] = useState<Settings>(store.get());
  const [restore, setRestore] = useState<RestoreResult | 'busy' | null>(null);
  useEffect(() => store.subscribe(setS), [store]);
  const update = (patch: Partial<Settings>): void => {
    store.update(patch);
  };
  const doRestore = (): void => {
    if (!entitlements) return;
    setRestore('busy');
    entitlements.restore().then(setRestore, () => setRestore('unavailable'));
  };
  return (
    <div class="screen settings-screen" data-testid="settings-screen">
      <div class="card settings-card">
        <h2 class="settings-title">{t('settingsTitle')}</h2>
        <Section id="game" title={t('secGame')}>
          <Choice
            testId="language"
            label={t('language')}
            value={s.language}
            options={LANGUAGE_OPTIONS}
            text={(v) => t(LANGUAGE_LABEL[v])}
            onChange={(v) => update({ language: v })}
          />
          <Choice
            testId="game-speed"
            label={t('gameSpeed')}
            hint={t('gameSpeedHint')}
            value={s.gameSpeed}
            options={GAME_SPEEDS}
            text={(v) => t('percent', { n: v })}
            onChange={(v) => update({ gameSpeed: v })}
          />
          <Choice
            testId="friendly"
            label={t('friendlyRule')}
            hint={t('friendlyRuleHint')}
            value={s.friendly}
            options={BOOL}
            text={onOff}
            onChange={(v) => update({ friendly: v })}
          />
          <Choice
            testId="corner-assist"
            label={t('cornerAssist')}
            hint={t('cornerAssistHint')}
            value={s.cornerAssist}
            options={ASSIST_OPTIONS}
            text={(v) => t(ASSIST_LABEL[v])}
            onChange={(v) => update({ cornerAssist: v })}
          />
        </Section>
        <Section id="controls" title={t('secControls')}>
          <Choice
            testId="scheme"
            label={t('controlScheme')}
            hint={t('schemeHint')}
            value={s.scheme}
            options={SCHEME_OPTIONS}
            text={(v) => t(SCHEME_LABEL[v])}
            onChange={(v) => update({ scheme: v })}
          />
          <Choice
            testId="left-handed"
            label={t('leftHanded')}
            hint={t('leftHandedHint')}
            value={s.leftHanded}
            options={BOOL}
            text={onOff}
            onChange={(v) => update({ leftHanded: v })}
          />
          <Choice
            testId="zone-size"
            label={t('zoneSize')}
            hint={t('zoneSizeHint')}
            value={s.zoneScale}
            options={ZONE_SCALES}
            text={(v) => t('percent', { n: v })}
            onChange={(v) => update({ zoneScale: v })}
          />
          <Choice
            testId="haptics"
            label={t('haptics')}
            hint={t('hapticsHint')}
            value={s.haptics}
            options={HAPTICS_OPTIONS}
            text={(v) => t(HAPTIC_LABEL[v])}
            onChange={(v) => update({ haptics: v })}
          />
          {onTouchTest && (
            <>
              <div class="setting-row">
                <span class="setting-name">{t('touchTest')}</span>
                <button
                  type="button"
                  class="bots-toggle"
                  data-testid="settings-touch-test"
                  onClick={onTouchTest}
                >
                  {t('touchTest')}
                </button>
              </div>
              <p class="setting-hint">{t('touchTestSettingHint')}</p>
            </>
          )}
        </Section>
        <Section id="access" title={t('secAccess')}>
          <Choice
            testId="reduced-motion"
            label={t('reducedMotion')}
            hint={t('reducedMotionHint')}
            value={s.reducedMotion}
            options={BOOL}
            text={onOff}
            onChange={(v) => update({ reducedMotion: v })}
          />
          <Choice
            testId="large-text"
            label={t('largeText')}
            value={s.largeText}
            options={BOOL}
            text={onOff}
            onChange={(v) => update({ largeText: v })}
          />
        </Section>
        <Section id="sound" title={t('secSound')}>
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
        </Section>
        <Section id="about" title={t('secAbout')}>
          <p class="setting-hint about-line" data-testid="about-version">
            {t('aboutVersion', { v: __APP_VERSION__ })} · {t('aboutNoTracking')}
          </p>
          <div class="about-buttons">
            <button
              type="button"
              class="bots-toggle"
              data-testid="about-privacy"
              onClick={() => openExternal(siteUrl('privacy', getLanguage()))}
            >
              {t('aboutPrivacy')}
            </button>
            <button
              type="button"
              class="bots-toggle"
              data-testid="about-support"
              onClick={() => openExternal(siteUrl('support', getLanguage()))}
            >
              {t('aboutSupport')}
            </button>
            {onPlus && (
              <button
                type="button"
                class="bots-toggle"
                data-testid="settings-plus"
                onClick={onPlus}
              >
                {t('settingsPlus')}
              </button>
            )}
            {entitlements && (
              <button
                type="button"
                class="bots-toggle"
                data-testid="restore-purchases"
                disabled={restore === 'busy'}
                onClick={doRestore}
              >
                {t('restorePurchases')}
              </button>
            )}
          </div>
          {onDeleteOnline && (
            <div class="about-buttons">
              <button
                type="button"
                class="bots-toggle"
                data-testid="settings-delete-online"
                disabled={onlineDeleted}
                onClick={() => void onDeleteOnline().then(() => setOnlineDeleted(true))}
              >
                {t('settingsDeleteOnline')}
              </button>
              {onlineDeleted && (
                <span class="setting-hint" role="status">
                  {t('settingsDeleteOnlineDone')}
                </span>
              )}
            </div>
          )}
          {restore !== null && restore !== 'busy' && (
            <p class="setting-hint" role="status" data-testid="restore-status">
              {t(
                restore === 'restored' && !entitlements?.hasPlus()
                  ? 'restoreRestoredAny'
                  : RESTORE_LABEL[restore],
              )}
            </p>
          )}
        </Section>
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
