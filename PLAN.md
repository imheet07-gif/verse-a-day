# Verse a Day: standalone web app plan

Verse a Day is a daily reading habit: one poem or song each morning, the story
behind it, and a private journal. Today it lives inside a Claude artifact. This
plan moves it to a static, installable web app (GitHub Pages) modelled on the
owner's other project, Mars Log (https://imheet07-gif.github.io/mars-log/).

## Architecture (all phases)

| Part | Decision |
|---|---|
| Hosting | Static site, GitHub Pages, served from a sub-path (`/verse-a-day/`). All URLs relative. |
| Entries | One JSON file per day, `entries/YYYY-MM-DD.json`, plus `entries/index.json`. Loaded through a single `EntryStore` module so the source can be swapped later. |
| Journal | Phase 1: on the device (localStorage, keys prefixed `vad:`). Phase 2: Supabase table with row-level security, behind the same `JournalStore` interface. |
| Daily writer | Phase 3: the existing Claude scheduled task commits the day's JSON. No secret key in the page, ever. |
| Ask box | "Ask in Claude" hand-off button. No in-page model calls. |

## Phases

1. **UI refresh as a static app** (this phase, spec below). No accounts, no network writes.
2. **Sync**: Supabase journal, sign-in, offline write queue, "newer version on another device" prompt, journal migration.
3. **Daily task**: rewrite the task to commit entry JSON; during overlap one task writes both old and new homes.
4. **Cutover**: switch the notification link; retire the artifact after the journal migration is confirmed.

Out of scope for phase 1: Supabase, sign-in, pushing to GitHub, creating remote repos, deploying, the scheduled task.

---

# Phase 1 spec

## Deliverables

```
index.html              app shell
css/app.css             styles (tokens, light/dark/paper/night)
js/*.js                 ES modules, no build step, no frameworks, no CDN scripts
entries/index.json      [{date,type,title,author,lang}] newest first
entries/YYYY-MM-DD.json one per day
manifest.webmanifest    name, icons, theme colour, start_url "./"
sw.js                   service worker (scope "./")
icons/                  SVG mark + 192/512 PNG + apple-touch-icon (generate from the SVG if tooling allows; otherwise ship SVG and say so)
README.md               how to run locally, file map, what is stubbed
```

Must run with `python3 -m http.server` from the repo root and from a sub-path. Fonts may come from Google Fonts; everything else is local.

## Entry schema (unchanged from the current system)

```json
{
  "date": "2026-11-09",
  "type": "classic | modern | song",
  "title": "", "author": "", "year": 1819,
  "lang": "en", "dir": "ltr",
  "credits": "songs only: lyricist, composer, singer, film and year",
  "text": "classics only, line breaks as \n, blank line between stanzas",
  "links": [{"label": "", "url": ""}],
  "who": "", "why": "", "notice": "",
  "prompts": ["", ""],
  "sources": [{"title": "", "url": ""}],
  "sample": true
}
```

`lang` and `dir` are new and optional (default `en` / `ltr`).

### Copyright rules (hard requirement)

- `text` is only ever present for poems published before 1929 / public domain.
- Modern poems: no text, links only. Songs: never any lyrics, not one line. Links are a YouTube search link, a Spotify search link and a Genius page.
- The page must not render poem or lyric text from any field other than `text`.

### Sample entries

Ship 8 sample entries dated 2026-11-03 to 2026-11-10 following the weekday
rotation (Mon/Thu/Sun classic, Tue/Fri modern, Wed/Sat song), all marked
`"sample": true`. Requirements:

- Classics: famous pre-1929 poems whose text you can reproduce accurately. Include one in Hindi or Urdu script (public domain, e.g. Ghalib or Kabir, a short couplet) so script support is exercised, with `lang`/`dir` set.
- `who`/`why`/`notice`: only widely documented facts. If the reason behind a work is not known, say so. Do not invent biography.
- Songs lean classic Hindi film; modern poems by well-known poets. Links must be search URLs or stable pages, not guessed deep links.

