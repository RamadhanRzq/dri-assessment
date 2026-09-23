import type { BrowseListingsDto, ListingSortKey } from './dto/browse-listings.dto.js';

/** Bind placeholder values without ever interpolating them into SQL text. */
export class ParameterList {
  readonly values: unknown[] = [];

  bind(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/** Sort keys that map straight onto a physical column. */
export type ColumnSortKey = Exclude<ListingSortKey, 'relevance'>;

/** Column each sort key reads; the whitelist prevents SQL built from request input. */
const SORT_COLUMN: Record<ColumnSortKey, string> = {
  createdAt: 'created_at',
  price: 'price',
  year: 'year',
  mileage: 'mileage',
};

export type ResolvedSort = {
  /** Sort key the cursor is bound to; `relevance` only when `q` is present. */
  key: ListingSortKey;
  column: string;
  direction: 'ASC' | 'DESC';
  relevance: boolean;
};

/**
 * `sort` is optional and depends on `q`: a full-text request ranks by relevance
 * unless it asked for a column, and a browse request orders by recency.
 */
export function resolveSort(filters: { q?: string; sort?: ListingSortKey; order?: string }): ResolvedSort {
  const direction = filters.order === 'asc' ? 'ASC' : 'DESC';
  const key: ListingSortKey = filters.sort ?? (filters.q ? 'relevance' : 'createdAt');

  return key === 'relevance'
    ? { key, column: 'relevance', direction, relevance: true }
    : { key, column: SORT_COLUMN[key as ColumnSortKey], direction, relevance: false };
}

/**
 * The filter half of a request: the validated DTO plus the full-text term.
 * Every field is optional because search, facet, and suggestion queries each
 * supply their own subset, but all of them share these predicates.
 */
export type ListingFilters = Partial<BrowseListingsDto> & { q?: string };

/**
 * An attribute filter after its value has been parsed and checked against the
 * attribute definition, so the SQL only has to bind it.
 */
export type ResolvedAttributeFilter =
  | { key: string; attributeId: number; type: 'enum'; values: string[] }
  | { key: string; attributeId: number; type: 'range'; min?: number; max?: number }
  | { key: string; attributeId: number; type: 'boolean'; value: boolean };

/**
 * WHERE clauses for every query that reads `listings` — browse, count, search,
 * and facet aggregation all share these semantics, so they are built once here.
 *
 * Every value is bound, never interpolated, and every column reference is a
 * constant chosen in this module.
 */
export function buildListingConditions(
  filters: ListingFilters,
  params: ParameterList,
  options: { categoryId?: number; attributeFilters?: ResolvedAttributeFilter[] } = {},
): string[] {
  const conditions = [
    filters.status === undefined
      ? `status <> ${params.bind('removed')}`
      : `status = ${params.bind(filters.status)}`,
  ];

  if (filters.q) {
    // `simple` matches the generated column in migration 0005: makes, models,
    // and city names are proper nouns, so stemming would only lose precision.
    conditions.push(
      `search_vector @@ websearch_to_tsquery('simple', ${params.bind(filters.q)})`,
    );
  }

  if (filters.make) conditions.push(`lower(make) = lower(${params.bind(filters.make)})`);
  if (filters.model) conditions.push(`lower(model) = lower(${params.bind(filters.model)})`);
  if (filters.location) conditions.push(`lower(location) = lower(${params.bind(filters.location)})`);
  if (filters.minPrice !== undefined) conditions.push(`price >= ${params.bind(filters.minPrice)}`);
  if (filters.maxPrice !== undefined) conditions.push(`price <= ${params.bind(filters.maxPrice)}`);
  if (filters.yearFrom !== undefined) conditions.push(`year >= ${params.bind(filters.yearFrom)}`);
  if (filters.yearTo !== undefined) conditions.push(`year <= ${params.bind(filters.yearTo)}`);
  if (filters.minMileage !== undefined) conditions.push(`mileage >= ${params.bind(filters.minMileage)}`);
  if (filters.maxMileage !== undefined) conditions.push(`mileage <= ${params.bind(filters.maxMileage)}`);
  if (filters.condition) conditions.push(`condition = ${params.bind(filters.condition)}`);
  if (filters.transmission) conditions.push(`transmission = ${params.bind(filters.transmission)}`);
  if (filters.fuelType) conditions.push(`fuel_type = ${params.bind(filters.fuelType)}`);

  // Scoped to a category and everything beneath it. The subtree is resolved
  // from the ltree path, but wrapped in ARRAY() rather than written as
  // `IN (subquery)`: the semi-join form made the planner scan the whole active
  // index and filter afterwards (35 ms on 50k rows), while the array form
  // turns the category into an index condition (0.17 ms).
  const scope = filters.categoryId ?? options.categoryId;
  if (scope !== undefined) {
    conditions.push(
      `category_id = ANY(ARRAY(SELECT id FROM categories WHERE path <@ (SELECT path FROM categories WHERE id = ${params.bind(scope)})))`,
    );
  }

  for (const filter of options.attributeFilters ?? []) {
    conditions.push(attributeCondition(filter, params));
  }

  return conditions;
}

/**
 * Dynamic attribute filters reach the values table through EXISTS, so a listing
 * with several attributes stays one row and the plan can use the
 * (attribute_id, value_*) indexes.
 */
function attributeCondition(filter: ResolvedAttributeFilter, params: ParameterList): string {
  const match = [`v.listing_id = listings.id`, `v.attribute_id = ${params.bind(filter.attributeId)}`];

  switch (filter.type) {
    case 'enum':
      match.push(`v.value_text = ANY(${params.bind(filter.values)})`);
      break;
    case 'range':
      if (filter.min !== undefined) match.push(`v.value_num >= ${params.bind(filter.min)}`);
      if (filter.max !== undefined) match.push(`v.value_num <= ${params.bind(filter.max)}`);
      break;
    case 'boolean':
      match.push(`v.value_bool = ${params.bind(filter.value)}`);
      break;
  }

  return `EXISTS (SELECT 1 FROM listing_attribute_values v WHERE ${match.join(' AND ')})`;
}
