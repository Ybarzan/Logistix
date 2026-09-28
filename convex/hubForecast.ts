import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { getOrgScope } from "./orgContext";
import { OVERLOAD_RATIO } from "./automation";
import { projectHubLoad } from "./hubForecastModel";
import { openIncident, resolveIncident } from "./webhooks";
import type { Arrival, HubProjection } from "./hubForecastModel";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * Saturation prévue des hubs : à partir des ETA prédites des expéditions en
 * route vers chaque hub, projette la charge sur 24 h et ouvre un incident
 * « capacity » prédit AVANT la saturation. Le détecteur classique
 * (automation.ts) le convertit en « Surcharge confirmée » si elle arrive.
 */

export const HORIZON_MS = 24 * 3600 * 1000;
const INBOUND_STATUSES = ["loading", "in_transit", "delayed"] as const;

const clockFr = (t: number) =>
  new Date(t).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

async function arrivalsByHub(ctx: QueryCtx, orgId: Id<"organizations">): Promise<Map<Id<"hubs">, Array<Arrival>>> {
  const map = new Map<Id<"hubs">, Array<Arrival>>();
  for (const status of INBOUND_STATUSES) {
    const rows = await ctx.db
      .query("shipments")
      .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", status))
      .collect();
    for (const s of rows) {
      const eta = s.prediction?.eta ?? s.estimatedDelivery;
      if (eta === undefined) continue;
      const list = map.get(s.toHubId) ?? [];
      list.push({ eta, weightKg: s.weight });
      map.set(s.toHubId, list);
    }
  }
  return map;
}

function project(hub: Doc<"hubs">, arrivals: Array<Arrival>, now: number): HubProjection {
  return projectHubLoad({
    currentLoad: hub.currentLoad,
    capacity: hub.capacity,
    arrivals,
    now,
    horizonMs: HORIZON_MS,
    threshold: OVERLOAD_RATIO,
  });
}

export const forecast = query({
  args: {},
  returns: v.array(
    v.object({
      hubId: v.id("hubs"),
      inboundKg: v.number(),
      arrivals: v.number(),
      peakPct: v.number(),
      crossesAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return [];
    const now = Date.now();
    const hubs = await ctx.db.query("hubs").withIndex("by_org", (q) => q.eq("orgId", scope.orgId)).collect();
    const byHub = await arrivalsByHub(ctx, scope.orgId);
    return hubs.map((h) => {
      const p = project(h, byHub.get(h._id) ?? [], now);
      return {
        hubId: h._id,
        inboundKg: p.inboundKg,
        arrivals: p.arrivals,
        peakPct: p.peakPct,
        ...(p.crossesAt !== undefined ? { crossesAt: p.crossesAt } : {}),
      };
    });
  },
});

/** Cron : ouvre / met à jour / referme les incidents de saturation prévue. */
export const detectPredictedSaturationForOrg = internalMutation({
  args: { orgId: v.id("organizations"), now: v.number() },
  returns: v.object({ opened: v.number(), resolved: v.number() }),
  handler: async (ctx, { orgId, now }) => {
    const hubs = await ctx.db.query("hubs").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const byHub = await arrivalsByHub(ctx, orgId);
    const open: Array<Doc<"incidents">> = [];
    for (const status of ["open", "investigating"] as const) {
      open.push(
        ...(await ctx.db
          .query("incidents")
          .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", status))
          .collect()),
      );
    }
    let opened = 0;
    let resolved = 0;
    for (const hub of hubs) {
      const existing = open.find((i) => i.type === "capacity" && i.hubId === hub._id);
      const p = project(hub, byHub.get(hub._id) ?? [], now);
      const description = `Charge projetée ${p.peakPct}% (+${(p.inboundKg / 1000).toFixed(1)} t sur ${p.arrivals} arrivée(s) en 24 h)${
        p.crossesAt !== undefined ? `, seuil de ${Math.round(OVERLOAD_RATIO * 100)}% franchi vers ${clockFr(p.crossesAt)}` : ""
      } — hypothèse prudente : départs non déduits`;
      if (hub.isActive && p.crossesAt !== undefined) {
        if (existing?.predicted === true) {
          await ctx.db.patch("incidents", existing._id, { description });
        } else if (!existing) {
          await openIncident(ctx, {
            orgId,
            hubId: hub._id,
            type: "capacity",
            severity: p.peakPct >= 100 ? "high" : "medium",
            title: `Saturation prévue : ${hub.name}`,
            description,
            status: "open",
            source: "auto",
            predicted: true,
            createdAt: now,
          });
          opened += 1;
        }
      } else if (existing?.predicted === true && existing.source === "auto") {
        await resolveIncident(ctx, existing, now, { description: `${existing.description} → écartée (${description})` });
        resolved += 1;
      }
    }
    return { opened, resolved };
  },
});
