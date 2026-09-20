-- Multi-team boards.
--
-- Before this migration the schema assumed one team: a single `members` list,
-- a single `blocks` table and one `sprint_config` row pinned to `id = 1`.
-- This introduces `boards` so one deployment can host many teams, each with
-- its own members, blocks and sprint settings, with access controlled by
-- `board_members` rather than by "is authenticated".
--
-- Everything here is written to be re-runnable where that is cheap
-- (`if not exists`, `drop ... if exists`, `on conflict do nothing`).

-- ---------------------------------------------------------------------------
-- 1. boards
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS boards (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL CHECK (char_length(btrim(name)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        REFERENCES auth.users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        REFERENCES auth.users(id)
);

-- Same version-token trigger the other tables use (migration 003), so
-- `updated_at` stays usable for optimistic concurrency on renames.
DROP TRIGGER IF EXISTS trg_boards_updated ON boards;
CREATE TRIGGER trg_boards_updated
  BEFORE UPDATE ON boards
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_fields();

-- ---------------------------------------------------------------------------
-- 2. board_members — who may see and edit a board
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS board_members (
  board_id   uuid        NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('owner', 'editor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, user_id)
);

-- "which boards am I on?" is the hottest query in the app (the board switcher).
CREATE INDEX IF NOT EXISTS idx_board_members_user_id ON board_members(user_id);

-- ---------------------------------------------------------------------------
-- 3. Attach the existing tables to a board
-- ---------------------------------------------------------------------------

ALTER TABLE members ADD COLUMN IF NOT EXISTS board_id uuid REFERENCES boards(id) ON DELETE CASCADE;
ALTER TABLE blocks  ADD COLUMN IF NOT EXISTS board_id uuid REFERENCES boards(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_members_board_id ON members(board_id);
CREATE INDEX IF NOT EXISTS idx_blocks_board_id  ON blocks(board_id);

-- sprint_config stops being a single row: one row per board, keyed by board.
ALTER TABLE sprint_config DROP CONSTRAINT IF EXISTS sprint_config_single_row;
ALTER TABLE sprint_config ADD COLUMN IF NOT EXISTS board_id uuid REFERENCES boards(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. Data migration — adopt everything that exists into one default board
-- ---------------------------------------------------------------------------
--
-- Note for a brand-new deployment: migration 005 seeds members and a sprint
-- config before any user has signed in, so the default board below is created
-- with no members. Add the first owner with
--   INSERT INTO board_members (board_id, user_id, role)
--   SELECT id, '<auth.users.id>', 'owner' FROM boards;

DO $$
DECLARE
  v_board_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM members       WHERE board_id IS NULL)
     OR EXISTS (SELECT 1 FROM blocks        WHERE board_id IS NULL)
     OR EXISTS (SELECT 1 FROM sprint_config WHERE board_id IS NULL)
  THEN
    -- Re-run safety: reuse the board a previous run created.
    SELECT id INTO v_board_id FROM boards ORDER BY created_at, id LIMIT 1;
    IF v_board_id IS NULL THEN
      INSERT INTO boards (name) VALUES ('Team') RETURNING id INTO v_board_id;
    END IF;

    UPDATE members       SET board_id = v_board_id WHERE board_id IS NULL;
    UPDATE blocks        SET board_id = v_board_id WHERE board_id IS NULL;
    UPDATE sprint_config SET board_id = v_board_id WHERE board_id IS NULL;

    -- Everyone who already had access (i.e. everyone who could sign in) keeps it.
    INSERT INTO board_members (board_id, user_id, role)
      SELECT v_board_id, u.id, 'owner' FROM auth.users u
      ON CONFLICT (board_id, user_id) DO NOTHING;
  END IF;
END $$;

-- Re-key sprint_config on board_id and drop the old integer id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sprint_config' AND column_name = 'id'
  ) THEN
    -- Collapse any duplicates before board_id can become the primary key.
    DELETE FROM sprint_config a
      USING sprint_config b
      WHERE a.board_id = b.board_id AND a.id > b.id;
    ALTER TABLE sprint_config DROP CONSTRAINT IF EXISTS sprint_config_pkey;
    ALTER TABLE sprint_config DROP COLUMN id;
  END IF;
END $$;

ALTER TABLE sprint_config ALTER COLUMN board_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sprint_config'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE sprint_config ADD PRIMARY KEY (board_id);
  END IF;
END $$;

-- Now that every row has a board, make the link mandatory.
ALTER TABLE members ALTER COLUMN board_id SET NOT NULL;
ALTER TABLE blocks  ALTER COLUMN board_id SET NOT NULL;

-- A block's board and its member's board must agree, or a client that is on
-- two boards could file work against a lane the other team owns. The RLS
-- policies below only look at `board_id`, so this is what makes that safe.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_id_board_key') THEN
    ALTER TABLE members ADD CONSTRAINT members_id_board_key UNIQUE (id, board_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blocks_member_same_board') THEN
    ALTER TABLE blocks ADD CONSTRAINT blocks_member_same_board
      FOREIGN KEY (member_id, board_id) REFERENCES members(id, board_id) ON DELETE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Membership helpers
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER so the policies below can read `board_members` without
-- recursing into that table's own RLS. STABLE so Postgres may cache the
-- result within a statement.

CREATE OR REPLACE FUNCTION is_board_member(p_board_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM board_members bm
    WHERE bm.board_id = p_board_id AND bm.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION is_board_owner(p_board_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM board_members bm
    WHERE bm.board_id = p_board_id AND bm.user_id = auth.uid() AND bm.role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- 6. Triggers that keep a board well-formed
-- ---------------------------------------------------------------------------

-- Whoever creates a board owns it. SECURITY DEFINER because the insert policy
-- on board_members requires ownership, which the creator does not have yet.
CREATE OR REPLACE FUNCTION add_board_creator_as_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO board_members (board_id, user_id, role)
      VALUES (NEW.id, auth.uid(), 'owner')
      ON CONFLICT (board_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_boards_add_creator_owner ON boards;
CREATE TRIGGER trg_boards_add_creator_owner
  AFTER INSERT ON boards
  FOR EACH ROW
  EXECUTE FUNCTION add_board_creator_as_owner();

-- Every board needs sprint settings from the moment it exists, so the client
-- never has to special-case a board with no config.
CREATE OR REPLACE FUNCTION create_board_sprint_config()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO sprint_config (board_id, anchor_date, length_days)
    VALUES (NEW.id, current_date, 14)
    ON CONFLICT (board_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_boards_default_sprint_config ON boards;
CREATE TRIGGER trg_boards_default_sprint_config
  AFTER INSERT ON boards
  FOR EACH ROW
  EXECUTE FUNCTION create_board_sprint_config();

-- A board must always keep at least one owner, or nobody could ever manage it
-- again. Guards both removal and demotion.
CREATE OR REPLACE FUNCTION prevent_last_owner_removal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_losing_owner boolean;
BEGIN
  -- Deleting the board itself cascades to every membership; the parent row is
  -- already gone by then, so let those deletes through.
  IF NOT EXISTS (SELECT 1 FROM boards WHERE id = OLD.board_id) THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_losing_owner := OLD.role = 'owner';
  ELSE
    v_losing_owner := OLD.role = 'owner' AND NEW.role <> 'owner';
  END IF;

  IF v_losing_owner AND NOT EXISTS (
    SELECT 1 FROM board_members bm
    WHERE bm.board_id = OLD.board_id AND bm.role = 'owner' AND bm.user_id <> OLD.user_id
  ) THEN
    RAISE EXCEPTION 'A board must keep at least one owner';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_board_members_keep_owner ON board_members;
CREATE TRIGGER trg_board_members_keep_owner
  BEFORE DELETE OR UPDATE OF role ON board_members
  FOR EACH ROW
  EXECUTE FUNCTION prevent_last_owner_removal();

-- ---------------------------------------------------------------------------
-- 7. RLS — replace the blanket "any authenticated user" policies from 002
-- ---------------------------------------------------------------------------

ALTER TABLE boards        ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can select members"       ON members;
DROP POLICY IF EXISTS "Authenticated users can insert members"       ON members;
DROP POLICY IF EXISTS "Authenticated users can update members"       ON members;
DROP POLICY IF EXISTS "Authenticated users can delete members"       ON members;
DROP POLICY IF EXISTS "Authenticated users can select blocks"        ON blocks;
DROP POLICY IF EXISTS "Authenticated users can insert blocks"        ON blocks;
DROP POLICY IF EXISTS "Authenticated users can update blocks"        ON blocks;
DROP POLICY IF EXISTS "Authenticated users can delete blocks"        ON blocks;
DROP POLICY IF EXISTS "Authenticated users can select sprint_config" ON sprint_config;
DROP POLICY IF EXISTS "Authenticated users can update sprint_config" ON sprint_config;

-- boards: visible to its members, created by anyone signed in, managed by owners.
-- The creator is also allowed through directly: the ownership row is written by
-- an AFTER INSERT trigger, and Postgres checks the SELECT policy for
-- `INSERT ... RETURNING` before that trigger runs, so without this clause a
-- creator could not read back the board they just made.
DROP POLICY IF EXISTS "Board members can select boards" ON boards;
CREATE POLICY "Board members can select boards"
  ON boards FOR SELECT TO authenticated
  USING (is_board_member(id) OR created_by = auth.uid());
DROP POLICY IF EXISTS "Authenticated users can insert boards" ON boards;
CREATE POLICY "Authenticated users can insert boards"
  ON boards FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Board owners can update boards" ON boards;
CREATE POLICY "Board owners can update boards"
  ON boards FOR UPDATE TO authenticated USING (is_board_owner(id)) WITH CHECK (is_board_owner(id));
DROP POLICY IF EXISTS "Board owners can delete boards" ON boards;
CREATE POLICY "Board owners can delete boards"
  ON boards FOR DELETE TO authenticated USING (is_board_owner(id));

-- board_members: the roster is visible to the board, editable by its owners.
DROP POLICY IF EXISTS "Board members can select board_members" ON board_members;
CREATE POLICY "Board members can select board_members"
  ON board_members FOR SELECT TO authenticated USING (is_board_member(board_id));
DROP POLICY IF EXISTS "Board owners can insert board_members" ON board_members;
CREATE POLICY "Board owners can insert board_members"
  ON board_members FOR INSERT TO authenticated WITH CHECK (is_board_owner(board_id));
DROP POLICY IF EXISTS "Board owners can delete board_members" ON board_members;
CREATE POLICY "Board owners can delete board_members"
  ON board_members FOR DELETE TO authenticated USING (is_board_owner(board_id));

-- members / blocks / sprint_config: membership of the owning board decides.
DROP POLICY IF EXISTS "Board members can select members" ON members;
CREATE POLICY "Board members can select members"
  ON members FOR SELECT TO authenticated USING (is_board_member(board_id));
DROP POLICY IF EXISTS "Board members can insert members" ON members;
CREATE POLICY "Board members can insert members"
  ON members FOR INSERT TO authenticated WITH CHECK (is_board_member(board_id));
DROP POLICY IF EXISTS "Board members can update members" ON members;
CREATE POLICY "Board members can update members"
  ON members FOR UPDATE TO authenticated USING (is_board_member(board_id)) WITH CHECK (is_board_member(board_id));
DROP POLICY IF EXISTS "Board members can delete members" ON members;
CREATE POLICY "Board members can delete members"
  ON members FOR DELETE TO authenticated USING (is_board_member(board_id));

DROP POLICY IF EXISTS "Board members can select blocks" ON blocks;
CREATE POLICY "Board members can select blocks"
  ON blocks FOR SELECT TO authenticated USING (is_board_member(board_id));
DROP POLICY IF EXISTS "Board members can insert blocks" ON blocks;
CREATE POLICY "Board members can insert blocks"
  ON blocks FOR INSERT TO authenticated WITH CHECK (is_board_member(board_id));
DROP POLICY IF EXISTS "Board members can update blocks" ON blocks;
CREATE POLICY "Board members can update blocks"
  ON blocks FOR UPDATE TO authenticated USING (is_board_member(board_id)) WITH CHECK (is_board_member(board_id));
DROP POLICY IF EXISTS "Board members can delete blocks" ON blocks;
CREATE POLICY "Board members can delete blocks"
  ON blocks FOR DELETE TO authenticated USING (is_board_member(board_id));

DROP POLICY IF EXISTS "Board members can select sprint_config" ON sprint_config;
CREATE POLICY "Board members can select sprint_config"
  ON sprint_config FOR SELECT TO authenticated USING (is_board_member(board_id));
DROP POLICY IF EXISTS "Board members can insert sprint_config" ON sprint_config;
CREATE POLICY "Board members can insert sprint_config"
  ON sprint_config FOR INSERT TO authenticated WITH CHECK (is_board_member(board_id));
DROP POLICY IF EXISTS "Board members can update sprint_config" ON sprint_config;
CREATE POLICY "Board members can update sprint_config"
  ON sprint_config FOR UPDATE TO authenticated USING (is_board_member(board_id)) WITH CHECK (is_board_member(board_id));
-- No DELETE policy on sprint_config: the row is created with its board and
-- removed by the cascade when the board goes; nobody deletes it directly.
DROP POLICY IF EXISTS "Board members can delete sprint_config" ON sprint_config;

-- ---------------------------------------------------------------------------
-- 8. Reading and writing the roster from a client
-- ---------------------------------------------------------------------------

-- Clients cannot read auth.users, so expose just the columns the Board
-- settings modal needs. The view runs with its owner's rights (so it may join
-- auth.users) and re-applies the membership check itself.
CREATE OR REPLACE VIEW board_members_view AS
  SELECT bm.board_id,
         bm.user_id,
         u.email::text AS email,
         bm.role
  FROM board_members bm
  JOIN auth.users u ON u.id = bm.user_id
  WHERE is_board_member(bm.board_id);

GRANT SELECT ON board_members_view TO authenticated;

-- Invite by email: the only way a client can turn an address into a user id.
CREATE OR REPLACE FUNCTION add_board_member_by_email(
  p_board_id uuid,
  p_email    text,
  p_role     text DEFAULT 'editor'
)
RETURNS board_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_row     board_members;
BEGIN
  IF NOT is_board_owner(p_board_id) THEN
    RAISE EXCEPTION 'Only board owners can add members';
  END IF;

  IF p_role NOT IN ('owner', 'editor') THEN
    RAISE EXCEPTION 'Unknown role: %', p_role;
  END IF;

  SELECT u.id INTO v_user_id
    FROM auth.users u
    WHERE lower(u.email) = lower(btrim(p_email))
    LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No account found for %. They need to sign in once first.', btrim(p_email);
  END IF;

  INSERT INTO board_members (board_id, user_id, role)
    VALUES (p_board_id, v_user_id, p_role)
    ON CONFLICT (board_id, user_id) DO UPDATE SET role = EXCLUDED.role
    RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Realtime
-- ---------------------------------------------------------------------------
--
-- The client subscribes with `board_id=eq.<id>` filters. A DELETE payload only
-- carries the replica identity, which by default is the primary key alone —
-- that has no board_id, so the filter would drop every remote delete. FULL
-- replica identity puts the whole old row in the payload instead.
ALTER TABLE members REPLICA IDENTITY FULL;
ALTER TABLE blocks  REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE boards;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE board_members;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
