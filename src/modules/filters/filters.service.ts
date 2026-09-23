import { Injectable, NotFoundException } from '@nestjs/common';
import { FiltersRepository } from './filters.repository.js';
import type { FilterAttributeRow } from './filter.types.js';
import type { ListingFilters } from '../listings/listing-query.js';
import { resolveAttributeFilters } from './attribute-values.js';
import {
  AttributeFacetDto,
  FilterDefinitionDto,
  FilterOptionsDto,
  FacetDto,
  RangeFacetDto,
  RangeFacetBoundsDto,
} from './dto/filter-response.dto.js';

/** The definition fields every facet shape carries; the base for spreading. */
type FilterDefinition = {
  key: string;
  label: string;
  type: string;
  unit: string | null;
  options: string[];
  categoryId: number;
};

/** Facet values returned per facet; enough to render a filter panel. */
const FACET_VALUE_LIMIT = 25;

/** Every facet that is a plain column group rather than a dynamic attribute. */
const FACET_KEYS = [
  'make',
  'model',
  'fuelType',
  'transmission',
  'condition',
  'location',
] as const;

@Injectable()
export class FiltersService {
  constructor(private readonly repository: FiltersRepository) {}

  /** Filter definitions for a category, or for every known attribute. */
  async definitions(categoryId?: number): Promise<FilterDefinitionDto[]> {
    if (categoryId !== undefined && !(await this.repository.categoryExists(categoryId))) {
      throw new NotFoundException(`Category ${categoryId} not found`);
    }

    const rows = await this.repository.findAttributes(categoryId);
    return rows.map(toDefinition);
  }

  /**
   * Facets for the current filter context.
   *
   * The dynamic attribute keys in `filters.attributes` are validated against the
   * definitions first: an unknown key would otherwise silently widen the result
   * set, which is exactly the kind of bug a filter panel cannot surface.
   */
  async options(filters: ListingFilters): Promise<FilterOptionsDto> {
    const definitions = await this.repository.findAttributes(filters.categoryId);
    const attributeFilters = resolveAttributeFilters(filters.attributes ?? {}, definitions);

    const [countRows, attributeRows, rangeRows] = await Promise.all([
      this.repository.facetCounts(filters, attributeFilters),
      this.repository.attributeCounts(
        filters,
        attributeFilters,
        definitions.filter((d) => d.type !== 'range').map((d) => d.id),
      ),
      this.repository.attributeRanges(
        filters,
        attributeFilters,
        definitions.filter((d) => d.type === 'range').map((d) => d.id),
      ),
    ]);

    const stats = countRows.find((row) => row.facet === 'stats');

    const facets = FACET_KEYS.map((facet) =>
      toFacet(
        facet,
        countRows.filter((row) => row.facet === facet),
      ),
    );

    const attributes = definitions.map((definition) =>
      toAttributeFacet(definition, attributeRows, rangeRows),
    );

    return {
      total: stats?.count ?? 0,
      facets,
      attributes,
      price: rangeFacet('price', stats?.min_price ?? null, stats?.max_price ?? null, stats?.count ?? 0),
      year: rangeFacet('year', stats?.min_year ?? null, stats?.max_year ?? null, stats?.count ?? 0),
    };
  }
}

function toFacet(key: string, rows: { value: string | null; count: number }[]): FacetDto {
  const values = rows
    .filter((row) => row.value !== null)
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)))
    // The facet's own counts describe the context; a single value beyond this
    // limit is a tail nobody filters by, and returning it would dwarf the panel.
    .slice(0, FACET_VALUE_LIMIT)
    .map((row) => ({ value: row.value as string, count: row.count }));

  return { key, values };
}

function toAttributeFacet(
  definition: FilterAttributeRow,
  counts: { key: string; value: string | null; count: number }[],
  ranges: { key: string; min: number | null; max: number | null; count: number }[],
): AttributeFacetDto | RangeFacetDto {
  const base = toDefinition(definition);

  if (definition.type === 'range') {
    const range = ranges.find((row) => row.key === definition.key);
    return { ...base, min: range?.min ?? null, max: range?.max ?? null, count: range?.count ?? 0 };
  }

  const observed = new Map(
    counts
      .filter((row) => row.key === definition.key)
      .map((row) => [String(row.value), row.count]),
  );

  // Every declared option is listed, including the ones nothing currently
  // matches. A filter panel has to render an unselected value with a zero count
  // rather than have it vanish and reappear as filters change. A boolean has no
  // declared options, so its two values are the fixed domain.
  const candidates =
    definition.type === 'enum' ? definition.options : ['true', 'false'];

  const values = candidates
    .map((value) => ({ value, count: observed.get(value) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  return {
    ...base,
    values,
    // Enum and boolean attributes report per-value counts instead of a span.
    count: values.reduce((total, value) => total + value.count, 0),
  };
}

function rangeFacet(
  key: string,
  min: number | null,
  max: number | null,
  count: number,
): RangeFacetBoundsDto {
  return { key, min, max, count };
}

/**
 * Plain object rather than a DTO instance: the facet builders spread this into
 * their own shapes, and spreading a class instance would drop its prototype.
 */
function toDefinition(row: FilterAttributeRow): FilterDefinition {
  return {
    key: row.key,
    label: row.label,
    type: row.type,
    unit: row.unit,
    options: row.type === 'enum' ? row.options : [],
    categoryId: row.category_id,
  };
}
