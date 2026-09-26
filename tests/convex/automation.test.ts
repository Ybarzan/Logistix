import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { addHub, newTest, orgWithUser } from "./setup";

const HOUR = 3_600_000;

async function lateShipment() {
  const t = newTest();
  const a = await orgWithUser(t, "admin");
  const h1 = await addHub(t, a.orgId, "A1");
  const h2 = await addHub(t, a.orgId, "A2");
  const id = await a.as.mutation(api.shipments.create, {
    fromHubId: h1, toHubId: h2, weight: 1, priority: "normal", customerName: "C",
    estimatedDelivery: Date.now() - HOUR,
  });
  await a.as.mutation(api.shipments.updateStatus, { shipmentId: id, status: "in_transit" });
  const incidents = () =>
    t.run((ctx) =>
      ctx.db.query("incidents").withIndex("by_org", (q) => q.eq("orgId", a.orgId)).collect(),
    );
  return { t, a, id, incidents };
}

describe("détection des retards", () => {
  it("crée un incident, passe l'expédition en retard, sans doublon", async () => {
    const { t, a, id, incidents } = await lateShipment();
    const now = Date.now();
    await t.mutation(internal.automation.detectDelaysForOrg, { orgId: a.orgId, now });
    await t.mutation(internal.automation.detectDelaysForOrg, { orgId: a.orgId, now });
    const list = await incidents();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: "delay", severity: "low", source: "auto", shipmentId: id });
    const s = await t.run((ctx) => ctx.db.get("shipments", id));
    expect(s?.status).toBe("delayed");
  });

  it("escalade la sévérité quand le retard s'aggrave", async () => {
    const { t, a, incidents } = await lateShipment();
    await t.mutation(internal.automation.detectDelaysForOrg, { orgId: a.orgId, now: Date.now() });
    await t.mutation(internal.automation.detectDelaysForOrg, {
      orgId: a.orgId, now: Date.now() + 30 * HOUR,
    });
    const list = await incidents();
    expect(list).toHaveLength(1);
    expect(list[0].severity).toBe("high");
  });

  it("n'escalade pas un incident saisi par un humain", async () => {
    const { t, a, id, incidents } = await lateShipment();
    await a.as.mutation(api.incidents.create, {
      shipmentId: id, type: "delay", severity: "low", title: "Signalé", description: "tel.",
    });
    await t.mutation(internal.automation.detectDelaysForOrg, {
      orgId: a.orgId, now: Date.now() + 60 * HOUR,
    });
    const list = await incidents();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ source: "manual", severity: "low" });
  });
});

describe("surcharge des hubs", () => {
  it("ouvre un incident au-delà de 90 % puis le clôture quand la charge baisse", async () => {
    const t = newTest();
    const a = await orgWithUser(t, "admin");
    const hub = await addHub(t, a.orgId, "H", { capacity: 100, currentLoad: 95 });
    const run = () =>
      t.mutation(internal.automation.detectHubOverloadForOrg, { orgId: a.orgId, now: Date.now() });

    expect(await run()).toEqual({ created: 1, resolved: 0 });
    expect(await run()).toEqual({ created: 0, resolved: 0 });

    await a.as.mutation(api.hubs.update, { hubId: hub, currentLoad: 50 });
    expect(await run()).toEqual({ created: 0, resolved: 1 });
  });
});
