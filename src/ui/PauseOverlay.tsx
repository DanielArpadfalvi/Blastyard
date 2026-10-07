import { useEffect, useRef } from 'preact/hooks';
import { t } from '../i18n';

/** The pause card: resume, restart or leave the match. */
export function PauseOverlay(props: {
  onResume: () => void;
  onRestart: () => void;
  onLeave: () => void;
}) {
  const resume = useRef<HTMLButtonElement>(null);
  useEffect(() => resume.current?.focus(), []);
  return (
    <div class="screen pause-screen" data-testid="pause-overlay" role="dialog" aria-modal="true">
      <div class="card pause-card">
        <h2 class="settings-title">{t('paused')}</h2>
        <div class="pause-buttons">
          <button
            type="button"
            ref={resume}
            class="mode-button"
            data-testid="pause-resume"
            onClick={props.onResume}
          >
            <span class="mode-name">{t('resume')}</span>
          </button>
          <button
            type="button"
            class="mode-button secondary"
            data-testid="pause-restart"
            onClick={props.onRestart}
          >
            <span class="mode-name">{t('restart')}</span>
          </button>
          <button
            type="button"
            class="mode-button secondary"
            data-testid="pause-leave"
            onClick={props.onLeave}
          >
            <span class="mode-name">{t('leaveMatch')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
