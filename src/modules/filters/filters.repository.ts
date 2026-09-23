import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../shared/database/database.service.js';
import {
  buildListingConditions,
  ParameterList,
  type ListingFilters,
  type ResolvedAttributeFilter,
} from '../listings/listing-query.js';
import {
  FILTER_ATTRIBUTE_COLUMNS,
  type AttributeCountRow,
  type AttributeRangeRow,
  type FacetCountRow,
  type FilterAttributeRow,
} from './filter.types.js';

/**
 * Read model behind the filter and facet endpoints.
 *
 * It owns no data of its own: every count it returns is aggregated from
 * `listings` through the shared condition builder, so facets cannot disagree
 * with the listing queries they describe.
 */
@Injectable()
export class FiltersRepository {
  constructor(private readonly db: DatabaseService) {}

  async categoryExists(id: number): Promise<boolean> {
    const rows = await this.db.query<{ id: number }>(
      'SELECT id FROM categories WHERE id = $1',
      [id],
    );
    return rows.length > 0;
  }

  /**
   * Attribute definitions a category exposes: the ones attached to it plus
   * every ancestor's, so a leaf inherits the filters defined higher up.
   *
   * Attributes are shared rows, so a key attached at two levels is the same
   * definition and appears once — at the shallowest category that exposes it.
   */
  async findAttributes(categoryId?: number): Promise<FilterAttributeRow[]> {
    return this.db.query<FilterAttributeRow>(
      `SELECT id, key, label, type, unit, options, category_id
         FROM (
           SELECT DISTINCT ON (a.key) ${FILTER_ATTRIBUTE_COLUMNS}, c.depth, ca.position
             FROM attributes a
             JOIN category_attributes ca ON ca.attribute_id = a.id
             JOIN categories c ON c.id = ca.category_id
            ${
              categoryId === undefined
                ? ''
                : // `c.path @> target` reads as "c is the target or an ancestor of
                  // it", so a leaf inherits the filters defined above it.
                  'WHERE c.path @> (SELECT path FROM categories WHERE id = $1)'
            }
            ORDER BY a.key, c.depth, ca.position
         ) exposed
        ORDER BY position, key`,
      categoryId === undefined ? [] : [categoryId],
    );
  }

  /**
   * Every facet for the current filter context in one pass.
   *
   * `GROUPING SETS` produces the make, model, fuel type, transmission,
   * condition, and location counts as separate groups of a single scan; the
   * empty grouping set rides along to carry the global min/max that the price
   * and year range facets need. One query per facet would scan the same rows
   * six more times.
   */
  async facetCounts(
    filters: ListingFilters,
    attributeFilters: ResolvedAttributeFilter[],
    categoryId?: number,
  ): Promise<FacetCountRow[]> {
    const params = new ParameterList();
    const conditions = buildListingConditions(filters, params, {
      categoryId,
      attributeFilters,
    });

    return this.db.query<FacetCountRow>(
      `SELECT CASE
                WHEN GROUPING(make) = 0        THEN 'make'
                WHEN GROUPING(model) = 0       THEN 'model'
                WHEN GROUPING(fuel_type) = 0   THEN 'fuelType'
                WHEN GROUPING(transmission) = 0 THEN 'transmission'
                WHEN GROUPING(condition) = 0   THEN 'condition'
                WHEN GROUPING(location) = 0    THEN 'location'
                ELSE 'stats'
              END AS facet,
              COALESCE(make, model, fuel_type, transmission, condition, location) AS value,
              count(*)::int AS count,
              min(price)::bigint AS min_price,
              max(price)::bigint AS max_price,
              min(year) AS min_year,
              max(year) AS max_year
         FROM listings
        WHERE ${conditions.join(' AND ')}
        GROUP BY GROUPING SETS
          ((make), (model), (fuel_type), (transmission), (condition), (location), ())`,
      params.values,
    );
  }

  /** Enum and boolean attribute counts, one row per value. */
  async attributeCounts(
    filters: ListingFilters,
    attributeFilters: ResolvedAttributeFilter[],
    attributeIds: number[],
    categoryId?: number,
  ): Promise<AttributeCountRow[]> {
    if (attributeIds.length === 0) return [];

    const params = new ParameterList();
    const conditions = buildListingConditions(filters, params, {
      categoryId,
      attributeFilters,
    });
    const ids = params.bind(attributeIds);

    return this.db.query<AttributeCountRow>(
      `SELECT a.key,
              a.type,
              COALESCE(v.value_text, v.value_bool::text) AS value,
              count(*)::int AS count
         FROM listing_attribute_values v
         JOIN attributes a ON a.id = v.attribute_id
         JOIN listings ON listings.id = v.listing_id
        WHERE a.type IN ('enum', 'boolean')
          AND a.id = ANY(${ids}::bigint[])
          AND ${conditions.join(' AND ')}
        GROUP BY a.key, a.type, v.value_text, v.value_bool
        ORDER BY a.key, count(*) DESC, 3`,
      params.values,
    );
  }

  /**
   * Range attributes report the observed span instead of per-value counts: a
   * numeric attribute has as many distinct values as listings, so counting each
   * one would return a histogram nobody can render.
   */
  async attributeRanges(
    filters: ListingFilters,
    attributeFilters: ResolvedAttributeFilter[],
    attributeIds: number[],
    categoryId?: number,
  ): Promise<AttributeRangeRow[]> {
    if (attributeIds.length === 0) return [];

    const params = new ParameterList();
    const conditions = buildListingConditions(filters, params, {
      categoryId,
      attributeFilters,
    });
    const ids = params.bind(attributeIds);

    return this.db.query<AttributeRangeRow>(
      `SELECT a.key,
              min(v.value_num)::float8 AS min,
              max(v.value_num)::float8 AS max,
              count(*)::int AS count
         FROM listing_attribute_values v
         JOIN attributes a ON a.id = v.attribute_id
         JOIN listings ON listings.id = v.listing_id
        WHERE a.type = 'range'
          AND a.id = ANY(${ids}::bigint[])
          AND ${conditions.join(' AND ')}
        GROUP BY a.key
        ORDER BY a.key`,
      params.values,
    );
  }
}
