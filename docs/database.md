# Database

Postgres on Supabase: row level security on every table, Realtime on the
board-scoped ones, and an audit trigger that stamps `updated_at` /
`updated_by`. The schema is defined only by the SQL files in
`supabase/migrations/`, which are applied in filename order and never edited
once merged.

Since `007_boards.sql`, the schema is multi-board: `boards` and
`board_members` were added, `members`/`blocks`/`sprint_config` each carry a
mandatory `board_id`, and access is decided by board membership rather than
by "is authenticated". A default "Team" board is created by that migration
and every pre-existing row (and every pre-existing `auth.users` row, as an
owner) is attached to it.

## Schema

| Table | Columns | Notes |
| --- | --- | --- |
| `boards` | `id uuid pk`, `name text`, `created_at/by`, `updated_at/by` | One row per team. Creating a board makes the creator its `owner` (`board_members`) and gives it a default `sprint_config` row, both via triggers. |
| `board_members` | `board_id uuid → boards(id) on delete cascade`, `user_id uuid → auth.users(id) on delete cascade`, `role text` (`owner` \| `editor`), `created_at`, pk `(board_id, user_id)` | Who may see/edit a board. A trigger blocks removing or demoting a board's last owner. Indexed on `user_id`. |
| `members` | `id uuid pk`, `board_id uuid → boards(id) on delete cascade`, `name text`, `sort_order double precision`, `created_at/by`, `updated_at/by` | One swimlane per row. `sort_order` is a float so a lane can be dropped between two others without renumbering. `(id, board_id)` is unique, which the `blocks` FK below relies on. Indexed on `sort_order` and `board_id`. |
| `blocks` | `id uuid pk`, `member_id uuid`, `board_id uuid`, composite FK `(member_id, board_id) → members(id, board_id) on delete cascade`, `title text`, `start_date date`, `end_date date` (inclusive), `color text`, `tags text[] not null default '{}'`, `created_at/by`, `updated_at/by` | The composite FK stops a block from pairing a member with a board other than the member's own. `tags` (`009_block_tags.sql`) holds up to ten free-text labels, the board's tag filter reads them client-side. Indexed on `member_id`, `board_id` and — GIN — `tags`. |
| `sprint_config` | `board_id uuid pk → boards(id) on delete cascade`, `anchor_date date`, `length_days integer`, `updated_at/by` | One row per board (before `007_boards.sql` this was a single global row keyed on an integer `id`, enforced by `CHECK (id = 1)`; that column is gone). A trigger creates this row when a board is created. |
| `ics_tokens` | `token uuid pk`, `member_id uuid → members(id) on delete cascade`, `created_by uuid → auth.users(id) on delete cascade`, `created_at` | Bearer tokens for the `ics` calendar-feed edge function (`008_ics_tokens.sql`); the function reads this table with the service role key, bypassing RLS, since the calendar client has no session. Indexed on `member_id` and `created_by`. |

`created_by` / `updated_by` reference `auth.users(id)` and are `NULL` for rows
nobody edited through the app (the seed rows, for instance). `updated_at` is
also the optimistic-concurrency token: every write from the client sends the
value it last saw as `expectedUpdatedAt` and is rejected if the row moved on.

## Constraints

From `001_create_tables.sql`:

- `blocks_date_order` — `end_date >= start_date`.
- `sprint_config_single_row` — `id = 1`. Dropped by `007_boards.sql` along
  with the `id` column itself: `sprint_config` is now one row per board,
  keyed on `board_id`.

From `006_constraints.sql`:

| Constraint | Rule |
| --- | --- |
| `blocks_color_valid` | `color` is one of the eight palette colours |
| `blocks_title_not_blank` | `btrim(title) <> ''` |
| `blocks_title_length` | `char_length(title) <= 200` |
| `members_name_not_blank` | `btrim(name) <> ''` |
| `members_name_length` | `char_length(name) <= 200` |
| `blocks_date_range_sane` | both dates within `1970-01-01 .. 2100-12-31` |
| `sprint_config_length_days_range` | `length_days BETWEEN 1 AND 90` (supersedes the `> 0` check from 001, which 006 drops) |

Two things to know about that migration:

- Each constraint is added `NOT VALID` and validated in a second statement. New
  writes are checked as soon as the constraint exists, while the scan of
  existing rows happens under a lock that does not block reads or writes — and
  if legacy data does violate a rule, the `VALIDATE` step names the constraint
  instead of failing opaquely.
