-- 0004_search.sql
-- Full-text search, plus trigram indexes for autocomplete.
--
-- `search_vector` is a stored generated column over the searchable fields, so it
-- can never drift from the row. Weights rank the fields: make and model are what
-- a buyer types, location narrows it, and colour is the weakest signal.
--
-- The `simple` configuration is used rather than `english`: vehicle makes,
-- models, and Indonesian city names are proper nouns, and stemming them
-- ("avanza" -> "avanz") would only lose precision.
--
-- pg_trgm backs autocomplete. The indexes are declared on the bare columns so
-- they serve `col ILIKE 'prefix%'` directly: under the en_US.UTF-8 collation a
-- plain btree cannot answer a prefix LIKE at all, and wrapping the column in
-- lower() would put the expression out of reach of these indexes.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE listings
  ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', COALESCE(make, '')), 'A') ||
      setweight(to_tsvector('simple', COALESCE(model, '')), 'A') ||
      setweight(to_tsvector('simple', COALESCE(location, '')), 'B') ||
      setweight(to_tsvector('simple', COALESCE(color, '')), 'C')
    ) STORED;

-- GIN is the index type for `@@`; the vector column is already normalised.
CREATE INDEX listings_search_vector_idx ON listings USING gin (search_vector);

-- Autocomplete. These sit alongside the lower() btree indexes from 0001: the
-- btree serves equality filters, the trigram index serves the prefix match.
CREATE INDEX listings_make_trgm_idx     ON listings USING gin (make gin_trgm_ops);
CREATE INDEX listings_model_trgm_idx    ON listings USING gin (model gin_trgm_ops);
CREATE INDEX listings_location_trgm_idx ON listings USING gin (location gin_trgm_ops);
