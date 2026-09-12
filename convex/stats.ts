import { v } from "convex/values";
import { query } from "./_generated/server";
import { getOrgScope } from "./orgContext";
import type { Id } from "./_generated/dataModel";

const DAYS = 7;

function dayLabel(timestamp: number): string {
  const days = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
  const d = new Date(timestamp);
  return `${days[d.getDay()]} ${d.getDate()}`;
}

const slaRouteStats = v.object({
  routeId: v.optional(v.id("routes")),
  name: v.string(),
  delivered: v.number(),
  onTime: v.number(),
  slaRate: v.number(),
});

export const slaStats = query({
  args: {},
  returns: v.object({
    total: v.number(),
    statusCounts: v.object({
      pending: v.number(),
      loading: v.number(),
      in_transit: v.number(),
      delivered: v.number(),
      delayed: v.number(),
      cancelled: v.number(),
    }),
    slaRate: v.number(),
    onTime: v.number(),
    late: v.number(),
    avgTransitHours: v.optional(v.number()),
    delaysByReason: v.array(
      v.object({
        type: v.string(),
        label: v.string(),
        count: v.number(),
      }),
    ),
    slaByRoute: v.array(slaRouteStats),
  }),
  handler: async (ctx) => {
    const scope = await getOrgScope(ctx);
    if (!scope) {
      return {
        total: 0,
        statusCounts: {
          pending: 0,
          loading: 0,
          in_transit: 0,
          delivered: 0,
          delayed: 0,
          cancelled: 0,
        },
        slaRate: 0,
        onTime: 0,
        late: 0,
        avgTransitHours: undefined,
        delaysByReason: [],
        slaByRoute: [],
      };
    }

    const shipments = await ctx.db
      .query("shipments")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .collect();
    const incidents = await ctx.db
      .query("incidents")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .collect();
    const routes = await ctx.db
      .query("routes")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .collect();

    const statusCounts = {
      pending: shipments.filter((s) => s.status === "pending").length,
      loading: shipments.filter((s) => s.status === "loading").length,
      in_transit: shipments.filter((s) => s.status === "in_transit").length,
      delivered: shipments.filter((s) => s.status === "delivered").length,
      delayed: shipments.filter((s) => s.status === "delayed").length,
      cancelled: shipments.filter((s) => s.status === "cancelled").length,
    };

    const delivered = shipments.filter(
      (s) => s.status === "delivered" && s.actualDelivery && s.estimatedDelivery,
    );
    const onTime = delivered.filter(
      (s) => (s.actualDelivery ?? 0) <= (s.estimatedDelivery ?? 0),
    ).length;
    const deliveredTotal = delivered.length;
    const late = deliveredTotal - onTime;
    const slaRate = deliveredTotal > 0
      ? Math.round((onTime / deliveredTotal) * 1000) / 10
      : 0;

    const transitMs = delivered.reduce((acc, s) => acc + ((s.actualDelivery ?? 0) - s.createdAt), 0);
    const avgTransitHours = deliveredTotal > 0
      ? Math.round((transitMs / deliveredTotal / 3600000) * 10) / 10
      : undefined;

    const reasonLabels: Record<string, string> = {
      breakdown: "Panne matérielle",
      customs: "Douane",
      capacity: "Capacité entrepôt",
      delay: "Retard réseau",
      damage: "Colis endommagé",
      other: "Autre",
    };
    const delaysByReason: Array<{ type: string; label: string; count: number }> = [];
    for (const inc of incidents) {
      if (inc.resolvedAt) continue;
      const entry = delaysByReason.find((r) => r.type === inc.type);
      if (entry) {
        entry.count += 1;
      } else {
        delaysByReason.push({
          type: inc.type,
          label: reasonLabels[inc.type],
          count: 1,
        });
      }
    }

    const routeById = new Map<Id<"routes">, { name: string }>();
    for (const route of routes) {
      routeById.set(route._id, { name: route.name });
    }

    const routeBuckets = new Map<Id<"routes">, { delivered: number; onTime: number }>();
    for (const s of delivered) {
      if (!s.routeId) continue;
      const key = s.routeId;
      const bucket = routeBuckets.get(key) ?? { delivered: 0, onTime: 0 };
      bucket.delivered += 1;
      if ((s.actualDelivery ?? 0) <= (s.estimatedDelivery ?? 0)) {
        bucket.onTime += 1;
      }
      routeBuckets.set(key, bucket);
    }

    const slaByRoute: Array<{
      routeId?: Id<"routes">;
      name: string;
      delivered: number;
      onTime: number;
      slaRate: number;
    }> = [];
    for (const [routeId, bucket] of routeBuckets) {
      const meta = routeById.get(routeId);
      slaByRoute.push({
        routeId,
        name: meta?.name ?? routeId,
        delivered: bucket.delivered,
        onTime: bucket.onTime,
        slaRate: bucket.delivered > 0
          ? Math.round((bucket.onTime / bucket.delivered) * 1000) / 10
          : 0,
      });
    }
    slaByRoute.sort((a, b) => b.delivered - a.delivered);

    return {
      total: shipments.length,
      statusCounts,
      slaRate,
      onTime,
      late,
      avgTransitHours,
      delaysByReason,
      slaByRoute,
    };
  },
});

