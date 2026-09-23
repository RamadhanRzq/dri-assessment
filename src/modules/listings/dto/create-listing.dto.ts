import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateListingDto {
  @ApiProperty({ example: 'Toyota', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  make: string;

  @ApiProperty({ example: 'Avanza', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  model: string;

  @ApiProperty({ example: 2021, minimum: 1900, maximum: 2100 })
  @IsInt()
  @Min(1900)
  @Max(2100)
  year: number;

  @ApiProperty({ example: 35_000, minimum: 0, description: 'Kilometres driven.' })
  @IsInt()
  @Min(0)
  mileage: number;

  @ApiProperty({ example: 210_000_000, minimum: 0, description: 'Price in IDR.' })
  @IsInt()
  @Min(0)
  price: number;

  @ApiProperty({ enum: LISTING_CONDITIONS, example: 'used' })
  @IsIn(LISTING_CONDITIONS)
  condition: ListingCondition;

  @ApiProperty({ enum: LISTING_TRANSMISSIONS, example: 'manual' })
  @IsIn(LISTING_TRANSMISSIONS)
  transmission: ListingTransmission;

  @ApiProperty({ enum: LISTING_FUEL_TYPES, example: 'petrol' })
  @IsIn(LISTING_FUEL_TYPES)
  fuelType: ListingFuelType;

  @ApiProperty({ example: 'Silver', maxLength: 50 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  color: string;

  @ApiProperty({ example: 'Jakarta', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  location: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 20,
    example: ['https://cdn.example.com/listings/1-1.jpg'],
    description: 'Defaults to an empty array.',
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

  @ApiPropertyOptional({
    enum: LISTING_STATUSES,
    example: 'available',
    description: 'Defaults to `available`.',
  })
  @IsIn(LISTING_STATUSES)
  @IsOptional()
  status?: ListingStatus;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 3,
    description: 'Category id. Omit to leave the listing uncategorised.',
  })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  categoryId?: number | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { seats: '7', engine_capacity: 1500, accident_free: true },
    description:
      "Dynamic attribute values keyed by the attribute's `key`. Each key must be defined on the listing's category or one of its ancestors; values are checked against the attribute's type.",
  })
  @IsObject()
  @IsOptional()
  attributes?: Record<string, unknown>;
}
