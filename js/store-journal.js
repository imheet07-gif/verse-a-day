// JournalStore: the only module that reads or writes journal data.
// Records are {date, text, updatedAt} plus two sync fields:
//   dirty  changed on this device since the last successful push
//   base   the remote updatedAt this device last saw for that date (or null)
// Records written by phase 1 have neither field: they read as dirty, base null,
// which is exactly what a never-synced local record is.
//
// Every method returns a Promise so a remote-backed store could sit behind the
// same interface, but the local writes themselves happen synchronously before
// the promise resolves, which lets a pagehide handler flush a pending save.
//
// createJournalStore({kv, ns}) is a factory so tests can run several "devices".
// The app uses the default export, which sits on the real localStorage.

import { kv as defaultKv } from './storage.js';
import { isISO } from './util.js';
import { NS } from './device.js';

const stamp = (r) => {
  const t = Date.parse(r && r.updatedAt);
  return Number.isFinite(t) ? t : 0;
};

/**
 * A timestamp for "now" that is strictly later than every floor given. The sync
 * engine tells versions apart by their updatedAt, so two different edits must
 * never share one, even within the same millisecond or across a clock that
 * stepped backwards.
 */
export function stampAfter(floors = [], at = new Date()) {
  let t = at.getTime();
  for (const f of floors) {
    const m = Date.parse(f);
    if (Number.isFinite(m) && m >= t) t = m + 1;
  }
  return new Date(t).toISOString();
}

export function createJournalStore({ kv = defaultKv, ns = '' } = {}) {
  const PREFIX = `vad:${ns}j:`;
  const listeners = new Set();
  const emit = (date, source) => listeners.forEach((fn) => fn(date, source));

  function readRaw(date) {
    const raw = kv.get(PREFIX + date);
    if (!raw) return null;
    try {
      const r = JSON.parse(raw);
      if (r && typeof r.text === 'string') {
        return {
          date,
          text: r.text,
          updatedAt: String(r.updatedAt || ''),
          dirty: r.dirty !== false,
          base: typeof r.base === 'string' && r.base ? r.base : null,
        };
      }
    } catch {
      /* corrupt record: treat as absent */
    }
    return null;
  }

  function writeRaw(rec) {
    return kv.set(
      PREFIX + rec.date,
      JSON.stringify({ date: rec.date, text: rec.text, updatedAt: rec.updatedAt, dirty: !!rec.dirty, base: rec.base || null }),
    );
  }

  function setSync(date, text) {
    if (!isISO(date)) throw new Error('Bad date');
    const prev = readRaw(date);
    const updatedAt = stampAfter(prev ? [prev.updatedAt, prev.base] : []);
    const record = { date, text: String(text), updatedAt, dirty: true, base: prev ? prev.base : null };
    const persisted = writeRaw(record);
    emit(date, 'local');
    return { record, persisted };
  }

  const rawAll = () => kv.keys(PREFIX).map((k) => readRaw(k.slice(PREFIX.length))).filter(Boolean);

  return {
    persistent: kv.persistent,

    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** True when `key` is one of this store's journal keys. */
    owns: (key) => typeof key === 'string' && key.startsWith(PREFIX),

    async get(date) {
      return isISO(date) ? readRaw(date) : null;
    },

    /** @returns {Promise<{record:object, persisted:boolean}>} */
    async set(date, text) {
      return setSync(date, text);
    },
    /** Same as set() but synchronous, for flushing an open editor right now. */
    setSync,

    /** All records with text, newest date first. */
    async all() {
      return rawAll()
        .filter((r) => r.text.trim())
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
     * Imported records are marked dirty so they sync. The existing `base` is
     * kept, so the sync engine still knows which remote version this replaced.
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
        const mine = readRaw(r.date);
        if (!mine || !mine.text.trim()) {
          sum.added++;
        } else if (stamp(r) > stamp(mine)) {
          sum.updated++;
        } else {
          sum.kept++;
          continue;
        }
        if (apply) writeRaw({ date: r.date, text: r.text, updatedAt: r.updatedAt, dirty: true, base: mine ? mine.base : null });
      }
      if (apply && (sum.added || sum.updated)) emit(null, 'import');
      return sum;
    },

    /* ---- used by the sync engine only ---- */

    /** Every record including empty ones, with sync fields. */
    rawAll,
    raw: (date) => (isISO(date) ? readRaw(date) : null),
    dirtyCount: () => rawAll().filter((r) => r.dirty).length,
    /** Write a record exactly as given, without asking for another sync. */
    put(rec, source = 'sync') {
      writeRaw(rec);
      emit(rec.date, source);
    },
    /** Make every record look unsynced, so it merges into whichever account signs in next. */
    markAllUnsynced() {
      for (const r of rawAll()) writeRaw({ ...r, dirty: true, base: null });
    },
    /** Remove every journal record from this device. */
    clearAll() {
      for (const k of kv.keys(PREFIX)) kv.remove(k);
      emit(null, 'sync');
    },
  };
}

export const JournalStore = createJournalStore({ kv: defaultKv, ns: NS });
