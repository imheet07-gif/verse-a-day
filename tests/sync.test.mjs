// Run with:  node tests/sync.test.mjs
// Drives the real sync engine, JournalStore and FakeRemote with in-memory
// storage. Each "device" has its own local kv; all devices share one fake
// server kv. No browser, no network, no timers (timers are captured).

import assert from 'node:assert/strict';
import { makeKv } from '../js/storage.js';
import { createJournalStore } from '../js/store-journal.js';
import { FakeRemote, SupabaseRemote, RemoteError } from '../js/remote.js';
import { createSync, DIVIDER, joinBoth } from '../js/sync.js';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${e.stack.split('\n').slice(0, 4).join('\n       ')}`);
  }
}

function world() {
  const server = makeKv(null);
  const mk = (name) => {
    const kv = makeKv(null);
    const store = createJournalStore({ kv });
    const remote = new FakeRemote({ kv: server, device: name });
    const timers = [];
    const sync = createSync({
      store,
      kv,
      remote,
      timers: { set: (fn, ms) => (timers.push({ fn, ms }), timers.length), clear: () => {} },
    });
    return { name, kv, store, remote, sync, ctl: remote.ctl, timers };
  };
  return { server, mk };
}
const D = '2026-11-09';
const D2 = '2026-11-10';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function signedIn(dev, email = 'a@x.test') {
  await dev.sync.init();
  await dev.sync.signIn(email, 'pw');
  await dev.sync.settled();
}
const text = async (dev, date = D) => (dev.store.raw(date) || {}).text;

console.log('merge rules');

await test('legacy phase 1 record reads as dirty with null base', async () => {
  const kv = makeKv(null);
  kv.set('vad:j:2026-11-09', JSON.stringify({ date: D, text: 'old', updatedAt: '2026-11-09T08:00:00.000Z' }));
  const r = createJournalStore({ kv }).raw(D);
  assert.equal(r.dirty, true);
  assert.equal(r.base, null);
});

await test('not configured: engine stays off and never touches a remote', async () => {
  const kv = makeKv(null);
  const store = createJournalStore({ kv });
  const sync = createSync({ store, kv });
  await sync.init();
  await sync.syncNow();
  assert.equal(sync.getState().mode, 'off');
  assert.equal(sync.getState().configured, false);
});

await test('write on A shows up on B', async () => {
  const w = world();
  const A = w.mk('a');
  const B = w.mk('b');
  await signedIn(A);
  await signedIn(B);
  await A.store.set(D, 'hello from A');
  await A.sync.syncNow();
  assert.equal(A.store.raw(D).dirty, false);
  await B.sync.syncNow();
  assert.equal(await text(B), 'hello from A');
  assert.equal(B.store.raw(D).dirty, false);
});

await test('offline edit stays dirty, then syncs on reconnect', async () => {
  const w = world();
  const A = w.mk('a');
  const B = w.mk('b');
  await signedIn(A);
  await signedIn(B);
  A.ctl.offline = true;
  await A.store.set(D, 'written offline');
  await A.sync.syncNow();
  assert.equal(A.sync.getState().run, 'offline');
  assert.equal(A.store.raw(D).dirty, true);
  assert.equal(A.sync.getState().pending, 1);
  assert.equal(await text(A), 'written offline');
  A.ctl.offline = false;
  await A.sync.syncNow();
  assert.equal(A.sync.getState().run, 'idle');
  assert.equal(A.sync.getState().pending, 0);
  await B.sync.syncNow();
  assert.equal(await text(B), 'written offline');
});

await test('failures back off 5s, 10s, 20s and keep the text', async () => {
  const w = world();
  const A = w.mk('a');
  await signedIn(A);
  await A.store.set(D, 'keep me');
  A.ctl.fail = true;
  const delays = [];
  for (let i = 0; i < 3; i++) {
    A.timers.length = 0;
    await A.sync.syncNow();
    assert.equal(A.sync.getState().run, 'error');
    delays.push(A.timers.at(-1).ms);
  }
  assert.deepEqual(delays, [5000, 10000, 20000]);
  assert.equal(await text(A), 'keep me');
  assert.equal(A.store.raw(D).dirty, true);
});

await test('local only / dirty with remote unchanged -> push; second edit pushes again', async () => {
  const w = world();
  const A = w.mk('a');
  await signedIn(A);
  await A.store.set(D, 'v1');
  await A.sync.syncNow();
  await A.store.set(D, 'v2');
  await A.sync.syncNow();
  assert.equal(w.server && A.remote.rows('a@x.test')[D].text, 'v2');
});

await test('clean local + remote newer -> take remote', async () => {
  const w = world();
  const A = w.mk('a');
  const B = w.mk('b');
  await signedIn(A);
  await signedIn(B);
  await A.store.set(D, 'one');
  await A.sync.syncNow();
  await B.sync.syncNow();
  await A.store.set(D, 'two');
  await A.sync.syncNow();
  await B.sync.syncNow();
  assert.equal(await text(B), 'two');
  assert.equal(B.sync.getState().conflicts.length, 0);
});

await test('identical text on both sides: no conflict, metadata aligned', async () => {
  const w = world();
  const A = w.mk('a');
  const B = w.mk('b');
  await signedIn(A);
  await A.store.set(D, 'same words');
  await A.sync.syncNow();
  await B.store.set(D, 'same words'); // B had it locally from before signing in
  await signedIn(B);
  assert.equal(B.sync.getState().conflicts.length, 0);
  assert.equal(B.store.raw(D).dirty, false);
  assert.equal(B.store.raw(D).base, A.remote.rows('a@x.test')[D].updatedAt);
});

await test('clearing an entry propagates and does not resurrect', async () => {
  const w = world();
  const A = w.mk('a');
  const B = w.mk('b');
  await signedIn(A);
  await signedIn(B);
  await A.store.set(D, 'to be cleared');
  await A.sync.syncNow();
  await B.sync.syncNow();
  await A.store.set(D, '');
  await A.sync.syncNow();
  assert.equal(A.remote.rows('a@x.test')[D].text, '');
  await B.sync.syncNow();
  assert.equal(await text(B), '');
  await A.sync.syncNow();
  await B.sync.syncNow();
  assert.equal(await text(A), '');
  assert.equal(await text(B), '');
  assert.equal(A.remote.rows('a@x.test')[D].text, '');
});

console.log('conflicts');

async function makeConflict() {
  const w = world();
  const A = w.mk('a');
  const B = w.mk('b');
  await signedIn(A);
  await signedIn(B);
  await A.store.set(D, 'base');
  await A.sync.syncNow();
  await B.sync.syncNow();
  await sleep(3);
  await A.store.set(D, 'edit from A');
  await B.store.set(D, 'edit from B');
  await A.sync.syncNow(); // A wins the race to the server
  await B.sync.syncNow();
  return { w, A, B };
}

await test('both edited from the same base: conflict, nothing pushed, nothing lost', async () => {
  const { A, B } = await makeConflict();
  const st = B.sync.getState();
  assert.equal(st.conflicts.length, 1);
  assert.equal(st.conflicts[0].local.text, 'edit from B');
  assert.equal(st.conflicts[0].remote.text, 'edit from A');
  assert.equal(await text(B), 'edit from B'); // local untouched
  assert.equal(B.store.raw(D).dirty, true);
  assert.equal(A.remote.rows('a@x.test')[D].text, 'edit from A'); // remote untouched
  // and it stays a conflict on every later sync until someone chooses
  await B.sync.syncNow();
  assert.equal(B.sync.getState().conflicts.length, 1);
  assert.equal(await text(B), 'edit from B');
});

await test("conflict: Keep this device's", async () => {
  const { A, B } = await makeConflict();
  assert.deepEqual(B.sync.resolveConflict(D, 'mine'), { ok: true });
  await B.sync.syncNow();
  assert.equal(B.sync.getState().conflicts.length, 0);
  assert.equal(A.remote.rows('a@x.test')[D].text, 'edit from B');
  await A.sync.syncNow();
  assert.equal(await text(A), 'edit from B');
  assert.equal(A.sync.getState().conflicts.length, 0);
});

await test("conflict: Use the other device's", async () => {
  const { A, B } = await makeConflict();
  assert.deepEqual(B.sync.resolveConflict(D, 'theirs'), { ok: true });
  assert.equal(await text(B), 'edit from A');
  assert.equal(B.store.raw(D).dirty, false);
  await B.sync.syncNow();
  assert.equal(A.remote.rows('a@x.test')[D].text, 'edit from A');
  assert.equal(B.sync.getState().conflicts.length, 0);
});

await test('conflict: Keep both (this device first, divider, other device)', async () => {
  const { A, B } = await makeConflict();
  assert.deepEqual(B.sync.resolveConflict(D, 'both'), { ok: true });
  assert.equal(await text(B), 'edit from B' + DIVIDER + 'edit from A');
  await B.sync.syncNow();
  assert.equal(A.remote.rows('a@x.test')[D].text, 'edit from B' + DIVIDER + 'edit from A');
  await A.sync.syncNow();
  assert.equal(await text(A), 'edit from B' + DIVIDER + 'edit from A');
  assert.equal(A.sync.getState().conflicts.length, 0);
});

await test('keep both with one side empty keeps the text without a divider', async () => {
  assert.equal(joinBoth('', 'x'), 'x');
  assert.equal(joinBoth('y', '  '), 'y');
  assert.equal(joinBoth('y\n\n', 'x'), 'y' + DIVIDER + 'x');
});

await test('cleared on one device, edited on another: conflict, not a silent clear', async () => {
  const w = world();
  const A = w.mk('a');
  const B = w.mk('b');
  await signedIn(A);
  await signedIn(B);
  await A.store.set(D, 'base');
  await A.sync.syncNow();
  await B.sync.syncNow();
  await A.store.set(D, '');
  await B.store.set(D, 'base plus more');
  await A.sync.syncNow();
  await B.sync.syncNow();
  assert.equal(B.sync.getState().conflicts.length, 1);
  assert.equal(await text(B), 'base plus more');
  B.sync.resolveConflict(D, 'both');
  assert.equal(await text(B), 'base plus more'); // the cleared side adds nothing
});

await test('several conflicts queue, oldest date first, resolved one at a time', async () => {
  const w = world();
  const A = w.mk('a');
  const B = w.mk('b');
  await signedIn(A);
  await signedIn(B);
  for (const d of [D, D2]) await A.store.set(d, 'base ' + d);
  await A.sync.syncNow();
  await B.sync.syncNow();
  for (const d of [D, D2]) {
    await A.store.set(d, 'A ' + d);
    await B.store.set(d, 'B ' + d);
  }
  await A.sync.syncNow();
  await B.sync.syncNow();
  assert.deepEqual(B.sync.getState().conflicts.map((c) => c.date), [D, D2]);
  B.sync.resolveConflict(D, 'theirs');
  assert.deepEqual(B.sync.getState().conflicts.map((c) => c.date), [D2]);
  assert.equal(await text(B, D2), 'B ' + D2); // untouched while queued
});

await test('stale resolution: local text changed after the prompt was built -> refused, not applied', async () => {
  const { B } = await makeConflict();
  await sleep(3);
  await B.store.set(D, 'edit from B, then more');
  assert.deepEqual(B.sync.resolveConflict(D, 'theirs'), { stale: true });
  assert.equal(await text(B), 'edit from B, then more');
  await B.sync.syncNow();
  assert.equal(B.sync.getState().conflicts[0].local.text, 'edit from B, then more');
});

console.log('open editor and races');

await test('remote newer but the box is in use: conflict, box text kept', async () => {
  const w = world();
  const A = w.mk('a');
  const B = w.mk('b');
  await signedIn(A);
  await signedIn(B);
  await A.store.set(D, 'one');
  await A.sync.syncNow();
  await B.sync.syncNow();
  await A.store.set(D, 'two');
  await A.sync.syncNow();
  let boxText = 'one plus words typed on B';
  B.sync.registerEditor(D, {
    busy: () => true,
    flush: () => B.store.setSync(D, boxText),
  });
  await B.sync.syncNow();
  assert.equal(B.sync.getState().conflicts.length, 1);
  assert.equal(await text(B), boxText);
  assert.equal(A.remote.rows('a@x.test')[D].text, 'two');
});

await test('remote newer and the box is open but idle: taken in place', async () => {
  const w = world();
  const A = w.mk('a');
  const B = w.mk('b');
  await signedIn(A);
  await signedIn(B);
  await A.store.set(D, 'one');
  await A.sync.syncNow();
  await B.sync.syncNow();
  await A.store.set(D, 'two');
  await A.sync.syncNow();
  const seen = [];
  B.store.onChange((d, src) => seen.push([d, src]));
  B.sync.registerEditor(D, { busy: () => false, flush() {} });
  await B.sync.syncNow();
  assert.equal(await text(B), 'two');
  assert.ok(seen.some(([d, s]) => d === D && s === 'sync'));
});

await test('edit made while a push is in flight is not marked synced', async () => {
  const w = world();
  const A = w.mk('a');
  await signedIn(A);
  await A.store.set(D, 'first');
  const realPush = A.remote.push.bind(A.remote);
  A.remote.push = async (rows) => {
    const res = await realPush(rows);
    await sleep(3);
    A.store.setSync(D, 'typed during the push');
    return res;
  };
  await A.sync.syncNow();
  assert.equal(await text(A), 'typed during the push');
  assert.equal(A.store.raw(D).dirty, true);
  A.remote.push = realPush;
  await A.sync.syncNow();
  assert.equal(A.store.raw(D).dirty, false);
  assert.equal(A.remote.rows('a@x.test')[D].text, 'typed during the push');
});

await test('edit made while a pull is in flight is judged on the fresh local read', async () => {
  const w = world();
  const A = w.mk('a');
  const B = w.mk('b');
  await signedIn(A);
  await signedIn(B);
  await A.store.set(D, 'one');
  await A.sync.syncNow();
  await B.sync.syncNow();
  await A.store.set(D, 'two');
  await A.sync.syncNow();
  const realPull = B.remote.pull.bind(B.remote);
  B.remote.pull = async () => {
    const rows = await realPull();
    B.store.setSync(D, 'typed on B during pull'); // lands after the server was read
    return rows;
  };
  await B.sync.syncNow();
  assert.equal(await text(B), 'typed on B during pull'); // not overwritten by "two"
  assert.equal(B.sync.getState().conflicts.length, 1);
});

await test('two devices pushing at once: the slower push is refused, then surfaces as a conflict', async () => {
  const w = world();
  const A = w.mk('a');
  const B = w.mk('b');
  await signedIn(A);
  await signedIn(B);
  await A.store.set(D, 'base');
  await A.sync.syncNow();
  await B.sync.syncNow();
  await sleep(3);
  await A.store.set(D, 'A edit');
  await B.store.set(D, 'B edit');
  const realPull = B.remote.pull.bind(B.remote);
  let first = true;
  B.remote.pull = async () => {
    const rows = await realPull(); // B has now seen the old server row
    if (first) {
      first = false;
      await A.sync.syncNow(); // ...and A pushes before B does
    }
    return rows;
  };
  await B.sync.syncNow();
  assert.equal(A.remote.rows('a@x.test')[D].text, 'A edit'); // B did not overwrite it
  assert.equal(await text(B), 'B edit');
  assert.equal(B.sync.getState().conflicts.length, 1);
});

console.log('first sign-in, sign-out, accounts');

await test('first sign-in merges existing local entries; only the true clash prompts', async () => {
  const w = world();
  const A = w.mk('a');
  const B = w.mk('b');
  await signedIn(A);
  await A.store.set('2026-11-03', 'remote only');
  await A.store.set('2026-11-04', 'both, same');
  await A.store.set('2026-11-05', 'remote version of clash');
  await A.sync.syncNow();
  // B was used before it ever signed in (phase 1 style records)
  B.kv.set('vad:j:2026-11-04', JSON.stringify({ date: '2026-11-04', text: 'both, same', updatedAt: '2026-11-04T07:00:00.000Z' }));
  B.kv.set('vad:j:2026-11-05', JSON.stringify({ date: '2026-11-05', text: 'local version of clash', updatedAt: '2026-11-05T07:00:00.000Z' }));
  B.kv.set('vad:j:2026-11-06', JSON.stringify({ date: '2026-11-06', text: 'local only', updatedAt: '2026-11-06T07:00:00.000Z' }));
  await signedIn(B);
  assert.equal(await text(B, '2026-11-03'), 'remote only');
  assert.equal(await text(B, '2026-11-04'), 'both, same');
  assert.equal(await text(B, '2026-11-06'), 'local only');
  assert.equal(A.remote.rows('a@x.test')['2026-11-06'].text, 'local only');
  const c = B.sync.getState().conflicts;
  assert.deepEqual(c.map((x) => x.date), ['2026-11-05']);
  assert.equal(await text(B, '2026-11-05'), 'local version of clash');
  assert.equal(A.remote.rows('a@x.test')['2026-11-05'].text, 'remote version of clash');
});

await test('sign-out keeps local text; signing back in as the same user is quiet', async () => {
  const w = world();
  const A = w.mk('a');
  await signedIn(A);
  await A.store.set(D, 'stays here');
  await A.sync.syncNow();
  await A.sync.signOut();
  assert.equal(A.sync.getState().mode, 'signedout');
  assert.equal(A.sync.getState().authExpired, false);
  assert.equal(await text(A), 'stays here');
  await A.store.set(D2, 'written while signed out');
  await A.sync.signIn('a@x.test', 'pw');
  await A.sync.settled();
  assert.equal(A.sync.getState().ownerPrompt, null);
  assert.equal(A.remote.rows('a@x.test')[D2].text, 'written while signed out');
});

await test('expired session: signed out notice, local data untouched', async () => {
  const w = world();
  const A = w.mk('a');
  await signedIn(A);
  await A.store.set(D, 'precious');
  A.remote.expireSession();
  const st = A.sync.getState();
  assert.equal(st.mode, 'signedout');
  assert.equal(st.authExpired, true);
  assert.equal(await text(A), 'precious');
  assert.equal(A.store.raw(D).dirty, true);
});

await test('auth error during a sync is treated as expiry, not as a failure that loses data', async () => {
  const w = world();
  const A = w.mk('a');
  await signedIn(A);
  await A.store.set(D, 'precious');
  A.remote.pull = async () => {
    throw new RemoteError('auth', 'JWT expired');
  };
  await A.sync.syncNow();
  assert.equal(A.sync.getState().authExpired, true);
  assert.equal(await text(A), 'precious');
});

async function otherAccountSetup() {
  const w = world();
  const A = w.mk('a');
  await signedIn(A, 'first@x.test');
  await A.store.set(D, 'first account text');
  await A.store.set(D2, 'unsynced first account text');
  await A.sync.syncNow();
  await A.store.set(D2, 'newer, never pushed');
  await A.sync.signOut();
  await A.sync.signIn('second@x.test', 'pw');
  await A.sync.settled();
  return { w, A };
}

await test('different account on the device: sync is held and nothing changes until asked', async () => {
  const { A } = await otherAccountSetup();
  const st = A.sync.getState();
  assert.ok(st.ownerPrompt);
  assert.equal(st.ownerPrompt.count, 2);
  assert.deepEqual(A.remote.rows('second@x.test'), {});
  assert.equal(await text(A), 'first account text');
});

await test('different account: keep and merge pushes this device\'s entries into the new account', async () => {
  const { A } = await otherAccountSetup();
  await A.sync.resolveOwner('merge');
  assert.equal(A.sync.getState().ownerPrompt, null);
  assert.equal(A.remote.rows('second@x.test')[D].text, 'first account text');
  assert.equal(A.remote.rows('second@x.test')[D2].text, 'newer, never pushed');
});

await test('different account: clear the device copy removes local entries only', async () => {
  const { A } = await otherAccountSetup();
  await A.sync.resolveOwner('clear');
  assert.equal(await text(A), undefined);
  assert.deepEqual(A.remote.rows('second@x.test'), {});
  assert.equal(A.remote.rows('first@x.test')[D].text, 'first account text'); // first account's server copy intact
});

await test('different account: cancel signs out and leaves the journal alone', async () => {
  const { A } = await otherAccountSetup();
  await A.sync.resolveOwner('cancel');
  assert.equal(A.sync.getState().mode, 'signedout');
  assert.equal(await text(A), 'first account text');
  assert.equal(await text(A, D2), 'newer, never pushed');
});

console.log('import and store');

await test('import marks records dirty (and keeps base) so they sync', async () => {
  const w = world();
  const A = w.mk('a');
  await signedIn(A);
  await A.store.set(D, 'old');
  await A.sync.syncNow();
  const base = A.store.raw(D).base;
  await A.store.import([{ date: D, text: 'imported newer', updatedAt: '2999-01-01T00:00:00.000Z' }, { date: D2, text: 'imported new', updatedAt: '2026-11-10T00:00:00.000Z' }]);
  assert.equal(A.store.raw(D).dirty, true);
  assert.equal(A.store.raw(D).base, base);
  await A.sync.syncNow();
  assert.equal(A.remote.rows('a@x.test')[D].text, 'imported newer');
  assert.equal(A.remote.rows('a@x.test')[D2].text, 'imported new');
});

await test('export and all() do not leak sync fields; blank records are hidden from the UI list', async () => {
  const kv = makeKv(null);
  const s = createJournalStore({ kv });
  await s.set(D, 'x');
  await s.set(D2, '   ');
  const exp = await s.export();
  assert.deepEqual(Object.keys(exp.journal[0]).sort(), ['date', 'text', 'updatedAt']);
  assert.equal(exp.journal.length, 1);
});

await test('one sync at a time; a request during a sync schedules exactly one follow-up', async () => {
  const w = world();
  const A = w.mk('a');
  await signedIn(A);
  let pulls = 0;
  const realPull = A.remote.pull.bind(A.remote);
  A.remote.pull = async () => {
    pulls++;
    await sleep(5);
    return realPull();
  };
  const p = A.sync.syncNow();
  A.sync.syncNow();
  A.sync.syncNow();
  A.sync.syncNow();
  await p;
  await A.sync.settled();
  assert.equal(pulls, 2);
});

console.log('SupabaseRemote against a mock client (call shapes only; not a real project)');

function mockClient() {
  const calls = [];
  const table = new Map();
  const q = (op) => {
    const st = { op, filters: {}, payload: null };
    const chain = {
      insert(p) { st.payload = p; return chain; },
      update(p) { st.payload = p; return chain; },
      select(cols) { st.cols = cols; return chain; },
      order() { return chain; },
      eq(k, v) { st.filters[k] = v; return chain; },
      range(a, b) { st.range = [a, b]; return chain; },
      then(res, rej) { return Promise.resolve(run(st)).then(res, rej); },
    };
    return chain;
  };
  const run = (st) => {
    calls.push(st);
    if (st.op === 'select') {
      const all = [...table.values()];
      return { data: all.slice(st.range[0], st.range[1] + 1), error: null };
    }
    if (st.op === 'insert') {
      if (table.has(st.payload.date)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      table.set(st.payload.date, st.payload);
      return { data: null, error: null };
    }
    const cur = table.get(st.filters.date);
    if (cur && cur.updated_at === st.filters.updated_at) {
      Object.assign(cur, st.payload);
      return { data: [{ date: cur.date }], error: null };
    }
    return { data: [], error: null };
  };
  return {
    calls,
    table,
    auth: {},
    from: (t) => {
      assert.equal(t, 'vad_journal');
      return { select: (c) => q('select').select(c), insert: (p) => q('insert').insert(p), update: (p) => q('update').update(p) };
    },
  };
}

await test('SupabaseRemote.push: insert for new, compare-and-set update, duplicate / moved rows are rejected', async () => {
  const c = mockClient();
  const r = new SupabaseRemote(c);
  let res = await r.push([{ date: D, text: 'a', updatedAt: '2026-11-09T10:00:00.000Z', expect: null }]);
  assert.deepEqual(res, { ok: [D], rejected: [] });
  res = await r.push([{ date: D, text: 'dup', updatedAt: '2026-11-09T11:00:00.000Z', expect: null }]);
  assert.deepEqual(res, { ok: [], rejected: [D] });
  res = await r.push([{ date: D, text: 'b', updatedAt: '2026-11-09T12:00:00.000Z', expect: '2026-11-09T10:00:00.000Z' }]);
  assert.deepEqual(res, { ok: [D], rejected: [] });
  res = await r.push([{ date: D, text: 'stale', updatedAt: '2026-11-09T13:00:00.000Z', expect: '2026-11-09T10:00:00.000Z' }]);
  assert.deepEqual(res, { ok: [], rejected: [D] });
  assert.equal(c.table.get(D).text, 'b');
});

await test('SupabaseRemote.pull pages past 1000 rows and normalises timestamps', async () => {
  const c = mockClient();
  for (let i = 0; i < 1500; i++) {
    const d = `d${String(i).padStart(4, '0')}`;
    c.table.set(d, { date: d, text: 't', updated_at: '2026-11-09T10:00:00.123+00:00' });
  }
  const rows = await new SupabaseRemote(c).pull();
  assert.equal(rows.length, 1500);
  assert.equal(rows[0].updatedAt, '2026-11-09T10:00:00.123Z');
});

await test('library load failure -> engine goes to "unavailable" and can retry', async () => {
  const kv = makeKv(null);
  const store = createJournalStore({ kv });
  let fail = true;
  const remote = new FakeRemote({ kv: makeKv(null) });
  const sync = createSync({
    store,
    kv,
    loadRemote: async () => {
      if (fail) throw new Error('offline');
      return remote;
    },
  });
  await sync.init();
  assert.equal(sync.getState().mode, 'unavailable');
  await store.set(D, 'still writable');
  fail = false;
  await sync.retryLoad();
  assert.equal(sync.getState().mode, 'signedout');
  assert.equal((await store.get(D)).text, 'still writable');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('Failed:', failures.join('; '));
  process.exit(1);
}
process.exit(0);
