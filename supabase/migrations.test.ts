// @vitest-environment node
/**
 * Runs every SQL file in `supabase/migrations/` against a real Postgres and
 * asserts the resulting schema behaves.
 *
 * The database is PGlite — Postgres compiled to WebAssembly — running entirely
 * in memory, so there is nothing to install and nothing to connect to. Migration
 * files are globbed at run time and applied in filename order, so a migration
 * added later is picked up by this test automatically.
 *
 * What the harness has to fake, and why: the migrations are written for a
 * Supabase database, which arrives with a `auth` schema, an `auth.uid()`
 * helper, the `anon` / `authenticated` / `service_role` roles, a
 * `supabase_realtime` publication, a few extensions in an `extensions` schema,
 * and default privileges that grant every new table in `public` to the API
 * roles. `bootstrapSupabase()` below creates the minimum version of all of that.
 * Anything a migration is allowed to assume should be created there rather than
 * worked around in a test.
 *
 * Run with `npm test` (it is part of the normal unit suite); node environment is
 * required, hence the pragma above — it must not run in jsdom.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/** Every `*.sql` file in supabase/migrations, in filename (== apply) order. */
function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

/** A user id that exists in the stub `auth.users`, used as the acting user. */
const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';

/**
 * Everything Supabase provides before the first migration runs. Kept in one
 * place and deliberately minimal: if a future migration needs more of Supabase
 * (another schema, another role, another extension), add it here.
 */
const BOOTSTRAP_SQL = `
-- Roles. PostgREST connects as one of these; RLS policies name them with
-- "TO authenticated" / "TO anon", and SECURITY DEFINER helpers are often
-- granted to service_role.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

-- Supabase installs its extensions into a dedicated schema and puts that schema
-- on the search path, so migrations may call gen_random_bytes(), digest(),
-- uuid_generate_v4() etc. unqualified or as extensions.<fn>().
CREATE SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;
SET search_path TO public, extensions;

-- GoTrue's user table, cut down to the columns our migrations reference:
-- members/blocks/sprint_config have created_by/updated_by FKs to auth.users(id),
-- and auth hooks look users up by email.
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE
);
INSERT INTO auth.users (id, email) VALUES
  ('${ALICE}', 'alice@evenlydistributed.xyz'),
  ('${BOB}',   'bob@evenlydistributed.xyz');

-- auth.uid() reads the JWT subject claim from a session GUC, exactly as the
-- real one does. Tests set it with set_config('request.jwt.claim.sub', ...).
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- auth.role() and auth.email() are not used today but are cheap to provide and
-- are the other two helpers Supabase policies commonly reference.
CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT current_setting('role', true) $$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT email FROM auth.users WHERE id = auth.uid() $$;

GRANT USAGE ON SCHEMA public, extensions, auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO authenticated, service_role;

-- Supabase grants the API roles access to everything created in "public"
-- afterwards; without this, RLS would never be reached because the table-level
-- privilege check fails first.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- The realtime publication migration 005 adds tables to.
CREATE PUBLICATION supabase_realtime;
`;

let db: PGlite;
const applied: string[] = [];
let memberId: string;
/** The default "Team" board that 007 creates and attaches every pre-existing
 *  row (and every seeded auth.users row, as an owner) to. */
let teamBoardId: string;

/** Run `sql` as the given database role, then switch back. */
async function asRole<T>(role: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`SET ROLE ${role};`);
  try {
    return await fn();
  } finally {
    await db.exec('RESET ROLE;');
  }
}

/**
 * Run `fn` under `role` and assert the promise it returns rejects with a
 * message matching `matcher`.
 *
 * A statement that raises a SQL error (an RLS `WITH CHECK` violation, a
 * `RAISE EXCEPTION`, ...) aborts the rest of the *enclosing transaction* —
 * every following statement errors with "current transaction is aborted"
 * until a ROLLBACK. Catching the rejection in JS (e.g. with
 * `expect(...).rejects`) does not undo that at the database level. So this
 * brackets the attempt in a SAVEPOINT and rolls back to it afterwards
 * (which, as a side effect, also undoes `SET ROLE`), leaving the
 * transaction usable for whatever the test does next. Use this instead of
 * `asRole` + `expect(...).rejects` whenever more statements follow in the
 * same `rolledBack` block.
 */
