import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
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
export const LISTING_SORT_KEYS = ['createdAt', 'price', 'year', 'mileage'] as const;
export type ListingSortKey = (typeof LISTING_SORT_KEYS)[number];
export type SortOrder = 'asc' | 'desc';

export class BrowseListingsDto {
  @IsString()
  @MaxLength(100)
  @IsOptional()
  make?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  model?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  location?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  minPrice?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  maxPrice?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  @IsOptional()
  yearFrom?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  @IsOptional()
  yearTo?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  minMileage?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  maxMileage?: number;

  @IsIn(LISTING_CONDITIONS)
  @IsOptional()
  condition?: ListingCondition;

  @IsIn(LISTING_TRANSMISSIONS)
  @IsOptional()
  transmission?: ListingTransmission;

  @IsIn(LISTING_FUEL_TYPES)
  @IsOptional()
  fuelType?: ListingFuelType;

  /** Omit to browse every non-removed listing; pass `removed` to target them. */
  @IsIn(LISTING_STATUSES)
  @IsOptional()
  status?: ListingStatus;

  @IsIn(LISTING_SORT_KEYS)
  @IsOptional()
  sort: ListingSortKey = 'createdAt';

  @IsIn(['asc', 'desc'])
  @IsOptional()
  order: SortOrder = 'desc';

  @IsString()
  @MaxLength(500)
  @IsOptional()
  cursor?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit: number = 20;
}
