import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getOrgScope, requireRole } from "./orgContext";
import { recordTrackingEvent } from "./tracking";
import type { Id } from "./_generated/dataModel";

const shipmentFields = v.object({
  _id: v.id("shipments"),
  _creationTime: v.number(),
  reference: v.string(),
  fromHubId: v.id("hubs"),
  toHubId: v.id("hubs"),
  routeId: v.optional(v.id("routes")),
  status: v.union(
    v.literal("pending"),
    v.literal("loading"),
    v.literal("in_transit"),
    v.literal("delivered"),
    v.literal("delayed"),
    v.literal("cancelled")
  ),
  weight: v.number(),
  priority: v.union(v.literal("low"), v.literal("normal"), v.literal("high"), v.literal("urgent")),
  customerName: v.string(),
  customerRef: v.optional(v.string()),
  estimatedDelivery: v.optional(v.number()),
  actualDelivery: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
  orgId: v.optional(v.id("organizations")),
});

export const list = query({
  args: {
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("loading"),
      v.literal("in_transit"),
      v.literal("delivered"),
      v.literal("delayed"),
      v.literal("cancelled")
    )),
    limit: v.optional(v.number()),
  },
  returns: v.array(shipmentFields),
  handler: async (ctx, args) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return [];
    const limit = args.limit ?? 50;
    if (args.status) {
      const status = args.status;
      return await ctx.db
        .query("shipments")
        .withIndex("by_org_and_status", (q) =>
          q.eq("orgId", scope.orgId).eq("status", status),
        )
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("shipments")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .order("desc")
      .take(limit);
  },
});

const emptyStats = {
  inTransit: 0,
  onTimeRate: 0,
  activeDelays: 0,
  openIncidents: 0,
  recentShipments: [],
  activeAlerts: [],
  hubLoads: [],
  slaRate: 0,
  onTime: 0,
  late: 0,
};

export const dashboardStats = query({
  args: {},
  returns: v.object({
    inTransit: v.number(),
    onTimeRate: v.number(),
    activeDelays: v.number(),
    openIncidents: v.number(),
    recentShipments: v.array(v.object({
      _id: v.id("shipments"),
      reference: v.string(),
      status: v.string(),
      weight: v.number(),
      customerName: v.string(),
      fromHubId: v.id("hubs"),
      toHubId: v.id("hubs"),
      createdAt: v.number(),
    })),
    activeAlerts: v.array(v.object({
      _id: v.id("incidents"),
      type: v.string(),
      severity: v.string(),
      title: v.string(),
      description: v.string(),
      status: v.string(),
      createdAt: v.number(),
    })),
    hubLoads: v.array(v.object({
      hubId: v.id("hubs"),
      name: v.string(),
      load: v.number(),
      capacity: v.number(),
    })),
    slaRate: v.number(),
    onTime: v.number(),
    late: v.number(),
  }),
  handler: async (ctx) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return emptyStats;

    const allShipments = await ctx.db
      .query("shipments")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .collect();
    const inTransit = allShipments.filter(s => s.status === "in_transit").length;
    const delayed = allShipments.filter(s => s.status === "delayed").length;

    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentDelivered = allShipments.filter(
      s => s.status === "delivered" && s.createdAt >= weekAgo
    );
    const onTime = recentDelivered.filter(s => s.actualDelivery && s.estimatedDelivery && s.actualDelivery <= s.estimatedDelivery).length;
    const totalRecent = recentDelivered.length || 1;
    const onTimeRate = Math.round((onTime / totalRecent) * 1000) / 10;

    const openIncidentsCount = (await ctx.db
      .query("incidents")
      .withIndex("by_org_and_status", (q) =>
        q.eq("orgId", scope.orgId).eq("status", "open"),
      )
      .collect()).length;

    const recentShipmentsData = (await ctx.db
      .query("shipments")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .order("desc")
      .take(5));

    const activeAlertsData = (await ctx.db
      .query("incidents")
      .withIndex("by_org_and_status", (q) =>
        q.eq("orgId", scope.orgId).eq("status", "open"),
      )
      .order("desc")
      .take(5));

    const hubsData = await ctx.db
      .query("hubs")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .collect();
    const hubLoadsData = hubsData.slice(0, 5).map(h => ({
      hubId: h._id,
      name: h.name,
      load: h.currentLoad,
      capacity: h.capacity,
    }));

    return {
      inTransit,
      onTimeRate,
      activeDelays: delayed,
      openIncidents: openIncidentsCount,
      recentShipments: recentShipmentsData.map(s => ({
        _id: s._id,
        reference: s.reference,
        status: s.status,
        weight: s.weight,
        customerName: s.customerName,
        fromHubId: s.fromHubId,
        toHubId: s.toHubId,
        createdAt: s.createdAt,
      })),
      activeAlerts: activeAlertsData.map(i => ({
        _id: i._id,
        type: i.type as string,
        severity: i.severity as string,
        title: i.title,
        description: i.description,
        status: i.status as string,
        createdAt: i.createdAt,
      })),
      hubLoads: hubLoadsData,
      slaRate: onTimeRate,
      onTime,
      late: totalRecent - onTime,
    };
  },
});

