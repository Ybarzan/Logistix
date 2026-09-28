import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { projectHubLoad } from "../../convex/hubForecastModel";
import { addHub, newTest, orgWithUser } from "./setup";

const HOUR = 3600_000;

describe("projection de charge", () => {
  it("détecte l'heure de franchissement du seuil", () => {
    const now = 0;
    const p = projectHubLoad({
      currentLoad: 800, capacity: 1000, now, horizonMs: 24 * HOUR, threshold: 0.9,
      arrivals: [{ eta: 5 * HOUR, weightKg: 50 }, { eta: 2 * HOUR, weightKg: 80 }, { eta: 30 * HOUR, weightKg: 500 }],
    });
    // 800 + 80 (2 h) = 880 ≤ 900 ; + 50 (5 h) = 930 > 900 → franchi à 5 h ; l'arrivée à 30 h est hors horizon.
    expect(p).toMatchObject({ inboundKg: 130, arrivals: 2, peakPct: 93, crossesAt: 5 * HOUR });
  });

  it("pas de franchissement si le hub reste sous le seuil, ni s'il est déjà au-dessus", () => {
    expect(projectHubLoad({ currentLoad: 100, capacity: 1000, now: 0, horizonMs: HOUR, threshold: 0.9, arrivals: [{ eta: 10, weightKg: 100 }] }).crossesAt).toBeUndefined();
    expect(projectHubLoad({ currentLoad: 950, capacity: 1000, now: 0, horizonMs: HOUR, threshold: 0.9, arrivals: [{ eta: 10, weightKg: 10 }] }).crossesAt).toBeUndefined();
  });
});

describe("saturation prévue", () => {
  async function setup() {
    const t = newTest();
    const a = await orgWithUser(t, "admin");
    const from = await addHub(t, a.orgId, "AAA");
    const hub = await addHub(t, a.orgId, "BBB", { capacity: 10_000, currentLoad: 8_500 });
    const id = await a.as.mutation(api.shipments.create, {
      fromHubId: from, toHubId: hub, weight: 1_000, priority: "normal", customerName: "C",
      estimatedDelivery: Date.now() + 3 * HOUR,
    });
    await a.as.mutation(api.shipments.updateStatus, { shipmentId: id, status: "in_transit" });
    const incidents = () =>
      t.run((ctx) => ctx.db.query("incidents").withIndex("by_org", (q) => q.eq("orgId", a.orgId)).collect());
    return { t, a, hub, id, incidents };
  }

  it("annonce la saturation avant qu'elle n'arrive, puis la confirme si elle se produit", async () => {
    const { t, a, hub, incidents } = await setup();
    expect(await t.mutation(internal.hubForecast.detectPredictedSaturationForOrg, { orgId: a.orgId, now: Date.now() })).toEqual({ opened: 1, resolved: 0 });
    expect((await incidents())[0]).toMatchObject({ type: "capacity", predicted: true, title: "Saturation prévue : Hub BBB" });
    const [f] = (await a.as.query(api.hubForecast.forecast, {})).filter((x) => x.hubId === hub);
    expect(f).toMatchObject({ inboundKg: 1000, peakPct: 95 });

    // Le détecteur classique ne doit PAS refermer une saturation prévue…
    await t.mutation(internal.automation.detectHubOverloadForOrg, { orgId: a.orgId, now: Date.now() });
    expect((await incidents())[0].status).toBe("open");
    // …et la convertit quand elle devient réelle.
    await a.as.mutation(api.hubs.update, { hubId: hub, currentLoad: 9_600 });
    await t.mutation(internal.automation.detectHubOverloadForOrg, { orgId: a.orgId, now: Date.now() });
    const [inc] = await incidents();
    expect(inc).toMatchObject({ title: "Surcharge confirmée : Hub BBB", predicted: false, status: "open" });
  });

  it("referme la saturation prévue si l'arrivée est annulée", async () => {
    const { t, a, id, incidents } = await setup();
    await t.mutation(internal.hubForecast.detectPredictedSaturationForOrg, { orgId: a.orgId, now: Date.now() });
    await a.as.mutation(api.shipments.updateStatus, { shipmentId: id, status: "cancelled" });
    expect(await t.mutation(internal.hubForecast.detectPredictedSaturationForOrg, { orgId: a.orgId, now: Date.now() })).toEqual({ opened: 0, resolved: 1 });
    expect((await incidents())[0].description).toMatch(/écartée/);
  });
});
