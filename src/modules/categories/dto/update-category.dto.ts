import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { SLUG_PATTERN } from '../category.types.js';

/**
 * PATCH semantics: rename only. Moving a node would have to rewrite the path of
 * every descendant, so reparenting is a separate concern and not exposed here.
 */
export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: 'SUV', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    example: 'suv',
    maxLength: 100,
    description: 'Renaming the slug also rewrites this category path.',
  })
  @IsString()
  @Matches(SLUG_PATTERN, { message: 'slug must be lowercase alphanumerics separated by dashes' })
  @MaxLength(100)
  @IsOptional()
  slug?: string;
}
