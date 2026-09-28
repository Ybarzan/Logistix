import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { sign } from "../../convex/webhooks";
import { addHub, addUser, newTest, orgWithUser } from "./setup";
import type { T } from "./setup";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function setup() {
  const t = newTest();
  const a = await orgWithUser(t, "admin");
  await addHub(t, a.orgId, "LYS");
  await addHub(t, a.orgId, "MRS");
  const { apiKey } = await a.as.action(api.apiKeys.create, { name: "ERP" });
  return { t, a, apiKey };
}

function call(t: T, key: string | null, method: string, path: string, body?: unknown) {
  return t.fetch(path, {
    method,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const newShipment = { fromHubCode: "lys", toHubCode: "MRS", weightKg: 1200, customerName: "Client ERP", customerRef: "PO-4411", priority: "high" };

describe("clés d'API", () => {
  it("la clé n'est montrée qu'à la création ; la liste n'expose que le préfixe", async () => {
    const { a, apiKey } = await setup();
    expect(apiKey).toMatch(/^lx_live_[A-Za-z0-9_-]{43}$/);
    const keys = await a.as.query(api.apiKeys.list, {});
    expect(keys).toHaveLength(1);
    expect(JSON.stringify(keys)).not.toContain(apiKey);
  });

  it("seul un admin crée une clé", async () => {
    const { t, a } = await setup();
    const op = await addUser(t, a.orgId, "operator", "op@a.fr");
    await expect(op.as.action(api.apiKeys.create, { name: "Clé op" })).rejects.toThrow(/Permissions/);
  });

  it("sans clé, clé bidon ou clé révoquée : 401", async () => {
    const { t, a, apiKey } = await setup();
    expect((await call(t, null, "GET", "/api/v1/shipments")).status).toBe(401);
    expect((await call(t, "lx_live_nope", "GET", "/api/v1/shipments")).status).toBe(401);
    const [k] = await a.as.query(api.apiKeys.list, {});
    await a.as.mutation(api.apiKeys.revoke, { keyId: k._id });
    expect((await call(t, apiKey, "GET", "/api/v1/shipments")).status).toBe(401);
  });
});

describe("API REST v1", () => {
  it("crée une expédition par codes de hubs, idempotente sur la référence client", async () => {
    const { t, apiKey } = await setup();
    const res = await call(t, apiKey, "POST", "/api/v1/shipments", newShipment);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { reference: string; fromHub: { code: string }; priority: string; events: Array<{ source: string }> };
    expect(body.reference).toMatch(/^EX-\d{4}-000001$/);
    expect(body.fromHub.code).toBe("LYS");
    expect(body.priority).toBe("high");
    expect(body.events[0].source).toBe("api");

    const again = await call(t, apiKey, "POST", "/api/v1/shipments", newShipment);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { reference: string }).reference).toBe(body.reference);
  });

  it("valide les champs et remonte les erreurs métier lisibles", async () => {
    const { t, apiKey } = await setup();
    const missing = await call(t, apiKey, "POST", "/api/v1/shipments", { fromHubCode: "LYS" });
    expect(missing.status).toBe(400);
    expect(await missing.text()).toMatch(/toHubCode, customerName, weightKg/);
    const unknownHub = await call(t, apiKey, "POST", "/api/v1/shipments", { ...newShipment, toHubCode: "XXX" });
    expect(unknownHub.status).toBe(422);
    expect(await unknownHub.text()).toMatch(/Hub d'arrivée inconnu : XXX/);
    const badWeight = await call(t, apiKey, "POST", "/api/v1/shipments", { ...newShipment, weightKg: -3 });
    expect(badWeight.status).toBe(422);
  });

  it("lit une expédition, change son statut, refuse une transition interdite", async () => {
    const { t, apiKey } = await setup();
    const created = (await (await call(t, apiKey, "POST", "/api/v1/shipments", newShipment)).json()) as { reference: string };
    const ref = created.reference;
    const moved = await call(t, apiKey, "POST", `/api/v1/shipments/${ref}/status`, { status: "in_transit", note: "Parti du quai 4" });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as { status: string }).status).toBe("in_transit");
    await call(t, apiKey, "POST", `/api/v1/shipments/${ref}/status`, { status: "delivered" });
    const back = await call(t, apiKey, "POST", `/api/v1/shipments/${ref}/status`, { status: "pending" });
    expect(back.status).toBe(422);
    expect(await back.text()).toMatch(/Transition interdite/);
    const got = (await (await call(t, apiKey, "GET", `/api/v1/shipments/${ref}`)).json()) as { events: Array<{ description: string }> };
    expect(got.events.some((e) => e.description === "Parti du quai 4")).toBe(true);
  });

  it("une clé ne voit jamais les expéditions ni les hubs d'une autre organisation", async () => {
    const { t, apiKey } = await setup();
    const created = (await (await call(t, apiKey, "POST", "/api/v1/shipments", newShipment)).json()) as { reference: string };
    const b = await orgWithUser(t, "admin", "org-b");
    await addHub(t, b.orgId, "PAR");
    const { apiKey: keyB } = await b.as.action(api.apiKeys.create, { name: "ERP B" });
    expect((await call(t, keyB, "GET", `/api/v1/shipments/${created.reference}`)).status).toBe(404);
    const list = (await (await call(t, keyB, "GET", "/api/v1/shipments")).json()) as { data: Array<unknown> };
    expect(list.data).toEqual([]);
    const crossHub = await call(t, keyB, "POST", "/api/v1/shipments", { ...newShipment, fromHubCode: "PAR", toHubCode: "LYS" });
    expect(crossHub.status).toBe(422);
  });
});

