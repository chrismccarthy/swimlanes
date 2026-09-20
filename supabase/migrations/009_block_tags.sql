-- Block tags: a small set of free-text labels per block, so a lane can be read
-- by theme (project, type of work) instead of by colour alone.
--
-- Stored as a text[] rather than a join table on purpose: tags are a display
-- and filtering aid, they are always read with their block, and the whole set
-- is rewritten whenever a block is saved. A GIN index keeps `tags && '{...}'`
-- and `tags @> '{...}'` cheap should the filter ever move server-side.

ALTER TABLE blocks
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

-- Element-level rules, as one IMMUTABLE helper so the CHECK below reads as a
-- single rule and the same rule can be reused (e.g. by a future import path).
-- Every element must be non-blank once trimmed, at most 30 characters, and
-- comma-free — commas are the separator the tag input types on, and letting one
-- into a stored tag would make a tag that can never be typed again.
-- `bool_and` over an empty array yields NULL, hence the coalesce: a block with
-- no tags is valid. Catalog-qualified so the function does not depend on the
-- caller's search_path.
CREATE OR REPLACE FUNCTION tags_are_valid(tags text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(
    pg_catalog.bool_and(
      t IS NOT NULL
      AND pg_catalog.btrim(t) <> ''
      AND pg_catalog.length(pg_catalog.btrim(t)) <= 30
      AND pg_catalog.strpos(t, ',') = 0
    ),
    true
  )
  FROM pg_catalog.unnest(tags) AS t;
$$;

COMMENT ON FUNCTION tags_are_valid(text[]) IS
  'True when every element is a non-blank, comma-free tag of at most 30 characters.';

-- The column is brand new, so no existing row can violate either check; they
-- are still added NOT VALID + VALIDATE to match the house style of 006 and to
-- keep the ADD step's lock short on a large table.
ALTER TABLE blocks
  ADD CONSTRAINT blocks_tags_count
  CHECK (cardinality(tags) <= 10)
  NOT VALID;
ALTER TABLE blocks VALIDATE CONSTRAINT blocks_tags_count;

ALTER TABLE blocks
  ADD CONSTRAINT blocks_tags_valid
  CHECK (tags_are_valid(tags))
  NOT VALID;
ALTER TABLE blocks VALIDATE CONSTRAINT blocks_tags_valid;

CREATE INDEX IF NOT EXISTS idx_blocks_tags ON blocks USING GIN (tags);
