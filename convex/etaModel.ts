/**
 * Modèle d'ETA prédictive — pur et explicable (aucun runtime Convex).
 *
 * Trois niveaux, du plus au moins informé :
 *  1. "gps"           — position récente : distance restante (vol d'oiseau ×
 *                       facteur route) ÷ vitesse réellement observée, + pause
 *                       réglementaire de 45 min au-delà de 4 h 30 de conduite
 *                       (règlement CE 561/2006).
 *  2. "route_history" — pas de GPS frais : durée prévue de l'itinéraire corrigée
 *                       par ce qu'ont réellement pris les dernières livraisons.
 *  3. "route_plan"    — durée prévue de l'itinéraire, sans historique.
 * Chaque prédiction porte une fourchette et une phrase d'explication.
 */

export type LatLng = { lat: number; lng: number };

export type EtaMethod = "gps" | "route_history" | "route_plan";

export type Prediction = {
  eta: number;
  low: number;
  high: number;
  method: EtaMethod;
  explanation: string;
};

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Rapport distance routière / vol d'oiseau, ordre de grandeur réseau européen. */
export const ROAD_FACTOR = 1.25;
/** Au-delà, la position n'est plus considérée comme « en direct ». */
export const GPS_FRESH_MS = 45 * MIN;
const MIN_SPEED_KPH = 40;
const MAX_SPEED_KPH = 90;
const DEFAULT_SPEED_KPH = 65;
/** Conduite continue maximale avant pause obligatoire (CE 561/2006). */
const MAX_CONTINUOUS_DRIVING_MS = 4.5 * HOUR;
const MANDATORY_BREAK_MS = 45 * MIN;
/** Conduite journalière maximale, puis repos journalier (CE 561/2006, cas standard). */
const MAX_DAILY_DRIVING_MS = 9 * HOUR;
const DAILY_REST_MS = 11 * HOUR;

/**
 * Temps réglementaire à ajouter à un temps de conduite pur : une pause de 45 min
 * par tranche de 4 h 30, et un repos de 11 h par tranche de 9 h de conduite.
 * (Hypothèse prudente : un seul conducteur, pas de dérogation 10 h.)
 */
export function regulatoryStopsMs(driveMs: number): { stopsMs: number; breaks: number; rests: number } {
  const rests = Math.max(0, Math.ceil(driveMs / MAX_DAILY_DRIVING_MS) - 1);
  const breaks = Math.max(0, Math.ceil(driveMs / MAX_CONTINUOUS_DRIVING_MS) - 1 - rests);
  return { stopsMs: breaks * MANDATORY_BREAK_MS + rests * DAILY_REST_MS, breaks, rests };
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function median(values: Array<number>): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function hhmm(ms: number): string {
  const h = Math.floor(ms / HOUR);
  const m = Math.round((ms % HOUR) / MIN);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

export type EtaInput = {
  now: number;
  destination: LatLng;
  position?: LatLng & { recordedAt: number; speedKph?: number };
  /** Vitesses observées récemment (km/h), toutes mesures confondues. */
  recentSpeedsKph?: Array<number>;
  route?: { distanceKm: number; avgDurationMin: number };
  /** Durée réelle / durée prévue sur les dernières livraisons de l'itinéraire. */
  history?: { ratio: number; samples: number };
  /** Début du trajet (départ constaté), à défaut maintenant. */
  departedAt?: number;
};

export function predictEta(input: EtaInput): Prediction | null {
  const { now, position, route, history } = input;

  if (position && now - position.recordedAt <= GPS_FRESH_MS) {
    const remainingKm = haversineKm(position, input.destination) * ROAD_FACTOR;
    const moving = [...(input.recentSpeedsKph ?? []), ...(position.speedKph !== undefined ? [position.speedKph] : [])]
      .filter((v) => v >= 10);
    const observed = median(moving);
    const routeSpeed = route && route.avgDurationMin > 0 ? route.distanceKm / (route.avgDurationMin / 60) : null;
    const speed = clamp(observed ?? routeSpeed ?? DEFAULT_SPEED_KPH, MIN_SPEED_KPH, MAX_SPEED_KPH);
    const pureDriveMs = (remainingKm / speed) * HOUR;
    const stops = regulatoryStopsMs(pureDriveMs);
    const driveMs = pureDriveMs + stops.stopsMs;
    const from = Math.max(now, position.recordedAt);
    const eta = from + driveMs;
    // Incertitude : 10 % du restant + 10 min, élargie si la position vieillit.
    const spread = driveMs * 0.1 + 10 * MIN + (now - position.recordedAt) * 0.5;
    const speedSource = observed !== null ? "vitesse observée" : routeSpeed !== null ? "vitesse moyenne de l'itinéraire" : "vitesse type poids lourd";
    return {
      eta,
      low: eta - spread,
      high: eta + spread,
      method: "gps",
      explanation:
        remainingKm < 2
          ? "Camion à l'arrivée"
          : `GPS : ~${Math.round(remainingKm)} km restants à ${Math.round(speed)} km/h (${speedSource}) = ${hhmm(driveMs)}` +
            (stops.breaks > 0 ? `, ${stops.breaks} pause(s) réglementaire(s) de 45 min` : "") +
            (stops.rests > 0 ? `, ${stops.rests} repos journalier(s) de 11 h` : ""),
    };
  }

  if (route && route.avgDurationMin > 0) {
    const planned = route.avgDurationMin * MIN;
    const useHistory = history !== undefined && history.samples >= 3;
    const expected = useHistory ? planned * history.ratio : planned;
    const start = input.departedAt ?? now;
    // Déjà parti sans GPS : on ne descend jamais sous « maintenant ».
    const eta = Math.max(now + 15 * MIN, start + expected);
    const spread = expected * (useHistory ? 0.15 : 0.25) + 15 * MIN;
    return {
      eta,
      low: eta - spread,
      high: eta + spread,
      method: useHistory ? "route_history" : "route_plan",
      explanation: useHistory
        ? `Sans GPS : durée prévue ${hhmm(planned)} × ${history.ratio.toFixed(2)} (médiane des ${history.samples} dernières livraisons sur cet itinéraire)`
        : `Sans GPS ni historique : durée prévue de l'itinéraire (${hhmm(planned)})`,
    };
  }
  return null;
}

/** Retard prédit par rapport à l'engagement, en ms (négatif = avance). */
export function predictedOverrunMs(prediction: Prediction, committed: number): number {
  return prediction.eta - committed;
}

/** Seuil à partir duquel on ouvre un incident « retard prévu ». */
export const PREDICTED_DELAY_THRESHOLD_MS = 30 * MIN;