## Design

Keep the existing identity and make it feel like a place, as Mars Log does.

- **Palette**: pale blue "inland letter" paper, deep ink blue text, marigold accent. Not cream-and-terracotta. Define as CSS custom properties on `:root`. Suggested starting tokens (adjust for contrast, AA minimum):
  - light: paper `#E9F0F6`, surface `#F6F9FC`, ink `#1E2E4A`, muted `#5B6B85`, rule `#C4D2E0`, accent `#E0A21B`, accent-ink `#7A5200`
  - dark: paper `#101826`, surface `#172235`, ink `#E3EAF4`, muted `#93A3BC`, rule `#2A3A54`, accent `#F2B93B`
  - plus two reading modes: "paper" (warmer, lower contrast) and "night" (true dark, dim accent)
- **Type**: Cormorant Garamond for poems and titles, Work Sans for interface. Noto Serif Devanagari for `hi`, Noto Nastaliq Urdu for `ur`/`fa` (with `dir="rtl"` and extra line height), Noto Serif Bengali for `bn`. Load script fonts only when an entry needs them.
- **Mark**: an original letter-seal or ink-nib icon in SVG, used for the header, favicon and app icons.
- **Poem typography**: large text, measure about 60 characters, each line its own element with a hanging indent when it wraps, stanza breaks preserved, never justified. Text-size control (A− / A+) persisted.
- **Inland-letter details** are welcome (fold lines, a postal-style date stamp, an airmail edge) if they stay quiet. No decorative clutter around the poem itself.

## Interface

- **Header**: mark, today's date as a postal-style stamp, and a streak line: "Day 23 · 4 this week" (days journaled in a row, and this week's count).
- **Week strip** (sticky): Monday to Sunday, each day showing its type letter (C / M / S), a dot when a piece exists and a ring when journaled. Tap opens the day. Swipe left/right on the piece changes day.
- **Piece view**: type chip, title, author and year, credits (songs), full text (classics), link buttons, then "Who they are", "Why it was written", "What to notice", then Sources.
- **Journal**: the two prompts, a text box that autosaves (debounced, one write at a time) with word count and a Saved status with timestamp; a gentle "write one line" nudge when empty; a distraction-free full-screen mode that keeps the prompts visible.
- **Ask in Claude**: a button beside the journal that opens `https://claude.ai/new?q=` with a prefilled prompt containing title, author, type, year and the two journal prompts, plus the instruction not to reproduce lyrics or copyrighted poem text. Never include journal text.
- **Bottom toolbar**: Previous · Next · Archive · Look up. Thumb-sized targets, safe-area insets respected.
- **Archive**: newest first, marked when journaled, with search (title, poet) and filters (classic / modern / song, journaled, language).
- **Look up**: one overlay searching entries and the user's own journal text, results grouped.
- **Month view**: a calendar showing which days have a piece and which were journaled.
- **Settings sheet**: text size, theme (auto / light / dark / paper / night), and a "Sync & Backup" panel with: sync status ("Saved on this device", sign-in shown as coming soon and disabled), export journal as JSON and as Markdown, import JSON (merge, newest `updatedAt` wins per date, confirm before applying).
- **Share**: copies a plain link to the day (`#/2026-11-09`). Never includes journal content.
- **Empty and error states**: a designed first-run screen explaining what arrives each morning; a clear state for a day with no piece; a clear offline state.
- **Routing**: hash routes (`#/YYYY-MM-DD`, `#/archive`, `#/month`). Default route is today, falling back to the latest entry.

## Layout across devices

- Phone: single reading column.
- Tablet and desktop ("Wide", from about 900px): piece on the left, journal on the right, archive as a collapsible side rail. Journal column sticky.
- Works from 320px wide. No horizontal page scroll. Honour `prefers-reduced-motion` and `prefers-color-scheme`.
- Keyboard: arrow keys for previous/next, `/` opens Look up, Esc closes overlays. Visible focus rings, labelled controls, overlays trap focus.

