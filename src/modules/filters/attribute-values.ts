import { BadRequestException } from '@nestjs/common';
import type { ResolvedAttributeFilter } from '../listings/listing-query.js';
import type { FilterAttributeRow } from './filter.types.js';

/**
 * The typed column values for one stored attribute value. Exactly one field is
 * set, matching the `listing_attribute_values_single_value` CHECK.
 */
export type AttributeValueColumns =
  | { value_text: string; value_num?: undefined; value_bool?: undefined }
  | { value_num: number; value_text?: undefined; value_bool?: undefined }
  | { value_bool: boolean; value_text?: undefined; value_num?: undefined };

/**
 * Parses the request's `attr.*` map against the category's attribute
 * definitions.
 *
 * Keys are checked against the definitions rather than a DTO whitelist,
 * because the attribute set is data: an unknown key is a client error, not a
 * silently ignored parameter.
 */
export function resolveAttributeFilters(
  raw: Record<string, unknown>,
  definitions: FilterAttributeRow[],
): ResolvedAttributeFilter[] {
  const resolved: ResolvedAttributeFilter[] = [];

  for (const [key, value] of Object.entries(raw)) {
    const definition = definitions.find((candidate) => candidate.key === key);
    if (!definition) {
      throw new BadRequestException(`Unknown filter attribute '${key}'`);
    }
    resolved.push(parseAttributeFilter(definition, value));
  }

  return resolved;
}

/**
 * Validates a value destined for `listing_attribute_values` against the
 * attribute's declared type, so a mistyped value is a 400 rather than a
 * constraint violation.
 */
export function parseAttributeValue(
  definition: FilterAttributeRow,
  raw: unknown,
): AttributeValueColumns {
  const fail = (expected: string): never => {
    throw new BadRequestException(
      `Attribute '${definition.key}' expects ${expected}`,
    );
  };

  switch (definition.type) {
    case 'enum': {
      if (typeof raw !== 'string' && typeof raw !== 'number') {
        return fail('one of: ' + definition.options.join(', '));
      }
      const value = String(raw);
      if (!definition.options.includes(value)) {
        throw new BadRequestException(
          `Attribute '${definition.key}' does not allow '${value}'; expected one of: ${definition.options.join(', ')}`,
        );
      }
      return { value_text: value };
    }

    case 'boolean':
      if (typeof raw !== 'boolean') return fail('true or false');
      return { value_bool: raw };

    case 'range':
      return { value_num: toNumber(raw, definition.key) };
  }
}

/**
 * `attr.seats=7` for enum and boolean, `attr.engine_capacity.min=1500` for
 * range. A bare number on a range attribute is read as its lower bound, which
 * is what `?attr.engine_capacity=1500` means to a caller.
 */
function parseAttributeFilter(
  definition: FilterAttributeRow,
  raw: unknown,
): ResolvedAttributeFilter {
  const fail = (expected: string): never => {
    throw new BadRequestException(
      `Filter attribute '${definition.key}' expects ${expected}`,
    );
  };

  switch (definition.type) {
    case 'enum': {
      const values = (Array.isArray(raw) ? raw : [raw]).map(String);
      if (values.length === 0) return fail('one of: ' + definition.options.join(', '));
      for (const value of values) {
        if (!definition.options.includes(value)) {
          throw new BadRequestException(
            `Filter attribute '${definition.key}' does not allow '${value}'; expected one of: ${definition.options.join(', ')}`,
          );
        }
      }
      return { key: definition.key, attributeId: definition.id, type: 'enum', values };
    }

    case 'boolean': {
      const text = String(raw).toLowerCase();
      if (text !== 'true' && text !== 'false') return fail('true or false');
      return {
        key: definition.key,
        attributeId: definition.id,
        type: 'boolean',
        value: text === 'true',
      };
    }

    case 'range': {
      const bounds =
        typeof raw === 'object' && raw !== null && !Array.isArray(raw)
          ? (raw as { min?: unknown; max?: unknown })
          : { min: raw };

      const min = bounds.min === undefined ? undefined : toNumber(bounds.min, definition.key);
      const max = bounds.max === undefined ? undefined : toNumber(bounds.max, definition.key);

      if (min === undefined && max === undefined) return fail('a min and/or max bound');
      if (min !== undefined && max !== undefined && min > max) {
        throw new BadRequestException(
          `Filter attribute '${definition.key}': min must not exceed max`,
        );
      }

      return { key: definition.key, attributeId: definition.id, type: 'range', min, max };
    }
  }
}

function toNumber(raw: unknown, key: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new BadRequestException(`Filter attribute '${key}' expects a numeric bound`);
  }
  return value;
}
