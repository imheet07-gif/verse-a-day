// The one sync engine for this page, wired to the real journal store.
//  - fake mode (?fake-remote=1 on localhost): FakeRemote, no network at all.
//  - configured: SupabaseRemote, whose library is loaded lazily by init().
//  - otherwise: mode "off". Nothing is loaded and no request is ever made.

import { kv } from './storage.js';
import { JournalStore } from './store-journal.js';
import { NS, FAKE_MODE } from './device.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, syncConfigured } from './config.js';
import { createFakeForPage, SupabaseRemote } from './remote.js';
import { createSync } from './sync.js';

const opts = { store: JournalStore, kv, ns: NS };
if (FAKE_MODE) opts.remote = createFakeForPage();
else if (syncConfigured) opts.loadRemote = () => SupabaseRemote.create({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });

export const engine = createSync(opts);
