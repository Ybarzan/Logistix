import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getOrgScope, requireRole } from "./orgContext";
import type { Doc } from "./_generated/dataModel";

/**
 * Estimation CO2e du transport routier, méthode distance × masse × facteur
 * (approche ISO 14083 / GLEC simplifiée : t·km × intensité par t·km).
 *
 * Le facteur par défaut est un ORDRE DE GRANDEUR pour un poids lourd
 * articulé ~40 t en chargement moyen, du puits à la roue. Il est volontairement
 * présenté comme indicatif dans l'UI et remplaçable par organisation : le
 * bon facteur est celui du transporteur (ou de la Base Carbone ADEME pour
 * le véhicule et le taux de remplissage réels).
 */
export const DEFAULT_FACTOR_KG_PER_TKM = 0.08;

export function estimateCo2Kg(weightKg: number, distanceKm: number, factorKgPerTkm: number): number {
  if (!(weightKg > 0) || !(distanceKm > 0) || !(factorKgPerTkm > 0)) return 0;
  return Math.round((weightKg / 1000) * distanceKm * factorKgPerTkm * 10) / 10;
}

function factorFor(org: Doc<"organizations"> | null): number {
  return org?.co2FactorKgPerTkm ?? DEFAULT_FACTOR_KG_PER_TKM;
}

export const forShipment = query({
  args: { shipmentId: v.id("shipments") },
  returns: v.union(
    v.null(),
    v.object({ co2Kg: v.number(), tonneKm: v.number(), factor: v.number(), isDefaultFactor: v.boolean() }),
  ),
  handler: async (ctx, { shipmentId }) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return null;
    const shipment = await ctx.db.get("shipments", shipmentId);
    if (!shipment || shipment.orgId !== scope.orgId || !shipment.routeId) return null;
    const route = await ctx.db.get("routes", shipment.routeId);
    if (!route) return null;
    const org = await ctx.db.get("organizations", scope.orgId);
    const factor = factorFor(org);
    return {
      co2Kg: estimateCo2Kg(shipment.weight, route.distance, factor),
      tonneKm: Math.round((shipment.weight / 1000) * route.distance),
      factor,
      isDefaultFactor: org?.co2FactorKgPerTkm === undefined,
    };
  },
});

const WINDOW_DAYS = 90;

/** Bilan CO2e sur 90 jours (expéditions non annulées ayant un itinéraire connu). */
export const summary = query({
  args: {},
  returns: v.object({
    totalKg: v.number(),
    shipmentsCounted: v.number(),
    shipmentsWithoutRoute: v.number(),
    avgKgPerShipment: v.union(v.number(), v.null()),
    factor: v.number(),
    isDefaultFactor: v.boolean(),
    byRoute: v.array(v.object({ name: v.string(), co2Kg: v.number(), shipments: v.number() })),
  }),
  handler: async (ctx) => {
    const scope = await getOrgScope(ctx);
    const empty = {
      totalKg: 0, shipmentsCounted: 0, shipmentsWithoutRoute: 0, avgKgPerShipment: null,
      factor: DEFAULT_FACTOR_KG_PER_TKM, isDefaultFactor: true, byRoute: [],
    };
    if (!scope) return empty;
    const org = await ctx.db.get("organizations", scope.orgId);
    const factor = factorFor(org);
    const since = Date.now() - WINDOW_DAYS * 24 * 3600 * 1000;
    const shipments = await ctx.db
      .query("shipments")
      .withIndex("by_org_and_created_at", (q) => q.eq("orgId", scope.orgId).gte("createdAt", since))
      .collect();
    const routes = new Map(
      (await ctx.db.query("routes").withIndex("by_org", (q) => q.eq("orgId", scope.orgId)).collect()).map((r) => [r._id, r]),
    );
    let totalKg = 0;
    let counted = 0;
    let withoutRoute = 0;
    const byRoute = new Map<string, { name: string; co2Kg: number; shipments: number }>();
    for (const s of shipments) {
      if (s.status === "cancelled") continue;
      const route = s.routeId ? routes.get(s.routeId) : undefined;
      if (!route) {
        withoutRoute += 1;
        continue;
      }
      const kg = estimateCo2Kg(s.weight, route.distance, factor);
      totalKg += kg;
      counted += 1;
      const bucket = byRoute.get(route._id) ?? { name: route.name, co2Kg: 0, shipments: 0 };
      bucket.co2Kg += kg;
      bucket.shipments += 1;
      byRoute.set(route._id, bucket);
    }
    return {
      totalKg: Math.round(totalKg),
      shipmentsCounted: counted,
      shipmentsWithoutRoute: withoutRoute,
      avgKgPerShipment: counted > 0 ? Math.round(totalKg / counted) : null,
      factor,
      isDefaultFactor: org?.co2FactorKgPerTkm === undefined,
      byRoute: [...byRoute.values()]
        .map((b) => ({ ...b, co2Kg: Math.round(b.co2Kg) }))
        .sort((a, b) => b.co2Kg - a.co2Kg),
    };
  },
});

export const setFactor = mutation({
  args: { factorKgPerTkm: v.union(v.number(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { factorKgPerTkm }) => {
    const scope = requireRole(await getOrgScope(ctx), "admin");
    if (factorKgPerTkm !== null && !(factorKgPerTkm > 0 && factorKgPerTkm < 2)) {
      throw new Error("Facteur invalide (attendu entre 0 et 2 kg CO2e par t·km)");
    }
    await ctx.db.patch("organizations", scope.orgId, {
      co2FactorKgPerTkm: factorKgPerTkm ?? undefined,
    });
    return null;
  },
});
