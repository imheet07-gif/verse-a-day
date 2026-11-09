// Script fonts are loaded only when an entry actually needs them.
const FAMILY = {
  hi: 'Noto+Serif+Devanagari:wght@400;600',
  mr: 'Noto+Serif+Devanagari:wght@400;600',
  ne: 'Noto+Serif+Devanagari:wght@400;600',
  ur: 'Noto+Nastaliq+Urdu:wght@400;500',
  fa: 'Noto+Nastaliq+Urdu:wght@400;500',
  bn: 'Noto+Serif+Bengali:wght@400;600',
};
const loaded = new Set();

export function ensureScriptFont(lang) {
  const fam = FAMILY[lang];
  if (!fam || loaded.has(fam)) return;
  loaded.add(fam);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${fam}&display=swap`;
  document.head.append(link);
}
