import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../shared/database/database.service.js';
import { CATEGORY_COLUMNS, type CategoryRow } from './category.types.js';
import type { CreateCategoryDto } from './dto/create-category.dto.js';
import type { UpdateCategoryDto } from './dto/update-category.dto.js';

@Injectable()
export class CategoriesRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Whole tree in one query; the service assembles it without N+1 lookups. */
  async findAll(): Promise<CategoryRow[]> {
    return this.db.query<CategoryRow>(
      `SELECT ${CATEGORY_COLUMNS} FROM categories ORDER BY path`,
    );
  }

  async findById(id: number): Promise<CategoryRow | undefined> {
    const rows = await this.db.query<CategoryRow>(
      `SELECT ${CATEGORY_COLUMNS} FROM categories WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  async findByParent(parentId: number | null): Promise<CategoryRow[]> {
    const rows = await this.db.query<CategoryRow>(
      `SELECT ${CATEGORY_COLUMNS}
         FROM categories
        WHERE parent_id IS NOT DISTINCT FROM $1
        ORDER BY path`,
      [parentId],
    );
    return rows;
  }

  async findSiblingBySlug(parentId: number | null, slug: string): Promise<CategoryRow | undefined> {
    const rows = await this.db.query<CategoryRow>(
      `SELECT ${CATEGORY_COLUMNS}
         FROM categories
        WHERE parent_id IS NOT DISTINCT FROM $1 AND slug = $2`,
      [parentId, slug],
    );
    return rows[0];
  }

  /**
   * The path is derived from the parent inside the INSERT, so it can never
   * disagree with the tree it describes.
   */
  async create(dto: CreateCategoryDto): Promise<CategoryRow> {
    const rows = await this.db.query<CategoryRow>(
      `INSERT INTO categories (parent_id, name, slug, path, depth)
       SELECT $1, $2, $3,
              (COALESCE(parent.path::text || '.', '') || $3)::ltree,
              COALESCE(parent.depth, 0) + 1
         FROM (SELECT 1) AS one
         LEFT JOIN categories parent ON parent.id = $1
       RETURNING ${CATEGORY_COLUMNS}`,
      [dto.parentId ?? null, dto.name, dto.slug],
    );
    return rows[0];
  }

  /**
   * Renaming rewrites the node's own path segment and, when the slug changed,
   * the same segment in every descendant.
   *
   * Descendants are rewritten before the node itself: the match is on the old
   * path, which stops being true once the node moves. The new prefix comes from
   * the node's updated path so both halves of the rewrite agree.
   */
  async update(
    id: number,
    current: CategoryRow,
    dto: UpdateCategoryDto,
  ): Promise<CategoryRow | undefined> {
    return this.db.withTransaction(async (client) => {
      const renaming = dto.slug !== undefined && dto.slug !== current.slug;

      if (renaming) {
        // Rebuild each descendant's path from the node's new path plus the
        // descendant's own tail below this node.
        await client.query(
          `UPDATE categories
              SET path = $3::ltree || subpath(path, $4),
                  updated_at = now()
            WHERE path <@ $2::ltree AND id <> $1`,
          [
            id,
            current.path,
            `${current.path.split('.').slice(0, -1).concat(dto.slug as string).join('.')}`,
            current.depth,
          ],
        );
      }

      const rows = await client.query<CategoryRow>(
        `UPDATE categories
            SET name = COALESCE($2, name),
                slug = COALESCE($3, slug),
                path = CASE
                         WHEN $3::text IS NULL THEN path
                         ELSE subpath(path, 0, depth - 1) || $3::text::ltree
                       END,
                updated_at = now()
          WHERE id = $1
          RETURNING ${CATEGORY_COLUMNS}`,
        [id, dto.name ?? null, dto.slug ?? null],
      );

      return rows.rows[0];
    });
  }
}
