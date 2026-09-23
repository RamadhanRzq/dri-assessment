-- 0002_listing_indexes.sql
-- Align the listing indexes with how browse actually queries.
--
-- Two changes, both measured on 50k rows:
--
-- 1. Add partial indexes for the default browse predicate `status <> 'removed'`.
--    The existing (status, <sort>, id) indexes only serve an equality filter on
--    status. For the inequality the planner fell back to a sequential scan plus
--    a top-N sort: 869 buffers and ~11 ms to return 21 rows, growing with table
--    size. A partial index matching the predicate turns that into an index-only
--    scan (~0.4 ms) because `removed` rows are excluded from the index entirely.
--
-- 2. Drop the fuel_type, condition, and transmission indexes. Those columns have
--    3-4 distinct values, so an equality filter still matches a fifth of the
--    table and the planner consistently prefers the sort index with a filter.
--    EXPLAIN produced identical plans with and without them, so they only cost
--    write amplification and space.
--
-- Deliberately kept: the lower() indexes on make/model/location. Removing them
-- pushed a combined make+model+location filter from ~0.5 ms to an 11 ms
-- sequential scan.

-- Default browse, one per supported sort key. Mirrors SORT_COLUMN in
-- listings.repository.ts; id keeps each ordering total for keyset pagination.
CREATE INDEX listings_active_created_at_id_idx
  ON listings (created_at DESC, id DESC) WHERE status <> 'removed';
CREATE INDEX listings_active_price_id_idx
  ON listings (price, id) WHERE status <> 'removed';
CREATE INDEX listings_active_year_id_idx
  ON listings (year, id) WHERE status <> 'removed';
CREATE INDEX listings_active_mileage_id_idx
  ON listings (mileage, id) WHERE status <> 'removed';

-- Low-cardinality equality filters; the sort indexes already cover these.
DROP INDEX listings_fuel_type_idx;
DROP INDEX listings_condition_idx;
DROP INDEX listings_transmission_idx;
