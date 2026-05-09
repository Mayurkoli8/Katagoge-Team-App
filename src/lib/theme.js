import { THEMES, DEFAULT_THEME } from '../config.js';

const STORAGE_KEY = 'katagoge:theme';

export function applyTheme(name) {
  const theme = THEMES[name] || THEMES[DEFAULT_THEME];
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.vars)) {
    root.style.setProperty(`--${k}`, v);
  }
  root.setAttribute('data-theme', name);
  // For native UI (scrollbars, form controls) to match
  root.style.colorScheme = name === 'dark' ? 'dark' : 'light';
  try { localStorage.setItem(STORAGE_KEY, name); } catch (e) {}
}

export function getStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && THEMES[v]) return v;
  } catch (e) {}
  return DEFAULT_THEME;
}

export function listThemes() {
  return Object.entries(THEMES).map(([id, t]) => ({ id, label: t.label, desc: t.desc }));
}
