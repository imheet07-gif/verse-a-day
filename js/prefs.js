// Reader preferences: text size, theme, rail. Persisted through the kv wrapper.
import { kv } from './storage.js';

export const SIZES = [1.08, 1.2, 1.34, 1.52, 1.74]; // rem, poem text
export const THEMES = [
  { id: 'auto', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'paper', label: 'Paper' },
  { id: 'night', label: 'Night' },
];
const BAR = { light: '#E9F0F6', dark: '#101826', paper: '#EDE6D6', night: '#07090E' };

const listeners = new Set();
export const prefs = {
  size: clampSize(Number(kv.get('vad:size') ?? 2)),
  theme: THEMES.some((t) => t.id === kv.get('vad:theme')) ? kv.get('vad:theme') : 'auto',
  rail: kv.get('vad:rail') === null ? window.innerWidth >= 1280 : kv.get('vad:rail') === '1',
  welcomed: kv.get('vad:welcomed') === '1',
};

function clampSize(n) {
  return Number.isFinite(n) ? Math.min(SIZES.length - 1, Math.max(0, Math.round(n))) : 2;
}

export function apply() {
  const root = document.documentElement;
  root.style.setProperty('--poem-size', `${SIZES[prefs.size]}rem`);
  if (prefs.theme === 'auto') root.removeAttribute('data-theme');
  else root.dataset.theme = prefs.theme;
  const resolved =
    prefs.theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : prefs.theme;
  const meta = document.getElementById('meta-theme');
  if (meta) {
    meta.removeAttribute('media');
    meta.content = BAR[resolved];
  }
  const app = document.getElementById('app');
  if (app) app.dataset.rail = prefs.rail ? 'open' : 'closed';
}

export function set(key, value) {
  if (key === 'size') prefs.size = clampSize(value);
  else if (key === 'theme') prefs.theme = value;
  else if (key === 'rail') prefs.rail = !!value;
  else if (key === 'welcomed') prefs.welcomed = !!value;
  const stored = typeof prefs[key] === 'boolean' ? (prefs[key] ? '1' : '0') : String(prefs[key]);
  kv.set('vad:' + key, stored);
  apply();
  listeners.forEach((fn) => fn(key));
}

export const onPrefs = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => prefs.theme === 'auto' && apply());
