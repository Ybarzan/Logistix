import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { DEFAULT_FACTOR_KG_PER_TKM, estimateCo2Kg } from "../../convex/co2";
import { addHub, addRoute, addUser, newTest, orgWithUser } from "./setup";

async function setup(priority: "normal" | "urgent" = "urgent") {
  const t = newTest();
  const a = await orgWithUser(t, "admin");
  const lyon = await addHub(t, a.orgId, "LYS");
  const mrs = await addHub(t, a.orgId, "MRS");
  await addRoute(t, a.orgId, lyon, mrs, 200);
  const id = await a.as.mutation(api.shipments.create, {
    fromHubId: lyon, toHubId: mrs, weight: 10_000, priority, customerName: "C",
  });
  return { t, a, id, lyon, mrs };
}

async function delayIncident(t: Awaited<ReturnType<typeof setup>>["t"], orgId: Awaited<ReturnType<typeof setup>>["a"]["orgId"], shipmentId: Awaited<ReturnType<typeof setup>>["id"], severity: "low" | "high" = "high") {
  await t.run((ctx) =>
    ctx.db.insert("incidents", {
      orgId, shipmentId, type: "delay", severity, title: "Retard", description: "d",
      status: "open", source: "auto", createdAt: Date.now(),
    }),
  );
}

describe("actions recommandées", () => {
  it("retard urgent sans camion : affecter, secours FleetMarket, prévenir le client", async () => {
    const { t, a, id } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("fleetmarketIntegrations", { orgId: a.orgId, baseUrl: "http://fm", apiKey: "k", enabled: true }),
    );
    await delayIncident(t, a.orgId, id);
    const [item] = await a.as.query(api.recommendations.openActions, {});
    expect(item.actions.map((x) => x.kind)).toEqual([
      "assign_truck", "publish_fleetmarket", "share_tracking", "open_shipment",
    ]);
  });

  it("pas de secours FleetMarket proposé si l'intégration n'est pas active", async () => {
    const { t, a, id } = await setup();
    await delayIncident(t, a.orgId, id);
    const [item] = await a.as.query(api.recommendations.openActions, {});
    expect(item.actions.map((x) => x.kind)).not.toContain("publish_fleetmarket");
  });

  it("charge publiée avec propositions : choisir un transporteur", async () => {
    const { t, a, id } = await setup();
    await t.run((ctx) =>
      ctx.db.patch("shipments", id, { fleetmarket: { loadId: 1, status: "OPEN", proposalCount: 3, postedAt: 0 } }),
    );
    await delayIncident(t, a.orgId, id);
    const [item] = await a.as.query(api.recommendations.openActions, {});
    expect(item.actions[0]).toMatchObject({ kind: "review_proposals", label: expect.stringContaining("3 propositions") });
    expect(item.actions.map((x) => x.kind)).not.toContain("assign_truck");
  });

  it("classe les incidents critiques en premier", async () => {
    const { t, a, id } = await setup("normal");
    await delayIncident(t, a.orgId, id, "low");
    await t.run((ctx) =>
      ctx.db.insert("incidents", {
        orgId: a.orgId, type: "breakdown", severity: "critical", title: "Panne", description: "d",
        status: "open", createdAt: Date.now() - 1000,
      }),
    );
    const items = await a.as.query(api.recommendations.openActions, {});
    expect(items.map((i) => i.severity)).toEqual(["critical", "low"]);
  });
});

describe("lien de suivi client", () => {
  it("expose l'essentiel, arrondit la position et masque les événements internes", async () => {
    const { t, a, id } = await setup();
    await a.as.mutation(api.shipments.updateStatus, { shipmentId: id, status: "in_transit" });
    await t.run((ctx) =>
      ctx.db.patch("shipments", id, {
        truckRegistration: "AB-123", lastPosition: { lat: 45.76412, lng: 4.83571, recordedAt: 1 },
      }),
    );
    const token = await a.as.mutation(api.publicTracking.createLink, { shipmentId: id });
    const view = await t.query(api.publicTracking.get, { token });
    expect(view).toMatchObject({ status: "in_transit", fromCity: "LYS", toCity: "MRS", approxPosition: { lat: 45.76, lng: 4.84 } });
    expect(JSON.stringify(view)).not.toContain("AB-123");
    expect(view?.events.map((e) => e.eventType)).toEqual(["in_transit", "created"]);
  });

  it("un lien révoqué ou un jeton inventé ne renvoie rien", async () => {
    const { a, t, id } = await setup();
    const token = await a.as.mutation(api.publicTracking.createLink, { shipmentId: id });
    await a.as.mutation(api.publicTracking.revokeLink, { shipmentId: id });
    expect(await t.query(api.publicTracking.get, { token })).toBeNull();
    expect(await t.query(api.publicTracking.get, { token: "x".repeat(40) })).toBeNull();
  });

  it("un lecteur ne peut pas générer de lien", async () => {
    const { t, a, id } = await setup();
    const viewer = await addUser(t, a.orgId, "viewer", "v@a.fr");
    await expect(viewer.as.mutation(api.publicTracking.createLink, { shipmentId: id })).rejects.toThrow(/Permissions/);
  });
});

describe("CO2", () => {
  it("t·km × facteur", () => {
    expect(estimateCo2Kg(10_000, 100, 0.08)).toBe(80);
    expect(estimateCo2Kg(0, 100, 0.08)).toBe(0);
  });

  it("estime par expédition avec le facteur par défaut, puis celui de l'organisation", async () => {
    const { a, id } = await setup();
    expect(await a.as.query(api.co2.forShipment, { shipmentId: id })).toMatchObject({
      co2Kg: estimateCo2Kg(10_000, 100, DEFAULT_FACTOR_KG_PER_TKM), tonneKm: 1000, isDefaultFactor: true,
    });
    await a.as.mutation(api.co2.setFactor, { factorKgPerTkm: 0.05 });
    expect(await a.as.query(api.co2.forShipment, { shipmentId: id })).toMatchObject({ co2Kg: 50, isDefaultFactor: false });
    const summary = await a.as.query(api.co2.summary, {});
    expect(summary).toMatchObject({ totalKg: 50, shipmentsCounted: 1 });
  });

  it("refuse un facteur absurde", async () => {
    const { a } = await setup();
    await expect(a.as.mutation(api.co2.setFactor, { factorKgPerTkm: 50 })).rejects.toThrow(/Facteur invalide/);
  });
});
