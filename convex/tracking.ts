import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getOrgScope, requireRole } from "./orgContext";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export type EventType =
  | "created"
  | "processed"
  | "in_transit"
  | "delayed"
  | "delivered"
  | "cancelled"
  | "custom";

export const eventTypeSchema = v.union(
  v.literal("created"),
  v.literal("processed"),
  v.literal("in_transit"),
  v.literal("delayed"),
  v.literal("delivered"),
  v.literal("cancelled"),
  v.literal("custom")
);

const eventFields = v.object({
  _id: v.id("trackingEvents"),
  _creationTime: v.number(),
  shipmentId: v.id("shipments"),
  eventType: eventTypeSchema,
  description: v.string(),
  location: v.optional(v.string()),
  orgId: v.optional(v.id("organizations")),
});

/**
 * Enregistre un événement de suivi. Simple helper réutilisable par les
 * mutations (ex. changement de statut d'une expédition).
 */
export async function recordTrackingEvent(
  ctx: MutationCtx,
  data: {
    orgId: Id<"organizations">;
    shipmentId: Id<"shipments">;
    eventType: EventType;
    description: string;
    location?: string | undefined;
  },
): Promise<void> {
  await ctx.db.insert("trackingEvents", {
    shipmentId: data.shipmentId,
    eventType: data.eventType,
    description: data.description,
    orgId: data.orgId,
    ...(data.location !== undefined ? { location: data.location } : {}),
  });
}

export const listByShipment = query({
  args: { shipmentId: v.id("shipments") },
  returns: v.array(eventFields),
  handler: async (ctx, args) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return [];
    return await ctx.db
      .query("trackingEvents")
      .withIndex("by_org_and_shipment", (q) =>
        q.eq("orgId", scope.orgId).eq("shipmentId", args.shipmentId),
      )
      .order("desc")
      .take(50);
  },
});

export const log = mutation({
  args: {
    shipmentId: v.id("shipments"),
    eventType: eventTypeSchema,
    description: v.string(),
    location: v.optional(v.string()),
  },
  returns: v.id("trackingEvents"),
  handler: async (ctx, args) => {
    const scope = requireRole(await getOrgScope(ctx), "operator");
    const shipment = await ctx.db.get("shipments", args.shipmentId);
    if (!shipment) throw new Error("Expédition introuvable");
    if (shipment.orgId !== scope.orgId) throw new Error("Accès refusé");
    return await ctx.db.insert("trackingEvents", {
      shipmentId: args.shipmentId,
      eventType: args.eventType,
      description: args.description,
      orgId: scope.orgId,
      ...(args.location !== undefined ? { location: args.location } : {}),
    });
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("trackingEvents"),
      _creationTime: v.number(),
      shipmentId: v.id("shipments"),
      eventType: eventTypeSchema,
      description: v.string(),
      location: v.optional(v.string()),
      reference: v.string(),
      fromCity: v.string(),
      toCity: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return [];
    const events = await ctx.db
      .query("trackingEvents")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .order("desc")
      .take(args.limit ?? 40);

    const shipments: Array<{
      _id: Id<"shipments">;
      reference: string;
      fromHubId: Id<"hubs">;
      toHubId: Id<"hubs">;
    }> = [];
    const hubIds = new Set<Id<"hubs">>();
    for (const event of events) {
      const shipment = await ctx.db.get("shipments", event.shipmentId);
      if (!shipment || shipment.orgId !== scope.orgId) continue;
      shipments.push({
        _id: shipment._id,
        reference: shipment.reference,
        fromHubId: shipment.fromHubId,
        toHubId: shipment.toHubId,
      });
      hubIds.add(shipment.fromHubId);
      hubIds.add(shipment.toHubId);
    }

    const hubNames = new Map<Id<"hubs">, string>();
    for (const hubId of hubIds) {
      const hub = await ctx.db.get("hubs", hubId);
      if (hub) hubNames.set(hubId, hub.city);
    }

    const result: Array<{
      _id: Id<"trackingEvents">;
      _creationTime: number;
      shipmentId: Id<"shipments">;
      eventType: EventType;
      description: string;
      location?: string;
      reference: string;
      fromCity: string;
      toCity: string;
    }> = [];
    for (const event of events) {
      const shipment = shipments.find((s) => s._id === event.shipmentId);
      if (!shipment) continue;
      result.push({
        _id: event._id,
        _creationTime: event._creationTime,
        shipmentId: event.shipmentId,
        eventType: event.eventType,
        description: event.description,
        reference: shipment.reference,
        fromCity: hubNames.get(shipment.fromHubId) ?? shipment.fromHubId,
        toCity: hubNames.get(shipment.toHubId) ?? shipment.toHubId,
        ...(event.location !== undefined ? { location: event.location } : {}),
      });
    }
    return result;
  },
});