export const create = mutation({
  args: {
    fromHubId: v.id("hubs"),
    toHubId: v.id("hubs"),
    weight: v.number(),
    priority: v.union(v.literal("low"), v.literal("normal"), v.literal("high"), v.literal("urgent")),
    customerName: v.string(),
    customerRef: v.optional(v.string()),
    estimatedDelivery: v.optional(v.number()),
  },
  returns: v.id("shipments"),
  handler: async (ctx, args) => {
    const scope = requireRole(await getOrgScope(ctx), "operator");
    const reference = `EX-${String(Date.now() % 100000).padStart(5, '0')}`;
    return await ctx.db.insert("shipments", {
      reference,
      fromHubId: args.fromHubId,
      toHubId: args.toHubId,
      status: "pending" as const,
      weight: args.weight,
      priority: args.priority,
      customerName: args.customerName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      orgId: scope.orgId,
      ...(args.customerRef !== undefined ? { customerRef: args.customerRef } : {}),
      ...(args.estimatedDelivery !== undefined ? { estimatedDelivery: args.estimatedDelivery } : {}),
    });
  },
});

export const updateStatus = mutation({
  args: {
    shipmentId: v.id("shipments"),
    status: v.union(
      v.literal("pending"),
      v.literal("loading"),
      v.literal("in_transit"),
      v.literal("delivered"),
      v.literal("delayed"),
      v.literal("cancelled")
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scope = requireRole(await getOrgScope(ctx), "operator");
    const shipment = await ctx.db.get("shipments", args.shipmentId);
    if (!shipment) throw new Error("Expédition introuvable");
    if (shipment.orgId !== scope.orgId) throw new Error("Accès refusé");
    const update: Record<string, any> = {
      status: args.status,
      updatedAt: Date.now(),
    };
    if (args.status === "delivered") {
      update.actualDelivery = Date.now();
    }
    await ctx.db.patch("shipments", args.shipmentId, update);

    const eventType =
      args.status === "pending"
        ? "created"
        : args.status === "loading"
          ? "processed"
          : args.status;
    const descriptions: Record<string, string> = {
      pending: "Expédition enregistrée, en attente de traitement",
      loading: "Chargement en cours au hub de départ",
      in_transit: "En route vers le hub de destination",
      delivered: "Livrée au hub de destination",
      delayed: "Retard signalé sur le trajet",
      cancelled: "Expédition annulée",
    };
    await recordTrackingEvent(ctx, {
      orgId: scope.orgId,
      shipmentId: args.shipmentId,
      eventType,
      description: descriptions[args.status],
    });
    return null;
  },
});

export const update = mutation({
  args: {
    shipmentId: v.id("shipments"),
    fromHubId: v.optional(v.id("hubs")),
    toHubId: v.optional(v.id("hubs")),
    weight: v.optional(v.number()),
    priority: v.optional(v.union(v.literal("low"), v.literal("normal"), v.literal("high"), v.literal("urgent"))),
    customerName: v.optional(v.string()),
    customerRef: v.optional(v.union(v.string(), v.null())),
    estimatedDelivery: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scope = requireRole(await getOrgScope(ctx), "operator");
    const shipment = await ctx.db.get("shipments", args.shipmentId);
    if (!shipment) throw new Error("Expédition introuvable");
    if (shipment.orgId !== scope.orgId) throw new Error("Accès refusé");

    const patch: Record<string, any> = { updatedAt: Date.now() };
    if (args.fromHubId !== undefined) patch.fromHubId = args.fromHubId;
    if (args.toHubId !== undefined) patch.toHubId = args.toHubId;
    if (args.weight !== undefined) patch.weight = args.weight;
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.customerName !== undefined) patch.customerName = args.customerName;
    if (args.customerRef !== undefined) {
      patch.customerRef = args.customerRef;
    }
    if (args.estimatedDelivery !== undefined) {
      patch.estimatedDelivery = args.estimatedDelivery;
    }
    await ctx.db.patch("shipments", args.shipmentId, patch);
    return null;
  },
});

export const getById = query({
  args: { shipmentId: v.id("shipments") },
  returns: v.union(
    v.null(),
    v.object({
      shipment: shipmentFields,
      fromHub: v.object({
        _id: v.id("hubs"),
        name: v.string(),
        code: v.string(),
        city: v.string(),
        country: v.string(),
      }),
      toHub: v.object({
        _id: v.id("hubs"),
        name: v.string(),
        code: v.string(),
        city: v.string(),
        country: v.string(),
      }),
      route: v.optional(v.object({
        _id: v.id("routes"),
        name: v.string(),
        distance: v.number(),
        avgDuration: v.number(),
      })),
    }),
  ),
  handler: async (ctx, args) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return null;
    const shipment = await ctx.db.get("shipments", args.shipmentId);
    if (!shipment || shipment.orgId !== scope.orgId) return null;

    const [fromHub, toHub] = await Promise.all([
      ctx.db.get("hubs", shipment.fromHubId),
      ctx.db.get("hubs", shipment.toHubId),
    ]);
    if (!fromHub || !toHub) return null;
    const formatHub = (h: NonNullable<typeof fromHub>) => ({
      _id: h._id,
      name: h.name,
      code: h.code,
      city: h.city,
      country: h.country,
    });

    let route:
      | { _id: Id<"routes">; name: string; distance: number; avgDuration: number }
      | undefined;
    if (shipment.routeId) {
      const routeDoc = await ctx.db.get("routes", shipment.routeId);
      if (routeDoc) {
        route = {
          _id: routeDoc._id,
          name: routeDoc.name,
          distance: routeDoc.distance,
          avgDuration: routeDoc.avgDuration,
        };
      }
    }

    return {
      shipment,
      fromHub: formatHub(fromHub),
      toHub: formatHub(toHub),
      route,
    };
  },
});