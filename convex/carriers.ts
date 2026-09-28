import { v } from "convex/values";
import { query } from "./_generated/server";
import { getOrgScope } from "./orgContext";
import type { Doc } from "./_generated/dataModel";

/**
 * Score des transporteurs à partir de l'historique RÉEL de l'organisation
 * (180 jours) : courses, livraisons à l'heure, retard moyen, incidents de
 * retard. Complète le score de conformité fleet-hub (déclaratif réglementaire)
 * par ce que le transporteur a effectivement fait POUR VOUS.
 */

const WINDOW_MS = 180 * 24 * 3600 * 1000;

export type Scorecard = {
  key: string;
  carrierId?: number;
  name: string;
  kind: "fleetmarket" | "own_fleet";
  shipments: number;
  delivered: number;
  onTime: number;
  onTimeRate: number | null;
  avgDelayMin: number | null;
  delayIncidents: number;
  lastComplianceScore?: number;
};

/** Agrégation pure (testable) : expéditions + incidents de retard → scores. */
export function buildScorecards(
  shipments: Array<Doc<"shipments">>,
  delayIncidentShipmentIds: Set<string>,
): Array<Scorecard> {
  const cards = new Map<string, Scorecard & { delaySum: number; lateCount: number }>();
  for (const s of shipments) {
    if (s.status === "cancelled") continue;
    const fm = s.fleetmarket;
    let key: string;
    let base: Pick<Scorecard, "name" | "kind"> & { carrierId?: number };
    if (fm?.carrierName !== undefined && (fm.status === "MATCHED" || fm.status === "DONE")) {
      key = fm.carrierId !== undefined ? `fm:${fm.carrierId}` : `fm:${fm.carrierName}`;
      base = { name: fm.carrierName, kind: "fleetmarket", ...(fm.carrierId !== undefined ? { carrierId: fm.carrierId } : {}) };
    } else if (s.truckRegistration) {
      key = "own";
      base = { name: "Flotte propre (fleet-hub)", kind: "own_fleet" };
    } else {
      continue;
    }
    const c = cards.get(key) ?? {
      key, ...base, shipments: 0, delivered: 0, onTime: 0, onTimeRate: null, avgDelayMin: null,
      delayIncidents: 0, delaySum: 0, lateCount: 0,
    };
    c.shipments += 1;
    if (fm?.carrierComplianceScore !== undefined) c.lastComplianceScore = fm.carrierComplianceScore;
    if (delayIncidentShipmentIds.has(s._id)) c.delayIncidents += 1;
    if (s.status === "delivered" && s.actualDelivery !== undefined && s.estimatedDelivery !== undefined) {
      c.delivered += 1;
      const late = s.actualDelivery - s.estimatedDelivery;
      if (late <= 0) c.onTime += 1;
      else {
        c.lateCount += 1;
        c.delaySum += late;
      }
    }
    cards.set(key, c);
  }
  return [...cards.values()]
    .map(({ delaySum, lateCount, ...c }) => ({
      ...c,
      onTimeRate: c.delivered > 0 ? Math.round((c.onTime / c.delivered) * 100) : null,
      avgDelayMin: lateCount > 0 ? Math.round(delaySum / lateCount / 60000) : null,
    }))
    .sort((a, b) => b.shipments - a.shipments);
}

const scorecardFields = v.object({
  key: v.string(),
  carrierId: v.optional(v.number()),
  name: v.string(),
  kind: v.union(v.literal("fleetmarket"), v.literal("own_fleet")),
  shipments: v.number(),
  delivered: v.number(),
  onTime: v.number(),
  onTimeRate: v.union(v.number(), v.null()),
  avgDelayMin: v.union(v.number(), v.null()),
  delayIncidents: v.number(),
  lastComplianceScore: v.optional(v.number()),
});

export const scorecards = query({
  args: {},
  returns: v.array(scorecardFields),
  handler: async (ctx) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return [];
    const since = Date.now() - WINDOW_MS;
    const shipments = await ctx.db
      .query("shipments")
      .withIndex("by_org_and_created_at", (q) => q.eq("orgId", scope.orgId).gte("createdAt", since))
      .collect();
    const incidents = await ctx.db
      .query("incidents")
      .withIndex("by_org_and_created_at", (q) => q.eq("orgId", scope.orgId).gte("createdAt", since))
      .collect();
    const delayed = new Set<string>(
      incidents.filter((i) => i.type === "delay" && i.shipmentId && i.predicted !== true).map((i) => i.shipmentId as string),
    );
    return buildScorecards(shipments, delayed);
  },
});
