-- Generic trigger function for updated_at / updated_by
CREATE OR REPLACE FUNCTION set_updated_fields()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply to members
CREATE TRIGGER trg_members_updated
  BEFORE UPDATE ON members
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_fields();

-- Apply to blocks
CREATE TRIGGER trg_blocks_updated
  BEFORE UPDATE ON blocks
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_fields();

-- Apply to sprint_config
CREATE TRIGGER trg_sprint_config_updated
  BEFORE UPDATE ON sprint_config
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_fields();