export const performanceStats = query({
  args: {},
  returns: v.object({
    inTransit: v.number(),
    totalWeightInTransit: v.number(),
    deliveredTotal: v.number(),
    onTimeRate: v.number(),
    openIncidents: v.number(),
    resolvedIncidents: v.number(),
    resolutionRate: v.number(),
    volumePerDay: v.array(
      v.object({
        label: v.string(),
        count: v.number(),
      }),
    ),
    hubThroughput: v.array(
      v.object({
        hubId: v.id("hubs"),
        name: v.string(),
        loadPct: v.number(),
        currentLoad: v.number(),
        capacity: v.number(),
        throughput: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const scope = await getOrgScope(ctx);
    const empty = {
      inTransit: 0,
      totalWeightInTransit: 0,
      deliveredTotal: 0,
      onTimeRate: 0,
      openIncidents: 0,
      resolvedIncidents: 0,
      resolutionRate: 0,
      volumePerDay: [],
      hubThroughput: [],
    };
    if (!scope) return empty;

    const shipments = await ctx.db
      .query("shipments")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .collect();
    const incidents = await ctx.db
      .query("incidents")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .collect();
    const hubs = await ctx.db
      .query("hubs")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .collect();

    const inTransit = shipments.filter((s) => s.status === "in_transit");
    const delivered = shipments.filter((s) => s.status === "delivered");
    const onTime = delivered.filter(
      (s) => s.actualDelivery && s.estimatedDelivery && s.actualDelivery <= s.estimatedDelivery,
    ).length;
    const onTimeRate = delivered.length > 0
      ? Math.round((onTime / delivered.length) * 1000) / 10
      : 0;

    const openIncidents = incidents.filter((i) => !i.resolvedAt).length;
    const resolvedIncidents = incidents.filter((i) => i.resolvedAt).length;
    const resolutionRate = incidents.length > 0
      ? Math.round((resolvedIncidents / incidents.length) * 1000) / 10
      : 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets: Array<{ label: string; count: number }> = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const start = today.getTime() - i * 24 * 60 * 60 * 1000;
      const end = start + 24 * 60 * 60 * 1000;
      const count = shipments.filter((s) => s.createdAt >= start && s.createdAt < end).length;
      buckets.push({ label: dayLabel(start), count });
    }

    const hubThroughput = hubs.map((hub) => {
      const throughput = shipments.filter(
        (s) => s.fromHubId === hub._id || s.toHubId === hub._id,
      ).length;
      const loadPct = hub.capacity > 0
        ? Math.round((hub.currentLoad / hub.capacity) * 1000) / 10
        : 0;
      return {
        hubId: hub._id,
        name: hub.name,
        loadPct,
        currentLoad: hub.currentLoad,
        capacity: hub.capacity,
        throughput,
      };
    });

    return {
      inTransit: inTransit.length,
      totalWeightInTransit: inTransit.reduce((acc, s) => acc + s.weight, 0),
      deliveredTotal: delivered.length,
      onTimeRate,
      openIncidents,
      resolvedIncidents,
      resolutionRate: resolutionRate,
      volumePerDay: buckets,
      hubThroughput,
    };
  },
});