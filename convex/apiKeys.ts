import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { getOrgScope, requireRole } from "./orgContext";
import type { Id } from "./_generated/dataModel";

/**
 * Clés d'API d'organisation pour l'API REST v1 (voir http.ts). Format
 * `lx_live_<43 car.>` ; seul le SHA-256 est stocké, la clé en clair n'est
 * montrée qu'à la création. Une clé agit avec les droits d'un opérateur de
 * SON organisation, jamais au-delà.
 */

const PREFIX = "lx_live_";

export async function hashKey(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return PREFIX + b64;
}

export const adminScope = internalQuery({
  args: {},
  returns: v.union(v.null(), v.object({ orgId: v.id("organizations"), userId: v.id("users") })),
  handler: async (ctx) => {
    const scope = await getOrgScope(ctx);
    return scope?.role === "admin" ? { orgId: scope.orgId, userId: scope.userId } : null;
  },
});

export const insertKey = internalMutation({
  args: { orgId: v.id("organizations"), userId: v.id("users"), name: v.string(), keyHash: v.string(), prefix: v.string() },
  returns: v.id("apiKeys"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("apiKeys", {
      orgId: args.orgId,
      createdBy: args.userId,
      name: args.name,
      keyHash: args.keyHash,
      prefix: args.prefix,
      createdAt: Date.now(),
    });
  },
});

/** Crée une clé (admin). La valeur en clair n'est renvoyée qu'ici. */
export const create = action({
  args: { name: v.string() },
  returns: v.object({ apiKey: v.string() }),
  handler: async (ctx, { name }): Promise<{ apiKey: string }> => {
    const scope = await ctx.runQuery(internal.apiKeys.adminScope, {});
    if (!scope) throw new Error("Permissions insuffisantes");
    const label = name.trim();
    if (label.length < 2 || label.length > 60) throw new Error("Nom de clé : 2 à 60 caractères");
    const apiKey = randomKey();
    await ctx.runMutation(internal.apiKeys.insertKey, {
      orgId: scope.orgId,
      userId: scope.userId,
      name: label,
      keyHash: await hashKey(apiKey),
      prefix: apiKey.slice(0, PREFIX.length + 4),
    });
    return { apiKey };
  },
});

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("apiKeys"),
      name: v.string(),
      prefix: v.string(),
      createdAt: v.number(),
      lastUsedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const scope = await getOrgScope(ctx);
    if (!scope || scope.role !== "admin") return [];
    const rows = await ctx.db.query("apiKeys").withIndex("by_org", (q) => q.eq("orgId", scope.orgId)).collect();
    return rows
      .filter((r) => r.revokedAt === undefined)
      .map((r) => ({
        _id: r._id,
        name: r.name,
        prefix: r.prefix,
        createdAt: r.createdAt,
        ...(r.lastUsedAt !== undefined ? { lastUsedAt: r.lastUsedAt } : {}),
      }));
  },
});

export const revoke = mutation({
  args: { keyId: v.id("apiKeys") },
  returns: v.null(),
  handler: async (ctx, { keyId }) => {
    const scope = requireRole(await getOrgScope(ctx), "admin");
    const key = await ctx.db.get("apiKeys", keyId);
    if (!key || key.orgId !== scope.orgId) throw new Error("Clé introuvable");
    await ctx.db.patch("apiKeys", keyId, { revokedAt: Date.now() });
    return null;
  },
});

/** Résout une clé (déjà hachée) en organisation ; null si inconnue ou révoquée. */
export const authenticate = internalMutation({
  args: { keyHash: v.string() },
  returns: v.union(v.null(), v.id("organizations")),
  handler: async (ctx, { keyHash }): Promise<Id<"organizations"> | null> => {
    const key = await ctx.db.query("apiKeys").withIndex("by_hash", (q) => q.eq("keyHash", keyHash)).first();
    if (!key || key.revokedAt !== undefined) return null;
    const now = Date.now();
    // Écriture limitée à une par minute par clé (pas de conflit sous charge).
    if (key.lastUsedAt === undefined || now - key.lastUsedAt > 60_000) {
      await ctx.db.patch("apiKeys", key._id, { lastUsedAt: now });
    }
    return key.orgId;
  },
});
