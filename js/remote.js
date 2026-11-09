// Remote: the server side of journal sync, behind one small interface.
//
//   session()                 -> Promise<{user:{id,email}} | null>   (no network)
//   signIn(email, password)   -> Promise<{session}>
//   signUp(email, password)   -> Promise<{session|null, needsConfirmation}>
//   signOut()                 -> Promise<void>
//   onAuthChange(fn)          -> unsubscribe;  fn(session|null)
//   pull(sinceISO|null)       -> Promise<[{date,text,updatedAt}]>
//   push(rows)                -> Promise<{ok:[date], rejected:[date]}>
//
// push() is a compare-and-set upsert. Each row is {date,text,updatedAt,expect}
// where `expect` is the remote updatedAt this device believes is current (null
// for "no row yet"). If the server row has moved on, the row is `rejected` and
// NOT written; the sync engine then pulls again and handles it as a conflict.
// This closes the window where two devices push at the same moment and one
// silently overwrites the other.
//
// Failures throw RemoteError with kind 'network' | 'auth' | 'server'.
//
// Two implementations: SupabaseRemote (real) and FakeRemote (tests, localhost).

import { kv as defaultKv } from './storage.js';
import { DEVICE, FAKE_MODE } from './device.js';

export class RemoteError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'RemoteError';
    this.kind = kind;
  }
}

/** Normalise any timestamp to the ISO form we compare with (ms precision, Z). */
export const normTime = (t) => {
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : String(t);
};

/* ------------------------------------------------------------------ fake */

/**
 * In-page fake backend. State lives under `vad:fake:` in the shared kv so a
 * second tab (?device=b) sees the same "server". Each device keeps its own
 * session. Any non-empty password is accepted.
 *
 * Test controls (also on window.__vadFake in the browser):
 *   ctl.offline = true    every network call fails like a dropped connection
 *   ctl.fail = true       every network call fails like a 500
 *   ctl.latency = ms      artificial delay per call
 *   ctl.confirmEmail=true signUp returns no session (email confirmation on)
 *   expireSession()       drop this device's session as if the token expired
 *   rows(email)           the server rows for an email, for inspection
 */
export class FakeRemote {
  constructor({ kv = defaultKv, device = '' } = {}) {
    this.kv = kv;
    this.device = device || 'main';
    this.listeners = new Set();
    this.ctl = { offline: false, fail: false, latency: 0, confirmEmail: false, calls: 0 };
  }

