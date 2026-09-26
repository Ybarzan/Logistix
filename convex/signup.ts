import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "org"
  );
}

/**
 * Rattache un compte fraîchement créé à une organisation :
 * - jeton d'invitation valide ET e-mail identique → rejoint
 *   l'organisation invitante avec le rôle prévu ;
 * - sinon → crée sa propre organisation et en devient admin.
 * Jamais de rattachement implicite à une organisation existante.
 */
export async function attachNewUser(ctx: MutationCtx, uid: Id<"users">): Promise<void> {
  const user = await ctx.db.get("users", uid);
  if (!user || user.orgId) return;

  const email = user.email?.toLowerCase();
  const token = user.inviteToken;
  if (token !== undefined) {
    // Le jeton est à usage unique et ne reste jamais sur le compte.
    await ctx.db.patch("users", uid, { inviteToken: undefined });
    const invitation = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (invitation?.status === "pending" && invitation.email === email) {
      await ctx.db.patch("users", uid, { orgId: invitation.orgId, role: invitation.role });
      await ctx.db.patch("invitations", invitation._id, {
        status: "accepted",
        acceptedAt: Date.now(),
      });
      return;
    }
  }

  const label = user.name ?? email ?? "nouvel utilisateur";
  const orgId = await ctx.db.insert("organizations", {
    name: `Organisation de ${label}`,
    slug: `${slugify(label)}-${String(uid).slice(-6)}`,
  });
  await ctx.db.patch("users", uid, { orgId, role: "admin" });
}
