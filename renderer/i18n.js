'use strict';

// Simple i18n system for AgentProxy
class I18n {
  constructor() {
    this.locale = 'en';
    this.translations = {};
    this.listeners = [];
  }

  async load(locale) {
    try {
      const response = await fetch(`./locales/${locale}.json`);
      if (!response.ok) throw new Error(`Failed to load ${locale}.json`);
      this.translations = await response.json();
      this.locale = locale;
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
    let val = this.translations;
    for (const k of keys) {
      val = val?.[k];
      if (!val) return defaultText;
    }
    return val;
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
