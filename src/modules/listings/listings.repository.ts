import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../shared/database/database.service.js';
import {
  LISTING_COLUMNS,
  type BrowseRow,
  type ListingRow,
} from './listing.types.js';
import type { BrowseListingsDto, ListingSortKey } from './dto/browse-listings.dto.js';
import type { CreateListingDto } from './dto/create-listing.dto.js';
import type { UpdateListingDto } from './dto/update-listing.dto.js';
import type { CursorPayload } from '../../shared/pagination/cursor.js';

/** Column each sort key reads; the whitelist prevents SQL built from request input. */
const SORT_COLUMN: Record<ListingSortKey, string> = {
  createdAt: 'created_at',
  price: 'price',
  year: 'year',
  mileage: 'mileage',
};

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

/** Bind placeholder values without ever interpolating them into SQL text. */
class ParameterList {
  readonly values: unknown[] = [];

  bind(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

@Injectable()
export class ListingsRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(dto: CreateListingDto): Promise<ListingRow> {
    const rows = await this.db.query<ListingRow>(
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
    return rows[0];
  }

  async findById(id: number): Promise<ListingRow | undefined> {
    const rows = await this.db.query<ListingRow>(
      `SELECT ${LISTING_COLUMNS} FROM listings WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  /** Returns the updated row, or undefined when the id does not exist. */
  async update(id: number, dto: UpdateListingDto): Promise<ListingRow | undefined> {
    const assignments: string[] = [];
    const params: unknown[] = [];

    for (const [field, column] of Object.entries(COLUMN_BY_FIELD)) {
      const value = (dto as Record<string, unknown>)[field];
      if (value === undefined) continue;
      params.push(value);
      assignments.push(`${column} = $${params.length}`);
    }

    // No recognised field means nothing to change; report the current row.
    if (assignments.length === 0) return this.findById(id);

    params.push(id);
    const rows = await this.db.query<ListingRow>(
      `UPDATE listings
          SET ${assignments.join(', ')}, updated_at = now()
        WHERE id = $${params.length}
        RETURNING ${LISTING_COLUMNS}`,
      params,
    );
    return rows[0];
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
    filters: BrowseListingsDto,
    cursor: CursorPayload | null,
    categoryId?: number,
  ): Promise<BrowseRow[]> {
    const params = new ParameterList();
    const conditions = this.filterConditions(filters, params, categoryId);
    const sortColumn = SORT_COLUMN[filters.sort];
    const direction = filters.order === 'asc' ? 'ASC' : 'DESC';

    // Keyset predicate: compare the sort tuple lexicographically, so rows that
    // share a sort value continue exactly after the cursor's id.
    if (cursor) {
      const operator = filters.order === 'asc' ? '>' : '<';
      const value = params.bind(cursor.value);
      const id = params.bind(cursor.id);
      const cast = filters.sort === 'createdAt' ? 'timestamptz' : 'bigint';
      conditions.push(`(${sortColumn}, id) ${operator} (${value}::${cast}, ${id}::bigint)`);
    }

    return this.db.query<BrowseRow>(
      `SELECT ${LISTING_COLUMNS},
              created_at::text AS created_at_cursor
         FROM listings
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${sortColumn} ${direction}, id ${direction}
        LIMIT ${params.bind(filters.limit + 1)}`,
      params.values,
    );
  }

  /** Total rows matching the filters, ignoring the cursor and page size. */
  async count(filters: BrowseListingsDto, categoryId?: number): Promise<number> {
    const params = new ParameterList();
    const conditions = this.filterConditions(filters, params, categoryId);

    const rows = await this.db.query<{ count: number }>(
      `SELECT count(*)::bigint AS count
         FROM listings
        WHERE ${conditions.join(' AND ')}`,
      params.values,
    );
    return rows[0].count;
  }

  /**
   * Shared WHERE clauses for browse and count.
   *
   * Soft-deleted rows are hidden unless the caller explicitly asks for them,
   * which is why the default status filter is an inequality rather than `=`.
   */
  private filterConditions(
    filters: BrowseListingsDto,
    params: ParameterList,
    categoryId?: number,
  ): string[] {
    const conditions = [
      filters.status === undefined
        ? `status <> ${params.bind('removed')}`
        : `status = ${params.bind(filters.status)}`,
    ];

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
    const scope = filters.categoryId ?? categoryId;
    if (scope !== undefined) {
      conditions.push(
        `category_id = ANY(ARRAY(SELECT id FROM categories WHERE path <@ (SELECT path FROM categories WHERE id = ${params.bind(scope)})))`,
      );
    }

    return conditions;
  }
}
