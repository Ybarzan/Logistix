import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getOrgScope, requireOwned, requireRole } from "./orgContext";
import { recordTrackingEvent } from "./tracking";
import { canTransition, formatShipmentReference, isTerminal } from "./shipmentStatus";
import type { ShipmentStatus } from "./shipmentStatus";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

export const shipmentStatusSchema = v.union(
  v.literal("pending"),
  v.literal("loading"),
  v.literal("in_transit"),
  v.literal("delivered"),
  v.literal("delayed"),
  v.literal("cancelled"),
);

const prioritySchema = v.union(
  v.literal("low"),
  v.literal("normal"),
  v.literal("high"),
  v.literal("urgent"),
);

const shipmentFields = v.object({
  _id: v.id("shipments"),
  _creationTime: v.number(),
  reference: v.string(),
  fromHubId: v.id("hubs"),
  toHubId: v.id("hubs"),
  routeId: v.optional(v.id("routes")),
  status: shipmentStatusSchema,
  weight: v.number(),
  priority: prioritySchema,
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
    status: v.optional(shipmentStatusSchema),
    limit: v.optional(v.number()),
  },
  returns: v.array(shipmentFields),
  handler: async (ctx, args) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return [];
    const limit = Math.min(args.limit ?? 50, 500);
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
  onTimeRate: null,
  activeDelays: 0,
  openIncidents: 0,
  recentShipments: [],
  activeAlerts: [],
  hubLoads: [],
  onTime: 0,
  late: 0,
  deliveredLast7d: 0,
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const dashboardStats = query({
  args: {},
  returns: v.object({
    inTransit: v.number(),
    // null = aucune livraison mesurable sur 7 jours (et non 0 %).
    onTimeRate: v.union(v.number(), v.null()),
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
    onTime: v.number(),
    late: v.number(),
    deliveredLast7d: v.number(),
  }),
  handler: async (ctx) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return emptyStats;
    const orgId = scope.orgId;

    // Lectures bornées par index (statut) plutôt qu'un scan complet.
    const byStatus = (status: ShipmentStatus) =>
      ctx.db
        .query("shipments")
        .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", status))
        .collect();
    const [inTransitDocs, delayedDocs, deliveredDocs] = await Promise.all([
      byStatus("in_transit"),
      byStatus("delayed"),
      byStatus("delivered"),
    ]);

    // Ponctualité mesurée sur les livraisons *effectuées* ces 7 derniers
    // jours (date de livraison, pas de création), avec une ETA connue.
    const weekAgo = Date.now() - WEEK_MS;
    const measurable = deliveredDocs.filter(
      (s) =>
        s.actualDelivery !== undefined &&
        s.actualDelivery >= weekAgo &&
        s.estimatedDelivery !== undefined,
    );
    const onTime = measurable.filter(
      (s) => (s.actualDelivery ?? 0) <= (s.estimatedDelivery ?? 0),
    ).length;
    const onTimeRate = measurable.length > 0
      ? Math.round((onTime / measurable.length) * 1000) / 10
      : null;

    const openIncidents = await ctx.db
      .query("incidents")
      .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", "open"))
      .order("desc")
      .collect();

    const recentShipmentsData = await ctx.db
      .query("shipments")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(5);

    const hubsData = await ctx.db
      .query("hubs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const hubLoadsData = hubsData
      .filter((h) => h.isActive)
      .sort((a, b) => b.currentLoad / (b.capacity || 1) - a.currentLoad / (a.capacity || 1))
      .slice(0, 5)
      .map((h) => ({ hubId: h._id, name: h.name, load: h.currentLoad, capacity: h.capacity }));

    return {
      inTransit: inTransitDocs.length,
      onTimeRate,
      activeDelays: delayedDocs.length,
      openIncidents: openIncidents.length,
      recentShipments: recentShipmentsData.map((s) => ({
        _id: s._id,
        reference: s.reference,
        status: s.status,
        weight: s.weight,
        customerName: s.customerName,
        fromHubId: s.fromHubId,
        toHubId: s.toHubId,
        createdAt: s.createdAt,
      })),
      activeAlerts: openIncidents.slice(0, 5).map((i) => ({
        _id: i._id,
        type: i.type as string,
        severity: i.severity as string,
        title: i.title,
        description: i.description,
        status: i.status as string,
        createdAt: i.createdAt,
      })),
      hubLoads: hubLoadsData,
      onTime,
      late: measurable.length - onTime,
      deliveredLast7d: measurable.length,
    };
  },
});

/**
 * Itinéraire actif de l'organisation reliant ces deux hubs, s'il existe.
 * Sans lui, l'expédition n'apparaît dans aucune statistique par itinéraire.
 */
export async function resolveRoute(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  fromHubId: Id<"hubs">,
  toHubId: Id<"hubs">,
): Promise<Doc<"routes"> | null> {
  const candidates = await ctx.db
    .query("routes")
    .withIndex("by_from_hub", (q) => q.eq("fromHubId", fromHubId))
    .collect();
  return (
    candidates.find((r) => r.orgId === orgId && r.toHubId === toHubId && r.isActive) ?? null
  );
}

function validateWeight(weight: number) {
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error("Le poids doit être un nombre positif");
  }
}

