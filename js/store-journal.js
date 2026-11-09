// JournalStore: the only module that reads or writes journal data.
// Records are {date, text, updatedAt}. Every method returns a Promise so that
// the phase 2 Supabase implementation can drop in behind the same interface.
// The local writes themselves happen synchronously before the promise
// resolves, which lets a pagehide handler flush a pending save safely.

import { kv, persistent } from './storage.js';
import { isISO } from './util.js';

const PREFIX = 'vad:j:';
const listeners = new Set();
const emit = (date) => listeners.forEach((fn) => fn(date));

function read(date) {
  const raw = kv.get(PREFIX + date);
  if (!raw) return null;
  try {
    const r = JSON.parse(raw);
    if (r && typeof r.text === 'string') return { date, text: r.text, updatedAt: String(r.updatedAt || '') };
  } catch {
    /* corrupt record: treat as absent */
  }
  return null;
}

const stamp = (r) => {
  const t = Date.parse(r && r.updatedAt);
  return Number.isFinite(t) ? t : 0;
};

export const JournalStore = {
  persistent,
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  async get(date) {
    return isISO(date) ? read(date) : null;
  },

  /** @returns {Promise<{record:object, persisted:boolean}>} */
  async set(date, text) {
    if (!isISO(date)) throw new Error('Bad date');
    const record = { date, text: String(text), updatedAt: new Date().toISOString() };
    const persisted = kv.set(PREFIX + date, JSON.stringify(record));
    emit(date);
    return { record, persisted };
  },

  /** All records with text, newest date first. */
  async all() {
    return kv
      .keys(PREFIX)
      .map((k) => read(k.slice(PREFIX.length)))
      .filter((r) => r && r.text.trim())
      .sort((a, b) => b.date.localeCompare(a.date));
  },

  async export() {
    return {
      app: 'verse-a-day',
      version: 1,
      exportedAt: new Date().toISOString(),
      journal: (await this.all()).map(({ date, text, updatedAt }) => ({ date, text, updatedAt })),
    };
  },

  /**
   * Merge incoming data. Per date the record with the newest updatedAt wins.
   * With {apply:false} nothing is written and only the summary is returned,
   * so the UI can ask for confirmation first.
   * Accepts the export object or a bare array of records.
   */
  async import(data, { apply = true } = {}) {
    const rows = Array.isArray(data) ? data : data && Array.isArray(data.journal) ? data.journal : null;
    if (!rows) throw new Error('This file does not look like a Verse a Day journal export.');
    const sum = { added: 0, updated: 0, kept: 0, skipped: 0 };
    for (const r of rows) {
      const ok = r && isISO(r.date) && typeof r.text === 'string' && r.text.trim() && Number.isFinite(Date.parse(r.updatedAt));
      if (!ok) {
        sum.skipped++;
        continue;
      }
      const mine = read(r.date);
      if (!mine || !mine.text.trim()) {
        sum.added++;
      } else if (stamp(r) > stamp(mine)) {
        sum.updated++;
      } else {
        sum.kept++;
        continue;
      }
      if (apply) kv.set(PREFIX + r.date, JSON.stringify({ date: r.date, text: r.text, updatedAt: r.updatedAt }));
    }
    if (apply && (sum.added || sum.updated)) emit(null);
    return sum;
  },
};
