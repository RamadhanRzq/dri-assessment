import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { SLUG_PATTERN } from '../category.types.js';

export class CreateCategoryDto {
  @ApiProperty({ example: 'SUV', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    example: 'suv',
    maxLength: 100,
    description:
      'Lowercase alphanumerics separated by single dashes. Unique among siblings; the stored path is built from it.',
  })
  @IsString()
  @Matches(SLUG_PATTERN, { message: 'slug must be lowercase alphanumerics separated by dashes' })
  @MaxLength(100)
  slug: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 1,
    description: 'Parent category id. Omit for a root category.',
  })
  @IsOptional()
  parentId?: number | null;
}
