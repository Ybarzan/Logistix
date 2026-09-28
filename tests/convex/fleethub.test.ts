import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { parseFleethubTime } from "../../convex/fleethub";
import { addHub, addUser, newTest, orgWithUser } from "./setup";

const SECRET = "mk_test_secret_value_1234";

function stubFleethub(opts: { status?: number; lat?: number; gpsAt?: string } = {}) {
  const calls: Array<{ url: string; key: string | null }> = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    calls.push({ url, key: headers.get("X-Marketplace-Key") });
    if (opts.status && opts.status !== 200) {
      return Promise.resolve(new Response("", { status: opts.status }));
    }
    if (url.includes("/availability")) {
      return Promise.resolve(Response.json({
        companyName: "Transports Test",
        complianceScore: 94,
        trucksAvailable: [{ truckId: 1, registration: "AB-123-CD", capacityTons: 19 }],
      }));
    }
    return Promise.resolve(Response.json({
      registration: "GPS-01",
      available: true,
      latitude: opts.lat ?? 45.764,
      longitude: 4.8357,
      speedKph: 72,
      lastGpsUpdate: opts.gpsAt ?? "2026-09-26T10:00:00",
    }));
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function trackedShipment() {
  const t = newTest();
  const a = await orgWithUser(t, "admin");
  const h1 = await addHub(t, a.orgId, "LYS");
  const h2 = await addHub(t, a.orgId, "MRS");
  const id = await a.as.mutation(api.shipments.create, {
    fromHubId: h1, toHubId: h2, weight: 1000, priority: "normal", customerName: "C",
  });
  await a.as.mutation(api.shipments.updateStatus, { shipmentId: id, status: "in_transit" });
  await t.run(async (ctx) => {
    await ctx.db.insert("fleethubIntegrations", {
      orgId: a.orgId, baseUrl: "http://fleethub.test", apiKey: SECRET, enabled: true,
    });
    await ctx.db.patch("shipments", id, { truckRegistration: "GPS-01" });
  });
  return { t, a, id };
}

describe("synchronisation fleet-hub", () => {
  it("récupère société, camions dispo et position GPS de l'expédition suivie", async () => {
    const calls = stubFleethub();
    const { t, a, id } = await trackedShipment();
    await t.action(internal.fleethub.syncOrg, { orgId: a.orgId });

    expect(calls.every((c) => c.key === SECRET)).toBe(true);
    expect(calls.map((c) => c.url)).toEqual([
      "http://fleethub.test/api/marketplace/availability",
      "http://fleethub.test/api/marketplace/vehicle-position?registration=GPS-01",
    ]);

    const s = await t.run((ctx) => ctx.db.get("shipments", id));
    expect(s?.lastPosition).toMatchObject({ lat: 45.764, lng: 4.8357, speedKph: 72 });
    expect(s?.lastPosition?.recordedAt).toBe(Date.parse("2026-09-26T10:00:00Z"));

    const cfg = await a.as.query(api.fleethub.getConfig, {});
    expect(cfg).toMatchObject({ companyName: "Transports Test", complianceScore: 94, vehicleCount: 1 });
    expect(cfg?.lastError).toBeUndefined();

    const events = await a.as.query(api.tracking.listByShipment, { shipmentId: id });
    expect(events.some((e) => e.source === "gps")).toBe(true);
    expect(await a.as.query(api.fleethub.positionTrail, { shipmentId: id })).toHaveLength(1);
  });

  it("n'enregistre pas de nouvelle trace si le camion n'a pas bougé", async () => {
    stubFleethub();
    const { t, a, id } = await trackedShipment();
    await t.action(internal.fleethub.syncOrg, { orgId: a.orgId });
    stubFleethub({ gpsAt: "2026-09-26T10:02:00" });
    await t.action(internal.fleethub.syncOrg, { orgId: a.orgId });
    expect(await a.as.query(api.fleethub.positionTrail, { shipmentId: id })).toHaveLength(1);
  });

  it("ignore une mesure plus ancienne que la position connue", async () => {
    stubFleethub({ gpsAt: "2026-09-26T10:00:00" });
    const { t, a, id } = await trackedShipment();
    await t.action(internal.fleethub.syncOrg, { orgId: a.orgId });
    stubFleethub({ gpsAt: "2026-09-26T09:00:00", lat: 43.3 });
    await t.action(internal.fleethub.syncOrg, { orgId: a.orgId });
    const s = await t.run((ctx) => ctx.db.get("shipments", id));
    expect(s?.lastPosition?.lat).toBe(45.764);
  });

  it("clé refusée : erreur lisible enregistrée, jamais d'exception", async () => {
    stubFleethub({ status: 401 });
    const { t, a } = await trackedShipment();
    await t.action(internal.fleethub.syncOrg, { orgId: a.orgId });
    const cfg = await a.as.query(api.fleethub.getConfig, {});
    expect(cfg?.lastError).toMatch(/Clé fleet-hub refusée/);
  });
});

describe("sécurité de l'intégration", () => {
  it("la clé n'est jamais renvoyée au navigateur", async () => {
    stubFleethub();
    const { a } = await trackedShipment();
    const cfg = await a.as.query(api.fleethub.getConfig, {});
    expect(JSON.stringify(cfg)).not.toContain(SECRET);
    expect(cfg?.keyHint).toBe("••••1234");
  });

  it("seul un admin configure l'intégration", async () => {
    const { t, a } = await trackedShipment();
    const op = await addUser(t, a.orgId, "operator", "op@a.fr");
    await expect(
      op.as.mutation(api.fleethub.saveConfig, { baseUrl: "http://evil.test", apiKey: "x", enabled: true }),
    ).rejects.toThrow(/Permissions insuffisantes/);
  });

  it("une autre organisation ne voit ni la trace ni la carte", async () => {
    stubFleethub();
    const { t, a, id } = await trackedShipment();
    await t.action(internal.fleethub.syncOrg, { orgId: a.orgId });
    const b = await orgWithUser(t, "admin", "org-b");
    expect(await b.as.query(api.fleethub.positionTrail, { shipmentId: id })).toEqual([]);
    expect((await b.as.query(api.fleethub.networkMap, {})).trucks).toEqual([]);
    expect(await b.as.query(api.fleethub.getConfig, {})).toBeNull();
  });

  it("refuse une URL non http(s)", async () => {
    const t = newTest();
    const a = await orgWithUser(t, "admin");
    await expect(
      a.as.mutation(api.fleethub.saveConfig, { baseUrl: "file:///etc/passwd", apiKey: "x", enabled: false }),
    ).rejects.toThrow(/URL http\(s\) requise/);
  });
});

describe("parseFleethubTime", () => {
  it("interprète un LocalDateTime sans fuseau comme UTC", () => {
    expect(parseFleethubTime("2026-09-23T12:45:09.761749")).toBe(Date.parse("2026-09-23T12:45:09.761Z"));
    expect(parseFleethubTime(null)).toBeNull();
  });
});