async function expectRejects<T>(role: string, fn: () => Promise<T>, matcher: RegExp): Promise<void> {
  await db.exec('SAVEPOINT expect_rejects;');
  await db.exec(`SET ROLE ${role};`);
  try {
    await expect(fn()).rejects.toThrow(matcher);
  } finally {
    await db.exec('ROLLBACK TO SAVEPOINT expect_rejects;');
  }
}

/** Set (or clear, with null) the JWT subject claim auth.uid() reads. */
async function setUid(uid: string | null): Promise<void> {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
}

/** Run `fn` inside a transaction that is always rolled back. */
async function rolledBack(fn: () => Promise<void>): Promise<void> {
  await db.exec('BEGIN;');
  try {
    await fn();
  } finally {
    await db.exec('ROLLBACK;');
  }
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto, uuid_ossp, citext } });
  await db.exec(BOOTSTRAP_SQL);

  // Apply each migration on its own so a failure names the file that broke.
  for (const file of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
    applied.push(file);
  }

  const rows = await db.query<{ id: string }>(
    'SELECT id FROM members ORDER BY sort_order LIMIT 1',
  );
  memberId = rows.rows[0].id;

  const boards = await db.query<{ id: string }>(
    `SELECT id FROM boards WHERE name = 'Team' LIMIT 1`,
  );
  teamBoardId = boards.rows[0].id;
}, 30_000);

afterAll(async () => {
  await db?.close();
});

/** Insert a block, overriding any of the columns (including member_id/board_id). */
function insertBlock(over: Partial<Record<string, string>> = {}) {
  const b = {
    member_id: memberId,
    board_id: teamBoardId,
    title: 'Ship it',
    start_date: '2026-02-12',
    end_date: '2026-02-18',
    color: 'blue',
    ...over,
  };
  return db.query(
    `INSERT INTO blocks (member_id, board_id, title, start_date, end_date, color)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [b.member_id, b.board_id, b.title, b.start_date, b.end_date, b.color],
  );
}

/**
 * Insert a board the way the client does: `created_by` set to the caller and
 * the id read back with `RETURNING`. Ownership is granted by an AFTER INSERT
 * trigger, which runs after the `RETURNING` visibility check, so the boards
 * SELECT policy also admits `created_by = auth.uid()` (007) to keep this
 * pattern working.
 */
async function createBoard(name: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO boards (name, created_by) VALUES ($1, auth.uid()) RETURNING id`,
    [name],
  );
  return rows[0].id;
}

describe('migrations apply', () => {
  it('runs in the node environment, not jsdom', () => {
    // Guards the `@vitest-environment node` pragma at the top of the file: if it
    // is ever dropped this fails loudly instead of quietly booting Postgres
    // inside a jsdom sandbox.
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
  });

  it('applies every migration file in order', () => {
    expect(applied).toEqual(migrationFiles());
    expect(applied.length).toBeGreaterThanOrEqual(6);
    expect(applied[0]).toBe('001_create_tables.sql');
  });

  it('creates the three tables with RLS enabled', async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class
       WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
       ORDER BY relname`,
    );
    const byName = Object.fromEntries(rows.map(r => [r.relname, r.relrowsecurity]));
    for (const t of ['members', 'blocks', 'sprint_config']) {
      expect(byName[t], `${t} exists`).toBe(true);
    }
  });

  it('seeds 12 members and one sprint config row (005)', async () => {
    const members = await db.query<{ n: number }>('SELECT count(*)::int n FROM members');
    expect(members.rows[0].n).toBe(12);
    const config = await db.query<{ length_days: number; anchor_date: Date }>(
      'SELECT length_days, anchor_date FROM sprint_config',
    );
    expect(config.rows).toHaveLength(1);
    expect(config.rows[0].length_days).toBe(14);
  });

  it('adds all three tables to the supabase_realtime publication (005)', async () => {
    const { rows } = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' ORDER BY tablename`,
    );
    expect(rows.map(r => r.tablename)).toEqual(
      expect.arrayContaining(['blocks', 'members', 'sprint_config']),
    );
  });
});

