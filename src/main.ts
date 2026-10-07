import { h, render } from 'preact';
import './ui/styles.css';
import { startArenaView, wantsArenaView } from './game/arenaDevView';
import { GameShell, parseShellOptions } from './game/shell';
import { startSheetView, wantsSheetView } from './game/sheetView';
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
  // T4.4 item sheets (`?view=sheet&page=…`).
  if (wantsSheetView(location.search)) {
    startSheetView(app, location.search);
    return;
  }
  // T2.1 renderer dev/test view (`?view=arena`, or `?test` without `game`): scripted inputs.
  if (wantsArenaView(location.search)) {
    startArenaView(app, location.search);
    render(h(App, { shell: undefined }), ui);
    return;
  }
  // The game: start screen → solo / face-off match → result. The web preview build (GitHub Pages,
  // `VITE_SPIKE=1`) and `?spike` add the T2.4 device-test tools; `?touchtest` opens the tester.
  const shell = new GameShell(app, parseShellOptions(location.search));
  const touchTest = query.has('touchtest');
  const spike = import.meta.env.VITE_SPIKE === '1' || query.has('spike') || touchTest;
  render(h(App, { shell, spike, touchTest }), ui);
}

void boot();
