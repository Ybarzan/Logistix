/**
 * Projection de charge d'un hub à partir des arrivées prédites (pur, testable).
 *
 * Hypothèse volontairement prudente et affichée comme telle : on ajoute les
 * arrivées à leur ETA prédite, sans retrancher les départs (leur heure réelle
 * de sortie n'est pas connue) — la projection est donc un plafond : si elle
 * ne dépasse pas le seuil, le hub ne saturera pas à cause des arrivées.
 */

export type Arrival = { eta: number; weightKg: number };

export type HubProjection = {
  inboundKg: number;
  arrivals: number;
  peakLoad: number;
  peakPct: number;
  /** Premier instant où la charge projetée dépasse le seuil (absent si jamais). */
  crossesAt?: number;
};

export function projectHubLoad(input: {
  currentLoad: number;
  capacity: number;
  arrivals: Array<Arrival>;
  now: number;
  horizonMs: number;
  threshold: number;
}): HubProjection {
  const { currentLoad, capacity, now, horizonMs, threshold } = input;
  const inHorizon = input.arrivals
    .filter((a) => a.eta <= now + horizonMs && a.weightKg > 0)
    .sort((a, b) => a.eta - b.eta);
  let load = currentLoad;
  let crossesAt: number | undefined;
  const limit = capacity * threshold;
  for (const a of inHorizon) {
    load += a.weightKg;
    if (crossesAt === undefined && capacity > 0 && load > limit && currentLoad <= limit) {
      crossesAt = Math.max(now, a.eta);
    }
  }
  const inboundKg = load - currentLoad;
  return {
    inboundKg,
    arrivals: inHorizon.length,
    peakLoad: load,
    peakPct: capacity > 0 ? Math.round((load / capacity) * 100) : 0,
    ...(crossesAt !== undefined ? { crossesAt } : {}),
  };
}
