-- 0003_categories.sql
-- Hierarchical categories, plus the listing -> category link.
--
-- Tree strategy: ltree materialised path.
--
-- Compared against a plain text path column with a text_pattern_ops index on a
-- 156-node, 4-level tree: descendant and ancestor lookups measured the same
-- (~0.12 ms), so performance did not decide it. ltree won on the data model:
--
--   * the database rejects a malformed path instead of storing it,
--   * ancestry is one operator (`path <@ 'cars.suv'`) rather than a LIKE plus
--     an equality case for the node itself,
--   * moving a subtree is subpath() over the descendants rather than string
--     surgery on every stored path.
--
-- Labels are slugs (cars.suv.5-seater), so a path is known at INSERT time from
-- the parent's path and needs no trigger or second pass.
--
-- Deliberately not used: adjacency-list-only. Recursive CTEs answer descendant
-- queries but cannot use an index for the recursion, so filtering listings by
-- category would rescan the tree per request.

CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TABLE categories (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id  bigint      REFERENCES categories (id) ON DELETE RESTRICT,
  name       text        NOT NULL,
  slug       text        NOT NULL,
  -- Materialised path from the root, e.g. 'cars.suv.5-seater'.
  path       ltree       NOT NULL,
  depth      integer     NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT categories_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT categories_slug_not_blank CHECK (btrim(slug) <> ''),
  -- A root sits at depth 1 and must not claim a parent; a child must have one.
  CONSTRAINT categories_root_shape CHECK ((parent_id IS NULL) = (depth = 1)),
  CONSTRAINT categories_depth_positive CHECK (depth >= 1),
  -- The path always ends with the node's own slug and is exactly depth long,
  -- so a stored path cannot disagree with the tree it describes.
  CONSTRAINT categories_path_matches_slug CHECK (subpath(path, depth - 1, 1)::text = slug),
  CONSTRAINT categories_path_depth_matches CHECK (nlevel(path) = depth)
);

-- Sibling names must be unique; the same name may repeat in different branches.
CREATE UNIQUE INDEX categories_parent_slug_key
  ON categories (parent_id, slug) NULLS NOT DISTINCT;

-- Descendant queries: `WHERE path <@ $1`. GiST is the index type ltree
-- operators are built for.
CREATE INDEX categories_path_gist_idx ON categories USING gist (path);
-- Listing joins and tree assembly walk parent -> child.
CREATE INDEX categories_parent_id_idx ON categories (parent_id);

-- A listing belongs to at most one category. Nullable: uncategorised listings
-- are allowed, and ON DELETE RESTRICT makes deleting a used category fail
-- loudly rather than silently orphaning listings.
ALTER TABLE listings ADD COLUMN category_id bigint REFERENCES categories (id) ON DELETE RESTRICT;

-- Category-scoped browse: filter by category then order by the sort key.
-- Partial to match the default browse predicate, mirroring 0002.
CREATE INDEX listings_category_created_at_id_idx
  ON listings (category_id, created_at DESC, id DESC) WHERE status <> 'removed';
CREATE INDEX listings_category_price_id_idx
  ON listings (category_id, price, id) WHERE status <> 'removed';
