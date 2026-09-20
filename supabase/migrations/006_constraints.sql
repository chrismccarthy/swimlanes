-- Tighten the column-level constraints the client already relies on.
--
-- Every CHECK below could in principle be violated by rows that predate this
-- migration, so each is added `NOT VALID` first and validated in a second
-- statement. `ADD CONSTRAINT ... NOT VALID` takes a brief ACCESS EXCLUSIVE lock
-- and skips the table scan, so every *new* write is checked from that moment on;
-- `VALIDATE CONSTRAINT` then scans the existing rows under SHARE UPDATE
-- EXCLUSIVE, which does not block concurrent reads or writes. The split also
-- makes a failure easy to read: if legacy data is bad it is the VALIDATE step
-- that reports the constraint name and the offending table, instead of a single
-- opaque failure at ADD time. (`supabase db push` wraps the migration in a
-- transaction, so a failed VALIDATE still rolls the whole file back — you fix
-- the data, then re-run.)

-- blocks.color: exactly the eight palette colours. The client's single source of
-- truth is `ALL_COLORS` in src/lib/colors.ts, and src/lib/colors.test.ts parses
-- the list out of *this file* and asserts the two are identical, so they cannot
-- drift apart.
ALTER TABLE blocks
  ADD CONSTRAINT blocks_color_valid
  CHECK (color IN ('blue', 'green', 'amber', 'red', 'purple', 'pink', 'teal', 'orange'))
  NOT VALID;
ALTER TABLE blocks VALIDATE CONSTRAINT blocks_color_valid;

-- blocks.title: non-empty once trimmed, and capped so a runaway paste cannot
-- become an unbounded row. The UI never sends whitespace-only titles (BlockModal
-- trims and requires a value), this stops anything else from doing so.
ALTER TABLE blocks
  ADD CONSTRAINT blocks_title_not_blank
  CHECK (btrim(title) <> '')
  NOT VALID;
ALTER TABLE blocks VALIDATE CONSTRAINT blocks_title_not_blank;

ALTER TABLE blocks
  ADD CONSTRAINT blocks_title_length
  CHECK (char_length(title) <= 200)
  NOT VALID;
ALTER TABLE blocks VALIDATE CONSTRAINT blocks_title_length;

-- members.name: same rules as blocks.title.
ALTER TABLE members
  ADD CONSTRAINT members_name_not_blank
  CHECK (btrim(name) <> '')
  NOT VALID;
ALTER TABLE members VALIDATE CONSTRAINT members_name_not_blank;

ALTER TABLE members
  ADD CONSTRAINT members_name_length
  CHECK (char_length(name) <= 200)
  NOT VALID;
ALTER TABLE members VALIDATE CONSTRAINT members_name_length;

-- blocks date sanity. `end_date >= start_date` is already enforced by
-- blocks_date_order (001); this bounds both ends so a mis-parsed or malicious
-- date cannot put a block in year 0200 or 20260, which would make the timeline
-- render a few million pixels wide.
ALTER TABLE blocks
  ADD CONSTRAINT blocks_date_range_sane
  CHECK (
    start_date BETWEEN DATE '1970-01-01' AND DATE '2100-12-31'
    AND end_date BETWEEN DATE '1970-01-01' AND DATE '2100-12-31'
  )
  NOT VALID;
ALTER TABLE blocks VALIDATE CONSTRAINT blocks_date_range_sane;

-- sprint_config.length_days: 1..90. The settings UI caps input at 42 days
-- (SettingsModal.tsx), so the database bound is a deliberately looser backstop —
-- it rejects nonsense without having to be redeployed if the UI cap is raised.
-- It supersedes the anonymous `length_days > 0` check from 001, which is dropped
-- here so there is exactly one rule to read.
ALTER TABLE sprint_config
  ADD CONSTRAINT sprint_config_length_days_range
  CHECK (length_days BETWEEN 1 AND 90)
  NOT VALID;
ALTER TABLE sprint_config VALIDATE CONSTRAINT sprint_config_length_days_range;

ALTER TABLE sprint_config DROP CONSTRAINT IF EXISTS sprint_config_length_days_check;
