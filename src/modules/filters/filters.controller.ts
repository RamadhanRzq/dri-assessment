import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { FiltersService } from './filters.service.js';
import { BrowseListingsDto } from '../listings/dto/browse-listings.dto.js';
import { FilterDefinitionDto, FilterOptionsDto } from './dto/filter-response.dto.js';
import { ErrorResponseDto } from '../../shared/errors/error-response.dto.js';

@ApiTags('filters')
@Controller('filters')
export class FiltersController {
  constructor(private readonly filters: FiltersService) {}

  @Get()
  @ApiOperation({
    summary: 'Filter options with counts',
    description:
      'Counts describe the context built from the same query parameters `GET /listings/search` accepts, so a facet count always equals the number of listings that filter would return.',
  })
  @ApiOkResponse({ type: FilterOptionsDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid filter, or an `attr.*` key the category does not define.',
  })
  options(@Query() query: BrowseListingsDto) {
    return this.filters.options(query);
  }

  @Get(':categoryId')
  @ApiOperation({
    summary: 'Filter attributes for a category',
    description:
      "The category's own attributes plus every ancestor's, so a leaf exposes the filters defined higher up the tree. A child definition shadows an inherited key of the same name.",
  })
  @ApiParam({ name: 'categoryId', example: 3 })
  @ApiOkResponse({ type: [FilterDefinitionDto] })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  definitions(@Param('categoryId', ParseIntPipe) categoryId: number) {
    return this.filters.definitions(categoryId);
  }
}
