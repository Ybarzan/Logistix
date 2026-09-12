import { getAuthUserId } from "@convex-dev/auth/server";
import { DEFAULT_ORG_SLUG } from "./organizations";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export type Role = "admin" | "manager" | "operator" | "viewer";

export type OrgScope = {
  userId: Id<"users">;
  orgId: Id<"organizations">;
  role: Role;
};

/**
 * Rang de chaque rôle pour la hiérarchie d'héritage :
 * admin > manager > operator > viewer. Un rôle supérieur hérite
 * des permissions des rôles inférieurs.
 */
const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  operator: 1,
  manager: 2,
  admin: 3,
};

/**
 * Vérifie que l'utilisateur est authentifié et possède au moins le rôle
 * `minRole`. Retourne le scope si c'est le cas, jette une erreur sinon.
 * À appeler en tête de toute mutation soumise au RBAC.
 */
export function requireRole(scope: OrgScope | null, minRole: Role): OrgScope {
  if (!scope) throw new Error("Non authentifié");
  if (ROLE_RANK[scope.role] < ROLE_RANK[minRole]) {
    throw new Error("Permissions insuffisantes");
  }
  return scope;
}

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
  // Rôle absent (compte créé avant l'ajout du champ) → "viewer" :
  // moindre privilège, lecture seule, fail-safe.
  return { userId, orgId, role: user.role ?? "viewer" };
}