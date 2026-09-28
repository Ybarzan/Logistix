import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { hashKey } from "./apiKeys";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(() => {
    return Promise.resolve(new Response("ok", { status: 200 }));
  }),
});

// ---------------------------------------------------------------------------
// API REST v1 — intégration ERP / WMS / portail client.
// Authentification : `Authorization: Bearer lx_live_…` (ou `X-Api-Key`).
// Documentée dans le README et dans Paramètres → API.
// ---------------------------------------------------------------------------

const STATUSES = ["pending", "loading", "in_transit", "delivered", "delayed", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function problem(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

/** Message métier lisible à partir d'une erreur remontée d'une mutation. */
function businessMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const m = raw.match(/Uncaught Error: (.+?)(\n|$)/);
  return (m ? m[1] : raw).slice(0, 300);
}

async function authenticate(ctx: ActionCtx, req: Request): Promise<Id<"organizations"> | null> {
  const header = req.headers.get("Authorization");
  const key = header?.startsWith("Bearer ") ? header.slice(7).trim() : req.headers.get("X-Api-Key")?.trim();
  if (!key || !key.startsWith("lx_live_")) return null;
  return await ctx.runMutation(internal.apiKeys.authenticate, { keyHash: await hashKey(key) });
}

function withApiKey(handler: (ctx: ActionCtx, req: Request, orgId: Id<"organizations">) => Promise<Response>) {
  return httpAction(async (ctx, req) => {
    const orgId = await authenticate(ctx, req);
    if (!orgId) return problem(401, "unauthorized", "Clé d'API manquante, invalide ou révoquée");
    try {
      return await handler(ctx, req, orgId);
    } catch (err) {
      return problem(422, "unprocessable", businessMessage(err));
    }
  });
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);

function parseDate(x: unknown): number | undefined | "invalid" {
  if (x === undefined || x === null) return undefined;
  if (typeof x !== "string") return "invalid";
  const t = Date.parse(x);
  return Number.isNaN(t) ? "invalid" : t;
}

/** Extrait la référence et le suffixe de /api/v1/shipments/<ref>[/status]. */
function refFromPath(req: Request): { reference: string; rest: string } {
  const path = new URL(req.url).pathname.replace(/^\/api\/v1\/shipments\//, "");
  const [reference = "", ...rest] = path.split("/");
  return { reference: decodeURIComponent(reference), rest: rest.join("/") };
}

http.route({
  path: "/api/v1/shipments",
  method: "POST",
  handler: withApiKey(async (ctx, req, orgId) => {
    const body = await readJson(req);
    if (!body) return problem(400, "invalid_json", "Corps JSON attendu");
    const fromHubCode = str(body.fromHubCode);
    const toHubCode = str(body.toHubCode);
    const customerName = str(body.customerName);
    const weightKg = num(body.weightKg);
    const estimatedDelivery = parseDate(body.estimatedDelivery);
    const priority = str(body.priority);
    const missing = [
      !fromHubCode && "fromHubCode",
      !toHubCode && "toHubCode",
      !customerName && "customerName",
      weightKg === undefined && "weightKg",
    ].filter(Boolean);
    if (missing.length > 0) return problem(400, "missing_fields", `Champs requis : ${missing.join(", ")}`);
    if (estimatedDelivery === "invalid") return problem(400, "invalid_date", "estimatedDelivery : date ISO 8601 attendue");
    if (priority && !["low", "normal", "high", "urgent"].includes(priority)) {
      return problem(400, "invalid_priority", "priority : low | normal | high | urgent");
    }
    const declaredValueEur = num(body.declaredValueEur);
    const result = (await ctx.runMutation(internal.publicApi.createShipment, {
      orgId,
      fromHubCode: fromHubCode as string,
      toHubCode: toHubCode as string,
      weightKg: weightKg as number,
      customerName: customerName as string,
      ...(priority ? { priority: priority as "low" | "normal" | "high" | "urgent" } : {}),
      ...(str(body.customerRef) ? { customerRef: str(body.customerRef) } : {}),
      ...(estimatedDelivery !== undefined ? { estimatedDelivery } : {}),
      ...(str(body.goodsDescription) ? { goodsDescription: str(body.goodsDescription) } : {}),
      ...(declaredValueEur !== undefined ? { declaredValueEur } : {}),
    })) as { created: boolean; shipment: unknown };
    return json(result.created ? 201 : 200, result.shipment);
  }),
});

http.route({
  path: "/api/v1/shipments",
  method: "GET",
  handler: withApiKey(async (ctx, req, orgId) => {
    const params = new URL(req.url).searchParams;
    const status = params.get("status");
    if (status && !(STATUSES as ReadonlyArray<string>).includes(status)) {
      return problem(400, "invalid_status", `status : ${STATUSES.join(" | ")}`);
    }
    const limit = Number(params.get("limit") ?? 50);
    const rows: unknown = await ctx.runQuery(internal.publicApi.listShipments, {
      orgId,
      limit: Number.isFinite(limit) ? limit : 50,
      ...(status ? { status: status as Status } : {}),
    });
    return json(200, { data: rows });
  }),
});

http.route({
  pathPrefix: "/api/v1/shipments/",
  method: "GET",
  handler: withApiKey(async (ctx, req, orgId) => {
    const { reference, rest } = refFromPath(req);
    if (!reference || rest) return problem(404, "not_found", "Ressource inconnue");
    const s: unknown = await ctx.runQuery(internal.publicApi.getShipment, { orgId, reference });
    return s ? json(200, s) : problem(404, "not_found", `Expédition ${reference} introuvable`);
  }),
});

http.route({
  pathPrefix: "/api/v1/shipments/",
  method: "POST",
  handler: withApiKey(async (ctx, req, orgId) => {
    const { reference, rest } = refFromPath(req);
    if (!reference || rest !== "status") return problem(404, "not_found", "Ressource inconnue");
    const body = await readJson(req);
    const status = str(body?.status);
    if (!status || !(STATUSES as ReadonlyArray<string>).includes(status)) {
      return problem(400, "invalid_status", `status : ${STATUSES.join(" | ")}`);
    }
    const s: unknown = await ctx.runMutation(internal.publicApi.setStatus, {
      orgId,
      reference,
      status: status as Status,
      ...(str(body?.note) ? { note: str(body?.note) } : {}),
    });
    return s ? json(200, s) : problem(404, "not_found", `Expédition ${reference} introuvable`);
  }),
});

export default http;
