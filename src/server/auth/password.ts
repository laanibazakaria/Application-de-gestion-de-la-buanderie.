import { randomInt } from "node:crypto";

import { hash, verify } from "@node-rs/argon2";

/** Paramètres argon2id (recommandations OWASP : 19 Mio, 2 itérations). */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Empreinte factice : on vérifie quand même un mot de passe si le compte n'existe pas (temps de réponse constant). */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword("compte-inexistant-" + randomInt(1e9));
  return dummyHash;
}

/** Alphabet sans caractères ambigus (0/O, 1/l/I) pour les mots de passe temporaires dictés ou imprimés. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateTemporaryPassword(length = 10): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