## Offline and install

- Manifest with name, short name, icons, `display: standalone`, theme and background colours per the palette, themed status bar meta tags for iOS.
- Service worker: precache the shell; cache the entry index and every entry file (they are small) with stale-while-revalidate; versioned cache name; old caches removed on activate. Must work under a sub-path.

## Code structure

- `js/store-entries.js` — `EntryStore`: `list()`, `get(date)`. Only place that knows entries are JSON files.
- `js/store-journal.js` — `JournalStore`: `get(date)`, `set(date, text)`, `all()`, `import(data)`, `export()`. Records are `{date, text, updatedAt}`. Only place that touches localStorage for journal data. Phase 2 will add a Supabase-backed implementation behind the same interface.
- Wrap all storage access in try/catch; the page must render with storage unavailable.
- Render user and entry strings as text, never as HTML.

## Done means

- Every item under Interface works on the sample entries at phone and wide widths, in light and dark.
- No console errors on load, navigation, journaling, export/import or offline reload.
- Verified by actually serving the site locally and exercising it; anything not verified is listed in the final report.
- Work committed on the worktree branch. Nothing pushed, no remote created.

---

# Phase 2 spec: journal sync

Phase 1 is done. The journal lives on the device in `js/store-journal.js`
(records `{date, text, updatedAt}` in localStorage under `vad:j:`). Phase 2
adds optional sign-in and cross-device sync through Supabase, without changing
how the app behaves for someone who never signs in.

## Ground rules

