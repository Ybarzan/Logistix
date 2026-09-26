import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { addHub, addRoute, newTest, orgWithUser } from "./setup";

async function setup() {
  const t = newTest();
  const a = await orgWithUser(t, "admin");
  const paris = await addHub(t, a.orgId, "PAR");
  const lyon = await addHub(t, a.orgId, "LYS");
  const create = (over: Record<string, unknown> = {}) =>
    a.as.mutation(api.shipments.create, {
      fromHubId: paris, toHubId: lyon, weight: 500, priority: "normal", customerName: "Client",
      ...over,
    });
  return { t, a, paris, lyon, create };
}

describe("création d'expédition", () => {
  it("génère des références uniques et séquentielles", async () => {
    const { t, create } = await setup();
    const ids = [await create(), await create(), await create()];
    const refs = await t.run(async (ctx) =>
      Promise.all(ids.map(async (id) => (await ctx.db.get("shipments", id))?.reference)),
    );
    const year = new Date().getUTCFullYear();
    expect(refs).toEqual([`EX-${year}-000001`, `EX-${year}-000002`, `EX-${year}-000003`]);
  });

  it("rattache l'itinéraire existant et en déduit l'ETA", async () => {
    const { t, a, paris, lyon, create } = await setup();
    const routeId = await addRoute(t, a.orgId, paris, lyon, 270);
    const before = Date.now();
    const id = await create();
    const s = await t.run((ctx) => ctx.db.get("shipments", id));
    expect(s?.routeId).toBe(routeId);
    expect(s?.estimatedDelivery).toBeGreaterThanOrEqual(before + 270 * 60_000);
  });

  it("trace un événement de création", async () => {
    const { a, create } = await setup();
    const id = await create();
    const events = await a.as.query(api.tracking.listByShipment, { shipmentId: id });
    expect(events.map((e) => e.eventType)).toEqual(["created"]);
  });

  it("refuse un poids nul ou négatif et des hubs identiques", async () => {
    const { paris, create } = await setup();
    await expect(create({ weight: 0 })).rejects.toThrow(/poids/);
    await expect(create({ toHubId: paris })).rejects.toThrow(/différents/);
  });
});

describe("cycle de vie", () => {
  it("interdit de rouvrir une expédition livrée", async () => {
    const { a, create } = await setup();
    const id = await create();
    await a.as.mutation(api.shipments.updateStatus, { shipmentId: id, status: "in_transit" });
    await a.as.mutation(api.shipments.updateStatus, { shipmentId: id, status: "delivered" });
    await expect(
      a.as.mutation(api.shipments.updateStatus, { shipmentId: id, status: "pending" }),
    ).rejects.toThrow(/Transition interdite/);
    await expect(
      a.as.mutation(api.shipments.update, { shipmentId: id, weight: 1 }),
    ).rejects.toThrow(/plus modifiable/);
  });

  it("clôture l'incident de retard automatique à la livraison", async () => {
    const { t, a, create } = await setup();
    const id = await create({ estimatedDelivery: Date.now() - 60_000 });
    await a.as.mutation(api.shipments.updateStatus, { shipmentId: id, status: "in_transit" });
    const incidentId = await t.run((ctx) =>
      ctx.db.insert("incidents", {
        orgId: a.orgId, shipmentId: id, type: "delay", severity: "low", title: "r",
        description: "r", status: "open", source: "auto", createdAt: Date.now(),
      }),
    );
    await a.as.mutation(api.shipments.updateStatus, { shipmentId: id, status: "delivered" });
    const inc = await t.run((ctx) => ctx.db.get("incidents", incidentId));
    expect(inc?.status).toBe("resolved");
  });
});

describe("tableau de bord", () => {
  it("sans livraison : ponctualité non mesurable (null) et 0 en retard", async () => {
    const { a, create } = await setup();
    await create();
    const stats = await a.as.query(api.shipments.dashboardStats, {});
    expect(stats.onTimeRate).toBeNull();
    expect(stats.late).toBe(0);
    expect(stats.onTime).toBe(0);
  });

  it("mesure la ponctualité sur les livraisons effectuées", async () => {
    const { a, create } = await setup();
    const onTime = await create({ estimatedDelivery: Date.now() + 3_600_000 });
    const late = await create({ estimatedDelivery: Date.now() - 3_600_000 });
    for (const id of [onTime, late]) {
      await a.as.mutation(api.shipments.updateStatus, { shipmentId: id, status: "in_transit" });
      await a.as.mutation(api.shipments.updateStatus, { shipmentId: id, status: "delivered" });
    }
    const stats = await a.as.query(api.shipments.dashboardStats, {});
    expect(stats.onTimeRate).toBe(50);
    expect(stats.onTime).toBe(1);
    expect(stats.late).toBe(1);
  });
});
