import { useState } from 'preact/hooks';
import { BotLevel } from '../core';
import type { PlayMode } from '../game/shell';
import { MAX_CORNER_BOTS } from '../game/modes';
import { getLanguage, setLanguage, t } from '../i18n';
import { levelName } from './PartySetup';

export interface StartScreenProps {
  onStart: (mode: PlayMode, bots?: number) => void;
  /** Party setup (T5.1). */
  onParty?: () => void;
  /** One-tap Quick Match against three bots. */
  onQuick?: () => void;
  /** Challenge map (T5.2). */
  onChallenges?: () => void;
  /** Daily challenge card (T5.3) and the current streak. */
  onDaily?: () => void;
  dailyStreak?: number;
  /** Tutorial (T5.4); `tutorialDone` = finished or skipped (otherwise it is highlighted). */
  onTutorial?: () => void;
  tutorialDone?: boolean;
  /** Bot level of Quick Match and its change handler. */
  quickLevel?: number;
  onQuickLevel?: (level: number) => void;
  /** Device-test tools (web preview / `?spike`): touch tester and the four-corner prototype. */
  spike?: boolean;
  onTouchTest?: () => void;
  /** Initial bot seats for the four-corner prototype. */
  cornerBots?: number;
  onSettings?: () => void;
}

/** Start screen: Quick Match, Party, Challenges, Daily, Tutorial and the first-playable modes. */
export function StartScreen({
  onStart,
  onParty,
  onQuick,
  onChallenges,
  onDaily,
  dailyStreak = 0,
  onTutorial,
  tutorialDone = true,
  quickLevel = BotLevel.NORMAL,
  onQuickLevel,
  spike = false,
  onTouchTest,
  cornerBots = 0,
  onSettings,
}: StartScreenProps) {
  const [bots, setBots] = useState(cornerBots);
  return (
    <div class="screen start-screen" data-testid="start-screen">
      <button
        type="button"
        class="lang-switch"
        data-testid="lang-switch"
        onClick={() => setLanguage(getLanguage() === 'hu' ? 'en' : 'hu')}
      >
        {t('switchLanguage')}
      </button>
      {onSettings && (
        <button
          type="button"
          class="lang-switch settings-switch"
          data-testid="open-settings"
          onClick={onSettings}
        >
          {t('settings')}
        </button>
      )}
      <div class="card start-card">
        <h1 class="title">{t('appTitle')}</h1>
        <p class="tagline">{t('tagline')}</p>
        <div class="mode-buttons">
          {onQuick && (
            <div class="corner-group">
              <button type="button" class="mode-button" data-testid="start-quick" onClick={onQuick}>
                <span class="mode-name">{t('modeQuick')}</span>
                <span class="mode-hint">{t('modeQuickHint')}</span>
              </button>
              {onQuickLevel && (
                <button
                  type="button"
                  class="bots-toggle"
                  data-testid="quick-level"
                  onClick={() => onQuickLevel((quickLevel % BotLevel.EXPERT) + 1)}
                >
                  {levelName(quickLevel)}
                </button>
              )}
            </div>
          )}
          {onParty && (
            <button type="button" class="mode-button" data-testid="start-party" onClick={onParty}>
              <span class="mode-name">{t('modeParty')}</span>
              <span class="mode-hint">{t('modePartyHint')}</span>
            </button>
          )}
          {onChallenges && (
            <button
              type="button"
              class="mode-button"
              data-testid="start-challenges"
              onClick={onChallenges}
            >
              <span class="mode-name">{t('modeChallenges')}</span>
              <span class="mode-hint">{t('modeChallengesHint')}</span>
            </button>
          )}
          {onDaily && (
            <button type="button" class="mode-button" data-testid="start-daily" onClick={onDaily}>
              <span class="mode-name">{t('modeDaily')}</span>
              <span class="mode-hint">
                {dailyStreak > 0 ? t('modeDailyStreak', { n: dailyStreak }) : t('modeDailyHint')}
              </span>
            </button>
          )}
        </div>
        <div class="mode-buttons mode-buttons-minor">
          {onTutorial && (
            <button
              type="button"
              class={
                tutorialDone ? 'mode-button secondary compact' : 'mode-button compact mode-new'
              }
              data-testid="start-tutorial"
              data-done={tutorialDone}
              onClick={onTutorial}
            >
              <span class="mode-name">{t('modeTutorial')}</span>
              <span class="mode-hint">
                {tutorialDone ? t('modeTutorialHint') : t('modeTutorialNew')}
              </span>
            </button>
          )}
          <button
            type="button"
            class="mode-button secondary compact"
            data-testid="start-solo"
            onClick={() => onStart('solo')}
          >
            <span class="mode-name">{t('modeSolo')}</span>
            <span class="mode-hint">{t('modeSoloHint')}</span>
          </button>
          <button
            type="button"
            class="mode-button secondary compact"
            data-testid="start-faceoff"
            onClick={() => onStart('faceoff')}
          >
            <span class="mode-name">{t('modeFaceoff')}</span>
            <span class="mode-hint">{t('modeFaceoffHint')}</span>
          </button>
        </div>
        {spike && (
          <div class="spike-tools" data-testid="spike-tools">
            <p class="spike-title">{t('spikeTools')}</p>
            <div class="mode-buttons">
              <button
                type="button"
                class="mode-button secondary compact"
                data-testid="start-touchtest"
                onClick={() => onTouchTest?.()}
              >
                <span class="mode-name">{t('modeTouchTest')}</span>
                <span class="mode-hint">{t('modeTouchTestHint')}</span>
              </button>
              <div class="corner-group">
                <button
                  type="button"
                  class="mode-button secondary compact"
                  data-testid="start-corners"
                  onClick={() => onStart('corners', bots)}
                >
                  <span class="mode-name">{t('modeCorners')}</span>
                  <span class="mode-hint">{t('modeCornersHint')}</span>
                </button>
                <button
                  type="button"
                  class="bots-toggle"
                  data-testid="corner-bots"
                  onClick={() => setBots((b) => (b + 1) % (MAX_CORNER_BOTS + 1))}
                >
                  {t('cornerBots', { n: bots })}
                </button>
              </div>
            </div>
          </div>
        )}
        <p class="key-hint">{t('keyboardHint')}</p>
      </div>
    </div>
  );
}
