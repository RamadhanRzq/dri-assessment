import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { encodeCursor, decodeCursor } from '../../shared/pagination/cursor.js';
import { ListingsRepository, type ListingQuery } from './listings.repository.js';
import { resolveSort } from './listing-query.js';
import { FiltersRepository } from '../filters/filters.repository.js';
import { parseAttributeValue, resolveAttributeFilters } from '../filters/attribute-values.js';
import type { AttributeValueColumns } from '../filters/attribute-values.js';
import type { BrowseRow, ListingRow } from './listing.types.js';
import type { CreateListingDto } from './dto/create-listing.dto.js';
import type { UpdateListingDto } from './dto/update-listing.dto.js';
import type { BrowseListingsDto, ListingSortKey } from './dto/browse-listings.dto.js';
import type { SuggestListingsDto } from './dto/suggest-listings.dto.js';
import type {
  ListingDto,
  ListingPageDto,
  SuggestResponseDto,
} from './dto/listing-response.dto.js';

export type ListingPage = ListingPageDto;

@Injectable()
export class ListingsService {
  constructor(
    private readonly repository: ListingsRepository,
    private readonly filters: FiltersRepository,
  ) {}

  async create(dto: CreateListingDto): Promise<ListingDto> {
    const attributes = await this.attributeWrites(dto.categoryId ?? undefined, dto.attributes);
    const row = await this.repository.create(dto, attributes);
    return this.toDto(row);
  }

  async findOne(id: number): Promise<ListingDto> {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException(`Listing ${id} not found`);
    return this.toDto(row);
  }

  async update(id: number, dto: UpdateListingDto): Promise<ListingDto> {
    const current = await this.repository.findById(id);
    if (!current) throw new NotFoundException(`Listing ${id} not found`);

    // An attribute update without a new categoryId is checked against the
    // listing's existing category, so a client cannot attach values the listing's
    // category does not define.
    const categoryId = dto.categoryId === undefined ? (current.category_id ?? undefined) : (dto.categoryId ?? undefined);
    const attributes =
      dto.attributes === undefined ? undefined : await this.attributeWrites(categoryId, dto.attributes);

    const row = await this.repository.update(id, dto, attributes);
    if (!row) throw new NotFoundException(`Listing ${id} not found`);
    return this.toDto(row);
  }

  /** DELETE is a soft delete: the row is kept with status `removed`. */
  async remove(id: number): Promise<ListingDto> {
    const row = await this.repository.softDelete(id);
    if (!row) throw new NotFoundException(`Listing ${id} not found`);
    return this.toDto(row);
  }

  async browse(query: BrowseListingsDto, categoryId?: number): Promise<ListingPageDto> {
    validateRanges(query);
    return this.page(await this.query(query, categoryId));
  }

  /** Autocomplete over make, model, and city. */
  async suggest(query: SuggestListingsDto): Promise<SuggestResponseDto> {
    const rows = await this.repository.suggest(query.q, query.limit, query.categoryId);
    return {
      data: rows.map((row) => ({ type: row.type, value: row.value, count: row.count })),
    };
  }

  /** Single listing with its attribute values, read in one extra query. */
  private async toDto(row: ListingRow): Promise<ListingDto> {
    const values = await this.repository.findAttributeValues([row.id]);
    return toResponse(row, values.get(row.id));
  }

  /** Interpreted request: filters plus the attribute values they resolve to. */
  private async resolve(query: BrowseListingsDto): Promise<ListingQuery> {
    const definitions = await this.filters.findAttributes(query.categoryId);
    return {
      filters: query,
      attributeFilters: resolveAttributeFilters(query.attributes ?? {}, definitions),
      categoryId: undefined,
    };
  }

  private async query(query: BrowseListingsDto, categoryId?: number): Promise<ListingQuery> {
    const resolved = await this.resolve(query);
    return { ...resolved, categoryId };
  }

  /**
   * Validates and writes the requested attribute values against the definitions
   * the category exposes. Returns an empty list when the request carries none.
   */
  private async attributeWrites(
    categoryId: number | undefined,
    attributes: Record<string, unknown> | undefined,
  ): Promise<{ attributeId: number; value: AttributeValueColumns | null }[]> {
    if (attributes === undefined) return [];

    const definitions = await this.filters.findAttributes(categoryId);
    const writes: { attributeId: number; value: AttributeValueColumns | null }[] = [];

    for (const [key, raw] of Object.entries(attributes)) {
      const definition = definitions.find((candidate) => candidate.key === key);
      if (!definition) {
        throw new BadRequestException(
          `Unknown filter attribute '${key}'${categoryId === undefined ? '' : ` for category ${categoryId}`}`,
        );
      }
      writes.push({
        attributeId: definition.id,
        value: raw === null ? null : parseAttributeValue(definition, raw),
      });
    }

    return writes;
  }

  /** Shared page assembly: cursor decode, limit+1 probe, count, next cursor. */
  private async page(query: ListingQuery): Promise<ListingPageDto> {
    const { filters } = query;
    const sortKey = resolveSort(filters).key;
    const cursor = filters.cursor ? decodeCursor(filters.cursor, sortKey) : null;

    // The extra row only signals that another page exists; it is not returned.
    const rows = await this.repository.browse(query, cursor);
    const hasMore = rows.length > filters.limit;
    const page = hasMore ? rows.slice(0, filters.limit) : rows;

    const total = await this.repository.count(query);
    const last = page.at(-1);
    const attributes = await this.repository.findAttributeValues(page.map((row) => row.id));

    return {
      data: page.map((row) => toResponse(row, attributes.get(row.id))),
      pagination: {
        limit: filters.limit,
        hasMore,
        total,
        nextCursor:
          hasMore && last
            ? encodeCursor({ sort: sortKey, value: cursorValue(last, sortKey), id: last.id })
            : null,
      },
    };
  }
}

/** Value of the active sort column for the row that ends the page. */
function cursorValue(row: BrowseRow, sort: ListingSortKey): string | number {
  switch (sort) {
    case 'price':
      return row.price;
    case 'year':
      return row.year;
    case 'mileage':
      return row.mileage;
    case 'relevance':
      return row.relevance ?? 0;
    default:
      return row.created_at_cursor;
  }
}

function validateRanges(query: BrowseListingsDto): void {
  if (
    query.minPrice !== undefined &&
    query.maxPrice !== undefined &&
    query.minPrice > query.maxPrice
  ) {
    throw new BadRequestException('minPrice must not exceed maxPrice');
  }
  if (query.yearFrom !== undefined && query.yearTo !== undefined && query.yearFrom > query.yearTo) {
    throw new BadRequestException('yearFrom must not exceed yearTo');
  }
  if (
    query.minMileage !== undefined &&
    query.maxMileage !== undefined &&
    query.minMileage > query.maxMileage
  ) {
    throw new BadRequestException('minMileage must not exceed maxMileage');
  }
}

function toResponse(
  row: ListingRow,
  attributes: Record<string, unknown> = {},
): ListingDto {
  return {
    id: row.id,
    make: row.make,
    model: row.model,
    year: row.year,
    mileage: row.mileage,
    price: row.price,
    condition: row.condition,
    transmission: row.transmission,
    fuelType: row.fuel_type,
    color: row.color,
    images: row.images,
    location: row.location,
    status: row.status,
    categoryId: row.category_id,
    attributes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
