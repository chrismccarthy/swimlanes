-- Seed 12 members with staggered float sort_order values.
-- created_by / updated_by are NULL for seed rows (no user performed this action).
INSERT INTO members (name, sort_order) VALUES
  ('Alex',      1.0),
  ('Steve',     2.0),
  ('Simon',     3.0),
  ('Mat',       4.0),
  ('Dimi',      5.0),
  ('Barnaby',   6.0),
  ('Rachel',    7.0),
  ('Evita',     8.0),
  ('Giovanna',  9.0),
  ('Chris',    10.0),
  ('Swells',   11.0),
  ('Tristan',  12.0);

-- Seed sprint config: anchor 12 Feb 2026, 14-day sprints
INSERT INTO sprint_config (anchor_date, length_days) VALUES
  ('2026-02-12', 14);

-- No seed blocks

-- Enable Realtime for all three tables
ALTER PUBLICATION supabase_realtime ADD TABLE members;
ALTER PUBLICATION supabase_realtime ADD TABLE blocks;
ALTER PUBLICATION supabase_realtime ADD TABLE sprint_config;
