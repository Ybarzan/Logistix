import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { haversineKm, predictEta, regulatoryStopsMs } from "../../convex/etaModel";
import { newTest, orgWithUser } from "./setup";
import type { Id } from "../../convex/_generated/dataModel";
import type { T } from "./setup";

const MIN = 60_000;
const HOUR = 60 * MIN;
const LYON = { lat: 45.764, lng: 4.8357 };
const MARSEILLE = { lat: 43.2965, lng: 5.3698 };

describe("modèle ETA", () => {
  it("haversine Lyon–Marseille ≈ 277 km", () => {
    expect(Math.round(haversineKm(LYON, MARSEILLE))).toBeGreaterThan(270);
    expect(Math.round(haversineKm(LYON, MARSEILLE))).toBeLessThan(285);
  });

  it("GPS frais : distance restante ÷ vitesse observée, avec explication", () => {
    const now = Date.UTC(2026, 8, 28, 8, 0);
    const p = predictEta({
      now,
      destination: MARSEILLE,
      position: { ...LYON, recordedAt: now - 2 * MIN, speedKph: 80 },
      recentSpeedsKph: [78, 82, 80],
    });
    expect(p?.method).toBe("gps");
    // ~346 km route à 80 km/h ≈ 4 h 20
    expect(((p?.eta ?? 0) - now) / HOUR).toBeGreaterThan(4);
    expect(((p?.eta ?? 0) - now) / HOUR).toBeLessThan(4.6);
    expect(p?.explanation).toMatch(/km restants à 80 km\/h \(vitesse observée\)/);
    expect((p?.low ?? 0) < (p?.eta ?? 0) && (p?.eta ?? 0) < (p?.high ?? 0)).toBe(true);
  });

  it("ajoute la pause réglementaire au-delà de 4 h 30 de conduite", () => {
    const now = 0;
    const p = predictEta({
      now,
      destination: { lat: 48.8566, lng: 2.3522 }, // Paris
      position: { ...MARSEILLE, recordedAt: now, speedKph: 80 },
    });
    expect(p?.explanation).toMatch(/1 pause\(s\) réglementaire\(s\)/);
  });

  it("temps réglementaires : 1 pause au-delà de 4 h 30, repos de 11 h au-delà de 9 h", () => {
    expect(regulatoryStopsMs(4 * HOUR)).toEqual({ stopsMs: 0, breaks: 0, rests: 0 });
    expect(regulatoryStopsMs(6 * HOUR)).toMatchObject({ breaks: 1, rests: 0 });
    expect(regulatoryStopsMs(9 * HOUR)).toMatchObject({ breaks: 1, rests: 0 });
    expect(regulatoryStopsMs(12 * HOUR)).toMatchObject({ breaks: 1, rests: 1, stopsMs: 45 * MIN + 11 * HOUR });
  });

  it("GPS périmé : bascule sur l'historique de l'itinéraire", () => {
    const now = 10 * HOUR;
    const p = predictEta({
      now,
      destination: MARSEILLE,
      position: { ...LYON, recordedAt: now - 3 * HOUR },
      route: { distanceKm: 315, avgDurationMin: 200 },
      history: { ratio: 1.3, samples: 5 },
      departedAt: now - HOUR,
    });
    expect(p?.method).toBe("route_history");
    expect(p?.eta).toBe(now - HOUR + 200 * MIN * 1.3);
    expect(p?.explanation).toMatch(/médiane des 5 dernières livraisons/);
  });

  it("historique insuffisant (< 3 livraisons) : durée prévue seule", () => {
    const p = predictEta({ now: 0, destination: MARSEILLE, route: { distanceKm: 315, avgDurationMin: 200 }, history: { ratio: 2, samples: 2 } });
    expect(p?.method).toBe("route_plan");
  });

  it("vitesse aberrante bornée (bouchon à 5 km/h ignoré, pas de 200 km/h)", () => {
    const p = predictEta({ now: 0, destination: MARSEILLE, position: { ...LYON, recordedAt: 0, speedKph: 200 } });
    expect(p?.explanation).toMatch(/à 90 km\/h/);
  });
});

async function inTransit(t: T, committedInMin: number) {
  const a = await orgWithUser(t, "admin");
  const [lyon, mrs] = await t.run(async (ctx) => [
    await ctx.db.insert("hubs", { orgId: a.orgId, name: "Lyon", code: "LYS", city: "Lyon", country: "France", capacity: 100, currentLoad: 0, ...LYON, isActive: true }),
    await ctx.db.insert("hubs", { orgId: a.orgId, name: "Marseille", code: "MRS", city: "Marseille", country: "France", capacity: 100, currentLoad: 0, ...MARSEILLE, isActive: true }),
  ]);
  const id = await a.as.mutation(api.shipments.create, {
    fromHubId: lyon, toHubId: mrs, weight: 1000, priority: "normal", customerName: "C",
    estimatedDelivery: Date.now() + committedInMin * MIN,
  });
  await t.run((ctx) => ctx.db.patch("shipments", id, { status: "in_transit", truckRegistration: "AB-1" }));
  return { a, id };
}

async function gps(t: T, orgId: Id<"organizations">, shipmentId: Id<"shipments">, pos: { lat: number; lng: number }) {
  await t.mutation(internal.fleethub.applySyncResult, {
    orgId, now: Date.now(),
    positions: [{ shipmentId, ...pos, speedKph: 80, recordedAt: Date.now() }],
  });
}

