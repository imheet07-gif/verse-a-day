// EntryStore: the only module that knows entries are JSON files on the site.
// To read entries from somewhere else later, replace this file's internals and
// keep list() / get(date) / all().

import { isISO } from './util.js';

const base = new URL('entries/', document.baseURI);
const cache = new Map();
let index = null;

const validIndexRow = (r) => r && isISO(r.date) && typeof r.title === 'string';

export const EntryStore = {
  /** Index rows, newest first: [{date,type,title,author,lang}] */
  async list(force = false) {
    if (index && !force) return index;
    const res = await fetch(new URL('index.json', base), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Entry index returned ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Entry index is not a list');
    index = data.filter(validIndexRow).sort((a, b) => b.date.localeCompare(a.date));
    if (force) cache.clear();
    return index;
  },

  /** Full entry for a day, or null when there is none. */
  async get(date) {
    if (!isISO(date)) return null;
    if (cache.has(date)) return cache.get(date);
    const res = await fetch(new URL(`${date}.json`, base), { cache: 'no-cache' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Entry ${date} returned ${res.status}`);
    const entry = await res.json();
    if (!entry || typeof entry !== 'object') throw new Error(`Entry ${date} is malformed`);
    cache.set(date, entry);
    return entry;
  },

  /** Every full entry (used by Look up). The files are small. */
  async all() {
    const rows = await this.list();
    const entries = await Promise.all(rows.map((r) => this.get(r.date).catch(() => null)));
    return entries.filter(Boolean);
  },
};
