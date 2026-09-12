import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

const HOUR_MS = 60 * 60 * 1000;

type Severity = "low" | "medium" | "high" | "critical";

/**
 * Sévérité d'un incident de retard selon la durée de dépassement :
 * < 12h → low, 12-24h → medium, 24-48h → high, > 48h → critical.
 */
export function severityForDelay(overrunMs: number): Severity {
  if (overrunMs < 12 * HOUR_MS) return "low";
  if (overrunMs < 24 * HOUR_MS) return "medium";
  if (overrunMs < 48 * HOUR_MS) return "high";
  return "critical";
}

/**
 * Formate un dépassement en durée lisible, ex. 5h30, 1j 2h, 45min.
 */
export function formatOverrun(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}j ${hours}h`;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}`;
  return `${minutes}min`;
}

// ---------------------------------------------------------------------------
// Queries internes (lecture)
// ---------------------------------------------------------------------------

export const listOrganizations = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("organizations"),
      _creationTime: v.number(),
      name: v.string(),
      slug: v.string(),
    }),
  ),
  handler: async (ctx) => {
    return await ctx.db.query("organizations").collect();
  },
});

/**
 * Expéditions d'une organisation en statut pending/loading/in_transit
 * dont la livraison estimée est dépassée (retard avéré).
 * Index by_org_and_status, puis filtre en mémoire sur estimatedDelivery.
 */
export const listDelayedShipments = internalQuery({
  args: {
    orgId: v.id("organizations"),
    now: v.number(),
  },
  returns: v.array(
    v.object({
      _id: v.id("shipments"),
      reference: v.string(),
      estimatedDelivery: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const statuses = ["in_transit", "loading", "pending"] as const;
    const results: Array<{
      _id: Id<"shipments">;
      reference: string;
      estimatedDelivery?: number;
    }> = [];
    for (const status of statuses) {
      const shipments = await ctx.db
        .query("shipments")
        .withIndex("by_org_and_status", (q) =>
          q.eq("orgId", args.orgId).eq("status", status),
        )
        .collect();
      for (const shipment of shipments) {
        if (
          shipment.estimatedDelivery !== undefined &&
          shipment.estimatedDelivery < args.now
        ) {
          results.push({
            _id: shipment._id,
            reference: shipment.reference,
            estimatedDelivery: shipment.estimatedDelivery,
          });
        }
      }
    }
    return results;
  },
});

/**
 * Incidents de type "delay" encore ouverts (open ou investigating)
 * d'une organisation. Index by_org_and_status, puis filtre en mémoire
 * sur le type.
 */
export const listOpenDelayIncidents = internalQuery({
  args: {
    orgId: v.id("organizations"),
  },
  returns: v.array(
    v.object({
      _id: v.id("incidents"),
      shipmentId: v.optional(v.id("shipments")),
    }),
  ),
  handler: async (ctx, args) => {
    const statuses = ["open", "investigating"] as const;
    const results: Array<{
      _id: Id<"incidents">;
      shipmentId?: Id<"shipments">;
    }> = [];
    for (const status of statuses) {
      const incidents = await ctx.db
        .query("incidents")
        .withIndex("by_org_and_status", (q) =>
          q.eq("orgId", args.orgId).eq("status", status),
        )
        .collect();
      for (const incident of incidents) {
        if (incident.type === "delay") {
          results.push({ _id: incident._id, shipmentId: incident.shipmentId });
        }
      }
    }
    return results;
  },
});

/**
 * Hubs d'une organisation dont la charge dépasse 90% de la capacité.
 * Index by_org, puis filtre en mémoire sur le ratio charge/capacité.
 */
export const listOverloadedHubs = internalQuery({
  args: {
    orgId: v.id("organizations"),
  },
  returns: v.array(
    v.object({
      _id: v.id("hubs"),
      name: v.string(),
      currentLoad: v.number(),
      capacity: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const hubs = await ctx.db
      .query("hubs")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const results: Array<{
      _id: Id<"hubs">;
      name: string;
      currentLoad: number;
      capacity: number;
    }> = [];
    for (const hub of hubs) {
      if (hub.capacity > 0 && hub.currentLoad / hub.capacity > 0.9) {
        results.push({
          _id: hub._id,
          name: hub.name,
          currentLoad: hub.currentLoad,
          capacity: hub.capacity,
        });
      }
    }
    return results;
  },
});

/**
 * Incidents de type "capacity" encore ouverts (open ou investigating)
 * d'une organisation. Index by_org_and_status, puis filtre en mémoire
 * sur le type.
 */
export const listOpenCapacityIncidents = internalQuery({
  args: {
    orgId: v.id("organizations"),
  },
  returns: v.array(
    v.object({
      _id: v.id("incidents"),
      hubId: v.optional(v.id("hubs")),
    }),
  ),
  handler: async (ctx, args) => {
    const statuses = ["open", "investigating"] as const;
    const results: Array<{
      _id: Id<"incidents">;
      hubId?: Id<"hubs">;
    }> = [];
    for (const status of statuses) {
      const incidents = await ctx.db
        .query("incidents")
        .withIndex("by_org_and_status", (q) =>
          q.eq("orgId", args.orgId).eq("status", status),
        )
        .collect();
      for (const incident of incidents) {
        if (incident.type === "capacity") {
          results.push({ _id: incident._id, hubId: incident.hubId });
        }
      }
    }
    return results;
  },
});

// ---------------------------------------------------------------------------
// Mutation interne (écriture)
// ---------------------------------------------------------------------------

/**
 * Crée un incident automatique, toujours au statut "open" avec
 * createdAt = Date.now(). shipmentId/hubId sont optionnels et omis
 * (jamais undefined) quand absents.
 */
export const createIncident = internalMutation({
  args: {
    orgId: v.id("organizations"),
    shipmentId: v.optional(v.id("shipments")),
    hubId: v.optional(v.id("hubs")),
    type: v.union(
      v.literal("breakdown"),
      v.literal("customs"),
      v.literal("capacity"),
      v.literal("delay"),
      v.literal("damage"),
      v.literal("other"),
    ),
    severity: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical"),
    ),
    title: v.string(),
    description: v.string(),
  },
  returns: v.id("incidents"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("incidents", {
      orgId: args.orgId,
      type: args.type,
      severity: args.severity,
      title: args.title,
      description: args.description,
      status: "open" as const,
      createdAt: Date.now(),
      ...(args.shipmentId !== undefined ? { shipmentId: args.shipmentId } : {}),
      ...(args.hubId !== undefined ? { hubId: args.hubId } : {}),
    });
  },
});

// ---------------------------------------------------------------------------
// Actions internes (détection)
// ---------------------------------------------------------------------------

/**
 * Détecte les expéditions en retard pour chaque organisation et crée
 * un incident "delay" par expédition, sans doublon tant qu'un incident
 * delay ouvert (open/investigating) existe déjà pour cette expédition.
 */
export const detectDelays = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const orgs: Array<Doc<"organizations">> = await ctx.runQuery(
      internal.automation.listOrganizations,
      {},
    );

    for (const org of orgs) {
      const delayedShipments: Array<{
        _id: Id<"shipments">;
        reference: string;
        estimatedDelivery?: number;
      }> = await ctx.runQuery(internal.automation.listDelayedShipments, {
        orgId: org._id,
        now,
      });
      const openDelayIncidents: Array<{
        _id: Id<"incidents">;
        shipmentId?: Id<"shipments">;
      }> = await ctx.runQuery(internal.automation.listOpenDelayIncidents, {
        orgId: org._id,
      });

      // Anti-doublon : expéditions déjà couvertes par un incident delay ouvert.
      const coveredShipmentIds = new Set<Id<"shipments">>();
      for (const incident of openDelayIncidents) {
        if (incident.shipmentId !== undefined) {
          coveredShipmentIds.add(incident.shipmentId);
        }
      }

      for (const shipment of delayedShipments) {
        if (coveredShipmentIds.has(shipment._id)) continue;
        if (shipment.estimatedDelivery === undefined) continue;
        const overrunMs = now - shipment.estimatedDelivery;
        await ctx.runMutation(internal.automation.createIncident, {
          orgId: org._id,
          shipmentId: shipment._id,
          type: "delay",
          severity: severityForDelay(overrunMs),
          title: "Retard détecté automatiquement",
          description: `${shipment.reference} : retard de ${formatOverrun(overrunMs)} par rapport à la livraison estimée`,
        });
      }
    }

    return null;
  },
});