  /* ---- internals ---- */
  _json(key, fallback) {
    try {
      const v = this.kv.get(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  }
  _sessionKey() {
    return `vad:fake:session:${this.device}`;
  }
  async _gate() {
    this.ctl.calls++;
    if (this.ctl.latency) await new Promise((r) => setTimeout(r, this.ctl.latency));
    if (this.ctl.offline) throw new RemoteError('network', 'Failed to fetch');
    if (this.ctl.fail) throw new RemoteError('server', 'Fake server error (500)');
  }
  _need() {
    const s = this._json(this._sessionKey(), null);
    if (!s) throw new RemoteError('auth', 'Not signed in');
    return s;
  }
  _emit(s) {
    this.listeners.forEach((fn) => fn(s));
  }
  _login(email) {
    const users = this._json('vad:fake:users', {});
    if (!users[email]) users[email] = `fake-user-${Object.keys(users).length + 1}`;
    this.kv.set('vad:fake:users', JSON.stringify(users));
    const session = { user: { id: users[email], email } };
    this.kv.set(this._sessionKey(), JSON.stringify(session));
    return session;
  }
  _rowsKey(uid) {
    return `vad:fake:rows:${uid}`;
  }

  /* ---- interface ---- */
  async session() {
    return this._json(this._sessionKey(), null);
  }
  async signIn(email, password) {
    await this._gate();
    if (!email || !password) throw new RemoteError('auth', 'Enter an email and a password.');
    const session = this._login(String(email).trim().toLowerCase());
    this._emit(session);
    return { session };
  }
  async signUp(email, password) {
    await this._gate();
    if (!email || !password) throw new RemoteError('auth', 'Enter an email and a password.');
    if (this.ctl.confirmEmail) return { session: null, needsConfirmation: true };
    const session = this._login(String(email).trim().toLowerCase());
    this._emit(session);
    return { session, needsConfirmation: false };
  }
  async signOut() {
    this.kv.remove(this._sessionKey());
    this._emit(null);
  }
  onAuthChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  /** Test helper: the session disappears without the user asking. */
  expireSession() {
    this.kv.remove(this._sessionKey());
    this._emit(null);
  }
  rows(email) {
    const users = this._json('vad:fake:users', {});
    const uid = users[String(email).trim().toLowerCase()];
    return uid ? this._json(this._rowsKey(uid), {}) : {};
  }

  async pull() {
    await this._gate();
    const s = this._need();
    const rows = this._json(this._rowsKey(s.user.id), {});
    return Object.entries(rows).map(([date, r]) => ({ date, text: r.text, updatedAt: r.updatedAt }));
  }

  async push(list) {
    await this._gate();
    const s = this._need();
    const key = this._rowsKey(s.user.id);
    const rows = this._json(key, {});
    const ok = [];
    const rejected = [];
    for (const r of list) {
      const cur = rows[r.date];
      const matches = r.expect == null ? !cur : !!cur && cur.updatedAt === r.expect;
      if (matches) {
        rows[r.date] = { text: r.text, updatedAt: normTime(r.updatedAt) };
        ok.push(r.date);
      } else {
        rejected.push(r.date);
      }
    }
    this.kv.set(key, JSON.stringify(rows));
    return { ok, rejected };
  }
}

/* -------------------------------------------------------------- supabase */

export const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const TABLE = 'vad_journal';

function mapError(err, fallbackKind = 'server') {
  if (err instanceof RemoteError) return err;
  const msg = (err && err.message) || 'Unknown error';
  const status = err && (err.status || err.statusCode);
  const code = err && err.code;
  const name = err && err.name;
  // supabase-js reports a dropped connection as a fetch TypeError or AuthRetryableFetchError.
  if (name === 'AuthRetryableFetchError' || name === 'TypeError' || /failed to fetch|network|load failed|fetch failed/i.test(msg)) {
    return new RemoteError('network', msg);
  }
  // Set-up problems on the project, not the person's session. Say what to do.
  if (code === 'PGRST205' || code === '42P01') {
    return new RemoteError('server', 'The journal table is missing in Supabase. Run supabase/schema.sql in the SQL editor.');
  }
  if (code === '42501') {
    return new RemoteError('server', 'Supabase refused access to the journal table. Run supabase/schema.sql again to restore its permissions.');
  }
  if (name === 'AuthSessionMissingError' || status === 401 || status === 403 || code === 'PGRST301' || code === 'PGRST302' || /jwt/i.test(msg)) {
    return new RemoteError('auth', msg);
  }
  return new RemoteError(fallbackKind, msg);
}

/**
 * Real backend. NOT exercised against a live project in this repo's tests:
 * it has been written against the supabase-js v2.45 API only.
 */
export class SupabaseRemote {
  /** Loads the pinned library by dynamic import, then builds the client. */
  static async create({ url, anonKey, importer = (u) => import(/* @vite-ignore */ u) }) {
    const mod = await importer(SUPABASE_JS_URL);
    const createClient = mod.createClient || (mod.default && mod.default.createClient);
    if (typeof createClient !== 'function') throw new Error('supabase-js did not load');
    const client = createClient(url, anonKey, {
      auth: {
        storageKey: 'vad:auth', // never collide with other apps on this origin
        persistSession: true,
        autoRefreshToken: true,
        // The app uses #/ hash routes; letting the library read the URL hash
        // would race the router. Email-confirmation links just land on the
        // site and the person signs in.
        detectSessionInUrl: false,
      },
    });
    return new SupabaseRemote(client);
  }

  constructor(client) {
    this.client = client;
  }

  async session() {
    // getSession reads local storage and refreshes an expired token if it can.
    // If the refresh needs the network and fails, treat it as "no session": the
    // engine only shows "signed out" for a person who had one, and local data is untouched.
    try {
      const { data, error } = await this.client.auth.getSession();
      if (error || !data || !data.session) return null;
      const u = data.session.user;
      return { user: { id: u.id, email: u.email || '' } };
    } catch {
      return null;
    }
  }

  async signIn(email, password) {
    let res;
    try {
      res = await this.client.auth.signInWithPassword({ email, password });
    } catch (e) {
      throw mapError(e);
    }
    if (res.error) throw mapError(res.error, 'auth');
    const u = res.data.session.user;
    return { session: { user: { id: u.id, email: u.email || email } } };
  }

  async signUp(email, password) {
    let res;
    try {
      res = await this.client.auth.signUp({ email, password });
    } catch (e) {
      throw mapError(e);
    }
    if (res.error) throw mapError(res.error, 'auth');
    // With email confirmation on, data.session is null until the link is clicked.
    if (!res.data.session) return { session: null, needsConfirmation: true };
    const u = res.data.session.user;
    return { session: { user: { id: u.id, email: u.email || email } }, needsConfirmation: false };
  }

  async signOut() {
    try {
      // scope 'local': end this device's session only, and work even offline.
      await this.client.auth.signOut({ scope: 'local' });
    } catch {
      /* the local session is cleared by the library regardless */
    }
  }

  onAuthChange(fn) {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      // Do not call back into supabase from inside this callback (it can deadlock): defer.
      setTimeout(() => fn(session ? { user: { id: session.user.id, email: session.user.email || '' } } : null), 0);
    });
    return () => data.subscription.unsubscribe();
  }

