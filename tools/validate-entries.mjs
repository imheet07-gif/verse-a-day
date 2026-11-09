#!/usr/bin/env node
// Validates entries/ before anything is committed. No dependencies.
//
//   node tools/validate-entries.mjs                 check every entry and the index
//   node tools/validate-entries.mjs --date 2026-11-11   also require that this day exists
//
// Checks: schema, weekday rotation, the copyright rules that a machine can
// check (no `text` on modern or song entries, no unknown fields that could
// smuggle in lyrics, classics dated before 1929), no repeated piece, and
// entries/index.json in sync with the files. Exit code 0 = valid, 1 = not.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'entries');

// Sunday = 0. Mon/Thu/Sun classic, Tue/Fri modern, Wed/Sat song.
const ROTATION = ['classic', 'classic', 'modern', 'song', 'classic', 'modern', 'song'];
const ALLOWED = new Set(['date', 'type', 'title', 'author', 'year', 'lang', 'dir', 'credits', 'text', 'links', 'who', 'why', 'notice', 'prompts', 'sources', 'sample']);
const INDEX_FIELDS = ['date', 'type', 'title', 'author', 'lang'];
const PD_BEFORE = 1929;
// Prose fields are commentary, not the work. Long line-broken prose there would be a poem or lyric in disguise.
const PROSE = ['who', 'why', 'notice', 'credits'];

const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);

const isISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const str = (v) => typeof v === 'string' && v.trim().length > 0;
const httpsUrl = (u) => {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
};
const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
const norm = (s) => String(s).normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function readJson(file) {
  try {
    return JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  } catch (e) {
    fail(file, `not valid JSON (${e.message})`);
    return null;
  }
}

function checkEntry(file, e) {
  const date = file.replace(/\.json$/, '');
  if (!e || typeof e !== 'object' || Array.isArray(e)) return fail(file, 'must be a JSON object');

  for (const k of Object.keys(e)) if (!ALLOWED.has(k)) fail(file, `unknown field "${k}"`);
  if (e.date !== date) fail(file, `"date" is ${JSON.stringify(e.date)} but the file is named ${date}`);
  if (!isISO(date)) return fail(file, 'file name is not a real YYYY-MM-DD date');

  const expected = ROTATION[new Date(`${date}T00:00:00Z`).getUTCDay()];
  if (!['classic', 'modern', 'song'].includes(e.type)) fail(file, `"type" must be classic, modern or song`);
  else if (e.type !== expected) fail(file, `type is "${e.type}" but the rotation for this weekday is "${expected}"`);

  for (const k of ['title', 'author', 'who', 'why', 'notice']) if (!str(e[k])) fail(file, `"${k}" is required`);
  if ('year' in e && !(Number.isInteger(e.year) && e.year > 0 && e.year <= new Date().getUTCFullYear())) fail(file, '"year" must be a whole year, not in the future');
  if ('lang' in e && !/^[a-z]{2,3}$/.test(e.lang)) fail(file, '"lang" must be a language code like en, hi, ur');
  if ('dir' in e && !['ltr', 'rtl'].includes(e.dir)) fail(file, '"dir" must be ltr or rtl');
  if ('sample' in e && typeof e.sample !== 'boolean') fail(file, '"sample" must be true or false');

  if (!Array.isArray(e.links)) fail(file, '"links" must be a list');
  else e.links.forEach((l, i) => {
    if (!l || !str(l.label) || !httpsUrl(l.url)) fail(file, `links[${i}] needs a label and an https url`);
  });
  if (!Array.isArray(e.sources) || e.sources.length === 0) fail(file, '"sources" needs at least one source');
  else e.sources.forEach((s, i) => {
    if (!s || !str(s.title) || !httpsUrl(s.url)) fail(file, `sources[${i}] needs a title and an https url`);
  });
  if (!Array.isArray(e.prompts) || e.prompts.length !== 2 || !e.prompts.every(str)) fail(file, '"prompts" must be exactly two questions');

  // Copyright rules.
  if (e.type === 'classic') {
    if (!str(e.text)) fail(file, 'classic entries must carry the full "text"');
    if (!Number.isInteger(e.year)) fail(file, 'classic entries need "year" (publication, or the poet\'s death for older work)');
    else if (e.year >= PD_BEFORE) fail(file, `classic "year" is ${e.year}; only work from before ${PD_BEFORE} may carry text`);
  } else {
    if ('text' in e) fail(file, `${e.type} entries must not have "text" (copyright)`);
    if (!Array.isArray(e.links) || e.links.length === 0) fail(file, `${e.type} entries need links, since they carry no text`);
  }
  if (e.type === 'song') {
    if (!str(e.credits)) fail(file, 'song entries need "credits"');
    const hosts = (Array.isArray(e.links) ? e.links : []).map((l) => host(l && l.url));
    for (const h of ['youtube.com', 'open.spotify.com', 'genius.com']) if (!hosts.includes(h)) fail(file, `song entries need a ${h} link`);
  } else if ('credits' in e) fail(file, '"credits" is for songs only');

  for (const k of PROSE) {
    if (typeof e[k] === 'string' && e[k].split('\n').filter((l) => l.trim()).length > 2) fail(file, `"${k}" has line breaks like verse; it must be plain prose`);
  }
  for (const [i, p] of (Array.isArray(e.prompts) ? e.prompts : []).entries()) {
    if (typeof p === 'string' && p.includes('\n')) fail(file, `prompts[${i}] must be a single line`);
  }
}

