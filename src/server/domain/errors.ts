/**
 * Codes d'erreur métier. Le client les traduit (clé i18n `errors.<code>`) ;
 * l'API les associe à un statut HTTP.
 */
export const DOMAIN_ERROR_CODES = {
  INVALID_TRANSITION: 409,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  LAUNDRY_CLOSED: 409,
  MAX_ACTIVE_RESERVATIONS: 409,
  OWN_CYCLE_RUNNING: 409,
  MACHINE_OUT_OF_SERVICE: 409,
  MACHINE_BUSY: 409,
  STUDENT_CANNOT_START: 403,
  INVALID_DURATION: 422,
  INVALID_INPUT: 422,
  SCHOOL_ID_TAKEN: 409,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_SUSPENDED: 403,
  CANNOT_TARGET_SELF: 409,
} as const;

export type DomainErrorCode = keyof typeof DOMAIN_ERROR_CODES;

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = "DomainError";
  }

  get httpStatus(): number {
    return DOMAIN_ERROR_CODES[this.code];
  }
}
