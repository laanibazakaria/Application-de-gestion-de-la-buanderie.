/** Langues prises en charge. L'arabe (« ar », RTL) pourra être ajouté ici avec son fichier messages/ar.json. */
export const locales = ["fr"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "fr";

const rtlLocales: ReadonlySet<string> = new Set(["ar"]);
export function textDirection(locale: string): "ltr" | "rtl" {
  return rtlLocales.has(locale) ? "rtl" : "ltr";
}

/** Fuseau horaire de référence pour tout l'affichage et les horaires d'ouverture. */
export const TIME_ZONE = "Africa/Casablanca";
