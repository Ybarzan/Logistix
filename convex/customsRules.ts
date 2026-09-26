/**
 * Règles douanières pures (sans runtime Convex) : régime d'un trajet selon
 * les pays des hubs. Sert au pré-contrôle douane et aux recommandations.
 */
export type CustomsRegime = "domestic" | "intra_eu" | "extra_eu" | "unknown";

/** UE-27 : noms FR/EN normalisés et codes ISO-2. */
const EU: ReadonlyArray<ReadonlyArray<string>> = [
  ["allemagne", "germany", "de"], ["autriche", "austria", "at"], ["belgique", "belgium", "be"],
  ["bulgarie", "bulgaria", "bg"], ["chypre", "cyprus", "cy"], ["croatie", "croatia", "hr"],
  ["danemark", "denmark", "dk"], ["espagne", "spain", "es"], ["estonie", "estonia", "ee"],
  ["finlande", "finland", "fi"], ["france", "france", "fr"], ["grece", "greece", "gr"],
  ["hongrie", "hungary", "hu"], ["irlande", "ireland", "ie"], ["italie", "italy", "it"],
  ["lettonie", "latvia", "lv"], ["lituanie", "lithuania", "lt"], ["luxembourg", "luxembourg", "lu"],
  ["malte", "malta", "mt"], ["pays-bas", "netherlands", "nl"], ["pologne", "poland", "pl"],
  ["portugal", "portugal", "pt"], ["roumanie", "romania", "ro"], ["slovaquie", "slovakia", "sk"],
  ["slovenie", "slovenia", "si"], ["suede", "sweden", "se"], ["tchequie", "czechia", "cz"],
];

export function normalizeCountry(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/^republique tcheque$/, "tchequie")
    .replace(/^czech republic$/, "czechia")
    .replace(/\s+/g, "-");
}

function euKey(country: string): string | null {
  const n = normalizeCountry(country);
  const row = EU.find((names) => names.includes(n));
  return row ? row[2] : null;
}

export function customsRegime(fromCountry: string, toCountry: string): CustomsRegime {
  if (!fromCountry.trim() || !toCountry.trim()) return "unknown";
  if (normalizeCountry(fromCountry) === normalizeCountry(toCountry)) return "domestic";
  const a = euKey(fromCountry);
  const b = euKey(toCountry);
  if (a && b) return a === b ? "domestic" : "intra_eu";
  // Au moins un pays hors UE (ou non reconnu comme membre) : on traite comme
  // une frontière douanière — mieux vaut un contrôle de trop qu'un camion bloqué.
  return "extra_eu";
}

export const REGIME_LABELS: Record<CustomsRegime, string> = {
  domestic: "National — pas de formalité douanière",
  intra_eu: "Intra-UE — pas de dédouanement ; code NC utile pour la DEB/Intrastat",
  extra_eu: "Hors UE — déclaration en douane requise (code SH, valeur, origine)",
  unknown: "Pays à compléter sur les hubs",
};

/** Un code SH/NC plausible : 6 à 10 chiffres. */
export function isValidHsCode(code: string): boolean {
  return /^\d{6,10}$/.test(code.replace(/[\s.]/g, ""));
}
