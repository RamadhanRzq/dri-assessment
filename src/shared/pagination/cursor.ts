import { BadRequestException } from '@nestjs/common';

/**
 * Ordering a keyset page needs the last row's full sort tuple, not just the
 * sort column: without `id` the position of rows sharing a sort value is
 * undefined, so pages could repeat or skip them.
 */
export type CursorPayload = {
  /** Sort column the cursor was issued for; a mismatch means the client reused it. */
  sort: string;
  /** Value of the sort column on the last row of the previous page. */
  value: string | number;
  /** Tie-breaker, always the primary key. */
  id: number;
};

const CURSOR_VERSION = 1;

export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify([CURSOR_VERSION, payload.sort, payload.value, payload.id]);
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string, expectedSort: string): CursorPayload {
  const parsed: unknown = (() => {
    try {
      return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
  })();

  const [version, sort, value, id] = Array.isArray(parsed) ? parsed : [];
  const valid =
    Array.isArray(parsed) &&
    parsed.length === 4 &&
    version === CURSOR_VERSION &&
    sort === expectedSort &&
    (typeof value === 'string' || typeof value === 'number') &&
    typeof id === 'number' &&
    Number.isSafeInteger(id);

  if (!valid) {
    throw new BadRequestException('Invalid cursor');
  }

  return { sort, value, id };
}
