/**
 * Errors shared by the data layer.
 *
 * This module deliberately imports nothing — the artifact build (src/artifact/*)
 * imports it directly rather than through an alias, so both backends throw and
 * recognise the exact same ConflictError class.
 */

export type ConflictEntity = 'block' | 'member' | 'sprint settings';

/**
 * Thrown when a conditional update matched no row, i.e. the row's `updated_at`
 * no longer equals the value the client last saw: somebody else wrote first.
 */
export class ConflictError extends Error {
  readonly entity: ConflictEntity;
  readonly entityId: string | null;
  /** Duck-typing marker so the check survives duplicated module instances. */
  readonly isConflict = true;

  constructor(entity: ConflictEntity, entityId: string | null = null) {
    super(`This ${entity} was changed by someone else`);
    this.name = 'ConflictError';
    this.entity = entity;
    this.entityId = entityId;
  }
}

export function isConflictError(error: unknown): error is ConflictError {
  if (error instanceof ConflictError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { isConflict?: unknown }).isConflict === true
  );
}

/**
 * PostgREST reports "no rows returned" from `.single()` with this code, which is
 * what a conditional update looks like when the version token did not match.
 */
export function isNoRowsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'PGRST116'
  );
}
