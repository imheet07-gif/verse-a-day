# Verse a Day: the daily task

These are the instructions the scheduled task "Verse a Day: daily piece" follows
each morning at 7:16 AM IST. The task runs in `/Users/heetmehta/poetry` and
publishes to https://imheet07-gif.github.io/verse-a-day/.

## Steps

1. `git pull --ff-only` on `main`. If it fails, stop and report; do not force anything.
2. Today's date is `TZ=Asia/Kolkata date +%F`. If `entries/<date>.json` already
   exists, change nothing: go straight to step 9 with the existing piece.
3. The type comes from the weekday, with no exceptions:
   Monday, Thursday, Sunday → `classic`; Tuesday, Friday → `modern`; Wednesday, Saturday → `song`.
4. Read `entries/index.json` (every piece used so far). Choose a piece that is
   **not** in it: never the same title by the same author, and avoid the same
   author or film as any of the last 14 days.
5. Research it on the web. Every fact in the entry must come from a source you
   actually opened today, and those sources go in `sources`.
6. Write `entries/<date>.json` in the schema below. Do not set `sample`.
7. Run `node tools/update-index.mjs`, then `node tools/validate-entries.mjs --date <date>`.
   If the validator reports anything, fix the entry and run it again. Never
   commit while it fails. If it cannot be made to pass, delete the new file,
   rebuild the index, and report what went wrong.
8. `git add entries/` and nothing else, commit as `Entry <date>: <title> (<author>)`,
   then `git push origin main`. Never force-push; never touch files outside `entries/`.
9. Finish with a short message: the piece's title and author, and the link
   `https://imheet07-gif.github.io/verse-a-day/#/<date>`. If a push-notification
   tool is available, send the same line as a notification.

## Taste

The reader likes Bollywood songs, a romantic lean, and a mix of old and new.

- **Songs**: Hindi film songs, mostly classic (1950s to 1990s), with a newer one
  now and then. Lyricists such as Sahir Ludhianvi, Shailendra, Majrooh Sultanpuri,
  Gulzar, Anand Bakshi, Javed Akhtar, Irshad Kamil, Amitabh Bhattacharya.
- **Classics**: public-domain poems, love and longing first. Mix English
  (Shakespeare, Donne, Keats, Shelley, Byron, the Brownings, Christina Rossetti,
  Dickinson, Yeats's early work, Teasdale) with Urdu, Hindi and other Indian
  poetry in its own script (Ghalib, Mir, Kabir, Mirabai, Zauq, Daagh), about one in four.
- **Modern**: well-known poets from the twentieth century onward, in any language
  (Faiz, Amrita Pritam, Sahir, Gulzar, Neruda, Szymborska, Mary Oliver, Agha Shahid Ali, and others).

Vary language, century and mood across the week. Romantic most days, not every day.

## Copyright rules (hard; when in doubt, leave it out)

- **Songs: never any lyrics.** Not a line, not a phrase quoted from the song, not a
  translation of a line, in any field. The title is the only words of the song that appear.
- **Modern poems: never any of the poem's text**, in the original or in
  translation, in any field. Describe, do not quote.
- **Only `classic` entries have `text`**, and only when the poem was published
  before 1929 and its author died more than 60 years ago, so it is in the public domain in both the United States and India. For a
  translated poem the translation itself must also be public domain; otherwise
  give the original-language text and explain the plain sense in your own words in `why` or `notice`.
- Copy a classic's text from a reliable source opened today (Wikisource, Project
  Gutenberg, Poetry Foundation, Rekhta), complete and exact. Never from memory. If
  you cannot find a trustworthy full text, choose another poem. Long poems: pick
  one short enough to give whole (under about 40 lines) rather than an excerpt.
- If today's type is `classic` and you are not sure a poem is public domain, choose a different poem.

## Honesty rules

- `who` and `why` state only documented facts. If the reason a piece was written
  is not known, say so plainly ("There is no documented account of...") rather than guess.
- Mark what is tradition or widely reported as such. No invented biography, dates or anecdotes.
- Links must be search URLs or stable pages you opened, never guessed deep links.

## Entry schema

```json
{
  "date": "YYYY-MM-DD",
  "type": "classic | modern | song",
  "title": "",
  "author": "poet, or the lyricist for a song",
  "year": 1819,
  "lang": "en | hi | ur | pa | bn ...",
  "dir": "ltr | rtl",
  "credits": "songs only: Lyrics X, music Y, sung by Z, from the film F (year)",
  "text": "classics only: lines separated by \n, a blank line between stanzas",
  "links": [{"label": "", "url": "https://..."}],
  "who": "two to four sentences on the people behind it",
  "why": "what is documented about why it was written, or that this is not known",
  "notice": "two or three things to look or listen for",
  "prompts": ["journal question one", "journal question two"],
  "sources": [{"title": "", "url": "https://..."}]
}
```

- `year` is the year of publication or film release (for old poets with no known
  date, the year of death, said so in `who`). Leave it out if unknown; classics must have it.
- `lang` is the language of the text shown on the page: for a classic, the
  language of `text` (`ur` and `fa` take `"dir": "rtl"`); for modern entries `en`; for Hindi film songs `hi`.
- Song links, exactly these three: `Search YouTube` (`https://www.youtube.com/results?search_query=...`),
  `Search Spotify` (`https://open.spotify.com/search/...`), `Search Genius` (`https://genius.com/search?q=...`).
- Modern links: a `Find the poem` search link, plus a reading or recitation search on YouTube.
- `prompts`: two personal, open questions tied to the piece's theme. They must not quote it.
- Look at the last few files in `entries/` for the tone and length to match.
