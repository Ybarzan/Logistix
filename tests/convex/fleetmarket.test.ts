import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { addHub, addUser, newTest, orgWithUser } from "./setup";

const KEY = "fm_test_key_abcd";

type FakeState = {
  loadStatus: string;
  proposals: Array<Record<string, unknown>>;
  accepted: Array<number>;
  posted: Array<Record<string, unknown>>;
};

function stubFleetMarket(state: FakeState) {
  vi.stubGlobal("fetch", (url: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if (headers.get("X-Api-Key") !== KEY) return Promise.resolve(new Response("", { status: 401 }));
    const path = url.replace("http://fm.test/api", "");
    const method = init?.method ?? "GET";
    if (method === "POST" && path === "/loads") {
      state.posted.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Promise.resolve(Response.json({ id: 42, status: "OPEN" }));
    }
    if (path === "/loads/mine") {
      return Promise.resolve(Response.json([{ id: 42, status: state.loadStatus, proposalCount: state.proposals.length }]));
    }
    if (path === "/proposals/for-load/42") return Promise.resolve(Response.json(state.proposals));
    const accept = path.match(/^\/proposals\/(\d+)\/accept$/);
    if (method === "POST" && accept) {
      const id = Number(accept[1]);
      state.accepted.push(id);
      state.loadStatus = "MATCHED";
      state.proposals = state.proposals.map((p) => ({ ...p, status: p.id === id ? "ACCEPTED" : "DECLINED" }));
      return Promise.resolve(Response.json({}));
    }
    if (path === "/proposals/7/vehicle-position") {
      return Promise.resolve(Response.json({
        available: true, latitude: 43.3, longitude: 5.37, speedKph: 80, lastGpsUpdate: "2026-09-26T11:00:00",
      }));
    }
    return Promise.resolve(new Response("", { status: 404 }));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup() {
  const t = newTest();
  const a = await orgWithUser(t, "admin");
  const lyon = await addHub(t, a.orgId, "LYS");
  const mrs = await addHub(t, a.orgId, "MRS");
  const id = await a.as.mutation(api.shipments.create, {
    fromHubId: lyon, toHubId: mrs, weight: 8000, priority: "urgent", customerName: "C",
  });
  await t.run((ctx) =>
    ctx.db.insert("fleetmarketIntegrations", { orgId: a.orgId, baseUrl: "http://fm.test", apiKey: KEY, enabled: true }),
  );
  const state: FakeState = { loadStatus: "OPEN", proposals: [], accepted: [], posted: [] };
  stubFleetMarket(state);
  return { t, a, id, state };
}

describe("pont FleetMarket", () => {
  it("publie l'expédition comme charge avec villes, poids et référence", async () => {
    const { t, a, id, state } = await setup();
    await t.action(internal.fleetmarket.publishLoad, { orgId: a.orgId, shipmentId: id });
    expect(state.posted).toHaveLength(1);
    expect(state.posted[0]).toMatchObject({ origin: "LYS", destination: "MRS", weightKg: 8000 });
    expect(String(state.posted[0].goodsType)).toMatch(/EX-\d{4}-000001/);
    const s = await t.run((ctx) => ctx.db.get("shipments", id));
    expect(s?.fleetmarket).toMatchObject({ loadId: 42, status: "OPEN" });
  });

  it("de la proposition au GPS du transporteur tiers, piloté depuis LogistiX", async () => {
    const { t, a, id, state } = await setup();
    await t.action(internal.fleetmarket.publishLoad, { orgId: a.orgId, shipmentId: id });
    state.proposals = [
      { id: 7, carrierCompanyName: "Transports Sud", carrierComplianceScore: 96, truckRegistration: "GH-456-IJ", status: "PROPOSED" },
      { id: 8, carrierCompanyName: "Autre", carrierComplianceScore: 70, status: "PROPOSED" },
    ];
    await t.action(internal.fleetmarket.syncOrg, { orgId: a.orgId });
    expect((await t.run((ctx) => ctx.db.get("shipments", id)))?.fleetmarket?.proposalCount).toBe(2);

    const listed = await a.as.action(api.fleetmarket.proposals, { shipmentId: id });
    expect(listed.proposals.map((p) => p.id)).toEqual([7, 8]);

    await a.as.action(api.fleetmarket.acceptProposal, { shipmentId: id, proposalId: 7 });
    expect(state.accepted).toEqual([7]);

    const s = await t.run((ctx) => ctx.db.get("shipments", id));
    expect(s?.fleetmarket).toMatchObject({ status: "MATCHED", acceptedProposalId: 7, carrierName: "Transports Sud", carrierComplianceScore: 96 });
    expect(s?.truckRegistration).toBe("GH-456-IJ");
    expect(s?.lastPosition).toMatchObject({ lat: 43.3, lng: 5.37, speedKph: 80 });

    const events = await a.as.query(api.tracking.listByShipment, { shipmentId: id });
    expect(events.some((e) => e.description.includes("Transports Sud retenu"))).toBe(true);
  });

  it("refuse d'accepter une proposition qui n'appartient pas à cette charge", async () => {
    const { t, a, id, state } = await setup();
    await t.action(internal.fleetmarket.publishLoad, { orgId: a.orgId, shipmentId: id });
    state.proposals = [{ id: 7, carrierCompanyName: "X", status: "PROPOSED" }];
    await expect(
      a.as.action(api.fleetmarket.acceptProposal, { shipmentId: id, proposalId: 999 }),
    ).rejects.toThrow(/introuvable pour cette charge/);
    expect(state.accepted).toEqual([]);
  });

  it("un lecteur ne peut ni publier ni accepter", async () => {
    const { t, a, id } = await setup();
    await t.action(internal.fleetmarket.publishLoad, { orgId: a.orgId, shipmentId: id });
    const viewer = await addUser(t, a.orgId, "viewer", "v@a.fr");
    await expect(viewer.as.mutation(api.fleetmarket.publish, { shipmentId: id })).rejects.toThrow(/Permissions/);
    await expect(
      viewer.as.action(api.fleetmarket.acceptProposal, { shipmentId: id, proposalId: 7 }),
    ).rejects.toThrow(/Permissions/);
  });

  it("une autre organisation ne voit pas les propositions", async () => {
    const { t, a, id, state } = await setup();
    await t.action(internal.fleetmarket.publishLoad, { orgId: a.orgId, shipmentId: id });
    state.proposals = [{ id: 7, carrierCompanyName: "X", status: "PROPOSED" }];
    const b = await orgWithUser(t, "admin", "org-b");
    const res = await b.as.action(api.fleetmarket.proposals, { shipmentId: id });
    expect(res.proposals).toEqual([]);
  });

  it("ne publie pas deux fois la même expédition", async () => {
    const { t, a, id } = await setup();
    await t.action(internal.fleetmarket.publishLoad, { orgId: a.orgId, shipmentId: id });
    await expect(a.as.mutation(api.fleetmarket.publish, { shipmentId: id })).rejects.toThrow(/Déjà publiée/);
  });

  it("clé refusée : erreur tracée sur l'expédition, pas d'exception", async () => {
    const { t, a, id } = await setup();
    await t.run(async (ctx) => {
      const cfg = await ctx.db.query("fleetmarketIntegrations").first();
      if (cfg) await ctx.db.patch("fleetmarketIntegrations", cfg._id, { apiKey: "fm_wrong" });
    });
    await t.action(internal.fleetmarket.publishLoad, { orgId: a.orgId, shipmentId: id });
    const s = await t.run((ctx) => ctx.db.get("shipments", id));
    expect(s?.fleetmarket).toBeUndefined();
    const events = await a.as.query(api.tracking.listByShipment, { shipmentId: id });
    expect(events.some((e) => e.description.includes("Clé FleetMarket refusée"))).toBe(true);
  });
});
