import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ErrorBodyDto {
  @ApiProperty({ example: 'not_found', description: 'Stable machine-readable code.' })
  code: string;

  @ApiProperty({ example: 'Listing 42 not found' })
  message: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['year must not be less than 1900', 'price must not be less than 0'],
    description: 'Field-level messages; only set for validation failures.',
  })
  details?: string[];
}

/**
 * The error envelope produced by ApiExceptionFilter.
 *
 * `details` is present only for validation failures, where it lists one entry
 * per offending field.
 *
 * Declared after ErrorBodyDto: emitDecoratorMetadata emits a runtime reference
 * to the property type, which a forward reference would evaluate before the
 * class is initialised.
 */
export class ErrorResponseDto {
  @ApiProperty({
    type: () => ErrorBodyDto,
    example: {
      code: 'not_found',
      message: 'Listing 42 not found',
    },
  })
  error: ErrorBodyDto;
}