async function nextReference(ctx: MutationCtx, orgId: Id<"organizations">): Promise<string> {
  const org = await ctx.db.get("organizations", orgId);
  if (!org) throw new Error("Organisation introuvable");
  const now = Date.now();
  let seq = (org.shipmentSeq ?? 0) + 1;
  let reference = formatShipmentReference(seq, now);
  // Garde-fou si des références ont été créées hors compteur (import, seed).
  while (
    await ctx.db
      .query("shipments")
      .withIndex("by_org_and_reference", (q) => q.eq("orgId", orgId).eq("reference", reference))
      .first()
  ) {
    seq += 1;
    reference = formatShipmentReference(seq, now);
  }
  await ctx.db.patch("organizations", orgId, { shipmentSeq: seq });
  return reference;
}

export const create = mutation({
  args: {
    fromHubId: v.id("hubs"),
    toHubId: v.id("hubs"),
    weight: v.number(),
    priority: prioritySchema,
    customerName: v.string(),
    customerRef: v.optional(v.string()),
    estimatedDelivery: v.optional(v.number()),
  },
  returns: v.id("shipments"),
  handler: async (ctx, args) => {
    const scope = requireRole(await getOrgScope(ctx), "operator");
    if (args.fromHubId === args.toHubId) {
      throw new Error("Les hubs de départ et d'arrivée doivent être différents");
    }
    validateWeight(args.weight);
    const customerName = args.customerName.trim();
    if (!customerName) throw new Error("Nom du client requis");
    await requireOwned(ctx, "hubs", args.fromHubId, scope.orgId);
    await requireOwned(ctx, "hubs", args.toHubId, scope.orgId);

    const now = Date.now();
    const route = await resolveRoute(ctx, scope.orgId, args.fromHubId, args.toHubId);
    // ETA par défaut : durée moyenne de l'itinéraire (minutes) si connue.
    const estimatedDelivery =
      args.estimatedDelivery ?? (route ? now + route.avgDuration * 60_000 : undefined);
    const reference = await nextReference(ctx, scope.orgId);

    const shipmentId = await ctx.db.insert("shipments", {
      reference,
      fromHubId: args.fromHubId,
      toHubId: args.toHubId,
      status: "pending" as const,
      weight: args.weight,
      priority: args.priority,
      customerName,
      createdAt: now,
      updatedAt: now,
      orgId: scope.orgId,
      ...(route ? { routeId: route._id } : {}),
      ...(args.customerRef !== undefined ? { customerRef: args.customerRef } : {}),
      ...(estimatedDelivery !== undefined ? { estimatedDelivery } : {}),
    });
    await recordTrackingEvent(ctx, {
      orgId: scope.orgId,
      shipmentId,
      eventType: "created",
      description: "Expédition enregistrée, en attente de traitement",
    });
    return shipmentId;
  },
});

const statusDescriptions: Record<ShipmentStatus, string> = {
  pending: "Expédition enregistrée, en attente de traitement",
  loading: "Chargement en cours au hub de départ",
  in_transit: "En route vers le hub de destination",
  delivered: "Livrée au hub de destination",
  delayed: "Retard signalé sur le trajet",
  cancelled: "Expédition annulée",
};

