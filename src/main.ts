import { h, render } from 'preact';
import './ui/styles.css';
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
  await createStage(stage);
  render(h(App, {}), ui);
}

void boot();
