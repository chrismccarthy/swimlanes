-- Enable RLS on all tables
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sprint_config ENABLE ROW LEVEL SECURITY;

-- Members: full CRUD for authenticated users
CREATE POLICY "Authenticated users can select members"
  ON members FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert members"
  ON members FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update members"
  ON members FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete members"
  ON members FOR DELETE TO authenticated USING (true);

-- Blocks: full CRUD for authenticated users
CREATE POLICY "Authenticated users can select blocks"
  ON blocks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert blocks"
  ON blocks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update blocks"
  ON blocks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete blocks"
  ON blocks FOR DELETE TO authenticated USING (true);

-- Sprint config: SELECT + UPDATE only (seeded row, never created/removed by users)
CREATE POLICY "Authenticated users can select sprint_config"
  ON sprint_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can update sprint_config"
  ON sprint_config FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
