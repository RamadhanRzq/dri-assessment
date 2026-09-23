import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../shared/database/database.service.js';
import { LISTING_COLUMNS, type BrowseRow, type ListingRow } from './listing.types.js';
import {
  buildListingConditions,
  ParameterList,
  resolveSort,
  type ResolvedAttributeFilter,
} from './listing-query.js';
import type { BrowseListingsDto } from './dto/browse-listings.dto.js';
import type { CreateListingDto } from './dto/create-listing.dto.js';
import type { UpdateListingDto } from './dto/update-listing.dto.js';
import type { AttributeValueColumns } from '../filters/attribute-values.js';
import type { CursorPayload } from '../../shared/pagination/cursor.js';
import type { PoolClient } from 'pg';

/** API field name to physical column, used to build PATCH assignments. */
const COLUMN_BY_FIELD: Record<string, string> = {
  make: 'make',
  model: 'model',
  year: 'year',
  mileage: 'mileage',
  price: 'price',
  condition: 'condition',
  transmission: 'transmission',
  fuelType: 'fuel_type',
  color: 'color',
  images: 'images',
  location: 'location',
  status: 'status',
  categoryId: 'category_id',
};

/** Everything a listing query needs after the request has been interpreted. */
export type ListingQuery = {
  filters: BrowseListingsDto & { q?: string };
  attributeFilters: ResolvedAttributeFilter[];
  categoryId?: number;
};

/** Attribute value as read back, before being keyed by its attribute name. */
type AttributeValueRow = {
  listing_id: number;
  key: string;
  type: string;
  value_text: string | null;
  value_num: number | null;
  value_bool: boolean | null;
};