/**
 * Applique une transition de statut validée par la machine à états,
 * trace l'événement et clôture les incidents de retard automatiques
 * quand l'expédition atteint un état terminal. Partagé avec le cron.
 */
export async function applyStatusChange(
  ctx: MutationCtx,
  shipment: Doc<"shipments">,
  status: ShipmentStatus,
  description?: string,
): Promise<void> {
  if (!canTransition(shipment.status, status)) {
    throw new Error(`Transition interdite : ${shipment.status} → ${status}`);
  }
  const orgId = shipment.orgId;
  if (!orgId) throw new Error("Expédition sans organisation");
  const now = Date.now();
  await ctx.db.patch("shipments", shipment._id, {
    status,
    updatedAt: now,
    ...(status === "delivered" ? { actualDelivery: now } : {}),
  });
  const eventType =
    status === "pending" ? "created" : status === "loading" ? "processed" : status;
  await recordTrackingEvent(ctx, {
    orgId,
    shipmentId: shipment._id,
    eventType,
    description: description ?? statusDescriptions[status],
  });

  if (isTerminal(status)) {
    for (const incidentStatus of ["open", "investigating"] as const) {
      const incidents = await ctx.db
        .query("incidents")
        .withIndex("by_org_and_status", (q) =>
          q.eq("orgId", orgId).eq("status", incidentStatus),
        )
        .collect();
      for (const inc of incidents) {
        if (inc.shipmentId === shipment._id && inc.type === "delay" && inc.source === "auto") {
          await ctx.db.patch("incidents", inc._id, { status: "resolved", resolvedAt: now });
        }
      }
    }
  }
}

export const updateStatus = mutation({
  args: {
    shipmentId: v.id("shipments"),
    status: shipmentStatusSchema,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scope = requireRole(await getOrgScope(ctx), "operator");
    const shipment = await requireOwned(ctx, "shipments", args.shipmentId, scope.orgId);
    await applyStatusChange(ctx, shipment, args.status);
    return null;
  },
});

export const update = mutation({
  args: {
    shipmentId: v.id("shipments"),
    fromHubId: v.optional(v.id("hubs")),
    toHubId: v.optional(v.id("hubs")),
    weight: v.optional(v.number()),
    priority: v.optional(prioritySchema),
    customerName: v.optional(v.string()),
    customerRef: v.optional(v.union(v.string(), v.null())),
    estimatedDelivery: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scope = requireRole(await getOrgScope(ctx), "operator");
    const shipment = await requireOwned(ctx, "shipments", args.shipmentId, scope.orgId);
    if (isTerminal(shipment.status)) {
      throw new Error("Une expédition livrée ou annulée n'est plus modifiable");
    }

    const patch: Partial<Doc<"shipments">> = { updatedAt: Date.now() };
    if (args.fromHubId !== undefined) {
      await requireOwned(ctx, "hubs", args.fromHubId, scope.orgId);
      patch.fromHubId = args.fromHubId;
    }
    if (args.toHubId !== undefined) {
      await requireOwned(ctx, "hubs", args.toHubId, scope.orgId);
      patch.toHubId = args.toHubId;
    }
    const fromHubId = patch.fromHubId ?? shipment.fromHubId;
    const toHubId = patch.toHubId ?? shipment.toHubId;
    if (fromHubId === toHubId) {
      throw new Error("Les hubs de départ et d'arrivée doivent être différents");
    }
    if (patch.fromHubId !== undefined || patch.toHubId !== undefined) {
      const route = await resolveRoute(ctx, scope.orgId, fromHubId, toHubId);
      // undefined dans un patch = suppression du champ (plus d'itinéraire).
      patch.routeId = route?._id;
    }
    if (args.weight !== undefined) {
      validateWeight(args.weight);
      patch.weight = args.weight;
    }
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.customerName !== undefined) patch.customerName = args.customerName.trim();
    // null = effacement (patch à undefined supprime le champ côté Convex).
    if (args.customerRef !== undefined) patch.customerRef = args.customerRef ?? undefined;
    if (args.estimatedDelivery !== undefined) {
      patch.estimatedDelivery = args.estimatedDelivery ?? undefined;
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
      ...(route ? { route } : {}),
    };
  },
});
