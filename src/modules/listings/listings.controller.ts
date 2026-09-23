import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ListingsService } from './listings.service.js';
import { CreateListingDto } from './dto/create-listing.dto.js';
import { UpdateListingDto } from './dto/update-listing.dto.js';
import { BrowseListingsDto } from './dto/browse-listings.dto.js';
import { ListingDto, ListingPageDto } from './dto/listing-response.dto.js';
import { ErrorResponseDto } from '../../shared/errors/error-response.dto.js';

@ApiTags('listings')
@Controller('listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a vehicle listing' })
  @ApiCreatedResponse({ type: ListingDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Payload failed validation; `details` lists each offending field.',
  })
  create(@Body() dto: CreateListingDto) {
    return this.listings.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Browse listings',
    description:
      'Filters combine with AND. Soft-deleted listings are hidden unless `status=removed` is passed. Results are keyset paginated: follow `pagination.nextCursor`.',
  })
  @ApiOkResponse({ type: ListingPageDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid filter, cursor, or sort key.',
  })
  browse(@Query() query: BrowseListingsDto) {
    return this.listings.browse(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single listing' })
  @ApiParam({ name: 'id', example: 1 })
  @ApiOkResponse({ type: ListingDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: '`id` is not numeric.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.listings.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a listing',
    description: 'Only the supplied fields change. Unknown fields are ignored.',
  })
  @ApiParam({ name: 'id', example: 1 })
  @ApiOkResponse({ type: ListingDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateListingDto) {
    return this.listings.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft-delete a listing',
    description:
      'Sets `status` to `removed` and keeps the row. The response is the updated listing.',
  })
  @ApiParam({ name: 'id', example: 1 })
  @ApiOkResponse({ type: ListingDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.listings.remove(id);
  }
}
