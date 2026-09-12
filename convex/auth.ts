import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";

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

        // L'organisation est rattachée paresseusement : le scope de
        // l'utilisateur retombe sur l'organisation "LogistiX" par défaut
        // tant qu'aucune org n'est explicitement attachée (voir orgContext).
        return {
          name,
          email,
          role: "admin" as const,
        };
      },
    }),
  ],
});