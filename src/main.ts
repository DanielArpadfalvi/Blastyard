import { h, render } from 'preact';
import './ui/styles.css';
import { startArenaView, wantsArenaView } from './game/arenaDevView';
import { getLanguage, onLanguageChange } from './i18n';
import { createStage } from './render/stage';
import { App } from './ui/App';

async function boot(): Promise<void> {
  const stage = document.getElementById('stage');
  const ui = document.getElementById('ui');
  if (!stage || !ui) throw new Error('Missing #stage or #ui root element');
  const syncLang = (): void => {
    document.documentElement.lang = getLanguage();
  };
  syncLang();
  onLanguageChange(syncLang);
  const query = new URLSearchParams(location.search);
  if (query.has('test') && query.has('input')) {
    // Standalone touch-input harness for e2e and device tests (no renderer / game loop).
    const { mountInputTestPage } = await import('./input/testPage');
    mountInputTestPage(ui, location.search);
    return;
  }
  const app = await createStage(stage);
  // T2.1 renderer dev/test view (`?test` or `?view=arena`): a seeded match with scripted inputs.
  if (wantsArenaView(location.search)) startArenaView(app, location.search);
  render(h(App, {}), ui);
}

void boot();
