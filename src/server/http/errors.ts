/** Erreur HTTP explicite (authentification, droits, limitation…). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly headers?: Record<string, string>,
  ) {
    super(message ?? code);
    this.name = "HttpError";
  }
}

export const unauthorized = () => new HttpError(401, "UNAUTHENTICATED", "Connexion requise");
export const forbidden = (code = "FORBIDDEN") => new HttpError(403, code, "Accès refusé");
export const notFound = () => new HttpError(404, "NOT_FOUND", "Introuvable");
