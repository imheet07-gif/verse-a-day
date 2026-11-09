#!/usr/bin/env node
// Rebuilds entries/index.json from the entry files: newest first, one row per
// line, fields date/type/title/author/lang. Run after adding or editing an entry.
//
//   node tools/update-index.mjs

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'entries');

const rows = readdirSync(DIR)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .sort()
  .reverse()
  .map((f) => {
    const e = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
    return { date: e.date, type: e.type, title: e.title, author: e.author, lang: e.lang || 'en' };
  });

const line = (r) => `  {${Object.entries(r).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')}}`;
const body = rows.map(line).join(',\n');
writeFileSync(join(DIR, 'index.json'), `[\n${body}\n]\n`);
console.log(`index.json rebuilt: ${rows.length} entries, newest ${rows[0] ? rows[0].date : 'none'}.`);
