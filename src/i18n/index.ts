import { en, type TranslationKey } from './en';
import { hu } from './hu';

export type { TranslationKey };
export type Language = 'en' | 'hu';

export const DICTIONARIES: Record<Language, Record<TranslationKey, string>> = { en, hu };

/** Picks Hungarian for any `hu*` locale, English otherwise. */
export function languageFromLocale(locale: string | undefined): Language {
  return (locale ?? 'en').toLowerCase().startsWith('hu') ? 'hu' : 'en';
}

/** The device / browser language. */
export function deviceLanguage(): Language {
  return languageFromLocale(globalThis.navigator?.language);
}

let current: Language = deviceLanguage();
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

export function setLanguage(lang: Language): void {
  if (lang === current) return;
  current = lang;
  for (const listener of listeners) listener();
}

export function onLanguageChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Translates `key`, substituting `{name}` placeholders from `params`. */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  return format(DICTIONARIES[current][key] ?? en[key], params);
}

export function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}
