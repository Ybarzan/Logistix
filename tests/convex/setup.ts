/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import schema from "../../convex/schema";
import type { Id } from "../../convex/_generated/dataModel";

export const modules = import.meta.glob("../../convex/**/!(*.*.*)*.*s");

export function newTest() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return t;
}

export type T = ReturnType<typeof newTest>;
export type Role = "admin" | "manager" | "operator" | "viewer";

/** Crée une organisation + un utilisateur et renvoie un client authentifié. */
export async function orgWithUser(t: T, role: Role = "admin", slug = "org-a") {
  const { orgId, userId } = await t.run(async (ctx) => {
    const newOrgId = await ctx.db.insert("organizations", { name: slug, slug });
    const newUserId = await ctx.db.insert("users", { email: `${role}@${slug}.fr`, role, orgId: newOrgId });
    return { orgId: newOrgId, userId: newUserId };
  });
  return { orgId, userId, as: t.withIdentity({ subject: `${userId}|session` }) };
}

export async function addUser(t: T, orgId: Id<"organizations">, role: Role, email: string) {
  const userId = await t.run((ctx) => ctx.db.insert("users", { email, role, orgId }));
  return { userId, as: t.withIdentity({ subject: `${userId}|session` }) };
}

export async function addHub(t: T, orgId: Id<"organizations">, code: string, over: Partial<{ capacity: number; currentLoad: number; isActive: boolean }> = {}) {
  return await t.run((ctx) =>
    ctx.db.insert("hubs", {
      orgId, name: `Hub ${code}`, code, city: code, country: "France",
      capacity: over.capacity ?? 1000, currentLoad: over.currentLoad ?? 0,
      lat: 45, lng: 4, isActive: over.isActive ?? true,
    }),
  );
}

export async function addRoute(t: T, orgId: Id<"organizations">, fromHubId: Id<"hubs">, toHubId: Id<"hubs">, avgDuration = 120) {
  return await t.run((ctx) =>
    ctx.db.insert("routes", { orgId, name: "R", fromHubId, toHubId, distance: 100, avgDuration, isActive: true }),
  );
}
