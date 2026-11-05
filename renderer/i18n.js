'use strict';

// Simple i18n system for AgentProxy with English fallback
class I18n {
  constructor() {
    this.locale = 'en';
    this.translations = {};
    this.fallbackTranslations = {}; // English as fallback
    this.listeners = [];
  }

  async load(locale) {
    try {
      const response = await fetch(`./locales/${locale}.json`);
      if (!response.ok) throw new Error(`Failed to load ${locale}.json`);
      this.translations = await response.json();
      this.locale = locale;

      // Load English as fallback if not already loaded
      if (locale !== 'en' && !Object.keys(this.fallbackTranslations).length) {
        const fallbackRes = await fetch('./locales/en.json');
        if (fallbackRes.ok) {
          this.fallbackTranslations = await fallbackRes.json();
        }
      }

      localStorage.setItem('agentproxy-lang', locale);
      this.notifyListeners();
      return true;
    } catch (e) {
      console.error('[i18n] Load failed:', e.message);
      return false;
    }
  }

  t(key, defaultText = key) {
    const keys = key.split('.');

    // Try current locale
    let val = this.translations;
    for (const k of keys) {
      val = val?.[k];
      if (!val) break;
    }
    if (val && typeof val === 'string') return val;

    // Fallback to English
    if (this.locale !== 'en') {
      val = this.fallbackTranslations;
      for (const k of keys) {
        val = val?.[k];
        if (!val) break;
      }
      if (val && typeof val === 'string') return val;
    }

    // If still not found, return default
    return defaultText;
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  notifyListeners() {
    this.listeners.forEach(fn => fn(this.locale));
  }

  getLocale() {
    return this.locale;
  }
}

const i18n = new I18n();