describe('blocks constraints', () => {
  it('rejects a colour outside the palette', async () => {
    await expect(insertBlock({ color: 'chartreuse' })).rejects.toThrow(/blocks_color_valid/);
  });

  it('accepts every palette colour', async () => {
    await rolledBack(async () => {
      for (const color of ['blue', 'green', 'amber', 'red', 'purple', 'pink', 'teal', 'orange']) {
        await expect(insertBlock({ color })).resolves.toBeDefined();
      }
    });
  });

  it('rejects an empty or whitespace-only title', async () => {
    await expect(insertBlock({ title: '' })).rejects.toThrow(/blocks_title_not_blank/);
    await expect(insertBlock({ title: '   ' })).rejects.toThrow(/blocks_title_not_blank/);
  });

  it('rejects a title over 200 characters but accepts 200', async () => {
    await expect(insertBlock({ title: 'x'.repeat(201) })).rejects.toThrow(/blocks_title_length/);
    await rolledBack(async () => {
      await expect(insertBlock({ title: 'x'.repeat(200) })).resolves.toBeDefined();
    });
  });

  it('rejects end_date before start_date', async () => {
    await expect(
      insertBlock({ start_date: '2026-02-18', end_date: '2026-02-12' }),
    ).rejects.toThrow(/blocks_date_order/);
  });

  it('accepts a single-day block (end_date = start_date)', async () => {
    await rolledBack(async () => {
      await expect(
        insertBlock({ start_date: '2026-02-12', end_date: '2026-02-12' }),
      ).resolves.toBeDefined();
    });
  });

  it('rejects dates outside 1970-01-01 .. 2100-12-31', async () => {
    await expect(
      insertBlock({ start_date: '1969-12-31', end_date: '1970-01-02' }),
    ).rejects.toThrow(/blocks_date_range_sane/);
    await expect(
      insertBlock({ start_date: '2101-01-01', end_date: '2101-01-02' }),
    ).rejects.toThrow(/blocks_date_range_sane/);
  });

  it('cascades deletes from members', async () => {
    await rolledBack(async () => {
      await insertBlock();
      await db.query('DELETE FROM members WHERE id = $1', [memberId]);
      const { rows } = await db.query<{ n: number }>(
        'SELECT count(*)::int n FROM blocks WHERE member_id = $1',
        [memberId],
      );
      expect(rows[0].n).toBe(0);
    });
  });
});

describe('block tags (009)', () => {
  /** Insert a block with an explicit tags array. */
  function insertTagged(tags: string[] | null) {
    return db.query(
      `INSERT INTO blocks (member_id, board_id, title, start_date, end_date, color, tags)
       VALUES ($1, $2, 'Tagged', '2026-02-12', '2026-02-18', 'blue', $3) RETURNING id`,
      [memberId, teamBoardId, tags],
    );
  }

  it('defaults to an empty array and is NOT NULL', async () => {
    await rolledBack(async () => {
      const { rows } = await db.query<{ tags: string[] }>(
        `INSERT INTO blocks (member_id, board_id, title, start_date, end_date, color)
         VALUES ($1, $2, 'No tags', '2026-02-12', '2026-02-18', 'blue')
         RETURNING tags`,
        [memberId, teamBoardId],
      );
      expect(rows[0].tags).toEqual([]);
    });
    await expect(insertTagged(null)).rejects.toThrow(/null value|not-null/i);
  });

  it('accepts a normal set of tags and reads them back', async () => {
    await rolledBack(async () => {
      const { rows } = await db.query<{ tags: string[] }>(
        `INSERT INTO blocks (member_id, board_id, title, start_date, end_date, color, tags)
         VALUES ($1, $2, 'Tagged', '2026-02-12', '2026-02-18', 'blue', $3)
         RETURNING tags`,
        [memberId, teamBoardId, ['infra', 'API', 'q3 goals']],
      );
      expect(rows[0].tags).toEqual(['infra', 'API', 'q3 goals']);
    });
  });

  it('accepts ten tags but rejects eleven', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => `tag-${i}`);
    await rolledBack(async () => {
      await expect(insertTagged(ten)).resolves.toBeDefined();
    });
    await expect(insertTagged([...ten, 'tag-10'])).rejects.toThrow(/blocks_tags_count/);
  });

  it('rejects an empty or whitespace-only tag', async () => {
    await expect(insertTagged(['infra', ''])).rejects.toThrow(/blocks_tags_valid/);
    await expect(insertTagged(['   '])).rejects.toThrow(/blocks_tags_valid/);
  });

  it('rejects a tag over 30 characters but accepts 30', async () => {
    await expect(insertTagged(['x'.repeat(31)])).rejects.toThrow(/blocks_tags_valid/);
    await rolledBack(async () => {
      await expect(insertTagged(['x'.repeat(30)])).resolves.toBeDefined();
    });
  });

  it('rejects a tag containing a comma — the separator the UI types on', async () => {
    await expect(insertTagged(['infra,api'])).rejects.toThrow(/blocks_tags_valid/);
  });

  it('rejects a NULL element inside the array', async () => {
    await expect(insertTagged(['infra', null as unknown as string]))
      .rejects.toThrow(/blocks_tags_valid/);
  });

  it('tags_are_valid() answers for the edge cases directly', async () => {
    const { rows } = await db.query<{ empty: boolean; ok: boolean; bad: boolean }>(
      `SELECT tags_are_valid('{}'::text[]) AS empty,
              tags_are_valid(ARRAY['infra', 'Q3 goals']) AS ok,
              tags_are_valid(ARRAY['infra', ' ']) AS bad`,
    );
    expect(rows[0]).toEqual({ empty: true, ok: true, bad: false });
  });

  it('indexes tags with GIN so a containment filter can use it', async () => {
    const { rows } = await db.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'blocks' AND indexname = 'idx_blocks_tags'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/USING gin \(tags\)/);
  });
});