/**
 * Détecte les hubs surchargés (> 90% de capacité) pour chaque
 * organisation et crée un incident "capacity" par hub, sans doublon
 * tant qu'un incident capacity ouvert existe déjà pour ce hub.
 */
export const detectHubOverload = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const orgs: Array<Doc<"organizations">> = await ctx.runQuery(
      internal.automation.listOrganizations,
      {},
    );

    for (const org of orgs) {
      const overloadedHubs: Array<{
        _id: Id<"hubs">;
        name: string;
        currentLoad: number;
        capacity: number;
      }> = await ctx.runQuery(internal.automation.listOverloadedHubs, {
        orgId: org._id,
      });
      const openCapacityIncidents: Array<{
        _id: Id<"incidents">;
        hubId?: Id<"hubs">;
      }> = await ctx.runQuery(internal.automation.listOpenCapacityIncidents, {
        orgId: org._id,
      });

      // Anti-doublon : hubs déjà couverts par un incident capacity ouvert.
      const coveredHubIds = new Set<Id<"hubs">>();
      for (const incident of openCapacityIncidents) {
        if (incident.hubId !== undefined) {
          coveredHubIds.add(incident.hubId);
        }
      }

      for (const hub of overloadedHubs) {
        if (coveredHubIds.has(hub._id)) continue;
        const loadPct = Math.round((hub.currentLoad / hub.capacity) * 100);
        await ctx.runMutation(internal.automation.createIncident, {
          orgId: org._id,
          hubId: hub._id,
          type: "capacity",
          severity: "medium",
          title: `Surcharge détectée : ${hub.name}`,
          description: `Capacité à ${loadPct}% — redirection recommandée`,
        });
      }
    }

    return null;
  },
});

/**
 * Point d'entrée du cron : exécute la détection des retards puis
 * celle des surcharges de hubs.
 */
export const runAutomation = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.runAction(internal.automation.detectDelays, {});
    await ctx.runAction(internal.automation.detectHubOverload, {});
    return null;
  },
});