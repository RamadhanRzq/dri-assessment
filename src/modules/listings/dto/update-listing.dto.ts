import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
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
 * PATCH semantics: every field is optional, but at least one must be present
 * (enforced in the service so the message can name the actual problem).
 */
export class UpdateListingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @IsOptional()
  make?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @IsOptional()
  model?: string;

  @IsInt()
  @Min(1900)
  @Max(2100)
  @IsOptional()
  year?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  mileage?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  price?: number;

  @IsIn(LISTING_CONDITIONS)
  @IsOptional()
  condition?: ListingCondition;

  @IsIn(LISTING_TRANSMISSIONS)
  @IsOptional()
  transmission?: ListingTransmission;

  @IsIn(LISTING_FUEL_TYPES)
  @IsOptional()
  fuelType?: ListingFuelType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @IsOptional()
  color?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @IsOptional()
  location?: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^https?:\/\/\S+$/, {
    each: true,
    message: 'each image must be an http(s) URL',
  })
  @IsOptional()
  images?: string[];

  @IsIn(LISTING_STATUSES)
  @IsOptional()
  status?: ListingStatus;
}