describe('members constraints', () => {
  it('rejects an empty or whitespace-only name', async () => {
    await expect(
      db.query('INSERT INTO members (name, sort_order, board_id) VALUES ($1, 99, $2)', [
        '  ',
        teamBoardId,
      ]),
    ).rejects.toThrow(/members_name_not_blank/);
  });

  it('rejects a name over 200 characters', async () => {
    await expect(
      db.query('INSERT INTO members (name, sort_order, board_id) VALUES ($1, 99, $2)', [
        'n'.repeat(201),
        teamBoardId,
      ]),
    ).rejects.toThrow(/members_name_length/);
  });
});

describe('sprint_config constraints', () => {
  // 007 re-keys this table on board_id (the integer `id` column is gone), so
  // every row is now addressed by its board rather than by `id = 1`.
  it('rejects length_days of 0 or 91', async () => {
    await expect(
      db.query('UPDATE sprint_config SET length_days = 0 WHERE board_id = $1', [teamBoardId]),
    ).rejects.toThrow(/sprint_config_length_days_range/);
    await expect(
      db.query('UPDATE sprint_config SET length_days = 91 WHERE board_id = $1', [teamBoardId]),
    ).rejects.toThrow(/sprint_config_length_days_range/);
  });

  it('accepts the UI maximum of 42 days', async () => {
    await rolledBack(async () => {
      await db.query('UPDATE sprint_config SET length_days = 42 WHERE board_id = $1', [teamBoardId]);
      const { rows } = await db.query<{ length_days: number }>(
        'SELECT length_days FROM sprint_config WHERE board_id = $1',
        [teamBoardId],
      );
      expect(rows[0].length_days).toBe(42);
    });
  });

  it('stays one row per board: a duplicate board_id is rejected', async () => {
    await expect(
      db.query(
        `INSERT INTO sprint_config (board_id, anchor_date, length_days) VALUES ($1, '2026-01-01', 14)`,
        [teamBoardId],
      ),
    ).rejects.toThrow(/sprint_config_pkey|duplicate key/);
  });

  it('gets a fresh row per board (one row per board, not a single global row)', async () => {
    await rolledBack(async () => {
      const { rows } = await db.query<{ id: string }>(`INSERT INTO boards (name) VALUES ('Another') RETURNING id`);
      const otherBoardId = rows[0].id;
      // The trg_boards_default_sprint_config trigger (007) creates this row.
      const config = await db.query<{ n: number }>(
        'SELECT count(*)::int n FROM sprint_config WHERE board_id = $1',
        [otherBoardId],
      );
      expect(config.rows[0].n).toBe(1);
      const total = await db.query<{ n: number }>('SELECT count(*)::int n FROM sprint_config');
      expect(total.rows[0].n).toBe(2);
    });
  });
});

