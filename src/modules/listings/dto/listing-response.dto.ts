import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  LISTING_CONDITIONS,
  LISTING_FUEL_TYPES,
  LISTING_STATUSES,
  LISTING_TRANSMISSIONS,
} from '../listing.types.js';

/**
 * Wire shape of a listing. Separate from ListingRow because the row keeps
 * snake_case columns and Date timestamps; the API exposes camelCase ISO strings.
 */
export class ListingDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Toyota' })
  make: string;

  @ApiProperty({ example: 'Avanza' })
  model: string;

  @ApiProperty({ example: 2021, minimum: 1900, maximum: 2100 })
  year: number;

  @ApiProperty({ example: 35_000, description: 'Kilometres driven.' })
  mileage: number;

  @ApiProperty({ example: 210_000_000, description: 'Price in IDR.' })
  price: number;

  @ApiProperty({ enum: LISTING_CONDITIONS, example: 'used' })
  condition: string;

  @ApiProperty({ enum: LISTING_TRANSMISSIONS, example: 'manual' })
  transmission: string;

  @ApiProperty({ enum: LISTING_FUEL_TYPES, example: 'petrol' })
  fuelType: string;

  @ApiProperty({ example: 'Silver' })
  color: string;

  @ApiProperty({
    type: [String],
    example: ['https://cdn.example.com/listings/1-1.jpg'],
    description: 'Empty array when the listing has no photos.',
  })
  images: string[];

  @ApiProperty({ example: 'Jakarta' })
  location: string;

  @ApiProperty({ enum: LISTING_STATUSES, example: 'available' })
  status: string;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 3 })
  categoryId: number | null;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z', format: 'date-time' })
  createdAt: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z', format: 'date-time' })
  updatedAt: string;
}

export class PaginationDto {
  @ApiProperty({ example: 20, description: 'Page size that was applied.' })
  limit: number;

  @ApiProperty({ example: true })
  hasMore: boolean;

  @ApiProperty({
    example: 474,
    description: 'Total rows matching the filters, ignoring the cursor and page size.',
  })
  total: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'WzEsImNyZWF0ZWRBdCIsIjIwMjYtMDEtMDEgMDc6MDA6MDArMDciLDQyNF0',
    description:
      'Opaque keyset cursor for the next page. Null when this is the last page. Pass it back as `cursor`; it is bound to the sort key it was issued for.',
  })
  nextCursor: string | null;
}

export class ListingPageDto {
  @ApiProperty({ type: [ListingDto] })
  data: ListingDto[];

  @ApiProperty({ type: PaginationDto })
  pagination: PaginationDto;
}
