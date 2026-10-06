import { h, render } from 'preact';
import './ui/styles.css';
import { startArenaView, wantsArenaView } from './game/arenaDevView';
import { GameShell, parseShellOptions } from './game/shell';
import { getLanguage, onLanguageChange, setLanguage } from './i18n';
import { createStage } from './render/stage';
import { App } from './ui/App';

async function boot(): Promise<void> {
  const stage = document.getElementById('stage');
  const ui = document.getElementById('ui');
  if (!stage || !ui) throw new Error('Missing #stage or #ui root element');
  const query = new URLSearchParams(location.search);
  const lang = query.get('lang');
  if (lang === 'en' || lang === 'hu') setLanguage(lang);
  const syncLang = (): void => {
    document.documentElement.lang = getLanguage();
  };
  syncLang();
  onLanguageChange(syncLang);
  if (query.has('test') && query.has('input')) {
    // Standalone touch-input harness for e2e and device tests (no renderer / game loop).
    const { mountInputTestPage } = await import('./input/testPage');
    mountInputTestPage(ui, location.search);
    return;
  }
  const app = await createStage(stage);
  // T2.1 renderer dev/test view (`?view=arena`, or `?test` without `game`): scripted inputs.
  if (wantsArenaView(location.search)) {
    startArenaView(app, location.search);
    render(h(App, { shell: undefined }), ui);
    return;
  }
  // The game: start screen → solo / face-off match → result.
  const shell = new GameShell(app, parseShellOptions(location.search));
  render(h(App, { shell }), ui);
}

void boot();
