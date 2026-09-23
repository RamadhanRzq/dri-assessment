-- 0001_create_listings.sql
-- Core vehicle listing table for the automotive marketplace.
--
-- Scope note: the category tree (Phase 04) and dynamic filter attributes
-- (Phase 08) arrive in later migrations; this migration only covers the
-- columns §6.1 lists as listing fields.

CREATE TABLE listings (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  make          text        NOT NULL,
  model         text        NOT NULL,
  year          integer     NOT NULL,
  mileage       integer     NOT NULL,
  price         bigint      NOT NULL,
  condition     text        NOT NULL,
  transmission  text        NOT NULL,
  fuel_type     text        NOT NULL,
  color         text        NOT NULL,
  images        text[]      NOT NULL DEFAULT '{}',
  location      text        NOT NULL,
  status        text        NOT NULL DEFAULT 'available',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT listings_year_range      CHECK (year BETWEEN 1900 AND 2100),
  CONSTRAINT listings_mileage_range   CHECK (mileage >= 0),
  CONSTRAINT listings_price_range     CHECK (price >= 0),
  CONSTRAINT listings_condition_check CHECK (condition IN ('new', 'used', 'certified')),
  CONSTRAINT listings_transmission_check
    CHECK (transmission IN ('manual', 'automatic', 'cvt')),
  CONSTRAINT listings_fuel_type_check
    CHECK (fuel_type IN ('petrol', 'diesel', 'electric', 'hybrid')),
  CONSTRAINT listings_status_check
    CHECK (status IN ('available', 'pending', 'sold', 'removed'))
);

-- Default browse page: filter by status, order by (created_at, id) descending.
-- The id column makes the ordering total, which cursor pagination requires.
CREATE INDEX listings_status_created_at_id_idx
  ON listings (status, created_at DESC, id DESC);

-- Sorting by price/year/mileage within a status; id keeps each ordering total.
CREATE INDEX listings_status_price_id_idx   ON listings (status, price, id);
CREATE INDEX listings_status_year_id_idx    ON listings (status, year, id);
CREATE INDEX listings_status_mileage_id_idx ON listings (status, mileage, id);

-- Attribute equality filters that pair with the default ordering.
-- lower() expression indexes keep browse filters case-insensitive without
-- giving up the index (a plain btree on the column cannot serve lower(col) = ?).
CREATE INDEX listings_make_lower_idx     ON listings (lower(make));
CREATE INDEX listings_model_lower_idx    ON listings (lower(model));
CREATE INDEX listings_location_lower_idx ON listings (lower(location));
CREATE INDEX listings_fuel_type_idx    ON listings (fuel_type);
CREATE INDEX listings_transmission_idx ON listings (transmission);
CREATE INDEX listings_condition_idx    ON listings (condition);
