import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  LISTING_CONDITIONS,
  LISTING_FUEL_TYPES,
  LISTING_STATUSES,
  LISTING_TRANSMISSIONS,
  type ListingCondition,
  type ListingFuelType,
  type ListingStatus,
  type ListingTransmission,
} from '../listing.types.js';

/** Sort keys map to real columns in the repository; unknown keys are rejected here. */
export const LISTING_SORT_KEYS = ['relevance', 'createdAt', 'price', 'year', 'mileage'] as const;
export type ListingSortKey = (typeof LISTING_SORT_KEYS)[number];
export type SortOrder = 'asc' | 'desc';

export class BrowseListingsDto {
  @ApiPropertyOptional({
    example: 'Toyota',
    maxLength: 100,
    description: 'Case-insensitive exact match.',
  })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  make?: string;

  @ApiPropertyOptional({
    example: 'Avanza',
    maxLength: 100,
    description: 'Case-insensitive exact match.',
  })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  model?: string;

  @ApiPropertyOptional({
    example: 'Jakarta',
    maxLength: 100,
    description: 'Case-insensitive exact match.',
  })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({ example: 100_000_000, minimum: 0, description: 'Inclusive, in IDR.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  minPrice?: number;

  @ApiPropertyOptional({ example: 300_000_000, minimum: 0, description: 'Inclusive, in IDR.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  maxPrice?: number;

  @ApiPropertyOptional({ example: 2020, minimum: 1900, maximum: 2100 })
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  @IsOptional()
  yearFrom?: number;

  @ApiPropertyOptional({ example: 2025, minimum: 1900, maximum: 2100 })
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  @IsOptional()
  yearTo?: number;

  @ApiPropertyOptional({ example: 0, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  minMileage?: number;

  @ApiPropertyOptional({ example: 100_000, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  maxMileage?: number;

  @ApiPropertyOptional({ enum: LISTING_CONDITIONS, example: 'used' })
  @IsIn(LISTING_CONDITIONS)
  @IsOptional()
  condition?: ListingCondition;

  @ApiPropertyOptional({ enum: LISTING_TRANSMISSIONS, example: 'automatic' })
  @IsIn(LISTING_TRANSMISSIONS)
  @IsOptional()
  transmission?: ListingTransmission;

  @ApiPropertyOptional({ enum: LISTING_FUEL_TYPES, example: 'petrol' })
  @IsIn(LISTING_FUEL_TYPES)
  @IsOptional()
  fuelType?: ListingFuelType;

  @ApiPropertyOptional({
    enum: LISTING_STATUSES,
    description: 'Omit to browse every status except `removed`.',
  })
  @IsIn(LISTING_STATUSES)
  @IsOptional()
  status?: ListingStatus;

  @ApiPropertyOptional({
    type: Number,
    example: 3,
    description: 'Category id; matches the category and all of its descendants.',
  })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  categoryId?: number;

  @ApiPropertyOptional({
    maxLength: 200,
    example: 'toyota avanza',
    description:
      'Full-text query over make, model, and location. Terms combine with AND; `or` and `-term` are honoured.',
  })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  q?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { seats: '7', engine_capacity: { min: 1500 } },
    description:
      'Category-specific filter attributes, keyed by attribute `key`. Assembled from the `attr.` query prefix, e.g. `attr.seats=7` or `attr.engine_capacity.min=1500`. Valid only for attributes the category exposes; unknown keys are rejected.',
  })
  @IsObject()
  @IsOptional()
  attributes?: Record<string, unknown>;

  @ApiPropertyOptional({
    enum: LISTING_SORT_KEYS,
    description:
      'Column to order by. Always tie-broken by `id`. `relevance` requires `q` and defaults when `q` is present.',
  })
  @IsIn(LISTING_SORT_KEYS)
  @IsOptional()
  sort?: ListingSortKey;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsIn(['asc', 'desc'])
  @IsOptional()
  order: SortOrder = 'desc';

  @ApiPropertyOptional({
    maxLength: 500,
    description:
      'Keyset cursor from a previous response. Bound to the sort key it was issued for, so changing `sort` invalidates it.',
  })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  cursor?: string;


  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit: number = 20;
}
