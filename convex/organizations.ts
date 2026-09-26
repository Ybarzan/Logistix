import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { roleSchema } from "./schema";
import { getOrgScope, requireRole } from "./orgContext";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const DEFAULT_ORG_SLUG = "logistix";

/**
 * Récupère (ou crée) l'organisation de démonstration "LogistiX".
 * Utilisée uniquement par le seed : aucun compte n'y est rattaché
 * implicitement (voir `attachUserToOrg` pour un rattachement explicite).
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
 * Rattachement explicite d'un compte existant à une organisation,
 * réservé à l'opérateur de la plateforme (CLI, clé admin) :
 *   npx convex run organizations:attachUserToOrg '{"email":"a@b.fr","slug":"logistix","role":"admin"}'
 * Sert notamment à migrer les comptes créés avant la suppression du
 * repli implicite sur l'organisation de démo.
 */
export const attachUserToOrg = internalMutation({
  args: { email: v.string(), slug: v.string(), role: roleSchema },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .first();
    if (!user) throw new Error("Utilisateur introuvable");
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!org) throw new Error("Organisation introuvable");
    await ctx.db.patch("users", user._id, { orgId: org._id, role: args.role });
    return null;
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

    return {
      _id: user._id,
      _creationTime: user._creationTime,
      name: user.name,
      email: user.email,
      role: user.role,
      ...(org ? { org } : {}),
    };
  },
});

export const rename = mutation({
  args: { name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scope = requireRole(await getOrgScope(ctx), "admin");
    const name = args.name.trim();
    if (name.length < 2 || name.length > 80) {
      throw new Error("Nom d'organisation invalide (2 à 80 caractères)");
    }
    await ctx.db.patch("organizations", scope.orgId, { name });
    return null;
  },
});

export const listMembers = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("users"),
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      role: roleSchema,
    }),
  ),
  handler: async (ctx) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return [];
    const users = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .collect();
    return users.map((u) => ({
      _id: u._id,
      role: u.role ?? "viewer",
      ...(u.name !== undefined ? { name: u.name } : {}),
      ...(u.email !== undefined ? { email: u.email } : {}),
    }));
  },
});

async function countAdmins(ctx: MutationCtx, orgId: Id<"organizations">): Promise<number> {
  const users = await ctx.db
    .query("users")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  return users.filter((u) => u.role === "admin").length;
}

/**
 * Met à jour le rôle d'un membre de l'organisation. Réservé aux admins,
 * limité aux membres de la même organisation, et refuse de retirer le
 * dernier admin (l'organisation deviendrait ingérable).
 */
export const updateUserRole = mutation({
  args: {
    userId: v.id("users"),
    role: roleSchema,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scope = requireRole(await getOrgScope(ctx), "admin");
    const target = await ctx.db.get("users", args.userId);
    if (!target || target.orgId !== scope.orgId) {
      throw new Error("Utilisateur introuvable");
    }
    if (target.role === "admin" && args.role !== "admin") {
      if ((await countAdmins(ctx, scope.orgId)) <= 1) {
        throw new Error("Impossible de retirer le dernier administrateur");
      }
    }
    await ctx.db.patch("users", args.userId, { role: args.role });
    return null;
  },
});

const invitationFields = v.object({
  _id: v.id("invitations"),
  email: v.string(),
  role: roleSchema,
  createdAt: v.number(),
});

export const listInvitations = query({
  args: {},
  returns: v.array(invitationFields),
  handler: async (ctx) => {
    const scope = await getOrgScope(ctx);
    if (!scope || scope.role !== "admin") return [];
    const rows = await ctx.db
      .query("invitations")
      .withIndex("by_org_and_status", (q) =>
        q.eq("orgId", scope.orgId).eq("status", "pending"),
      )
      .collect();
    return rows.map((r) => ({
      _id: r._id,
      email: r.email,
      role: r.role,
      createdAt: r.createdAt,
    }));
  },
});

/**
 * Invite un collaborateur. Renvoie un jeton à transmettre sous forme de
 * lien (/login?invite=…) : l'inscription avec ce jeton ET cet e-mail
 * rattache le compte à l'organisation avec ce rôle.
 */
export const invite = mutation({
  args: { email: v.string(), role: roleSchema },
  returns: v.object({ invitationId: v.id("invitations"), token: v.string() }),
  handler: async (ctx, args) => {
    const scope = requireRole(await getOrgScope(ctx), "admin");
    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Adresse e-mail invalide");
    }
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (existingUser) {
      throw new Error("Un compte existe déjà avec cet e-mail");
    }
    const pending = await ctx.db
      .query("invitations")
      .withIndex("by_email_and_status", (q) =>
        q.eq("email", email).eq("status", "pending"),
      )
      .first();
    if (pending) {
      throw new Error("Une invitation est déjà en attente pour cet e-mail");
    }
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const invitationId = await ctx.db.insert("invitations", {
      orgId: scope.orgId,
      email,
      role: args.role,
      status: "pending",
      token,
      invitedBy: scope.userId,
      createdAt: Date.now(),
    });
    return { invitationId, token };
  },
});

export const revokeInvitation = mutation({
  args: { invitationId: v.id("invitations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scope = requireRole(await getOrgScope(ctx), "admin");
    const inv = await ctx.db.get("invitations", args.invitationId);
    if (!inv || inv.orgId !== scope.orgId) throw new Error("Invitation introuvable");
    if (inv.status !== "pending") throw new Error("Invitation déjà traitée");
    await ctx.db.patch("invitations", args.invitationId, { status: "revoked" });
    return null;
  },
});
