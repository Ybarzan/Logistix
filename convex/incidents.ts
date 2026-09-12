import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getOrgScope, requireRole } from "./orgContext";

const incidentFields = v.object({
  _id: v.id("incidents"),
  _creationTime: v.number(),
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
  createdAt: v.number(),
  resolvedAt: v.optional(v.number()),
  orgId: v.optional(v.id("organizations")),
});

export const list = query({
  args: {
    status: v.optional(v.union(
      v.literal("open"),
      v.literal("investigating"),
      v.literal("resolved")
    )),
  },
  returns: v.array(incidentFields),
  handler: async (ctx, args) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return [];
    if (args.status) {
      const status = args.status;
      return await ctx.db
        .query("incidents")
        .withIndex("by_org_and_status", (q) =>
          q.eq("orgId", scope.orgId).eq("status", status),
        )
        .order("desc")
        .take(50);
    }
    return await ctx.db
      .query("incidents")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .order("desc")
      .take(50);
  },
});

export const create = mutation({
  args: {
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
  },
  returns: v.id("incidents"),
  handler: async (ctx, args) => {
    const scope = requireRole(await getOrgScope(ctx), "operator");
    return await ctx.db.insert("incidents", {
      orgId: scope.orgId,
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

export const resolve = mutation({
  args: { incidentId: v.id("incidents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scope = requireRole(await getOrgScope(ctx), "operator");
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident) throw new Error("Incident introuvable");
    if (incident.orgId !== scope.orgId) throw new Error("Accès refusé");
    await ctx.db.patch("incidents", args.incidentId, {
      status: "resolved" as const,
      resolvedAt: Date.now(),
    });
    return null;
  },
});

export const update = mutation({
  args: {
    incidentId: v.id("incidents"),
    type: v.optional(v.union(
      v.literal("breakdown"),
      v.literal("customs"),
      v.literal("capacity"),
      v.literal("delay"),
      v.literal("damage"),
      v.literal("other")
    )),
    severity: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical"))),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(v.union(v.literal("open"), v.literal("investigating"), v.literal("resolved"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scope = requireRole(await getOrgScope(ctx), "manager");
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident) throw new Error("Incident introuvable");
    if (incident.orgId !== scope.orgId) throw new Error("Accès refusé");

    const patch: Record<string, any> = {};
    if (args.type !== undefined) patch.type = args.type;
    if (args.severity !== undefined) patch.severity = args.severity;
    if (args.title !== undefined) patch.title = args.title;
    if (args.description !== undefined) patch.description = args.description;
    if (args.status !== undefined) {
      patch.status = args.status;
      if (args.status === "resolved") {
        patch.resolvedAt = Date.now();
      }
    }
    await ctx.db.patch("incidents", args.incidentId, patch);
    return null;
  },
});