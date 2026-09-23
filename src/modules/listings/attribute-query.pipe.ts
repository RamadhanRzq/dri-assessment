import { Injectable, type PipeTransform } from '@nestjs/common';

/** Prefix that marks a query parameter as a dynamic attribute filter. */
const ATTRIBUTE_PREFIX = 'attr.';

/**
 * Collapses `attr.<key>` and `attr.<key>.<min|max>` query parameters into the
 * `attributes` object the DTO declares.
 *
 * This has to be a pipe rather than a `@Transform` on the DTO: class-transformer
 * only visits keys the source object already has, so a transform on `attributes`
 * never runs when the client sent `attr.*` instead. Registered globally *before*
 * ValidationPipe so the collapsed object exists by the time validation and
 * `whitelist` run — otherwise the raw `attr.*` keys are stripped and the filters
 * are silently dropped.
 *
 * Repeated `attr.<key>` values arrive as an array and are kept as one, which is
 * how a multi-select enum filter is expressed.
 */
@Injectable()
export class AttributeQueryPipe implements PipeTransform {
  transform(value: unknown): unknown {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;

    const query = value as Record<string, unknown>;
    const attributes: Record<string, unknown> = {};
    let found = false;

    for (const [name, raw] of Object.entries(query)) {
      if (!name.startsWith(ATTRIBUTE_PREFIX)) continue;
      found = true;

      const path = name.slice(ATTRIBUTE_PREFIX.length).split('.');
      const key = path[0];
      if (!key) continue;

      if (path.length === 1) {
        attributes[key] = raw;
      } else if (path.length === 2 && (path[1] === 'min' || path[1] === 'max')) {
        const bounds = (attributes[key] as Record<string, unknown> | undefined) ?? {};
        bounds[path[1]] = raw;
        attributes[key] = bounds;
      }
    }

    if (!found) return value;

    const rest = { ...query };
    for (const name of Object.keys(rest)) {
      if (name.startsWith(ATTRIBUTE_PREFIX)) delete rest[name];
    }

    // Only fill in `attributes` when the caller used the prefixed form, so an
    // explicit `attributes` parameter is not silently overwritten.
    return rest.attributes === undefined ? { ...rest, attributes } : rest;
  }
}
