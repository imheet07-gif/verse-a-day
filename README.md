# Verse a Day

A static, installable web app: one poem or song a day, the story behind it, and
a private journal. Plain HTML, CSS and ES modules. No build step, no framework.
Live at https://imheet07-gif.github.io/verse-a-day/ (GitHub Pages, served from the
`main` branch of `imheet07-gif/verse-a-day`; every push to `main` redeploys in about a minute).
See `PLAN.md` for the full plan.

## Run locally

    python3 -m http.server 8000

then open http://localhost:8000/. It also works from a sub-path
(for example `/verse-a-day/` on GitHub Pages) because every URL is relative.
The service worker only registers over http(s). While developing, bump
`VERSION` in `sw.js` or unregister the worker, since it serves files stale-while-revalidate.

## File map

    index.html              app shell
    css/app.css             tokens (light, dark, paper, night) and all styles
    js/main.js              routing, header, week strip, toolbar, rail
    js/store-entries.js     EntryStore: list(), get(date), all(). Only place that knows entries are JSON files
    js/store-journal.js     JournalStore: get, set, all, import, export. Only place that handles journal data
    js/storage.js           guarded localStorage wrapper (memory fallback)
    js/view-*.js            piece, journal, archive, month, welcome/empty/error screens
    js/lookup.js            Look up overlay (pieces and your journal)
    js/settings-ui.js       settings sheet, Sync & Backup, export and import
    js/config.js            SUPABASE_URL / SUPABASE_ANON_KEY (public key only) and syncConfigured
    js/remote.js            Remote interface: SupabaseRemote (real) and FakeRemote (tests)
    js/sync.js              sync engine: merge rules, conflicts, retry. No DOM, runs under node
    js/sync-app.js          the page's engine instance, wired to the journal store
    js/sync-ui.js           sync panel, banner, journal sync label, conflict prompt
    js/device.js            ?fake-remote / ?device switches (localhost only)
    supabase/schema.sql     table and row-level security policies, paste into Supabase
    tests/sync.test.mjs     node test of the merge rules
    tools/daily-task.md     what the morning task does: steps, taste, copyright rules
    tools/validate-entries.mjs  checks every entry and the index; run before committing
    tools/update-index.mjs  rebuilds entries/index.json from the entry files
    js/prefs.js, fonts.js, icons.js, dialogs.js, util.js
    entries/index.json      [{date,type,title,author,lang}] newest first
    entries/YYYY-MM-DD.json one per day (starts 2026-11-03)
    manifest.webmanifest, sw.js, icons/

## Copyright rule

Only `text` is ever rendered as poem text, and only for `classic` entries
(published before 1929). Modern poems and songs carry links only.

## The daily task

A Claude scheduled task, "Verse a Day: daily piece", runs every morning at 7:16 AM IST
on the owner's Mac (while the Claude app is open; if it was closed, on next launch).
It follows `tools/daily-task.md`: pull, pick the day's type from the weekday
(Mon/Thu/Sun classic, Tue/Fri modern, Wed/Sat song), choose a piece not already in
`entries/`, research it, write `entries/YYYY-MM-DD.json`, rebuild the index, run the
validator, then commit and push `entries/` only. Its closing message, which is the
morning notification, links to `https://imheet07-gif.github.io/verse-a-day/#/YYYY-MM-DD`.
To change what it picks or how it writes, edit `tools/daily-task.md`; to change the
time, edit the task in the Claude app's Scheduled list.

### Add or fix an entry by hand

1. Copy a recent file of the same type to `entries/YYYY-MM-DD.json` and edit it
   (schema and rules are in `tools/daily-task.md`). The type must match the weekday.
2. `node tools/update-index.mjs` rebuilds `entries/index.json`.
3. `node tools/validate-entries.mjs` must print `OK`.
4. `git add entries && git commit -m "Entry YYYY-MM-DD: Title (Author)" && git push`.

The validator fails on: a type that breaks the weekday rotation, `text` on a modern
or song entry, a classic dated 1929 or later, unknown fields, a repeated piece,
missing links or sources, and an index that does not match the files.

## Turn on sync

Sync is optional and off until you fill in `js/config.js`. Until then the app is
device-only, the Supabase library is never loaded and no request leaves the page.

1. Create a Supabase project (or pick one you already have).
2. In the SQL editor, paste and run `supabase/schema.sql`. It creates the
   `vad_journal` table with row-level security so each person can only reach their own rows.
3. Authentication -> URL configuration: add the address of the site (for example
   `https://<user>.github.io/verse-a-day/`) as the Site URL. Keep the Email provider enabled.
   If "Confirm email" is on, new accounts must click the emailed link, then sign in.
4. Project settings -> API: copy the project URL and the **anon (public)** key into
   `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `js/config.js`. Never put the service-role key in the page.

`@supabase/supabase-js` 2.45.4 is loaded from jsdelivr by dynamic `import()`, only when
configured. The session is stored under `vad:auth`, so it cannot collide with other apps on the same origin.

How it behaves: the journal is always written to the device first; sync runs in the
background. When two devices changed the same day, nothing is overwritten: you are asked
whether to keep this device's version, use the other device's, or keep both. Signing out
leaves the journal on the device.

### Try sync without a backend

On `localhost` or `127.0.0.1` only, add `?fake-remote=1` to use an in-page fake server
(any password works):

    http://localhost:8000/?fake-remote=1               device A
    http://localhost:8000/?fake-remote=1&device=b      device B (own local journal, same fake server)

Open both in two tabs. In the console, `window.__vadFake.offline = true` simulates being
offline, `.fail = true` a server error, `.confirmEmail = true` sign-up that needs email
confirmation, `.expireSession()` an expired login, and `.rows('you@example.com')` shows what
the fake server holds. Run the engine tests with `node tests/sync.test.mjs`.

## Not done

- `SupabaseRemote` has not yet been confirmed signed-in against the real project on two devices.
- Genius links are search URLs, not deep links.
- Fonts and the sync library are cached for offline use on the second visit, not the first
  (the first visit installs the service worker). The app itself works offline after one visit.
