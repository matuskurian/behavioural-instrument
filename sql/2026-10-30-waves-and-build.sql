-- 2026-10-30: waves (up to three runs per participant) and build provenance.
--
-- Run in the Supabase SQL editor, as one piece. It is a single transaction:
-- either all of it applies or none of it does.
--
-- BACKWARD-COMPATIBLE. The client deployed when this runs sends neither new
-- column, and keeps writing valid rows: wave takes its default of 1, build
-- stays null, and an account with no wave in its app_metadata counts as
-- wave 1 in the policy below. So this can run before the new client is
-- deployed, with no window of refused writes. (The new client must NOT be
-- deployed before this runs: it sends both columns, and PostgREST refuses
-- unknown columns with PGRST204.)
--
-- Every row already in the table becomes wave 1, which it is.

begin;

-- When the answer was given: 1, 2 or 3. At most three runs are planned; the
-- check catches a bad value rather than any real limit, and is one ALTER to
-- widen if that ever changes.
alter table public.responses
  add column wave smallint not null default 1;

-- Which build of the instrument the answer was given against: the commit sha
-- the page was stamped with at deploy ("dev" when served locally). Pure
-- provenance - it lets analysis say exactly what content a child saw, which
-- server_ts alone cannot around a deploy, because a child who loaded the page
-- just before it keeps the old content for the whole session.
alter table public.responses
  add column build text;

alter table public.responses
  add constraint responses_wave_range check (wave between 1 and 3);

alter table public.responses
  add constraint responses_build_short check (build is null or char_length(build) <= 64);

-- One answer per participant, per item, PER WAVE. The old key was stricter,
-- so no existing rows can violate the new one.
alter table public.responses
  drop constraint responses_participant_id_item_id_key;

alter table public.responses
  add constraint responses_participant_item_wave_key unique (participant_id, item_id, wave);

-- A row's wave must be the wave its account is in. The account's wave lives in
-- app_metadata, which only the secret key can write, so a participant cannot
-- move themselves into another wave from the browser.
--
-- RESTRICTIVE, deliberately: Postgres ANDs a restrictive policy with the
-- existing permissive insert policy. The participant_id check that policy
-- already makes is untouched, and nothing here can loosen it.
create policy responses_wave_matches_account
  on public.responses
  as restrictive
  for insert
  to authenticated
  with check (
    wave = coalesce((auth.jwt() -> 'app_metadata' ->> 'wave')::smallint, 1)
  );

commit;

-- Afterwards, optionally, to see the result (read-only):
--
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.responses'::regclass
--    order by conname;
--
--   select policyname, permissive, cmd, roles, with_check
--     from pg_policies
--    where tablename = 'responses';
