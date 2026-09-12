import { v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { eventTypeSchema } from "./tracking";
import type { Id } from "./_generated/dataModel";

const DAY_MS = 24 * 60 * 60 * 1000;

export const insertHub = internalMutation({
  args: {
    orgId: v.id("organizations"),
    name: v.string(),
    code: v.string(),
    city: v.string(),
    country: v.string(),
    capacity: v.number(),
    currentLoad: v.number(),
    lat: v.number(),
    lng: v.number(),
    isActive: v.boolean(),
  },
  returns: v.id("hubs"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("hubs", args);
  },
});

export const insertRoute = internalMutation({
  args: {
    orgId: v.id("organizations"),
    name: v.string(),
    fromHubId: v.id("hubs"),
    toHubId: v.id("hubs"),
    distance: v.number(),
    avgDuration: v.number(),
    isActive: v.boolean(),
  },
  returns: v.id("routes"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("routes", args);
  },
});

export const insertShipment = internalMutation({
  args: {
    orgId: v.id("organizations"),
    fromHubId: v.id("hubs"),
    toHubId: v.id("hubs"),
    routeId: v.optional(v.id("routes")),
    weight: v.number(),
    priority: v.union(v.literal("low"), v.literal("normal"), v.literal("high"), v.literal("urgent")),
    customerName: v.string(),
    customerRef: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("loading"),
      v.literal("in_transit"),
      v.literal("delivered"),
      v.literal("delayed"),
      v.literal("cancelled")
    ),
    createdAt: v.number(),
    estimatedDelivery: v.optional(v.number()),
    actualDelivery: v.optional(v.number()),
  },
  returns: v.id("shipments"),
  handler: async (ctx, args) => {
    const reference = `EX-${String(40000 + Math.floor(Math.random() * 9000))}`;
    return await ctx.db.insert("shipments", {
      reference,
      fromHubId: args.fromHubId,
      toHubId: args.toHubId,
      status: args.status,
      weight: args.weight,
      priority: args.priority,
      customerName: args.customerName,
      createdAt: args.createdAt,
      orgId: args.orgId,
      ...(args.routeId !== undefined ? { routeId: args.routeId } : {}),
      ...(args.customerRef !== undefined ? { customerRef: args.customerRef } : {}),
      ...(args.estimatedDelivery !== undefined ? { estimatedDelivery: args.estimatedDelivery } : {}),
      ...(args.actualDelivery !== undefined ? { actualDelivery: args.actualDelivery } : {}),
    });
  },
});

export const insertEvent = internalMutation({
  args: {
    orgId: v.id("organizations"),
    shipmentId: v.id("shipments"),
    eventType: eventTypeSchema,
    description: v.string(),
    location: v.optional(v.string()),
  },
  returns: v.id("trackingEvents"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("trackingEvents", {
      shipmentId: args.shipmentId,
      eventType: args.eventType,
      description: args.description,
      orgId: args.orgId,
      ...(args.location !== undefined ? { location: args.location } : {}),
    });
  },
});

export const insertIncident = internalMutation({
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
      v.literal("other")
    ),
    severity: v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical")),
    title: v.string(),
    description: v.string(),
    status: v.union(v.literal("open"), v.literal("investigating"), v.literal("resolved")),
    resolvedAt: v.optional(v.number()),
  },
  returns: v.id("incidents"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("incidents", {
      orgId: args.orgId,
      type: args.type,
      severity: args.severity,
      title: args.title,
      description: args.description,
      status: args.status,
      createdAt: Date.now(),
      ...(args.shipmentId !== undefined ? { shipmentId: args.shipmentId } : {}),
      ...(args.hubId !== undefined ? { hubId: args.hubId } : {}),
      ...(args.resolvedAt !== undefined ? { resolvedAt: args.resolvedAt } : {}),
    });
  },
});

const eventEventTypes = [
  "created",
  "processed",
  "in_transit",
  "delayed",
  "delivered",
  "cancelled",
  "custom",
] as const;

type EventSeed = {
  shipmentId: Id<"shipments">;
  eventType: (typeof eventEventTypes)[number];
  description: string;
  location?: string;
  ts: number;
};

type ShipmentMeta = {
  id: Id<"shipments">;
  status: "pending" | "loading" | "in_transit" | "delivered" | "delayed" | "cancelled";
  createdAt: number;
};

