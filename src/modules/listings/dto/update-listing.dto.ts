import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
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

/**
 * PATCH semantics: every field is optional. Unknown fields are stripped rather
 * than rejected, so an empty body returns the listing unchanged.
 */
export class UpdateListingDto {
  @ApiPropertyOptional({ example: 'Toyota', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @IsOptional()
  make?: string;

  @ApiPropertyOptional({ example: 'Avanza', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @IsOptional()
  model?: string;

  @ApiPropertyOptional({ example: 2021, minimum: 1900, maximum: 2100 })
  @IsInt()
  @Min(1900)
  @Max(2100)
  @IsOptional()
  year?: number;

  @ApiPropertyOptional({ example: 35_000, minimum: 0, description: 'Kilometres driven.' })
  @IsInt()
  @Min(0)
  @IsOptional()
  mileage?: number;

  @ApiPropertyOptional({ example: 210_000_000, minimum: 0, description: 'Price in IDR.' })
  @IsInt()
  @Min(0)
  @IsOptional()
  price?: number;

  @ApiPropertyOptional({ enum: LISTING_CONDITIONS, example: 'used' })
  @IsIn(LISTING_CONDITIONS)
  @IsOptional()
  condition?: ListingCondition;

  @ApiPropertyOptional({ enum: LISTING_TRANSMISSIONS, example: 'manual' })
  @IsIn(LISTING_TRANSMISSIONS)
  @IsOptional()
  transmission?: ListingTransmission;

  @ApiPropertyOptional({ enum: LISTING_FUEL_TYPES, example: 'petrol' })
  @IsIn(LISTING_FUEL_TYPES)
  @IsOptional()
  fuelType?: ListingFuelType;

  @ApiPropertyOptional({ example: 'Silver', maxLength: 50 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @IsOptional()
  color?: string;

  @ApiPropertyOptional({ example: 'Jakarta', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 20,
    example: ['https://cdn.example.com/listings/1-1.jpg'],
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^https?:\/\/\S+$/, {
    each: true,
    message: 'each image must be an http(s) URL',
  })
  @IsOptional()
  images?: string[];

  @ApiPropertyOptional({ enum: LISTING_STATUSES, example: 'pending' })
  @IsIn(LISTING_STATUSES)
  @IsOptional()
  status?: ListingStatus;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 3,
    description: 'Category id, or null to clear it.',
  })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  categoryId?: number | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { seats: '7', accident_free: null },
    description:
      'Attribute values to set, keyed by attribute `key`. Only the supplied keys change; a `null` value removes the attribute.',
  })
  @IsObject()
  @IsOptional()
  attributes?: Record<string, unknown>;
}