describe("retard prévu (incident prédictif)", () => {
  const incidents = (t: T, orgId: Id<"organizations">) =>
    t.run((ctx) => ctx.db.query("incidents").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect());

  it("ouvre « Retard prévu » avant l'échéance quand le camion ne peut plus arriver à temps", async () => {
    const t = newTest();
    // Engagement dans 1 h, camion encore à Lyon (~4 h 20 de route) : retard certain.
    const { a, id } = await inTransit(t, 60);
    await t.run((ctx) => ctx.db.insert("fleethubIntegrations", { orgId: a.orgId, baseUrl: "http://x", apiKey: "k", enabled: true }));
    await gps(t, a.orgId, id, LYON);
    const s = await t.run((ctx) => ctx.db.get("shipments", id));
    expect(s?.prediction?.method).toBe("gps");
    const list = await incidents(t, a.orgId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: "Retard prévu", predicted: true, type: "delay", source: "auto" });
    expect(list[0].description).toMatch(/arrivée prédite/);
  });

  it("referme l'incident prédit si le camion rattrape son retard", async () => {
    const t = newTest();
    const { a, id } = await inTransit(t, 60);
    await t.run((ctx) => ctx.db.insert("fleethubIntegrations", { orgId: a.orgId, baseUrl: "http://x", apiKey: "k", enabled: true }));
    await gps(t, a.orgId, id, LYON);
    // Nouvelle position : à 20 km de Marseille → arrivée bien avant l'engagement.
    await gps(t, a.orgId, id, { lat: 43.45, lng: 5.35 });
    const list = await incidents(t, a.orgId);
    expect(list[0]).toMatchObject({ status: "resolved" });
    expect(list[0].description).toMatch(/rattrapé/);
  });

  it("n'ouvre rien si l'arrivée prédite tient l'engagement", async () => {
    const t = newTest();
    const { a, id } = await inTransit(t, 8 * 60);
    await t.run((ctx) => ctx.db.insert("fleethubIntegrations", { orgId: a.orgId, baseUrl: "http://x", apiKey: "k", enabled: true }));
    await gps(t, a.orgId, id, LYON);
    expect(await incidents(t, a.orgId)).toHaveLength(0);
  });

  it("une fois l'échéance passée, le retard prévu devient « Retard confirmé » (pas de doublon)", async () => {
    const t = newTest();
    const { a, id } = await inTransit(t, 60);
    await t.run((ctx) => ctx.db.insert("fleethubIntegrations", { orgId: a.orgId, baseUrl: "http://x", apiKey: "k", enabled: true }));
    await gps(t, a.orgId, id, LYON);
    await t.mutation(internal.automation.detectDelaysForOrg, { orgId: a.orgId, now: Date.now() + 2 * HOUR });
    const list = await incidents(t, a.orgId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: "Retard confirmé", predicted: false, status: "open" });
  });
});

describe("historique d'itinéraire", () => {
  it("mesure la durée de roulage (départ → livraison), pas l'attente à quai", async () => {
    vi.useFakeTimers();
    // Horloge fixée AVANT toute écriture : _creationTime est monotone.
    let clock = Date.UTC(2026, 8, 20, 6, 0);
    vi.setSystemTime(clock);
    const t = newTest();
    const a = await orgWithUser(t, "admin");
    const [lyon, mrs] = await t.run(async (ctx) => [
      await ctx.db.insert("hubs", { orgId: a.orgId, name: "Lyon", code: "LYS", city: "Lyon", country: "France", capacity: 100, currentLoad: 0, ...LYON, isActive: true }),
      await ctx.db.insert("hubs", { orgId: a.orgId, name: "Marseille", code: "MRS", city: "Marseille", country: "France", capacity: 100, currentLoad: 0, ...MARSEILLE, isActive: true }),
    ]);
    await t.run((ctx) => ctx.db.insert("routes", { orgId: a.orgId, name: "L→M", fromHubId: lyon, toHubId: mrs, distance: 315, avgDuration: 200, isActive: true }));
    for (let i = 0; i < 3; i++) {
      vi.setSystemTime(clock);
      const id = await a.as.mutation(api.shipments.create, { fromHubId: lyon, toHubId: mrs, weight: 1, priority: "normal", customerName: `C${i}` });
      clock += 20 * HOUR; // 20 h d'attente à quai : ne doit PAS compter
      vi.setSystemTime(clock);
      await a.as.mutation(api.shipments.updateStatus, { shipmentId: id, status: "in_transit" });
      clock += 240 * MIN; // 4 h de route pour 3 h 20 prévues → ratio 1,2
      vi.setSystemTime(clock);
      await a.as.mutation(api.shipments.updateStatus, { shipmentId: id, status: "delivered" });
      clock += HOUR;
    }
    vi.setSystemTime(clock);
    const id = await a.as.mutation(api.shipments.create, { fromHubId: lyon, toHubId: mrs, weight: 1, priority: "normal", customerName: "X" });
    await a.as.mutation(api.shipments.updateStatus, { shipmentId: id, status: "in_transit" });
    await t.mutation(internal.eta.predictForOrg, { orgId: a.orgId, now: clock });
    const s = await t.run((ctx) => ctx.db.get("shipments", id));
    expect(s?.prediction?.method).toBe("route_history");
    expect(s?.prediction?.explanation).toMatch(/× 1\.20 \(médiane des 3 dernières livraisons/);
    vi.useRealTimers();
  });
});
