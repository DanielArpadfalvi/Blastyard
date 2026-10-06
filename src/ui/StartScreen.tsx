import type { PlayMode } from '../game/shell';
import { getLanguage, setLanguage, t } from '../i18n';

/** Minimal start screen (T2.3): pick a mode; full menus come in T6.1. */
export function StartScreen({ onStart }: { onStart: (mode: PlayMode) => void }) {
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
        <p class="key-hint">{t('keyboardHint')}</p>
      </div>
    </div>
  );
}