- **Local first.** localStorage stays the source the UI reads and writes. Sync runs in the background. Typing never waits on the network.
- **Off until configured.** `js/config.js` exports `SUPABASE_URL` and `SUPABASE_ANON_KEY`, both empty in the repo. While empty, the app behaves exactly as in phase 1 and the Supabase library is never loaded. Only the public anon key ever goes in the page; never a service-role key.
- **Library.** Load `@supabase/supabase-js` pinned at 2.45.4 as an ES module from jsdelivr (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm`), by dynamic `import()` only when configured. This is the one allowed CDN script.
- **Same origin as Mars Log.** Both sites live on `imheet07-gif.github.io`, so they share localStorage. Every key this app writes must start with `vad:`; pass a custom `storageKey` (`vad:auth`) to the Supabase client so sessions never collide.
- Do not create Supabase projects or accounts, and do not put real credentials in any file. All testing uses the fake backend described below.

## Database (`supabase/schema.sql`)

One file the owner pastes into the Supabase SQL editor:

- Table `vad_journal`: `user_id uuid not null default auth.uid() references auth.users on delete cascade`, `date date not null`, `text text not null default ''`, `updated_at timestamptz not null`, primary key `(user_id, date)`.
- Row-level security enabled, with select / insert / update / delete policies all restricted to `user_id = auth.uid()` for the `authenticated` role. No access for `anon`.
- Idempotent (`if not exists`, `drop policy if exists`), with comments explaining each part.

## Code structure

- `js/config.js` — the two constants plus `syncConfigured`.
- `js/remote.js` — a `Remote` interface: `session()`, `signIn(email, password)`, `signUp(email, password)`, `signOut()`, `onAuthChange(fn)`, `pull(sinceISO|null)` returning rows `{date, text, updatedAt}`, `push(rows)` (upsert). Two implementations: `SupabaseRemote` and `FakeRemote`.
- `FakeRemote` — an in-page fake used when the URL has `?fake-remote=1` (and only on localhost / 127.0.0.1). It keeps its rows under `vad:fake:` so a second browser tab or a second "device" profile (`?fake-remote=1&device=b`, which namespaces the *local* journal keys but shares the fake remote) can simulate two devices. It can simulate being offline and failing (`window.__vadFake.offline = true`). Any password is accepted. This is what makes sync testable without a real backend.
- `js/sync.js` — the sync engine. `store-journal.js` stays the only module touching journal localStorage, extended with per-record sync metadata.

## Sync rules

Each local record gains `dirty` (changed since last successful push) and `base` (the remote `updatedAt` this device last saw for that date, or null).

- **Save:** `set()` writes locally, marks `dirty`, and asks the engine to sync soon (debounced about 2s). Works identically offline.
- **Triggers:** sign-in, app start when signed in, coming back online, tab becoming visible, after a save, and a manual "Sync now" button. One sync at a time; a request during a sync schedules exactly one follow-up.
- **Pull then push**, per date:
  - remote only → take remote.
  - local only or local dirty with remote unchanged since `base` → push local.
  - local clean and remote newer → take remote. If that date's journal box is open and unfocused, update it in place; if the user is typing in it, do not overwrite the box, treat as a conflict instead.
  - local dirty **and** remote changed since `base` **and** texts differ → **conflict**. Do not auto-resolve.
  - identical text → no conflict, just align metadata.
- **Conflict prompt:** "A newer version exists on another device." Show both versions with their timestamps and word counts, and three actions: Keep this device's, Use the other device's, Keep both (joins them with a divider line, this device's first). Nothing is lost silently, ever. Multiple conflicts queue, one prompt at a time.
- **First sign-in on a device with existing local entries** follows the same rules (local records start `dirty`, `base` null), so local and remote merge and only true clashes prompt.
- **Empty text** is a real value: clearing an entry syncs as empty text, it does not resurrect the old text from the other device.
- **Failures:** network or server errors leave records `dirty` and retry with backoff (and on the next trigger). Auth expiry shows "Signed out, sign in again to sync" without touching local data.
- **Sign-out:** local journal stays on the device; say so in the UI. Signing in as a *different* user on a device that still holds another user's synced records must ask first (keep and merge into this account, or clear the device copy).
- Import (from the phase 1 backup panel) marks imported records `dirty` so they sync.

## Interface

- **Sync & Backup panel:** replace the disabled "Sign in · coming soon" row.
  - Signed out: email and password fields with Sign in and Create account, the same pattern as Mars Log, with proper `autocomplete` attributes so password managers work, inline error messages, and a note that sync is optional.
  - Signed in: "Signed in as …", last synced time, count waiting to sync, Sync now, Sign out.
  - Not configured: one quiet line, "Sync is not set up for this copy yet."
- **Header/status:** the existing "Saved on this device" wording becomes state-aware: Saved on this device / Syncing… / Synced just now / Waiting to sync (offline) / Sync problem, tap to retry. Quiet, never a modal, never blocks writing.
- The journal's Saved indicator stays truthful: "Saved" means saved locally; synced state is shown separately.
- Email confirmation: if sign-up returns no session, tell the user to confirm by email, then sign in.

## Service worker

- Never intercept requests to the Supabase project origin.
- Cache the pinned supabase-js module (and what it imports from jsdelivr) so a signed-in app still starts offline. Bump `VERSION`.
- A failed library load (offline, first run) must degrade to device-only mode with a clear status, not a broken page.

## Docs

`README.md` gains a "Turn on sync" section: create or pick a Supabase project, run `supabase/schema.sql`, add the site URL under Authentication → URL configuration, paste the project URL and anon key into `js/config.js`. Also document the `?fake-remote=1` test mode.

## Done means

- With empty config: phase 1 behaviour unchanged, no network requests to jsdelivr or Supabase, no console errors.
- With `?fake-remote=1`, demonstrated in a real browser: sign in; write on device A, see it on device B; edit offline and see it sync on reconnect; a real conflict produces the prompt and each of the three choices does what it says; clearing an entry propagates; sign-out keeps local text; first sign-in merges existing local entries.
- `SupabaseRemote` is code-reviewed carefully against the supabase-js v2 API since it cannot be run here; say plainly that it is untested against a real project.
- All committed on the worktree branch. Nothing pushed, no remote created, no credentials in the repo.
