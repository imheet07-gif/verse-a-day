# Verse a Day (phase 1)

A static, installable web app: one poem or song a day, the story behind it, and
a private journal. Plain HTML, CSS and ES modules. No build step, no framework.
See `PLAN.md` for the full plan and the phase 1 spec.

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
    js/prefs.js, fonts.js, icons.js, dialogs.js, util.js
    entries/index.json      [{date,type,title,author,lang}] newest first
    entries/YYYY-MM-DD.json one per day (8 samples, 2026-11-03 to 2026-11-10)
    manifest.webmanifest, sw.js, icons/

## Copyright rule

Only `text` is ever rendered as poem text, and only for `classic` entries
(published before 1929). Modern poems and songs carry links only.

## Stubbed or not done

- Sync: shown as "Sign in, coming soon" and disabled. Journal lives in localStorage (`vad:j:<date>`).
- Genius links are search URLs, not deep links.
- The daily writer, Supabase and deployment belong to later phases.
