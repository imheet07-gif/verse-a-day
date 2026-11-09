// The sync engine. Plain module, no DOM: it is driven by a JournalStore and a
// Remote, which is what lets tests/sync.test.mjs run it under node.
//
// The one rule everything here serves: no path may lose journal text silently.
// So:
//  - Decisions are made synchronously, per date, against a FRESH read of the
//    local record taken after the network round trip (typing never waits on the
//    network, and an edit made during a pull or push is never overwritten).
//  - A push is compare-and-set against the remote version we saw. If another
//    device got there first the push is refused and the next pull turns it into
//    a conflict instead of an overwrite.
//  - A real clash (this device changed it AND the remote changed it, texts
//    differ) is never auto-resolved. It waits in `conflicts` for the person.
//  - Failures leave records dirty and retry; nothing local is ever deleted by a
//    failure, a sign-out or an expired session.

import { isISO } from './util.js';
import { stampAfter } from './store-journal.js';
import { normTime } from './remote.js';

export const DIVIDER = '\n\n———\n\n';

/** "Keep both": this device's text first, a divider, then the other device's. */
export function joinBoth(mine, theirs) {
  if (!mine.trim()) return theirs;
  if (!theirs.trim()) return mine;
  return mine.replace(/\s+$/, '') + DIVIDER + theirs;
}

