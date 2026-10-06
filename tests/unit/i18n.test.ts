import { afterEach, describe, expect, it } from 'vitest';
import {
  DICTIONARIES,
  format,
  getLanguage,
  languageFromLocale,
  onLanguageChange,
  setLanguage,
  t,
} from '../../src/i18n';

describe('i18n', () => {
  afterEach(() => setLanguage('en'));

  it('EN and HU define the same non-empty keys', () => {
    const enKeys = Object.keys(DICTIONARIES.en).sort();
    expect(Object.keys(DICTIONARIES.hu).sort()).toEqual(enKeys);
    for (const dict of Object.values(DICTIONARIES)) {
      for (const value of Object.values(dict)) expect(value.trim()).not.toBe('');
    }
  });

  it('maps locales to a supported language', () => {
    expect(languageFromLocale('hu-HU')).toBe('hu');
    expect(languageFromLocale('HU')).toBe('hu');
    expect(languageFromLocale('en-GB')).toBe('en');
    expect(languageFromLocale('de-DE')).toBe('en');
    expect(languageFromLocale(undefined)).toBe('en');
  });

  it('switches language and notifies listeners', () => {
    setLanguage('en');
    let calls = 0;
    const off = onLanguageChange(() => calls++);
    setLanguage('hu');
    expect(getLanguage()).toBe('hu');
    expect(t('rotateDevice')).toBe(DICTIONARIES.hu.rotateDevice);
    setLanguage('hu');
    expect(calls).toBe(1);
    off();
    setLanguage('en');
    expect(calls).toBe(1);
    expect(t('rotateDevice')).toBe(DICTIONARIES.en.rotateDevice);
  });

  it('formats placeholders and keeps unknown ones', () => {
    expect(format('{a} vs {b}', { a: 1, b: 'two' })).toBe('1 vs two');
    expect(format('{missing}', { a: 1 })).toBe('{missing}');
    expect(format('plain')).toBe('plain');
  });
});
