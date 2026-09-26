import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

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
 * Aucun repli sur une organisation par défaut : un compte sans `orgId`
 * n'a accès à rien (fail-closed). L'organisation est attachée à
 * l'inscription (voir `auth.ts` → `afterUserCreatedOrUpdated`).
 */
export async function getOrgScope(
  ctx: QueryCtx | MutationCtx,
): Promise<OrgScope | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const user = await ctx.db.get("users", userId);
  if (!user?.orgId) return null;
  // Rôle absent → "viewer" : moindre privilège, lecture seule, fail-safe.
  return { userId, orgId: user.orgId, role: user.role ?? "viewer" };
}

type OwnedTable = "hubs" | "routes" | "shipments" | "incidents";

/**
 * Charge un document et vérifie qu'il appartient à l'organisation du
 * scope. Empêche de référencer (ou modifier) un document d'un autre
 * tenant en passant simplement son identifiant.
 */
export async function requireOwned<T extends OwnedTable>(
  ctx: QueryCtx | MutationCtx,
  table: T,
  id: Id<T>,
  orgId: Id<"organizations">,
): Promise<Doc<T>> {
  const doc = (await ctx.db.get(table, id)) as Doc<T> | null;
  if (!doc || doc.orgId !== orgId) {
    throw new Error(`Ressource introuvable (${table})`);
  }
  return doc;
}