- The colour list is duplicated in exactly two places on purpose: `ALL_COLORS`
  in `src/lib/colors.ts` (from which the `BlockColor` type is derived and which
  `src/types/index.ts` re-exports) and the `blocks_color_valid` check.
  `src/lib/colors.test.ts` parses the list back out of the migration file and
  asserts the two are identical, so they cannot drift.

The database bound on `length_days` is looser than the settings UI, which caps
input at 42 days (`SettingsModal.tsx`). That is deliberate: the UI is the
product decision, the constraint is the backstop.

From `009_block_tags.sql`:

| Constraint | Rule |
| --- | --- |
| `blocks_tags_count` | `cardinality(tags) <= 10` |
| `blocks_tags_valid` | every element is non-blank once trimmed, at most 30 characters and contains no comma — expressed as the `IMMUTABLE` helper `tags_are_valid(text[])`, so the rule is written once and can be reused |

The client half of those rules lives in `src/lib/tags.ts` (`normaliseTags`),
which every path into the data layer runs untrusted input through.

## Row level security

Every table has RLS enabled. There are no `anon` policies, so an
unauthenticated caller sees nothing.

Since `007_boards.sql` superseded the original blanket "any authenticated
user" policies (`002_rls_policies.sql`), access to `boards`, `board_members`,
`members`, `blocks` and `sprint_config` is decided per-board by the
`SECURITY DEFINER` helpers `is_board_member(board_id)` and
`is_board_owner(board_id)`, reading `board_members`. Boards can be renamed or
deleted only by an owner; `board_members` rows can be added or removed only
by an owner (`add_board_member_by_email(board_id, email, role)` is the
client's only way to turn an email into a member — it looks the address up
case-insensitively in `auth.users` and raises if there is no account).
`ics_tokens` (`008_ics_tokens.sql`) is simpler: a user may insert, select and
delete only the tokens they created themselves.

Sign-in is restricted to `evenlydistributed.xyz` by Google's `hd` parameter,
with `public.check_email_domain` (`004_before_sign_in_hook.sql`) as a second
line of defence. It has to be wired up by hand in the dashboard under
**Auth → Hooks → Before Sign In**; a migration cannot register it.

## Running the migration test

`supabase/migrations.test.ts` applies every migration to a real Postgres and
asserts the constraints, the audit trigger, the seed data and the RLS policies.
It is part of the normal unit suite:

```bash
npm test                                  # whole suite
npx vitest run supabase/migrations.test.ts # just this file
```

No database is needed and nothing is installed: the test runs
[PGlite](https://pglite.dev) (Postgres compiled to WebAssembly) in memory, in
the Node environment — hence the `// @vitest-environment node` pragma at the
top of the file, which must stay. The whole file takes a few seconds.

The test globs `supabase/migrations/*.sql` at run time and applies them in
filename order, so a new migration is covered the moment it is added. Before
they run it creates the parts of a Supabase database the migrations assume:

- roles `anon`, `authenticated`, `service_role`, plus default privileges in
  `public` granting new tables to them (without this the table-level privilege
  check fails before RLS is ever reached);
- schema `auth` with a cut-down `auth.users(id, email)` holding two seed users,
  and `auth.uid()` / `auth.role()` / `auth.email()`, where `auth.uid()` reads
  `current_setting('request.jwt.claim.sub')` exactly as the real one does;
- schema `extensions` with `pgcrypto`, `uuid-ossp` and `citext` installed into
  it, and `extensions` on the search path;
- the `supabase_realtime` publication that migration 005 adds tables to.

If a future migration needs more of Supabase than that, extend `BOOTSTRAP_SQL`
in the test rather than working around it in an individual test.

## Applying migrations to a project

With the [Supabase CLI](https://supabase.com/docs/guides/cli) installed and the
project linked:

```bash
supabase link --project-ref <project-ref>   # once per machine
supabase db push                            # apply pending migrations
```

`db push` applies every file in `supabase/migrations/` that the remote
`supabase_migrations.schema_migrations` table has not recorded yet, each in its
own transaction, in filename order. Check first with:

```bash
supabase migration list    # local vs remote, side by side
```

New migrations get the next number in sequence and are never edited after they
have been pushed; correct a mistake with a follow-up migration. Migration 005
seeds data and is part of this sequence, so pushing to a project that already
has members will add a second set — it is written for a fresh project.

Supabase is not reachable from the development sandbox, so `db push` is run from
a machine that has the project credentials. The migration test above is what
proves the SQL is correct before it gets there.