@Injectable()
export class ListingsRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(
    dto: CreateListingDto,
    attributes: { attributeId: number; value: AttributeValueColumns | null }[],
  ): Promise<ListingRow> {
    return this.db.withTransaction(async (client) => {
      const { rows } = await client.query<ListingRow>(
        `INSERT INTO listings
           (make, model, year, mileage, price, condition, transmission,
            fuel_type, color, images, location, status, category_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, 'available'), $13)
         RETURNING ${LISTING_COLUMNS}`,
        [
          dto.make,
          dto.model,
          dto.year,
          dto.mileage,
          dto.price,
          dto.condition,
          dto.transmission,
          dto.fuelType,
          dto.color,
          dto.images ?? [],
          dto.location,
          dto.status ?? null,
          dto.categoryId ?? null,
        ],
      );

      const listing = rows[0];
      await this.writeAttributeValues(client, listing.id, attributes);
      return listing;
    });
  }

  async findById(id: number): Promise<ListingRow | undefined> {
    const rows = await this.db.query<ListingRow>(
      `SELECT ${LISTING_COLUMNS} FROM listings WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  /** Returns the updated row, or undefined when the id does not exist. */
  async update(
    id: number,
    dto: UpdateListingDto,
    attributes: { attributeId: number; value: AttributeValueColumns | null }[] | undefined,
  ): Promise<ListingRow | undefined> {
    const assignments: string[] = [];
    const params: unknown[] = [];

    for (const [field, column] of Object.entries(COLUMN_BY_FIELD)) {
      const value = (dto as Record<string, unknown>)[field];
      if (value === undefined) continue;
      params.push(value);
      assignments.push(`${column} = $${params.length}`);
    }

    // No recognised field means nothing to change; report the current row.
    if (assignments.length === 0 && attributes === undefined) return this.findById(id);

    return this.db.withTransaction(async (client) => {
      let updated: ListingRow | undefined;

      if (assignments.length > 0) {
        const { rows } = await client.query<ListingRow>(
          `UPDATE listings
              SET ${assignments.join(', ')}, updated_at = now()
            WHERE id = $${params.length + 1}
            RETURNING ${LISTING_COLUMNS}`,
          [...params, id],
        );
        updated = rows[0];
        // Nothing to attach values to; the row does not exist.
        if (!updated) return undefined;
      } else {
        const { rows } = await client.query<ListingRow>(
          `SELECT ${LISTING_COLUMNS} FROM listings WHERE id = $1`,
          [id],
        );
        updated = rows[0];
        if (!updated) return undefined;
      }

      if (attributes !== undefined) {
        await this.writeAttributeValues(client, id, attributes);
        await client.query('UPDATE listings SET updated_at = now() WHERE id = $1', [id]);
      }

      return updated;
    });
  }

  /** Soft delete: the row stays, only the status changes. */
  async softDelete(id: number): Promise<ListingRow | undefined> {
    const rows = await this.db.query<ListingRow>(
      `UPDATE listings
          SET status = 'removed', updated_at = now()
        WHERE id = $1
        RETURNING ${LISTING_COLUMNS}`,
      [id],
    );
    return rows[0];
  }

  /**
   * Keyset page over an arbitrary combination of filters.
   *
   * `limit + 1` rows are requested so the caller can tell whether another page
   * exists without running a separate COUNT.
   */
  async browse(
    query: ListingQuery,
    cursor: CursorPayload | null,
  ): Promise<BrowseRow[]> {
    const params = new ParameterList();
    const { filters } = query;
    const conditions = buildListingConditions(filters, params, query);
    const sort = resolveSort(filters);
    const rank = sort.relevance ? relevanceExpression(filters.q as string, params) : null;
    const sortExpression = rank ?? sort.column;

    // Keyset predicate: compare the sort tuple lexicographically, so rows that
    // share a sort value continue exactly after the cursor's id.
    if (cursor) {
      const operator = sort.direction === 'ASC' ? '>' : '<';
      const cast = sort.relevance
        ? 'float8'
        : sort.column === 'created_at'
          ? 'timestamptz'
          : 'bigint';
      conditions.push(
        `(${sortExpression}, id) ${operator} (${params.bind(cursor.value)}::${cast}, ${params.bind(cursor.id)}::bigint)`,
      );
    }

    return this.db.query<BrowseRow>(
      `SELECT ${LISTING_COLUMNS},
              created_at::text AS created_at_cursor,
              ${rank ?? 'NULL::float8'} AS relevance
         FROM listings
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${sortExpression} ${sort.direction}, id ${sort.direction}
        LIMIT ${params.bind(filters.limit + 1)}`,
      params.values,
    );
  }

  /** Total rows matching the filters, ignoring the cursor and page size. */
  async count(query: ListingQuery): Promise<number> {
    const params = new ParameterList();
    const conditions = buildListingConditions(query.filters, params, query);

    const rows = await this.db.query<{ count: number }>(
      `SELECT count(*)::bigint AS count
         FROM listings
        WHERE ${conditions.join(' AND ')}`,
      params.values,
    );
    return rows[0].count;
  }

  /**
   * Attribute values for a whole page in one query.
   *
   * Read per page rather than per listing: asking for one listing's attributes
   * inside a loop is the N+1 this avoids.
   */
  async findAttributeValues(listingIds: number[]): Promise<Map<number, Record<string, unknown>>> {
    if (listingIds.length === 0) return new Map();

    const rows = await this.db.query<AttributeValueRow>(
      `SELECT v.listing_id, a.key, a.type, v.value_text, v.value_num, v.value_bool
         FROM listing_attribute_values v
         JOIN attributes a ON a.id = v.attribute_id
        WHERE v.listing_id = ANY($1::bigint[])`,
      [listingIds],
    );

    const byListing = new Map<number, Record<string, unknown>>();
    for (const row of rows) {
      const values = byListing.get(row.listing_id) ?? {};
      values[row.key] = attributeValue(row);
      byListing.set(row.listing_id, values);
    }
    return byListing;
  }

  /**
   * Prefix suggestions over make, model, and location.
   *
   * The three branches are one statement so the endpoint is a single round trip.
   * Each matches `col ILIKE 'prefix%'` — deliberately on the raw column, not on
   * `lower(col)`: the trigram indexes from migration 0004 are declared on the
   * bare columns (`make gin_trgm_ops`), and an expression the index does not
   * carry forces a sequential scan. Measured on 50k rows: 28 ms as a seq scan
   * versus 4 ms as a bitmap index scan.
   */
  async suggest(
    prefix: string,
    limit: number,
    categoryId?: number,
  ): Promise<{ type: string; value: string; count: number }[]> {
    const params = new ParameterList();
    const conditions = buildListingConditions({}, params, { categoryId });
    // `%` and `_` are the only wildcards; escaping them keeps a literal `_`
    // in a make or city name from widening the match.
    const escaped = prefix.replace(/[\\%_]/g, '\\$&');
    const pattern = params.bind(`${escaped}%`);

    return this.db.query(
      `SELECT * FROM (
         SELECT 'make' AS type, make AS value, count(*)::int AS count
           FROM listings WHERE ${conditions.join(' AND ')} AND make ILIKE ${pattern}
          GROUP BY make
         UNION ALL
         SELECT 'model', model, count(*)::int
           FROM listings WHERE ${conditions.join(' AND ')} AND model ILIKE ${pattern}
          GROUP BY model
         UNION ALL
         SELECT 'location', location, count(*)::int
           FROM listings WHERE ${conditions.join(' AND ')} AND location ILIKE ${pattern}
          GROUP BY location
       ) suggestions
       ORDER BY type, count DESC, value
       LIMIT ${params.bind(limit)}`,
      params.values,
    );
  }

  /**
   * Applies attribute values to a listing.
   *
   * `null` removes a value, which is how a client clears an attribute without
   * resending the whole set.
   */
  private async writeAttributeValues(
    client: PoolClient,
    listingId: number,
    attributes: { attributeId: number; value: AttributeValueColumns | null }[],
  ): Promise<void> {
    for (const attribute of attributes) {
      if (attribute.value === null) {
        await client.query(
          'DELETE FROM listing_attribute_values WHERE listing_id = $1 AND attribute_id = $2',
          [listingId, attribute.attributeId],
        );
        continue;
      }

      const value = attribute.value;
      await client.query(
        `INSERT INTO listing_attribute_values
           (listing_id, attribute_id, value_text, value_num, value_bool)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (listing_id, attribute_id) DO UPDATE
            SET value_text = EXCLUDED.value_text,
                value_num  = EXCLUDED.value_num,
                value_bool = EXCLUDED.value_bool,
                updated_at = now()`,
        [
          listingId,
          attribute.attributeId,
          value.value_text ?? null,
          value.value_num ?? null,
          value.value_bool ?? null,
        ],
      );
    }
  }
}

/**
 * Relevance score of the current query. Bound here rather than inlined because
 * it is needed twice — once in ORDER BY, once in the keyset predicate.
 *
 * Cast to `float8` deliberately. `ts_rank` returns `real`, so the value that
 * reaches the cursor is the float8 round-trip of a float4 and compares as
 * *lower* than the stored rank — every row sharing the boundary score would be
 * re-served on the next page. Widening in SQL keeps the cursor value and the
 * ordering expression bit-identical.
 */
function relevanceExpression(q: string, params: ParameterList): string {
  return `ts_rank(search_vector, websearch_to_tsquery('simple', ${params.bind(q)}))::float8`;
}

function attributeValue(row: AttributeValueRow): unknown {
  switch (row.type) {
    case 'range':
      return row.value_num;
    case 'boolean':
      return row.value_bool;
    default:
      return row.value_text;
  }
}
