import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CategoryDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiPropertyOptional({ type: Number, nullable: true, example: null })
  parentId: number | null;

  @ApiProperty({ example: 'SUV' })
  name: string;

  @ApiProperty({ example: 'suv' })
  slug: string;

  @ApiProperty({
    example: 'cars.suv',
    description: 'Materialised path from the root; labels are slugs.',
  })
  path: string;

  @ApiProperty({ example: 2, description: 'Root categories are depth 1.' })
  depth: number;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z', format: 'date-time' })
  createdAt: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z', format: 'date-time' })
  updatedAt: string;
}

/** A category plus its direct children; `/categories/:id` returns one of these. */
export class CategoryNodeDto extends CategoryDto {
  @ApiProperty({ type: () => [CategoryDto] })
  children: CategoryDto[];
}
