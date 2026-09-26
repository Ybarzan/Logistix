import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { customsRegime, isValidHsCode } from "../../convex/customsRules";
import { addUser, newTest, orgWithUser } from "./setup";
import type { Id } from "../../convex/_generated/dataModel";
import type { T } from "./setup";

const KEY = "ic_live_testkey1234";

function stubPraxio(calls: Array<{ method: string; url: string; body: unknown; key: string | null }>) {
  vi.stubGlobal("fetch", (url: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : null, key: headers.get("X-API-Key") });
    if (headers.get("X-API-Key") !== KEY) return Promise.resolve(new Response("", { status: 401 }));
    if (url.endsWith("/api/v1/hs-suggestions/suggest")) {
      return Promise.resolve(Response.json({
        id: "5f0c1f2e-0000-4000-8000-000000000001",
        suggestedCode1: "940360", suggestedDescription1: "Meubles en bois", confidence1: 0.91,
        suggestedCode2: "940390", confidence2: 0.42,
      }));
    }
    return Promise.resolve(Response.json({}));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function hub(t: T, orgId: Id<"organizations">, code: string, country: string) {
  return await t.run((ctx) =>
    ctx.db.insert("hubs", { orgId, name: code, code, city: code, country, capacity: 1000, currentLoad: 0, lat: 45, lng: 4, isActive: true }),
  );
}

async function setup(toCountry = "Suisse") {
  const t = newTest();
  const a = await orgWithUser(t, "admin");
  const lyon = await hub(t, a.orgId, "LYS", "France");
  const dest = await hub(t, a.orgId, "DST", toCountry);
  const id = await a.as.mutation(api.shipments.create, {
    fromHubId: lyon, toHubId: dest, weight: 500, priority: "normal", customerName: "C",
    goodsDescription: "Chaises de salle à manger en chêne massif", declaredValueEur: 4200,
  });
  await t.run((ctx) =>
    ctx.db.insert("praxioIntegrations", { orgId: a.orgId, baseUrl: "http://praxio.test", apiKey: KEY, enabled: true }),
  );
  return { t, a, id };
}

describe("régime douanier", () => {
  it("distingue national, intra-UE et hors UE (y compris Suisse, Royaume-Uni)", () => {
    expect(customsRegime("France", "France")).toBe("domestic");
    expect(customsRegime("France", "Allemagne")).toBe("intra_eu");
    expect(customsRegime("France", "Belgium")).toBe("intra_eu");
    expect(customsRegime("France", "Suisse")).toBe("extra_eu");
    expect(customsRegime("France", "Royaume-Uni")).toBe("extra_eu");
    expect(customsRegime("République tchèque", "Italie")).toBe("intra_eu");
    expect(customsRegime("France", "")).toBe("unknown");
  });

  it("valide un code SH plausible", () => {
    expect(isValidHsCode("9403.60")).toBe(true);
    expect(isValidHsCode("94036010")).toBe(true);
    expect(isValidHsCode("94")).toBe(false);
    expect(isValidHsCode("ABCDEF")).toBe(false);
  });
});

describe("pré-contrôle douane Praxio", () => {
  it("classe la marchandise via Praxio avec la clé, et trace la suggestion", async () => {
    const calls: Parameters<typeof stubPraxio>[0] = [];
    stubPraxio(calls);
    const { t, a, id } = await setup();
    await a.as.action(api.praxio.classify, { shipmentId: id });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "http://praxio.test/api/v1/hs-suggestions/suggest",
      key: KEY,
      body: { productDescription: "Chaises de salle à manger en chêne massif" },
    });
    const s = await t.run((ctx) => ctx.db.get("shipments", id));
    expect(s?.customs?.suggestions.map((x) => x.code)).toEqual(["940360", "940390"]);
    expect(s?.customs?.praxioSuggestionId).toBe("5f0c1f2e-0000-4000-8000-000000000001");
  });

  it("hors UE sans code confirmé : incident préventif, clos à la confirmation, renvoyée à Praxio", async () => {
    vi.useFakeTimers();
    const calls: Parameters<typeof stubPraxio>[0] = [];
    stubPraxio(calls);
    const { t, a, id } = await setup("Suisse");
    await t.mutation(internal.praxio.detectCustomsRiskForOrg, { orgId: a.orgId, now: Date.now() });
    const incidents = () =>
      t.run((ctx) => ctx.db.query("incidents").withIndex("by_org", (q) => q.eq("orgId", a.orgId)).collect());
    expect(await incidents()).toMatchObject([{ type: "customs", severity: "medium", status: "open", source: "auto" }]);

    await a.as.action(api.praxio.classify, { shipmentId: id });
    await a.as.mutation(api.praxio.confirmHsCode, { shipmentId: id, code: "9403.60" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await incidents())[0].status).toBe("resolved");
    expect(calls.at(-1)).toMatchObject({
      method: "PUT",
      url: "http://praxio.test/api/v1/hs-suggestions/5f0c1f2e-0000-4000-8000-000000000001/confirm",
      body: { selectedCode: "940360" },
    });
  });

  it("aucun incident douane pour un envoi intra-UE", async () => {
    const { t, a } = await setup("Allemagne");
    expect(await t.mutation(internal.praxio.detectCustomsRiskForOrg, { orgId: a.orgId, now: Date.now() })).toEqual({ created: 0, escalated: 0 });
  });

  it("l'incident passe en « high » quand le camion part sans code", async () => {
    const { t, a, id } = await setup("Suisse");
    await t.mutation(internal.praxio.detectCustomsRiskForOrg, { orgId: a.orgId, now: Date.now() });
    await a.as.mutation(api.shipments.updateStatus, { shipmentId: id, status: "in_transit" });
    expect(await t.mutation(internal.praxio.detectCustomsRiskForOrg, { orgId: a.orgId, now: Date.now() })).toEqual({ created: 0, escalated: 1 });
  });

  it("clé refusée : erreur lisible enregistrée, pas de code inventé", async () => {
    stubPraxio([]);
    const { t, a, id } = await setup();
    await t.run(async (ctx) => {
      const cfg = await ctx.db.query("praxioIntegrations").first();
      if (cfg) await ctx.db.patch("praxioIntegrations", cfg._id, { apiKey: "ic_live_wrong" });
    });
    await a.as.action(api.praxio.classify, { shipmentId: id });
    const s = await t.run((ctx) => ctx.db.get("shipments", id));
    expect(s?.customs).toMatchObject({ suggestions: [], error: "Clé Praxio refusée (invalide ou révoquée)" });
  });

  it("un lecteur ne peut ni classer ni confirmer ; une autre org ne voit rien", async () => {
    stubPraxio([]);
    const { t, a, id } = await setup();
    const viewer = await addUser(t, a.orgId, "viewer", "v@a.fr");
    await expect(viewer.as.action(api.praxio.classify, { shipmentId: id })).rejects.toThrow(/Permissions/);
    await expect(viewer.as.mutation(api.praxio.confirmHsCode, { shipmentId: id, code: "940360" })).rejects.toThrow(/Permissions/);
    const b = await orgWithUser(t, "admin", "org-b");
    expect(await b.as.query(api.praxio.status, { shipmentId: id })).toBeNull();
  });

  it("changer la description invalide la classification précédente", async () => {
    stubPraxio([]);
    const { t, a, id } = await setup();
    await a.as.action(api.praxio.classify, { shipmentId: id });
    await a.as.mutation(api.shipments.update, { shipmentId: id, goodsDescription: "Pièces détachées automobiles" });
    expect((await t.run((ctx) => ctx.db.get("shipments", id)))?.customs).toBeUndefined();
  });
});
