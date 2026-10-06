import { useEffect, useState } from 'preact/hooks';
import type { GameShell, PlayMode, ShellState } from '../game/shell';
import { onLanguageChange, t } from '../i18n';
import { Hud } from './Hud';
import { ResultScreen } from './ResultScreen';
import { StartScreen } from './StartScreen';

/** Root of the DOM overlay drawn above the Pixi canvas. */
export function App({ shell }: { shell?: GameShell }) {
  const [, setRevision] = useState(0);
  const [state, setState] = useState<ShellState | null>(shell ? shell.getState() : null);
  useEffect(() => onLanguageChange(() => setRevision((r) => r + 1)), []);
  useEffect(() => (shell ? shell.subscribe(setState) : undefined), [shell]);

  const screen = state?.screen;
  const result = state?.result;
  useEffect(() => {
    if (!shell || screen !== 'playing') return undefined;
    // Desktop: Escape leaves the match (the in-match pause comes with T5.1).
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') shell.showMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shell, screen]);

  return (
    <div class="overlay" data-testid="ui-root">
      {shell && state?.screen === 'menu' && <StartScreen onStart={(m) => shell.start(m)} />}
      {shell && state?.screen !== 'menu' && state?.snapshot && (
        <Hud snapshot={state.snapshot} banners={state.screen === 'playing'} />
      )}
      {shell && state?.screen === 'result' && result && result.mode !== 'attract' && (
        <ResultScreen
          result={result}
          onAgain={() => shell.start(result.mode as PlayMode)}
          onMenu={() => shell.showMenu()}
        />
      )}
      <div class="rotate-hint" role="status">
        {t('rotateDevice')}
      </div>
    </div>
  );
}
