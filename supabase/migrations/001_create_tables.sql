-- Members table
CREATE TABLE members (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  sort_order  double precision NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        REFERENCES auth.users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        REFERENCES auth.users(id)
);

-- Blocks table
CREATE TABLE blocks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   uuid        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title       text        NOT NULL,
  start_date  date        NOT NULL,
  end_date    date        NOT NULL,
  color       text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        REFERENCES auth.users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        REFERENCES auth.users(id),
  CONSTRAINT blocks_date_order CHECK (end_date >= start_date)
);

-- Sprint config (enforced single-row)
CREATE TABLE sprint_config (
  id          integer     PRIMARY KEY DEFAULT 1,
  anchor_date date        NOT NULL,
  length_days integer     NOT NULL CHECK (length_days > 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        REFERENCES auth.users(id),
  CONSTRAINT sprint_config_single_row CHECK (id = 1)
);

-- Indexes
CREATE INDEX idx_blocks_member_id ON blocks(member_id);
CREATE INDEX idx_members_sort_order ON members(sort_order);