  async pull() {
    // The engine always pulls everything: updated_at is written by devices, so
    // clock skew could hide a newer row from an incremental pull. Journals are
    // small. PostgREST caps a response at 1000 rows by default, so page through.
    const out = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      let res;
      try {
        res = await this.client.from(TABLE).select('date,text,updated_at').order('date', { ascending: true }).range(from, from + PAGE - 1);
      } catch (e) {
        throw mapError(e);
      }
      if (res.error) throw mapError(res.error);
      const rows = res.data || [];
      for (const r of rows) out.push({ date: r.date, text: r.text ?? '', updatedAt: normTime(r.updated_at) });
      if (rows.length < PAGE) break;
    }
    return out;
  }

  async push(list) {
    const ok = [];
    const rejected = [];
    for (const r of list) {
      const updated_at = normTime(r.updatedAt);
      try {
        if (r.expect == null) {
          // No row on the server as far as we know: insert. A duplicate key means someone else got there first.
          const { error } = await this.client.from(TABLE).insert({ date: r.date, text: r.text, updated_at });
          if (!error) ok.push(r.date);
          else if (error.code === '23505') rejected.push(r.date);
          else throw mapError(error);
        } else {
          // Compare-and-set on updated_at: zero rows back means the server row moved on.
          const { data, error } = await this.client
            .from(TABLE)
            .update({ text: r.text, updated_at })
            .eq('date', r.date)
            .eq('updated_at', normTime(r.expect))
            .select('date');
          if (error) throw mapError(error);
          if (data && data.length) ok.push(r.date);
          else rejected.push(r.date);
        }
      } catch (e) {
        // Rows already written stay written; report what happened so far with the failure attached.
        const err = mapError(e);
        err.partial = { ok, rejected };
        throw err;
      }
    }
    return { ok, rejected };
  }
}

/** The FakeRemote instance for this page, or null. Only ever in fake mode. */
export function createFakeForPage() {
  if (!FAKE_MODE) return null;
  const fake = new FakeRemote({ kv: defaultKv, device: DEVICE });
  try {
    window.__vadFake = Object.assign(fake.ctl, {
      expireSession: () => fake.expireSession(),
      rows: (email) => fake.rows(email),
      device: fake.device,
    });
  } catch {
    /* no window: fine */
  }
  return fake;
}
