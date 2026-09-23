import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FILTER_ATTRIBUTE_TYPES } from '../filter.types.js';

export class FilterDefinitionDto {
  @ApiProperty({ example: 'engine_capacity', description: 'Query parameter name.' })
  key: string;

  @ApiProperty({ example: 'Engine Capacity' })
  label: string;

  @ApiProperty({ enum: FILTER_ATTRIBUTE_TYPES, example: 'range' })
  type: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'cc' })
  unit: string | null;

  @ApiProperty({
    type: [String],
    example: ['5', '7'],
    description: 'Allowed values for `enum`; empty for `range` and `boolean`.',
  })
  options: string[];

  @ApiProperty({ example: 3, description: 'Category the attribute is defined on.' })
  categoryId: number;
}

export class FacetValueDto {
  @ApiProperty({ example: 'Toyota' })
  value: string;

  @ApiProperty({ example: 42, description: 'Listings matching the current filters.' })
  count: number;
}

export class FacetDto {
  @ApiProperty({ example: 'make' })
  key: string;

  @ApiProperty({ type: [FacetValueDto] })
  values: FacetValueDto[];
}

export class AttributeFacetDto extends FilterDefinitionDto {
  @ApiProperty({
    type: [FacetValueDto],
    description: 'Allowed values with the count each currently matches.',
  })
  values: FacetValueDto[];

  @ApiProperty({ example: 42, description: 'Listings carrying any value for this attribute.' })
  count: number;
}

export class RangeFacetDto extends FilterDefinitionDto {
  @ApiPropertyOptional({ type: Number, nullable: true, example: 1500, description: 'Observed lower bound.' })
  min: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 3500, description: 'Observed upper bound.' })
  max: number | null;

  @ApiProperty({ example: 42, description: 'Listings carrying a value for this attribute.' })
  count: number;
}

export class RangeFacetBoundsDto {
  @ApiProperty({ example: 'price' })
  key: string;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 20_000_000 })
  min: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 1_500_000_000 })
  max: number | null;

  @ApiProperty({ example: 42, description: 'Listings the bounds were computed over.' })
  count: number;
}

export class FilterOptionsDto {
  @ApiProperty({ example: 42, description: 'Listings matching the current filters.' })
  total: number;

  @ApiProperty({ type: [FacetDto] })
  facets: FacetDto[];

  @ApiProperty({
    type: [FilterDefinitionDto],
    description: 'Category attributes with counts; `range` attributes carry `min`/`max`.',
  })
  attributes: FilterDefinitionDto[];

  @ApiProperty({ type: RangeFacetBoundsDto })
  price: RangeFacetBoundsDto;

  @ApiProperty({ type: RangeFacetBoundsDto })
  year: RangeFacetBoundsDto;
}
