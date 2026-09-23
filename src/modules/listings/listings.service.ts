import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { encodeCursor, decodeCursor } from '../../shared/pagination/cursor.js';
import { ListingsRepository } from './listings.repository.js';
import type { BrowseRow, ListingRow } from './listing.types.js';
import type { CreateListingDto } from './dto/create-listing.dto.js';
import type { UpdateListingDto } from './dto/update-listing.dto.js';
import type { BrowseListingsDto } from './dto/browse-listings.dto.js';
import type { ListingDto, ListingPageDto } from './dto/listing-response.dto.js';

export type ListingPage = ListingPageDto;

@Injectable()
export class ListingsService {
  constructor(private readonly repository: ListingsRepository) {}

  async create(dto: CreateListingDto): Promise<ListingDto> {
    return toResponse(await this.repository.create(dto));
  }

  async findOne(id: number): Promise<ListingDto> {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException(`Listing ${id} not found`);
    return toResponse(row);
  }

  async update(id: number, dto: UpdateListingDto): Promise<ListingDto> {
    const row = await this.repository.update(id, dto);
    if (!row) throw new NotFoundException(`Listing ${id} not found`);
    return toResponse(row);
  }

  /** DELETE is a soft delete: the row is kept with status `removed`. */
  async remove(id: number): Promise<ListingDto> {
    const row = await this.repository.softDelete(id);
    if (!row) throw new NotFoundException(`Listing ${id} not found`);
    return toResponse(row);
  }

  async browse(filters: BrowseListingsDto, categoryId?: number): Promise<ListingPageDto> {
    if (
      filters.minPrice !== undefined &&
      filters.maxPrice !== undefined &&
      filters.minPrice > filters.maxPrice
    ) {
      throw new BadRequestException('minPrice must not exceed maxPrice');
    }
    if (
      filters.yearFrom !== undefined &&
      filters.yearTo !== undefined &&
      filters.yearFrom > filters.yearTo
    ) {
      throw new BadRequestException('yearFrom must not exceed yearTo');
    }
    if (
      filters.minMileage !== undefined &&
      filters.maxMileage !== undefined &&
      filters.minMileage > filters.maxMileage
    ) {
      throw new BadRequestException('minMileage must not exceed maxMileage');
    }

    const cursor = filters.cursor ? decodeCursor(filters.cursor, filters.sort) : null;

    // The extra row only signals that another page exists; it is not returned.
    const rows = await this.repository.browse(filters, cursor, categoryId);
    const hasMore = rows.length > filters.limit;
    const page = hasMore ? rows.slice(0, filters.limit) : rows;

    const total = await this.repository.count(filters, categoryId);
    const last = page.at(-1);

    return {
      data: page.map(toResponse),
      pagination: {
        limit: filters.limit,
        hasMore,
        total,
        nextCursor:
          hasMore && last
            ? encodeCursor({
                sort: filters.sort,
                value: cursorValue(last, filters),
                id: last.id,
              })
            : null,
      },
    };
  }
}

/** Value of the active sort column for the row that ends the page. */
function cursorValue(row: BrowseRow, filters: BrowseListingsDto): string | number {
  switch (filters.sort) {
    case 'price':
      return row.price;
    case 'year':
      return row.year;
    case 'mileage':
      return row.mileage;
    default:
      return row.created_at_cursor;
  }
}

function toResponse(row: ListingRow): ListingDto {
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
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