describe('audit trigger (003)', () => {
  it('bumps updated_at and records auth.uid() as updated_by on update', async () => {
    await rolledBack(async () => {
      const before = await db.query<{ updated_at: Date }>(
        'SELECT updated_at FROM members WHERE id = $1',
        [memberId],
      );
      await setUid(ALICE);
      await db.query(`UPDATE members SET name = 'Renamed' WHERE id = $1`, [memberId]);
      const after = await db.query<{ updated_at: Date; updated_by: string }>(
        'SELECT updated_at, updated_by FROM members WHERE id = $1',
        [memberId],
      );
      expect(new Date(after.rows[0].updated_at).getTime()).toBeGreaterThan(
        new Date(before.rows[0].updated_at).getTime(),
      );
      expect(after.rows[0].updated_by).toBe(ALICE);
      await setUid(null);
    });
  });

  it('leaves updated_by null when there is no authenticated user', async () => {
    await rolledBack(async () => {
      await setUid(null);
      await db.query(`UPDATE members SET name = 'Anon edit' WHERE id = $1`, [memberId]);
      const { rows } = await db.query<{ updated_by: string | null }>(
        'SELECT updated_by FROM members WHERE id = $1',
        [memberId],
      );
      expect(rows[0].updated_by).toBeNull();
    });
  });
});

describe('sign-in hook (004)', () => {
  it('rejects emails outside the allowed domain and passes the event through otherwise', async () => {
    const reject = await db.query<{ r: { decision?: string } }>(
      `SELECT public.check_email_domain(jsonb_build_object('claims', jsonb_build_object('email', 'someone@example.com'))) r`,
    );
    expect(reject.rows[0].r.decision).toBe('reject');

    const pass = await db.query<{ r: { claims?: { email?: string } } }>(
      `SELECT public.check_email_domain(jsonb_build_object('claims', jsonb_build_object('email', 'alice@evenlydistributed.xyz'))) r`,
    );
    expect(pass.rows[0].r.claims?.email).toBe('alice@evenlydistributed.xyz');
  });
});

describe('row level security (002)', () => {
  // The policies key off the *role*, not the user id: every authenticated user
  // sees the whole board (USING (true)), and anon has no policy at all. So the
  // meaningful pair is `authenticated` vs `anon`; a uid is set anyway to prove
  // auth.uid() resolves under a non-superuser role, which is what the audit
  // trigger depends on.
  it('lets an authenticated user read the board', async () => {
    await setUid(ALICE);
    const n = await asRole('authenticated', async () => {
      const { rows } = await db.query<{ n: number }>('SELECT count(*)::int n FROM members');
      return rows[0].n;
    });
    expect(n).toBe(12);
    await setUid(null);
  });

  it('shows an anonymous visitor nothing', async () => {
    await setUid(null);
    const counts = await asRole('anon', async () => {
      const members = await db.query<{ n: number }>('SELECT count(*)::int n FROM members');
      const config = await db.query<{ n: number }>('SELECT count(*)::int n FROM sprint_config');
      return [members.rows[0].n, config.rows[0].n];
    });
    expect(counts).toEqual([0, 0]);
  });

  it('does not let anyone delete the sprint config directly', async () => {
    // There is no DELETE policy on sprint_config (007): the row lives and dies
    // with its board. Even an owner's DELETE silently affects nothing.
    await rolledBack(async () => {
      await setUid(ALICE);
      await asRole('authenticated', async () => {
        await db.query('DELETE FROM sprint_config WHERE board_id = $1', [teamBoardId]);
      });
      const { rows } = await db.query<{ n: number }>('SELECT count(*)::int n FROM sprint_config');
      expect(rows[0].n).toBe(1);
    });
  });
});

