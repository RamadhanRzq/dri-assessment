import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CategoriesService } from './categories.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';
import { CategoryDto, CategoryNodeDto } from './dto/category-response.dto.js';
import { ErrorResponseDto } from '../../shared/errors/error-response.dto.js';
import { ListingsService } from '../listings/listings.service.js';
import { BrowseListingsDto } from '../listings/dto/browse-listings.dto.js';
import { ListingPageDto } from '../listings/dto/listing-response.dto.js';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly listings: ListingsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get the full category tree',
    description: 'Nested by parent. Built from a single query, not one per level.',
  })
  @ApiOkResponse({ type: [CategoryNodeDto] })
  getTree() {
    return this.categories.findTree();
  }

  @Post()
  @ApiOperation({
    summary: 'Create a category node',
    description: 'The path is derived from the parent, so depth is arbitrary.',
  })
  @ApiCreatedResponse({ type: CategoryDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'A sibling already uses this slug.',
  })
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a category with its direct children' })
  @ApiParam({ name: 'id', example: 1 })
  @ApiOkResponse({ type: CategoryNodeDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.categories.findOne(id);
  }

  @Get(':id/listings')
  @ApiOperation({
    summary: 'Browse listings in a category and its descendants',
    description:
      'Same filters, sorting, and cursor pagination as GET /listings, scoped to the subtree.',
  })
  @ApiParam({ name: 'id', example: 1 })
  @ApiOkResponse({ type: ListingPageDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  browseListings(@Param('id', ParseIntPipe) id: number, @Query() query: BrowseListingsDto) {
    // The category is resolved to its subtree before the query, so a bad id
    // fails as 404 rather than silently returning every listing.
    return this.categories.listingsInCategory(id, query);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Rename a category',
    description:
      'Renaming the slug rewrites the path of this category and every descendant. Reparenting is not supported.',
  })
  @ApiParam({ name: 'id', example: 1 })
  @ApiOkResponse({ type: CategoryDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(id, dto);
  }
}
