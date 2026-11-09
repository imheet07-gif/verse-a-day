-- Verse a Day: journal sync schema.
-- Paste this whole file into the Supabase SQL editor and run it once.
-- It is safe to run again: every statement is idempotent.

-- One row per user per day. `text` may be empty: an empty string is a real value
-- ("I cleared this entry") and must not be confused with "no row".
create table if not exists public.vad_journal (
  -- Whose entry this is. Filled in by the database from the signed-in session,
  -- so the page never has to send (or be trusted with) a user id.
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  date       date        not null,
  text       text        not null default '',
  -- When the entry was last edited, as stamped by the device that edited it.
  -- The app also uses it as a version marker for compare-and-set updates.
  updated_at timestamptz not null,
  primary key (user_id, date)
);

comment on table public.vad_journal is 'Verse a Day journal entries, one per user per day. Private to the owner.';

-- Row-level security: with it on and no matching policy, nobody sees anything.
alter table public.vad_journal enable row level security;

-- The public anon role gets nothing at all. Only signed-in users ("authenticated") are
-- granted table privileges, and the policies below narrow that to their own rows.
revoke all on public.vad_journal from anon;
grant select, insert, update, delete on public.vad_journal to authenticated;

-- Each policy lets a signed-in user touch only rows where user_id is themselves.
-- (select auth.uid()) is the form Supabase recommends: evaluated once per query, not per row.
drop policy if exists "vad_journal select own" on public.vad_journal;
create policy "vad_journal select own" on public.vad_journal
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "vad_journal insert own" on public.vad_journal;
create policy "vad_journal insert own" on public.vad_journal
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "vad_journal update own" on public.vad_journal;
create policy "vad_journal update own" on public.vad_journal
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "vad_journal delete own" on public.vad_journal;
create policy "vad_journal delete own" on public.vad_journal
  for delete to authenticated
  using (user_id = (select auth.uid()));
