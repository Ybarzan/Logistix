import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getOrgScope } from "./orgContext";

export const list = query({
  args: {},
  returns: v.array(v.object({
    _id: v.id("hubs"),
    _creationTime: v.number(),
    name: v.string(),
    code: v.string(),
    city: v.string(),
    country: v.string(),
    capacity: v.number(),
    currentLoad: v.number(),
    lat: v.number(),
    lng: v.number(),
    isActive: v.boolean(),
  })),
  handler: async (ctx) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return [];
    return await ctx.db
      .query("hubs")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .collect();
  },
});

export const create = mutation({
  args: {
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
    const scope = await getOrgScope(ctx);
    if (!scope) throw new Error("Non authentifié");
    return await ctx.db.insert("hubs", { ...args, orgId: scope.orgId });
  },
});

export const update = mutation({
  args: {
    hubId: v.id("hubs"),
    name: v.optional(v.string()),
    code: v.optional(v.string()),
    city: v.optional(v.string()),
    country: v.optional(v.string()),
    capacity: v.optional(v.number()),
    currentLoad: v.optional(v.number()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scope = await getOrgScope(ctx);
    if (!scope) throw new Error("Non authentifié");
    const hub = await ctx.db.get("hubs", args.hubId);
    if (!hub) throw new Error("Entrepôt introuvable");
    if (hub.orgId !== scope.orgId) throw new Error("Accès refusé");
    const patch: Record<string, any> = {};
    for (const key of ["name", "code", "city", "country", "capacity", "currentLoad", "lat", "lng", "isActive"] as const) {
      if (args[key] !== undefined) patch[key] = args[key];
    }
    await ctx.db.patch("hubs", args.hubId, patch);
    return null;
  },
});