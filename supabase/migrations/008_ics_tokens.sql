-- Subscription tokens for the calendar feed served by the `ics` edge function.
--
-- A token is a capability: whoever holds the URL can read that member's blocks
-- without signing in, which is exactly what a calendar client needs. Tokens are
-- therefore never listed to anyone but the user who created them, and the edge
-- function reads this table with the service role key (bypassing RLS) because
-- the request from a calendar client carries no session.

CREATE TABLE ics_tokens (
  token       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   uuid        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_by  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ics_tokens_member_id ON ics_tokens(member_id);
CREATE INDEX idx_ics_tokens_created_by ON ics_tokens(created_by);

ALTER TABLE ics_tokens ENABLE ROW LEVEL SECURITY;

-- Users may mint tokens for themselves and see (or revoke) the ones they minted.
-- Nobody may read anybody else's: a token is a bearer credential.
CREATE POLICY "Users can insert their own ics tokens"
  ON ics_tokens FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "Users can select their own ics tokens"
  ON ics_tokens FOR SELECT TO authenticated USING (created_by = auth.uid());
CREATE POLICY "Users can delete their own ics tokens"
  ON ics_tokens FOR DELETE TO authenticated USING (created_by = auth.uid());
