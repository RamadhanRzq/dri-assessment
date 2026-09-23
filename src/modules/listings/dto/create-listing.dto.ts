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

export class CreateListingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  make: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  model: string;

  @IsInt()
  @Min(1900)
  @Max(2100)
  year: number;

  @IsInt()
  @Min(0)
  mileage: number;

  @IsInt()
  @Min(0)
  price: number;

  @IsIn(LISTING_CONDITIONS)
  condition: ListingCondition;

  @IsIn(LISTING_TRANSMISSIONS)
  transmission: ListingTransmission;

  @IsIn(LISTING_FUEL_TYPES)
  fuelType: ListingFuelType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  color: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  location: string;

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
