import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Autocomplete query. Kept separate from browse: suggestions take no filters. */
export class SuggestListingsDto {
  @ApiProperty({ example: 'toy', minLength: 1, maxLength: 100, description: 'Prefix to match.' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  q: string;

  @ApiPropertyOptional({ example: 5, minimum: 1, maximum: 25, default: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  @IsOptional()
  limit: number = 10;

  @ApiPropertyOptional({
    type: Number,
    example: 3,
    description: 'Restrict suggestions to a category and its descendants.',
  })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  categoryId?: number;
}
