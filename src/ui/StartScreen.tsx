import { useState } from 'preact/hooks';
import type { PlayMode } from '../game/shell';
import { MAX_CORNER_BOTS } from '../game/modes';
import { getLanguage, setLanguage, t } from '../i18n';

export interface StartScreenProps {
  onStart: (mode: PlayMode, bots?: number) => void;
  /** Device-test tools (web preview / `?spike`): touch tester and the four-corner prototype. */
  spike?: boolean;
  onTouchTest?: () => void;
  /** Initial bot seats for the four-corner prototype. */
  cornerBots?: number;
  onSettings?: () => void;
}

/** Minimal start screen (T2.3): pick a mode; full menus come in T6.1. */
export function StartScreen({
  onStart,
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
          <button
            type="button"
            class="mode-button"
            data-testid="start-solo"
            onClick={() => onStart('solo')}
          >
            <span class="mode-name">{t('modeSolo')}</span>
            <span class="mode-hint">{t('modeSoloHint')}</span>
          </button>
          <button
            type="button"
            class="mode-button"
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
