-- 0005_filter_attributes.sql
-- Dynamic, category-specific filter attributes.
--
-- Requirement: a new business filter must not need a migration. So attributes
-- are rows, not columns: `attributes` holds the definition, `category_attributes`
-- says which categories expose it, and `listing_attribute_values` holds one typed
-- value per listing.
--
-- Attributes are global and attached to categories through a join table rather
-- than owned by a single category: "engine_capacity" means the same thing on
-- Cars and on Motorcycles, and one definition shared by both keeps its unit,
-- label, and options consistent instead of drifting per branch.
--
-- The three supported types map to three value columns rather than one text
-- column plus casts: filtering stays index-supported (`value_num >= $1`) and the
-- database rejects a value stored in the wrong shape.
--
-- Deliberately not used: a jsonb column on `listings`. Querying it per attribute
-- needs an expression index per attribute, which reintroduces exactly the
-- migration-per-filter the requirement rules out.

CREATE TABLE attributes (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key        text        NOT NULL,
  label      text        NOT NULL,
  type       text        NOT NULL,
  unit       text,
  -- Enum choices, e.g. {'petrol','diesel'}. Empty for range and boolean.
  options    text[]      NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT attributes_type_check CHECK (type IN ('enum', 'range', 'boolean')),
  CONSTRAINT attributes_key_format CHECK (key ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),
  CONSTRAINT attributes_label_not_blank CHECK (btrim(label) <> ''),
  -- An enum without choices cannot be rendered or validated; the other two
  -- types must not carry choices.
  CONSTRAINT attributes_enum_has_options CHECK (type <> 'enum' OR cardinality(options) > 0),
  CONSTRAINT attributes_options_only_for_enum CHECK (type = 'enum' OR cardinality(options) = 0)
);

-- One definition per key, shared by every category that attaches it.
CREATE UNIQUE INDEX attributes_key_key ON attributes (key);

CREATE TABLE category_attributes (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id  bigint      NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  attribute_id bigint      NOT NULL REFERENCES attributes (id) ON DELETE CASCADE,
  position     integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- One attachment per pair; `position` only orders the filter panel.
  CONSTRAINT category_attributes_unique UNIQUE (category_id, attribute_id)
);

-- Reverse lookup: "which categories expose this attribute".
CREATE INDEX category_attributes_attribute_idx ON category_attributes (attribute_id);

CREATE TABLE listing_attribute_values (
  listing_id   bigint      NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  attribute_id bigint      NOT NULL REFERENCES attributes (id) ON DELETE CASCADE,
  value_text   text,
  value_num    numeric,
  value_bool   boolean,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (listing_id, attribute_id),
  -- Exactly one typed column holds the value. Which one is correct depends on
  -- the attribute's type, which a CHECK cannot read, so the API validates the
  -- type and this constraint enforces the shape.
  CONSTRAINT listing_attribute_values_one_value
    CHECK (num_nonnulls(value_text, value_num, value_bool) = 1)
);

-- One index per value column: the filter predicate is always "this attribute,
-- this value (or this range)". Partial, because a row only ever populates one
-- of the three columns.
CREATE INDEX listing_attribute_values_text_idx
  ON listing_attribute_values (attribute_id, value_text) WHERE value_text IS NOT NULL;
CREATE INDEX listing_attribute_values_num_idx
  ON listing_attribute_values (attribute_id, value_num) WHERE value_num IS NOT NULL;
CREATE INDEX listing_attribute_values_bool_idx
  ON listing_attribute_values (attribute_id, value_bool) WHERE value_bool IS NOT NULL;