describe("webhooks", () => {
  it("signe chaque envoi en HMAC-SHA256 et livre les événements abonnés", async () => {
    vi.useFakeTimers();
    const { t, a, apiKey } = await setup();
    const { secret } = await a.as.mutation(api.webhooks.create, {
      url: "https://erp.example/hooks", events: ["shipment.created", "shipment.status_changed"],
    });
    const received: Array<{ sig: string; body: string }> = [];
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      received.push({ sig: new Headers(init.headers).get("X-LogistiX-Signature") ?? "", body: String(init.body) });
      return Promise.resolve(new Response("", { status: 204 }));
    });
    await call(t, apiKey, "POST", "/api/v1/shipments", newShipment);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const created = received.find((r) => JSON.parse(r.body).type === "shipment.created");
    expect(created).toBeDefined();
    const [, ts, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(created?.sig ?? "") ?? [];
    expect(v1).toBe(await sign(secret, Number(ts), created?.body ?? ""));
    expect(JSON.parse(created?.body ?? "{}").data.customerRef).toBe("PO-4411");
  });

  it("n'envoie pas les événements non abonnés ; ouvre bien incident.opened pour un retard", async () => {
    vi.useFakeTimers();
    const { t, a } = await setup();
    await a.as.mutation(api.webhooks.create, { url: "https://erp.example/hooks", events: ["incident.opened"] });
    const types: Array<string> = [];
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) => {
      types.push(JSON.parse(String(init.body)).type as string);
      return Promise.resolve(new Response("", { status: 200 }));
    });
    const lys = await t.run(async (ctx) => (await ctx.db.query("hubs").collect())[0]._id);
    const mrs = await t.run(async (ctx) => (await ctx.db.query("hubs").collect())[1]._id);
    await a.as.mutation(api.shipments.create, {
      fromHubId: lys, toHubId: mrs, weight: 1, priority: "normal", customerName: "C", estimatedDelivery: Date.now() - 3600_000,
    });
    await t.mutation(internal.automation.detectDelaysForOrg, { orgId: a.orgId, now: Date.now() });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(types).toEqual(["incident.opened"]);
  });

  it("relance en cas d'échec puis abandonne après 5 tentatives", async () => {
    vi.useFakeTimers();
    const { t, a } = await setup();
    const { webhookId } = await a.as.mutation(api.webhooks.create, { url: "https://down.example/h", events: ["shipment.created"] });
    let calls = 0;
    vi.stubGlobal("fetch", () => {
      calls += 1;
      return Promise.resolve(new Response("", { status: 503 }));
    });
    await a.as.mutation(api.webhooks.sendTest, { webhookId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls).toBe(5);
    const [hook] = await a.as.query(api.webhooks.list, {});
    expect(hook.recent[0]).toMatchObject({ status: "failed", attempts: 5, lastStatusCode: 503 });
  });

  it("refuse une URL non http(s) ; un non-admin ne gère pas les webhooks", async () => {
    const { t, a } = await setup();
    await expect(a.as.mutation(api.webhooks.create, { url: "ftp://x", events: ["incident.opened"] })).rejects.toThrow(/http/);
    const op = await addUser(t, a.orgId, "operator", "op@a.fr");
    await expect(op.as.mutation(api.webhooks.create, { url: "https://x.fr", events: ["incident.opened"] })).rejects.toThrow(/Permissions/);
  });
});
