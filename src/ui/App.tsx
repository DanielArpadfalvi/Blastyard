import { useEffect, useState } from 'preact/hooks';
import { onLanguageChange, t } from '../i18n';

/** Root of the DOM overlay drawn above the Pixi canvas. */
export function App() {
  const [, setRevision] = useState(0);
  useEffect(() => onLanguageChange(() => setRevision((r) => r + 1)), []);

  return (
    <div class="overlay" data-testid="ui-root">
      <div class="rotate-hint" role="status">
        {t('rotateDevice')}
      </div>
    </div>
  );
}