describe('boards & membership RLS (007)', () => {
  // 007's data migration attached every existing auth.users row to the
  // default "Team" board as an *owner* (see the DO block under "4. Data
  // migration"), so both alice and bob start out as owners of Team.

  it('lets alice see the Team board and its 12 members', async () => {
    await rolledBack(async () => {
      await setUid(ALICE);
      const { boards, memberCount } = await asRole('authenticated', async () => {
        const b = await db.query<{ id: string }>('SELECT id FROM boards');
        const m = await db.query<{ n: number }>(
          'SELECT count(*)::int n FROM members WHERE board_id = $1',
          [teamBoardId],
        );
        return { boards: b.rows, memberCount: m.rows[0].n };
      });
      expect(boards.map(r => r.id)).toContain(teamBoardId);
      expect(memberCount).toBe(12);
      await setUid(null);
    });
  });

  it('makes the creator of a new board its owner and gives it a sprint_config row', async () => {
    await rolledBack(async () => {
      await setUid(ALICE);
      const boardId = await asRole('authenticated', () => createBoard('Side Project'));

      const owner = await db.query<{ role: string }>(
        'SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2',
        [boardId, ALICE],
      );
      expect(owner.rows).toHaveLength(1);
      expect(owner.rows[0].role).toBe('owner');

      const config = await db.query<{ length_days: number }>(
        'SELECT length_days FROM sprint_config WHERE board_id = $1',
        [boardId],
      );
      expect(config.rows).toHaveLength(1);
      expect(config.rows[0].length_days).toBe(14);
      await setUid(null);
    });
  });

  it('hides a board bob is not on, along with its members, and rejects his insert into it', async () => {
    await rolledBack(async () => {
      await setUid(ALICE);
      const { boardId, otherMemberId } = await asRole('authenticated', async () => {
        const boardId = await createBoard('Alice Only');
        const member = await db.query<{ id: string }>(
          `INSERT INTO members (name, sort_order, board_id) VALUES ('Ghost', 1, $1) RETURNING id`,
          [boardId],
        );
        return { boardId, otherMemberId: member.rows[0].id };
      });

      await setUid(BOB);
      const { boards, members } = await asRole('authenticated', async () => {
        const b = await db.query('SELECT id FROM boards WHERE id = $1', [boardId]);
        const m = await db.query('SELECT id FROM members WHERE board_id = $1', [boardId]);
        return { boards: b.rows, members: m.rows };
      });
      expect(boards).toHaveLength(0);
      expect(members).toHaveLength(0);

      await expectRejects(
        'authenticated',
        () => insertBlock({ member_id: otherMemberId, board_id: boardId }),
        /row-level security|violates row-level/,
      );
      await setUid(null);
    });
  });

  describe('add_board_member_by_email', () => {
    it('rejects a non-owner, succeeds for the owner case-insensitively, and rejects an unknown email', async () => {
      await rolledBack(async () => {
        await setUid(ALICE);
        const boardId = await asRole('authenticated', () => createBoard('Invite Test'));

        await setUid(BOB);
        await expectRejects(
          'authenticated',
          () =>
            db.query(
              `SELECT * FROM add_board_member_by_email($1, 'bob@evenlydistributed.xyz', 'editor')`,
              [boardId],
            ),
          /Only board owners can add members/,
        );

        await setUid(ALICE);
        await asRole('authenticated', async () => {
          const { rows } = await db.query<{ role: string; user_id: string }>(
            `SELECT * FROM add_board_member_by_email($1, 'BOB@EvenlyDistributed.XYZ', 'editor')`,
            [boardId],
          );
          expect(rows[0].role).toBe('editor');
          expect(rows[0].user_id).toBe(BOB);
        });

        await expectRejects(
          'authenticated',
          () =>
            db.query(
              `SELECT * FROM add_board_member_by_email($1, 'nobody@evenlydistributed.xyz', 'editor')`,
              [boardId],
            ),
          /No account found/,
        );
        await setUid(null);
      });
    });
  });

  it('refuses to remove the last owner of a board', async () => {
    await rolledBack(async () => {
      await setUid(ALICE);
      const boardId = await asRole('authenticated', () => createBoard('Solo'));

      await expectRejects(
        'authenticated',
        () => db.query('DELETE FROM board_members WHERE board_id = $1 AND user_id = $2', [boardId, ALICE]),
        /must keep at least one owner/,
      );
      await setUid(null);
    });
  });

  it('rejects a block whose member belongs to a different board (composite FK)', async () => {
    await rolledBack(async () => {
      const { rows } = await db.query<{ id: string }>(`INSERT INTO boards (name) VALUES ('Other') RETURNING id`);
      const otherBoardId = rows[0].id;
      // memberId is on the Team board; pairing it with a different board_id
      // must fail blocks_member_same_board, not silently attach the block.
      await expect(insertBlock({ board_id: otherBoardId })).rejects.toThrow(
        /blocks_member_same_board|violates foreign key/,
      );
    });
  });

  it('cascades a board delete to its members, blocks, sprint_config, and board_members', async () => {
    await rolledBack(async () => {
      await setUid(ALICE);
      const { boardId, doomedMemberId } = await asRole('authenticated', async () => {
        const boardId = await createBoard('Doomed');
        const member = await db.query<{ id: string }>(
          `INSERT INTO members (name, sort_order, board_id) VALUES ('Temp', 1, $1) RETURNING id`,
          [boardId],
        );
        return { boardId, doomedMemberId: member.rows[0].id };
      });
      await insertBlock({ member_id: doomedMemberId, board_id: boardId });

      await db.query('DELETE FROM boards WHERE id = $1', [boardId]);

      const [members, blocks, config, boardMembers] = await Promise.all([
        db.query<{ n: number }>('SELECT count(*)::int n FROM members WHERE board_id = $1', [boardId]),
        db.query<{ n: number }>('SELECT count(*)::int n FROM blocks WHERE board_id = $1', [boardId]),
        db.query<{ n: number }>('SELECT count(*)::int n FROM sprint_config WHERE board_id = $1', [boardId]),
        db.query<{ n: number }>('SELECT count(*)::int n FROM board_members WHERE board_id = $1', [boardId]),
      ]);
      expect(members.rows[0].n).toBe(0);
      expect(blocks.rows[0].n).toBe(0);
      expect(config.rows[0].n).toBe(0);
      expect(boardMembers.rows[0].n).toBe(0);
      await setUid(null);
    });
  });
});

