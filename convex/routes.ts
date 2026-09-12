import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getOrgScope } from "./orgContext";

export const list = query({
  args: {},
  returns: v.array(v.object({
    _id: v.id("routes"),
    _creationTime: v.number(),
    name: v.string(),
    fromHubId: v.id("hubs"),
    toHubId: v.id("hubs"),
    distance: v.number(),
    avgDuration: v.number(),
    isActive: v.boolean(),
  })),
  handler: async (ctx) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return [];
    return await ctx.db
      .query("routes")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    fromHubId: v.id("hubs"),
    toHubId: v.id("hubs"),
    distance: v.number(),
    avgDuration: v.number(),
    isActive: v.boolean(),
  },
  returns: v.id("routes"),
  handler: async (ctx, args) => {
    const scope = await getOrgScope(ctx);
    if (!scope) throw new Error("Non authentifié");
    return await ctx.db.insert("routes", { ...args, orgId: scope.orgId });
  },
});

export const update = mutation({
  args: {
    routeId: v.id("routes"),
    name: v.optional(v.string()),
    fromHubId: v.optional(v.id("hubs")),
    toHubId: v.optional(v.id("hubs")),
    distance: v.optional(v.number()),
    avgDuration: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scope = await getOrgScope(ctx);
    if (!scope) throw new Error("Non authentifié");
    const route = await ctx.db.get("routes", args.routeId);
    if (!route) throw new Error("Itinéraire introuvable");
    if (route.orgId !== scope.orgId) throw new Error("Accès refusé");
    const patch: Record<string, any> = {};
    for (const key of ["name", "fromHubId", "toHubId", "distance", "avgDuration", "isActive"] as const) {
      if (args[key] !== undefined) patch[key] = args[key];
    }
    await ctx.db.patch("routes", args.routeId, patch);
    return null;
  },
});