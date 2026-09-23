import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CategoriesRepository } from './categories.repository.js';
import type { CategoryRow } from './category.types.js';
import type { CreateCategoryDto } from './dto/create-category.dto.js';
import type { UpdateCategoryDto } from './dto/update-category.dto.js';
import type { CategoryDto, CategoryNodeDto } from './dto/category-response.dto.js';
import { ListingsService } from '../listings/listings.service.js';
import type { ListingPage } from '../listings/listings.service.js';
import type { BrowseListingsDto } from '../listings/dto/browse-listings.dto.js';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly repository: CategoriesRepository,
    private readonly listings: ListingsService,
  ) {}

  /** Full tree, nested, built from one flat query. */
  async findTree(): Promise<CategoryNodeDto[]> {
    const rows = await this.repository.findAll();
    return buildTree(rows, null);
  }

  /** A single category with its direct children. */
  async findOne(id: number): Promise<CategoryNodeDto> {
    const row = await this.requireCategory(id);
    const children = await this.repository.findByParent(id);
    return toNode(row, children);
  }

  async create(dto: CreateCategoryDto): Promise<CategoryDto> {
    if (dto.parentId != null) {
      await this.requireCategory(dto.parentId);
    }

    const sibling = await this.repository.findSiblingBySlug(dto.parentId ?? null, dto.slug);
    if (sibling) {
      throw new ConflictException(
        `A category with slug '${dto.slug}' already exists at this level`,
      );
    }

    return toDto(await this.repository.create(dto));
  }

  async update(id: number, dto: UpdateCategoryDto): Promise<CategoryDto> {
    const current = await this.requireCategory(id);

    if (dto.slug !== undefined && dto.slug !== current.slug) {
      const sibling = await this.repository.findSiblingBySlug(current.parent_id, dto.slug);
      if (sibling) {
        throw new ConflictException(
          `A category with slug '${dto.slug}' already exists at this level`,
        );
      }
    }

    const updated = await this.repository.update(id, current, dto);
    if (!updated) throw new NotFoundException(`Category ${id} not found`);
    return toDto(updated);
  }

  /** Listings in this category and everything beneath it. */
  async listingsInCategory(id: number, query: BrowseListingsDto): Promise<ListingPage> {
    await this.requireCategory(id);
    return this.listings.browse(query, id);
  }

  private async requireCategory(id: number): Promise<CategoryRow> {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException(`Category ${id} not found`);
    return row;
  }
}

function buildTree(rows: CategoryRow[], parentId: number | null): CategoryNodeDto[] {
  return rows
    .filter((row) => row.parent_id === parentId)
    .map((row) => toNode(row, buildTree(rows, row.id)));
}

/**
 * Assembled from plain fields rather than by spreading a DTO, which would drop
 * the class prototype.
 */
function toNode(row: CategoryRow, children: CategoryRow[] | CategoryNodeDto[]): CategoryNodeDto {
  const base = toDto(row);
  return {
    id: base.id,
    parentId: base.parentId,
    name: base.name,
    slug: base.slug,
    path: base.path,
    depth: base.depth,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    children: children.map((child) => ('parent_id' in child ? toDto(child) : child)),
  };
}

function toDto(row: CategoryRow): CategoryDto {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    slug: row.slug,
    path: row.path,
    depth: row.depth,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