describe('ics_tokens (008)', () => {
  it('lets alice mint a token for a member on her board and select it back', async () => {
    await rolledBack(async () => {
      await setUid(ALICE);
      const token = await asRole('authenticated', async () => {
        const { rows } = await db.query<{ token: string }>(
          `INSERT INTO ics_tokens (member_id, created_by) VALUES ($1, $2) RETURNING token`,
          [memberId, ALICE],
        );
        return rows[0].token;
      });
      const seen = await asRole('authenticated', async () => {
        const { rows } = await db.query('SELECT token FROM ics_tokens WHERE token = $1', [token]);
        return rows;
      });
      expect(seen).toHaveLength(1);
      await setUid(null);
    });
  });

  it("hides alice's token from bob", async () => {
    await rolledBack(async () => {
      await setUid(ALICE);
      const token = await asRole('authenticated', async () => {
        const { rows } = await db.query<{ token: string }>(
          `INSERT INTO ics_tokens (member_id, created_by) VALUES ($1, $2) RETURNING token`,
          [memberId, ALICE],
        );
        return rows[0].token;
      });

      await setUid(BOB);
      const seen = await asRole('authenticated', async () => {
        const { rows } = await db.query('SELECT token FROM ics_tokens WHERE token = $1', [token]);
        return rows;
      });
      expect(seen).toHaveLength(0);
      await setUid(null);
    });
  });

  it('cascades token deletion when its member is deleted', async () => {
    await rolledBack(async () => {
      await setUid(ALICE);
      const localMemberId = await asRole('authenticated', async () => {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO members (name, sort_order, board_id) VALUES ('Temp', 99, $1) RETURNING id`,
          [teamBoardId],
        );
        return rows[0].id;
      });
      await db.query('INSERT INTO ics_tokens (member_id, created_by) VALUES ($1, $2)', [
        localMemberId,
        ALICE,
      ]);

      await db.query('DELETE FROM members WHERE id = $1', [localMemberId]);

      const { rows } = await db.query<{ n: number }>(
        'SELECT count(*)::int n FROM ics_tokens WHERE member_id = $1',
        [localMemberId],
      );
      expect(rows[0].n).toBe(0);
      await setUid(null);
    });
  });
});
