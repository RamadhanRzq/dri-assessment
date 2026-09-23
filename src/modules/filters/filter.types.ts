export const FILTER_ATTRIBUTE_TYPES = ['enum', 'range', 'boolean'] as const;

export type FilterAttributeType = (typeof FILTER_ATTRIBUTE_TYPES)[number];

/** Definition row; `options` is only populated for `enum` attributes. */
export type FilterAttributeRow = {
  id: number;
  key: string;
  label: string;
  type: FilterAttributeType;
  unit: string | null;
  options: string[];
  /** Category that exposed it; a shared attribute reports the nearest one. */
  category_id: number;
};

export const FILTER_ATTRIBUTE_COLUMNS =
  'a.id, a.key, a.label, a.type, a.unit, a.options, ca.category_id';

/**
 * One row of the GROUPING SETS aggregate: a facet value and its count, or the
 * `stats` row carrying the global bounds that the price and year facets need.
 */
export type FacetCountRow = {
  facet: string;
  value: string | null;
  count: number;
  min_price: number | null;
  max_price: number | null;
  min_year: number | null;
  max_year: number | null;
};

export type AttributeCountRow = {
  key: string;
  type: FilterAttributeType;
  value: string | null;
  count: number;
};

export type AttributeRangeRow = {
  key: string;
  min: number | null;
  max: number | null;
  count: number;
};