// ---- run ----
const args = process.argv.slice(2);
const want = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;
if (args.includes('--date') && !isISO(want)) {
  console.error('Usage: node tools/validate-entries.mjs [--date YYYY-MM-DD]');
  process.exit(1);
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
for (const f of readdirSync(DIR)) {
  if (f !== 'index.json' && !f.startsWith('.') && !/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) fail(f, 'unexpected file in entries/');
}

const entries = new Map();
for (const f of files) {
  const e = readJson(f);
  if (e) {
    checkEntry(f, e);
    entries.set(f.replace(/\.json$/, ''), e);
  }
}

// No piece twice.
const seen = new Map();
for (const [date, e] of entries) {
  if (!str(e.title) || !str(e.author)) continue;
  const key = `${norm(e.title)} | ${norm(e.author)}`;
  if (seen.has(key)) fail(`${date}.json`, `repeats "${e.title}" by ${e.author}, already used on ${seen.get(key)}`);
  else seen.set(key, date);
}

// Index in sync.
const index = readJson('index.json');
if (index) {
  if (!Array.isArray(index)) fail('index.json', 'must be a list');
  else {
    const dates = index.map((r) => r && r.date);
    if (new Set(dates).size !== dates.length) fail('index.json', 'has a date more than once');
    if (dates.join() !== [...dates].sort().reverse().join()) fail('index.json', 'must be sorted newest first');
    for (const r of index) {
      if (!r || !entries.has(r.date)) {
        fail('index.json', `lists ${r && r.date} but entries/${r && r.date}.json does not exist`);
        continue;
      }
      const e = entries.get(r.date);
      for (const k of Object.keys(r)) if (!INDEX_FIELDS.includes(k)) fail('index.json', `${r.date} has unknown field "${k}"`);
      for (const k of INDEX_FIELDS) {
        const expect = k === 'lang' ? e.lang || 'en' : e[k];
        if (r[k] !== expect) fail('index.json', `${r.date} "${k}" is ${JSON.stringify(r[k])}, the entry says ${JSON.stringify(expect)}`);
      }
    }
    for (const d of entries.keys()) if (!dates.includes(d)) fail('index.json', `is missing ${d}`);
  }
}

if (want && !entries.has(want)) fail(`${want}.json`, 'does not exist');

if (errors.length) {
  console.error(`INVALID: ${errors.length} problem${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`OK: ${entries.size} entries valid, index in sync${want ? `, ${want} present` : ''}.`);