export function createSync({ store, kv, ns = '', remote = null, loadRemote = null, timers = {}, now = () => new Date() }) {
  const setT = timers.set || ((fn, ms) => setTimeout(fn, ms));
  const clearT = timers.clear || ((id) => clearTimeout(id));
  const META = `vad:${ns}sync:`;
  const meta = {
    get: (k) => kv.get(META + k),
    set: (k, v) => kv.set(META + k, v),
  };

  const S = {
    mode: loadRemote || remote ? 'starting' : 'off', // off | starting | unavailable | signedout | signedin
    user: null,
    run: 'idle', // idle | syncing | offline | error   (meaningful while signed in)
    error: '',
    authExpired: false,
    lastSynced: meta.get('last') || null,
    hold: false, // sync paused while the "different account" question is open
    ownerPrompt: null, // {count}
  };
  let conflicts = []; // [{date, local:{text,updatedAt}, remote:{text,updatedAt}}]
  const editors = new Map(); // date -> {busy():bool, flush():void}
  const subs = new Set();
  let epoch = 0; // bumped whenever the signed-in identity changes, to abandon in-flight work
  let running = null;
  let again = false;
  let failures = 0;
  let timer = null;
  let retryTimer = null;
  let unsubAuth = null;

  const nowISO = () => now().toISOString();

  function getState() {
    return {
      ...S,
      configured: S.mode !== 'off',
      pending: S.mode === 'signedin' ? store.dirtyCount() : 0,
      conflicts: conflicts.map((c) => ({ ...c })),
    };
  }
  function emit() {
    const st = getState();
    subs.forEach((fn) => {
      try {
        fn(st);
      } catch {
        /* a broken subscriber must not break sync */
      }
    });
  }
  const subscribe = (fn) => (subs.add(fn), () => subs.delete(fn));

  /* ------------------------------------------------------------ identity */

  async function init() {
    if (!remote && loadRemote) {
      try {
        remote = await loadRemote();
      } catch {
        remote = null;
        S.mode = 'unavailable';
        emit();
        return;
      }
    }
    if (!remote) {
      S.mode = 'off';
      emit();
      return;
    }
    unsubAuth && unsubAuth();
    unsubAuth = remote.onAuthChange(onAuth);
    const session = await remote.session();
    if (session) adopt(session);
    else {
      S.mode = 'signedout';
      emit();
    }
  }

  /** The library may have failed to load (offline first run). Try again, e.g. when back online. */
  async function retryLoad() {
    if (S.mode !== 'unavailable' || !loadRemote) return;
    S.mode = 'starting';
    emit();
    await init();
  }

  function adopt(session) {
    const user = session.user;
    if (S.mode === 'signedin' && S.user && S.user.id === user.id) return; // duplicate auth event
    epoch++;
    S.user = user;
    S.mode = 'signedin';
    S.authExpired = false;
    S.run = 'idle';
    S.error = '';
    conflicts = [];
    const prev = meta.get('uid');
    const have = store.rawAll().length;
    if (prev && prev !== user.id && have) {
      // Another account's journal is still on this device. Ask before mixing or deleting anything.
      S.hold = true;
      S.ownerPrompt = { count: have };
      emit();
      return;
    }
    meta.set('uid', user.id);
    S.hold = false;
    S.ownerPrompt = null;
    emit();
    syncNow();
  }

  function onAuth(session) {
    if (session) {
      if (S.mode !== 'signedin' || !S.user || S.user.id !== session.user.id) adopt(session);
      return;
    }
    // Session vanished without the person asking (token expired or revoked).
    if (S.mode === 'signedin') {
      epoch++;
      S.mode = 'signedout';
      S.user = null;
      S.authExpired = true;
      S.hold = false;
      S.ownerPrompt = null;
      conflicts = [];
      clearTimers();
      emit();
    }
  }

  async function signIn(email, password) {
    const { session } = await remote.signIn(email, password);
    adopt(session);
    return { session };
  }
  async function signUp(email, password) {
    const res = await remote.signUp(email, password);
    if (res.session) adopt(res.session);
    return res;
  }
  async function signOut() {
    // Flip our own state first so the library's later "signed out" event is not mistaken for an expiry.
    epoch++;
    S.mode = 'signedout';
    S.user = null;
    S.authExpired = false;
    S.hold = false;
    S.ownerPrompt = null;
    S.run = 'idle';
    conflicts = [];
    clearTimers();
    emit();
    try {
      await remote.signOut();
    } catch {
      /* local state is already signed out; local journal untouched */
    }
  }

  /** Answer to "another account's journal is on this device". */
  async function resolveOwner(choice) {
    if (!S.ownerPrompt) return;
    if (choice === 'cancel') return signOut();
    if (choice === 'merge') store.markAllUnsynced();
    else if (choice === 'clear') store.clearAll();
    else return;
    meta.set('uid', S.user.id);
    S.hold = false;
    S.ownerPrompt = null;
    emit();
    await syncNow();
  }

  /* -------------------------------------------------------------- editors */

  function registerEditor(date, api) {
    editors.set(date, api);
    return () => editors.get(date) === api && editors.delete(date);
  }

  /* ----------------------------------------------------------- scheduling */

  function clearTimers() {
    timer && clearT(timer);
    retryTimer && clearT(retryTimer);
    timer = retryTimer = null;
    failures = 0;
  }

  /** Ask for a sync soon. Many calls inside the delay collapse into one. */
  function requestSync(delay = 2000) {
    if (S.mode !== 'signedin') return;
    timer && clearT(timer);
    timer = setT(() => {
      timer = null;
      syncNow();
    }, delay);
  }

  /** Resolves when no sync is running. */
  const settled = () => (running ? running.then(() => settled()) : Promise.resolve());

  function syncNow() {
    if (S.mode !== 'signedin' || S.hold || !remote) return Promise.resolve();
    if (running) {
      again = true; // exactly one follow-up, however many requests arrive
      return running;
    }
    running = cycle().finally(() => {
      running = null;
      if (again) {
        again = false;
        if (S.run === 'idle') syncNow();
      }
    });
    return running;
  }

  async function cycle() {
    const mine = epoch;
    timer && clearT(timer);
    timer = null;
    S.run = 'syncing';
    emit();
    try {
      let retry = false;
      for (let pass = 0; pass < 3; pass++) {
        retry = await onePass(mine);
        if (epoch !== mine) return;
        if (!retry) break;
      }
      failures = 0;
      retryTimer && clearT(retryTimer);
      retryTimer = null;
      S.run = 'idle';
      S.error = '';
      S.lastSynced = nowISO();
      meta.set('last', S.lastSynced);
      emit();
      if (retry) again = true; // still racing another device: look once more shortly
    } catch (err) {
      if (epoch !== mine) return;
      const kind = (err && err.kind) || 'server';
      if (kind === 'auth') {
        S.mode = 'signedout';
        S.user = null;
        S.authExpired = true;
        conflicts = [];
        clearTimers();
        emit();
        return;
      }
      failures++;
      S.run = kind === 'network' ? 'offline' : 'error';
      S.error = (err && err.message) || 'Sync failed';
      emit();
      retryTimer && clearT(retryTimer);
      retryTimer = setT(() => {
        retryTimer = null;
        syncNow();
      }, Math.min(300000, 5000 * 2 ** (failures - 1)));
    }
  }

  /* ------------------------------------------------------- one pull + push */

  /** @returns {Promise<boolean>} true when a push was refused and another pass is needed */
  async function onePass(mine) {
    const rows = await remote.pull(null);
    if (epoch !== mine) return false;

    const R = new Map();
    for (const r of rows) {
      if (r && isISO(r.date)) R.set(r.date, { date: r.date, text: String(r.text ?? ''), updatedAt: normTime(r.updatedAt) });
    }

    // ---- decision phase: synchronous, fresh local reads, no awaits ----
    const toPush = [];
    const found = new Map();
    const dates = new Set([...R.keys(), ...store.rawAll().map((r) => r.date)]);

    for (const date of dates) {
      let L = store.raw(date);
      const r = R.get(date);
      if (L && !L.updatedAt) {
        // a record with no timestamp (should not happen): give it one so pushes can be matched back to it
        L = { ...L, updatedAt: nowISO() };
        store.put(L);
      }

      if (!L && r) {
        // remote only -> take remote
        store.put({ date, text: r.text, updatedAt: r.updatedAt, dirty: false, base: r.updatedAt });
        continue;
      }
      if (L && !r) {
        // local only -> push it (an empty never-synced record has nothing to push)
        if (!L.text) {
          if (L.dirty) store.put({ ...L, dirty: false });
        } else {
          toPush.push({ date, text: L.text, updatedAt: L.updatedAt || nowISO(), expect: null });
        }
        continue;
      }

      const same = () => L.text === r.text;
      const align = () => store.put({ date, text: L.text, updatedAt: r.updatedAt, dirty: false, base: r.updatedAt });

      if (same()) {
        if (L.dirty || L.base !== r.updatedAt) align(); // identical text: just align metadata
        continue;
      }

      const remoteMoved = r.updatedAt !== L.base;
      if (!remoteMoved) {
        // remote unchanged since we last saw it: ours is the only change
        if (L.dirty) toPush.push({ date, text: L.text, updatedAt: L.updatedAt || nowISO(), expect: r.updatedAt });
        continue;
      }

      // The remote changed since base and the texts differ.
      if (!L.dirty) {
        const ed = editors.get(date);
        if (!(ed && ed.busy())) {
          // clean local, box not in use: take remote (an open, unfocused box updates in place)
          store.put({ date, text: r.text, updatedAt: r.updatedAt, dirty: false, base: r.updatedAt });
          continue;
        }
        // The person is typing here: never overwrite the box. Save what is in it, then treat as a conflict.
        ed.flush();
        L = store.raw(date) || L;
        if (same()) {
          align();
          continue;
        }
      }
      found.set(date, { date, local: { text: L.text, updatedAt: L.updatedAt }, remote: { text: r.text, updatedAt: r.updatedAt } });
    }
    conflicts = [...found.values()].sort((a, b) => a.date.localeCompare(b.date));
    emit();

    // ---- push phase ----
    if (!toPush.length) return false;
    let res;
    try {
      res = await remote.push(toPush);
    } catch (err) {
      if (err && err.partial) applyPushed(toPush, err.partial.ok);
      throw err;
    }
    if (epoch !== mine) return false;
    applyPushed(toPush, res.ok);
    return res.rejected.length > 0;
  }

  /** Mark pushed rows synced, unless the person edited them while the push was in flight. */
  function applyPushed(sent, okDates) {
    for (const date of okDates) {
      const row = sent.find((s) => s.date === date);
      const cur = store.raw(date);
      if (!row || !cur) continue;
      if (cur.updatedAt === row.updatedAt && cur.text === row.text) {
        store.put({ ...cur, updatedAt: normTime(row.updatedAt), dirty: false, base: normTime(row.updatedAt) });
      } else {
        // edited during the push: the remote now holds our older text, so that is the new base; stay dirty
        store.put({ ...cur, dirty: true, base: normTime(row.updatedAt) });
      }
    }
  }

  /* ------------------------------------------------------------ conflicts */

  /**
   * @param {'mine'|'theirs'|'both'} choice
   * @returns {{ok:true}|{stale:true}} stale: the day changed again; the prompt must be rebuilt
   */
  function resolveConflict(date, choice) {
    const c = conflicts.find((x) => x.date === date);
    if (!c) return { stale: true };
    const ed = editors.get(date);
    if (ed && ed.busy()) ed.flush();
    const L = store.raw(date);
    if (!L || L.text !== c.local.text || L.updatedAt !== c.local.updatedAt) {
      requestSync(0);
      return { stale: true };
    }
    const r = c.remote;
    if (choice === 'mine') {
      store.put({ date, text: L.text, updatedAt: stampAfter([L.updatedAt, r.updatedAt], now()), dirty: true, base: r.updatedAt });
    } else if (choice === 'theirs') {
      store.put({ date, text: r.text, updatedAt: r.updatedAt, dirty: false, base: r.updatedAt });
    } else if (choice === 'both') {
      store.put({ date, text: joinBoth(L.text, r.text), updatedAt: stampAfter([L.updatedAt, r.updatedAt], now()), dirty: true, base: r.updatedAt });
    } else {
      throw new Error('Unknown choice');
    }
    conflicts = conflicts.filter((x) => x.date !== date);
    emit();
    if (choice !== 'theirs') requestSync(0);
    return { ok: true };
  }

  /* -------------------------------------------------------- browser hooks */

  /** Wire the triggers: saves, coming online, tab visible. Called once by the app. */
  function bindBrowser(win, doc) {
    store.onChange((_date, source) => {
      if (source === 'local' || source === 'import') requestSync(2000);
    });
    let lastRun = 0;
    const kick = () => {
      if (S.mode === 'unavailable') retryLoad();
      else if (S.mode === 'signedin') {
        lastRun = Date.now();
        syncNow();
      }
    };
    win.addEventListener('online', kick);
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'visible' && Date.now() - lastRun > 15000) kick();
    });
  }

  return {
    getState,
    subscribe,
    init,
    retryLoad,
    signIn,
    signUp,
    signOut,
    resolveOwner,
    syncNow,
    requestSync,
    settled,
    resolveConflict,
    registerEditor,
    bindBrowser,
    get remote() {
      return remote;
    },
  };
}
