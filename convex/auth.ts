import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { attachNewUser } from "./signup";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile: (params) => {
        const email =
          typeof params.email === "string" ? params.email.trim().toLowerCase() : "";
        if (!email) {
          throw new Error("Adresse e-mail requise.");
        }
        const name =
          (typeof params.name === "string" && params.name.trim()) ||
          email.split("@")[0];
        // Pas de rôle ici : le rôle et l'organisation sont décidés
        // côté serveur dans `afterUserCreatedOrUpdated`, jamais à partir
        // de paramètres fournis par le client.
        const profile: { name: string; email: string; inviteToken?: string } = { name, email };
        if (typeof params.inviteToken === "string" && params.inviteToken) {
          profile.inviteToken = params.inviteToken;
        }
        return profile as { name: string; email: string };
      },
    }),
  ],
  callbacks: {
    /**
     * Appelé uniquement à la création d'un compte (credentials).
     * - Jeton d'invitation valide ET e-mail identique → rejoint
     *   l'organisation invitante avec le rôle prévu.
     * - Sinon → crée sa propre organisation et en devient admin.
     * Jamais de rattachement implicite à une organisation existante.
     */
    async afterUserCreatedOrUpdated(genericCtx, { userId, existingUserId }) {
      if (existingUserId !== null) return;
      await attachNewUser(genericCtx as unknown as MutationCtx, userId as Id<"users">);
    },
  },
});
