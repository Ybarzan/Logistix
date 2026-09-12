import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { roleSchema } from "./schema";
import { getOrgScope, requireRole } from "./orgContext";
import type { Id } from "./_generated/dataModel";

export const DEFAULT_ORG_SLUG = "logistix";

/**
 * Récupère (ou crée) l'organisation de démonstration "LogistiX".
 * Appelée au moment de la création du premier compte afin que toutes
 * les données du seed appartiennent à la même organisation.
 */
export const ensureForSignup = internalMutation({
  args: {},
  returns: v.id("organizations"),
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", DEFAULT_ORG_SLUG))
      .first();
    if (existing) {
      return existing._id;
    }
    return await ctx.db.insert("organizations", {
      name: "LogistiX",
      slug: DEFAULT_ORG_SLUG,
    });
  },
});

/**
 * Utilisateur courant (avec son organisation) pour l'en-tête de l'app.
 */
export const currentUser = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("users"),
      _creationTime: v.number(),
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      role: v.optional(roleSchema),
      org: v.optional(
        v.object({
          _id: v.id("organizations"),
          name: v.string(),
          slug: v.string(),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get("users", userId);
    if (!user) return null;

    let org:
      | { _id: Id<"organizations">; name: string; slug: string }
      | undefined;
    if (user.orgId) {
      const orgDoc = await ctx.db.get("organizations", user.orgId);
      if (orgDoc) {
        org = { _id: orgDoc._id, name: orgDoc.name, slug: orgDoc.slug };
      }
    }
    if (!org) {
      const fallback = await ctx.db
        .query("organizations")
        .withIndex("by_slug", (q) => q.eq("slug", DEFAULT_ORG_SLUG))
        .first();
      if (fallback) {
        org = { _id: fallback._id, name: fallback.name, slug: fallback.slug };
      }
    }

    return {
      _id: user._id,
      _creationTime: user._creationTime,
      name: user.name,
      email: user.email,
      role: user.role,
      org,
    };
  },
});

/**
 * Met à jour le rôle d'un utilisateur de l'organisation.
 * Réservé aux admins (requireRole "admin").
 */
export const updateUserRole = mutation({
  args: {
    userId: v.id("users"),
    role: roleSchema,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireRole(await getOrgScope(ctx), "admin");
    const target = await ctx.db.get("users", args.userId);
    if (!target) throw new Error("Utilisateur introuvable");
    await ctx.db.patch("users", args.userId, { role: args.role });
    return null;
  },
});