export const seed = action({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const orgId: Id<"organizations"> = await ctx.runMutation(
      internal.organizations.ensureForSignup,
      {},
    );

    const hubsData = [
      { name: "Paris CDG", code: "CDG", city: "Paris", country: "France", capacity: 50000, currentLoad: 44000, lat: 49.0097, lng: 2.5479, isActive: true },
      { name: "Lyon-Sud", code: "LYS", city: "Lyon", country: "France", capacity: 35000, currentLoad: 32200, lat: 45.7256, lng: 4.8139, isActive: true },
      { name: "Marseille", code: "MRS", city: "Marseille", country: "France", capacity: 40000, currentLoad: 24400, lat: 43.4393, lng: 5.2214, isActive: true },
      { name: "Bordeaux", code: "BOD", city: "Bordeaux", country: "France", capacity: 25000, currentLoad: 11750, lat: 44.8283, lng: -0.7153, isActive: true },
      { name: "Lille", code: "LIL", city: "Lille", country: "France", capacity: 30000, currentLoad: 22500, lat: 50.5619, lng: 3.087, isActive: true },
    ];

    const hubIds: Array<Id<"hubs">> = [];
    for (const hub of hubsData) {
      const id: Id<"hubs"> = await ctx.runMutation(internal.seed.insertHub, {
        orgId,
        ...hub,
      });
      hubIds.push(id);
    }

    const routesData = [
      { name: "Paris → Lyon", from: 0, to: 1, distance: 465, avgDuration: 270 },
      { name: "Lyon → Marseille", from: 1, to: 2, distance: 315, avgDuration: 200 },
      { name: "Marseille → Bordeaux", from: 2, to: 3, distance: 585, avgDuration: 390 },
      { name: "Bordeaux → Lille", from: 3, to: 4, distance: 720, avgDuration: 480 },
    ];
    const routeIds: Array<Id<"routes">> = [];
    for (const route of routesData) {
      const id: Id<"routes"> = await ctx.runMutation(internal.seed.insertRoute, {
        orgId,
        name: route.name,
        fromHubId: hubIds[route.from],
        toHubId: hubIds[route.to],
        distance: route.distance,
        avgDuration: route.avgDuration,
        isActive: true,
      });
      routeIds.push(id);
    }

    const now = Date.now();
    const baseOf = (daysAgo: number) => now - daysAgo * DAY_MS - Math.floor(Math.random() * 12) * 3600000;

    const customers = [
      { name: "Nexus Retail", ref: "NR-22118" },
      { name: "L'Auberge Provençale", ref: "AP-8831" },
      { name: "Transalp Distribution", ref: "TD-4119" },
      { name: "Breizh Match", ref: "BM-7024" },
      { name: "Nordica Pharma", ref: "NP-5567" },
    ];

    const statuses: Array<"pending" | "loading" | "in_transit" | "delivered" | "delayed" | "cancelled"> =
      ["in_transit", "delivered", "delayed", "pending", "loading", "in_transit",
       "delivered", "delayed", "in_transit", "delivered", "pending", "cancelled",
       "in_transit", "delivered", "in_transit", "delayed", "delivered", "pending",
       "in_transit", "delivered"];

    const priorities: Array<"low" | "normal" | "high" | "urgent"> = [
      "normal", "high", "urgent", "low", "normal", "high", "normal", "urgent",
      "normal", "high", "normal", "low", "urgent", "normal", "high", "normal",
      "low", "urgent", "normal", "high",
    ];

    const shipmentIds: Array<Id<"shipments">> = [];
    const shipmentMetas: Array<ShipmentMeta> = [];
    for (let i = 0; i < 20; i++) {
      const status = statuses[i];
      const createdAt = baseOf(i % 7);
      let estimatedDelivery: number | undefined;
      let actualDelivery: number | undefined;
      if (status === "delivered" || status === "delayed" || status === "in_transit" || status === "loading") {
        estimatedDelivery = createdAt + (i % 3) * DAY_MS + 8 * 3600000;
      }
      if (status === "delivered") {
        actualDelivery = i % 3 === 0
          ? (estimatedDelivery ?? createdAt + DAY_MS) + 5 * 3600000
          : (estimatedDelivery ?? createdAt + DAY_MS) - 2 * 3600000;
      }
      if (status === "delayed") {
        estimatedDelivery = createdAt + (i % 3 + 1) * DAY_MS;
      }
      const routeId = routeIds[i % routeIds.length];
      const id: Id<"shipments"> = await ctx.runMutation(
        internal.seed.insertShipment,
        {
          orgId,
          fromHubId: hubIds[i % hubIds.length],
          toHubId: hubIds[(i + 2) % hubIds.length],
          routeId,
          weight: 120 + Math.floor(Math.random() * 4900),
          priority: priorities[i],
          customerName: customers[i % customers.length].name,
          customerRef: customers[i % customers.length].ref,
          status,
          createdAt,
          ...(estimatedDelivery !== undefined ? { estimatedDelivery } : {}),
          ...(actualDelivery !== undefined ? { actualDelivery } : {}),
        },
      );
      shipmentIds.push(id);
      shipmentMetas.push({ id, status, createdAt });
    }

    const events: Array<EventSeed> = [];
    const eventDesc: Record<string, string> = {
      created: "Expédition créée et enregistrée",
      processed: "Chargement effectué au hub de départ",
      in_transit: "En route vers le hub de destination",
      delivered: "Livraison confirmée",
      delayed: "Retard déclaré sur le trajet",
      cancelled: "Expédition annulée",
    };
    for (let i = 0; i < shipmentMetas.length; i++) {
      const meta = shipmentMetas[i];
      const createdTs = meta.createdAt + 6 * 3600000;
      const inTransitTs = createdTs + (i % 5 + 2) * 3600000;
      if (meta.status !== "cancelled") {
        events.push({ shipmentId: meta.id, eventType: "created", description: eventDesc.created, location: hubsData[i % hubIds.length].city, ts: createdTs });
      }
      if (meta.status === "in_transit" || meta.status === "delivered" || meta.status === "delayed") {
        events.push({ shipmentId: meta.id, eventType: "processed", description: eventDesc.processed, location: hubsData[i % hubIds.length].city, ts: createdTs + 90 * 60000 });
        events.push({ shipmentId: meta.id, eventType: "in_transit", description: eventDesc.in_transit, location: `Route A${i % 7}`, ts: inTransitTs });
      }
      if (meta.status === "delivered") {
        events.push({ shipmentId: meta.id, eventType: "delivered", description: eventDesc.delivered, location: hubsData[(i + 2) % hubIds.length].city, ts: inTransitTs + 5 * 3600000 });
      }
      if (meta.status === "delayed") {
        events.push({ shipmentId: meta.id, eventType: "delayed", description: eventDesc.delayed, location: `Péage A${(i + i) % 7}`, ts: inTransitTs + 3 * 3600000 });
      }
      if (meta.status === "cancelled") {
        events.push({ shipmentId: meta.id, eventType: "cancelled", description: eventDesc.cancelled, location: hubsData[i % hubIds.length].city, ts: createdTs + 2 * 3600000 });
      }
    }
    events.sort((a, b) => a.ts - b.ts);
    for (const event of events) {
      await ctx.runMutation(internal.seed.insertEvent, {
        orgId,
        shipmentId: event.shipmentId,
        eventType: event.eventType,
        description: event.description,
        ...(event.location !== undefined ? { location: event.location } : {}),
      });
    }

    type IncidentSeed = {
      shipmentIdIdx?: number;
      hubIdIdx?: number;
      type: "breakdown" | "customs" | "capacity" | "delay" | "damage" | "other";
      severity: "low" | "medium" | "high" | "critical";
      title: string;
      description: string;
      status: "open" | "investigating" | "resolved";
    };
    const incidentsData: Array<IncidentSeed> = [
      { shipmentIdIdx: 2, type: "customs" as const, severity: "high" as const, title: "Retard douane", description: "3 palettes bloquées à la frontière. Dossier incomplet.", status: "open" as const },
      { shipmentIdIdx: 5, type: "breakdown" as const, severity: "critical" as const, title: "Rupture frigorifique", description: "Camion #TK-228, sonde à +12°C depuis 40 min.", status: "investigating" as const },
      { shipmentIdIdx: 15, type: "delay" as const, severity: "medium" as const, title: "Bouchons A7", description: "+2h de trajet estimé, secteur Saint-Étienne.", status: "open" as const },
      { hubIdIdx: 1, type: "capacity" as const, severity: "medium" as const, title: "Entrepôt Lyon-Sud", description: "Capacité à 92%. Redirection recommandée vers Lyon-Nord.", status: "open" as const },
      { type: "damage" as const, severity: "low" as const, title: "Colis endommagé (écrasé)", description: "Carton plastifié signalé par le client, photo fournie.", status: "resolved" as const },
    ];
    for (const inc of incidentsData) {
      const shipmentId = inc.shipmentIdIdx !== undefined
        ? shipmentIds[inc.shipmentIdIdx]
        : undefined;
      const hubId = inc.hubIdIdx !== undefined
        ? hubIds[inc.hubIdIdx]
        : undefined;
      await ctx.runMutation(internal.seed.insertIncident, {
        orgId,
        type: inc.type,
        severity: inc.severity,
        title: inc.title,
        description: inc.description,
        status: inc.status,
        ...(shipmentId !== undefined ? { shipmentId } : {}),
        ...(hubId !== undefined ? { hubId } : {}),
        ...(inc.status === "resolved" ? { resolvedAt: now - 2 * DAY_MS } : {}),
      });
    }

    console.log("Seed complete. Hubs:", hubIds.length, "· Shipments:", shipmentIds.length, "· Events:", events.length);
    return null;
  },
});