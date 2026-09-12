import { getAuthUserId } from "@convex-dev/auth/server";
import { DEFAULT_ORG_SLUG } from "./organizations";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export type OrgScope = {
  userId: Id<"users">;
  orgId: Id<"organizations">;
};

/**
 * Retourne l'utilisateur courant et son organisation, ou `null` si
 * non authentifié / sans organisation. Toutes les fonctions Convex
 * publiques doivent passer par ici pour respecter la multi-tenant.
 *
 * Si l'utilisateur n'a pas encore d'organisation attachée (premier
 * compte après sign-up), on retombe sur l'organisation "LogistiX"
 * par défaut afin que la démo reste fonctionnelle immédiatement.
 */
export async function getOrgScope(
  ctx: QueryCtx | MutationCtx,
): Promise<OrgScope | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const user = await ctx.db.get("users", userId);
  if (!user) return null;
  let orgId = user.orgId;
  if (!orgId) {
    const fallback = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", DEFAULT_ORG_SLUG))
      .first();
    if (fallback) {
      orgId = fallback._id;
    }
  }
  if (!orgId) return null;
  return { userId, orgId };
}