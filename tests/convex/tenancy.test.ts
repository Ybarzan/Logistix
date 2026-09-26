import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { attachNewUser } from "../../convex/signup";
import { addHub, addUser, newTest, orgWithUser } from "./setup";

describe("inscription et rattachement à une organisation", () => {
  it("un nouvel inscrit obtient sa propre organisation (jamais celle de démo)", async () => {
    const t = newTest();
    const demo = await orgWithUser(t, "admin", "logistix");
    const userId = await t.run((ctx) => ctx.db.insert("users", { email: "new@x.fr", name: "Nouveau" }));
    await t.run((ctx) => attachNewUser(ctx, userId));
    const user = await t.run((ctx) => ctx.db.get("users", userId));
    expect(user?.role).toBe("admin");
    expect(user?.orgId).toBeDefined();
    expect(user?.orgId).not.toBe(demo.orgId);
  });

  it("un jeton d'invitation valide + même e-mail rejoint l'organisation avec le rôle prévu", async () => {
    const t = newTest();
    const a = await orgWithUser(t, "admin");
    const { token } = await a.as.mutation(api.organizations.invite, { email: "Op@A.fr", role: "operator" });
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "op@a.fr", inviteToken: token }),
    );
    await t.run((ctx) => attachNewUser(ctx, userId));
    const user = await t.run((ctx) => ctx.db.get("users", userId));
    expect(user?.orgId).toBe(a.orgId);
    expect(user?.role).toBe("operator");
    expect(user?.inviteToken).toBeUndefined();
  });

  it("un jeton volé utilisé avec un autre e-mail ne donne pas accès à l'organisation", async () => {
    const t = newTest();
    const a = await orgWithUser(t, "admin");
    const { token } = await a.as.mutation(api.organizations.invite, { email: "op@a.fr", role: "admin" });
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "attaquant@evil.fr", inviteToken: token }),
    );
    await t.run((ctx) => attachNewUser(ctx, userId));
    const user = await t.run((ctx) => ctx.db.get("users", userId));
    expect(user?.orgId).not.toBe(a.orgId);
  });

  it("l'e-mail invité sans le jeton ne suffit pas", async () => {
    const t = newTest();
    const a = await orgWithUser(t, "admin");
    await a.as.mutation(api.organizations.invite, { email: "op@a.fr", role: "admin" });
    const userId = await t.run((ctx) => ctx.db.insert("users", { email: "op@a.fr" }));
    await t.run((ctx) => attachNewUser(ctx, userId));
    const user = await t.run((ctx) => ctx.db.get("users", userId));
    expect(user?.orgId).not.toBe(a.orgId);
  });

  it("un compte sans organisation ne voit aucune donnée", async () => {
    const t = newTest();
    const a = await orgWithUser(t, "admin");
    const hub = await addHub(t, a.orgId, "AAA");
    const hub2 = await addHub(t, a.orgId, "BBB");
    await a.as.mutation(api.shipments.create, {
      fromHubId: hub, toHubId: hub2, weight: 10, priority: "normal", customerName: "C",
    });
    const orphanId = await t.run((ctx) => ctx.db.insert("users", { email: "o@o.fr", role: "admin" }));
    const orphan = t.withIdentity({ subject: `${orphanId}|s` });
    expect(await orphan.query(api.shipments.list, {})).toEqual([]);
    expect(await orphan.query(api.hubs.list, {})).toEqual([]);
  });
});

describe("isolation entre organisations", () => {
  it("impossible de créer une expédition avec les hubs d'une autre organisation", async () => {
    const t = newTest();
    const a = await orgWithUser(t, "admin", "org-a");
    const b = await orgWithUser(t, "admin", "org-b");
    const bHub1 = await addHub(t, b.orgId, "B1");
    const bHub2 = await addHub(t, b.orgId, "B2");
    await expect(
      a.as.mutation(api.shipments.create, {
        fromHubId: bHub1, toHubId: bHub2, weight: 10, priority: "normal", customerName: "X",
      }),
    ).rejects.toThrow(/introuvable/);
  });

  it("impossible de changer le statut d'une expédition d'une autre organisation", async () => {
    const t = newTest();
    const a = await orgWithUser(t, "admin", "org-a");
    const b = await orgWithUser(t, "admin", "org-b");
    const h1 = await addHub(t, b.orgId, "B1");
    const h2 = await addHub(t, b.orgId, "B2");
    const id = await b.as.mutation(api.shipments.create, {
      fromHubId: h1, toHubId: h2, weight: 10, priority: "normal", customerName: "X",
    });
    await expect(
      a.as.mutation(api.shipments.updateStatus, { shipmentId: id, status: "cancelled" }),
    ).rejects.toThrow(/introuvable/);
  });

  it("impossible de rattacher un incident à un hub d'une autre organisation", async () => {
    const t = newTest();
    const a = await orgWithUser(t, "admin", "org-a");
    const b = await orgWithUser(t, "admin", "org-b");
    const bHub = await addHub(t, b.orgId, "B1");
    await expect(
      a.as.mutation(api.incidents.create, {
        hubId: bHub, type: "other", severity: "low", title: "x", description: "y",
      }),
    ).rejects.toThrow(/introuvable/);
  });

  it("un admin ne peut pas changer le rôle d'un utilisateur d'une autre organisation", async () => {
    const t = newTest();
    const a = await orgWithUser(t, "admin", "org-a");
    const b = await orgWithUser(t, "viewer", "org-b");
    await expect(
      a.as.mutation(api.organizations.updateUserRole, { userId: b.userId, role: "admin" }),
    ).rejects.toThrow(/introuvable/);
    const user = await t.run((ctx) => ctx.db.get("users", b.userId));
    expect(user?.role).toBe("viewer");
  });
});

describe("gestion des rôles", () => {
  it("refuse de rétrograder le dernier admin", async () => {
    const t = newTest();
    const a = await orgWithUser(t, "admin");
    await expect(
      a.as.mutation(api.organizations.updateUserRole, { userId: a.userId, role: "viewer" }),
    ).rejects.toThrow(/dernier administrateur/);
  });

  it("un viewer ne peut rien créer", async () => {
    const t = newTest();
    const a = await orgWithUser(t, "admin");
    const viewer = await addUser(t, a.orgId, "viewer", "v@a.fr");
    const h1 = await addHub(t, a.orgId, "A1");
    const h2 = await addHub(t, a.orgId, "A2");
    await expect(
      viewer.as.mutation(api.shipments.create, {
        fromHubId: h1, toHubId: h2, weight: 1, priority: "low", customerName: "C",
      }),
    ).rejects.toThrow(/Permissions insuffisantes/);
  });

  it("seul un admin peut inviter", async () => {
    const t = newTest();
    const a = await orgWithUser(t, "admin");
    const manager = await addUser(t, a.orgId, "manager", "m@a.fr");
    await expect(
      manager.as.mutation(api.organizations.invite, { email: "x@a.fr", role: "admin" }),
    ).rejects.toThrow(/Permissions insuffisantes/);
  });
});
