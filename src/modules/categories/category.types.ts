export type CategoryRow = {
  id: number;
  parent_id: number | null;
  name: string;
  slug: string;
  path: string;
  depth: number;
  created_at: Date;
  updated_at: Date;
};

export const CATEGORY_COLUMNS = 'id, parent_id, name, slug, path::text AS path, depth, created_at, updated_at';

/** Slug rules: lowercase alphanumerics separated by single dashes. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
