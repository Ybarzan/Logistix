import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { getOrgScope, requireRole } from "./orgContext";
import { webhookEventType } from "./schema";
import { assertOutboundUrl } from "./urlPolicy";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Webhooks sortants : LogistiX prévient le SI du client (ERP, WMS, portail)
 * au lieu d'attendre qu'il interroge. Chaque envoi est signé :
 *   X-LogistiX-Signature: t=<epoch ms>,v1=<hex HMAC-SHA256(secret, "<t>.<corps>")>
 * Le destinataire recalcule la signature et rejette un horodatage trop ancien
 * (anti-rejeu). Échec (≠ 2xx, réseau) → relance à 1 min, 5 min, 30 min, 2 h.
 */

export type WebhookEventType = typeof webhookEventType.type;

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000];
const HTTP_TIMEOUT_MS = 8000;

export const ALL_EVENTS: Array<WebhookEventType> = [
  "shipment.created",
  "shipment.status_changed",
  "incident.opened",
  "incident.resolved",
];

/**
 * Émet un événement métier vers tous les webhooks actifs de l'organisation
 * abonnés à ce type. Appelé dans la même transaction que le changement :
 * pas d'événement fantôme si la mutation échoue.
 */
export async function emitEvent(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  type: WebhookEventType,
  data: Record<string, unknown>,
): Promise<void> {
  const hooks = await ctx.db.query("webhooks").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const targets = hooks.filter((h) => h.enabled && h.events.includes(type));
  if (targets.length === 0) return;
  const now = Date.now();
  const eventId = `evt_${now.toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
  const payload = JSON.stringify({ id: eventId, type, createdAt: new Date(now).toISOString(), data });
  for (const hook of targets) {
    const deliveryId = await ctx.db.insert("webhookDeliveries", {
      orgId,
      webhookId: hook._id,
      eventId,
      type,
      payload,
      attempts: 0,
      status: "pending",
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.webhooks.deliver, { deliveryId });
  }
}

/** Représentation publique (API + webhooks) d'une expédition. */
export function shipmentPayload(s: Doc<"shipments">): Record<string, unknown> {
  return {
    id: s._id,
    reference: s.reference,
    status: s.status,
    customerName: s.customerName,
    customerRef: s.customerRef ?? null,
    weightKg: s.weight,
    priority: s.priority,
    estimatedDelivery: s.estimatedDelivery ? new Date(s.estimatedDelivery).toISOString() : null,
    actualDelivery: s.actualDelivery ? new Date(s.actualDelivery).toISOString() : null,
    predictedArrival: s.prediction
      ? {
          eta: new Date(s.prediction.eta).toISOString(),
          low: new Date(s.prediction.low).toISOString(),
          high: new Date(s.prediction.high).toISOString(),
          method: s.prediction.method,
          explanation: s.prediction.explanation,
        }
      : null,
    truckRegistration: s.truckRegistration ?? null,
    lastPosition: s.lastPosition
      ? { lat: s.lastPosition.lat, lng: s.lastPosition.lng, recordedAt: new Date(s.lastPosition.recordedAt).toISOString() }
      : null,
  };
}

function incidentPayload(i: Doc<"incidents">, reference?: string): Record<string, unknown> {
  return {
    id: i._id,
    type: i.type,
    severity: i.severity,
    title: i.title,
    description: i.description,
    status: i.status,
    predicted: i.predicted === true,
    source: i.source ?? "manual",
    shipmentReference: reference ?? null,
  };
}

async function shipmentRef(ctx: MutationCtx, id: Id<"shipments"> | undefined): Promise<string | undefined> {
  if (!id) return undefined;
  return (await ctx.db.get("shipments", id))?.reference;
}

/** Ouvre un incident et émet `incident.opened`. Point d'entrée unique. */
export async function openIncident(
  ctx: MutationCtx,
  doc: Omit<Doc<"incidents">, "_id" | "_creationTime">,
): Promise<Id<"incidents">> {
  const id = await ctx.db.insert("incidents", doc);
  const inserted = await ctx.db.get("incidents", id);
  if (inserted?.orgId) {
    await emitEvent(ctx, inserted.orgId, "incident.opened", incidentPayload(inserted, await shipmentRef(ctx, inserted.shipmentId)));
  }
  return id;
}

/** Résout un incident (si ouvert) et émet `incident.resolved`. */
export async function resolveIncident(
  ctx: MutationCtx,
  incident: Doc<"incidents">,
  now: number,
  extra: Partial<Pick<Doc<"incidents">, "description">> = {},
): Promise<void> {
  if (incident.status === "resolved") return;
  await ctx.db.patch("incidents", incident._id, { status: "resolved", resolvedAt: now, ...extra });
  const updated = await ctx.db.get("incidents", incident._id);
  if (updated?.orgId) {
    await emitEvent(ctx, updated.orgId, "incident.resolved", incidentPayload(updated, await shipmentRef(ctx, updated.shipmentId)));
  }
}

// ---------------------------------------------------------------------------
// Livraison
// ---------------------------------------------------------------------------

export const getDelivery = internalQuery({
  args: { deliveryId: v.id("webhookDeliveries") },
  returns: v.union(
    v.null(),
    v.object({ url: v.string(), secret: v.string(), payload: v.string(), attempts: v.number(), enabled: v.boolean(), status: v.string() }),
  ),
  handler: async (ctx, { deliveryId }) => {
    const d = await ctx.db.get("webhookDeliveries", deliveryId);
    if (!d) return null;
    const hook = await ctx.db.get("webhooks", d.webhookId);
    if (!hook) return null;
    return { url: hook.url, secret: hook.secret, payload: d.payload, attempts: d.attempts, enabled: hook.enabled, status: d.status };
  },
});

export const recordAttempt = internalMutation({
  args: {
    deliveryId: v.id("webhookDeliveries"),
    ok: v.boolean(),
    statusCode: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const d = await ctx.db.get("webhookDeliveries", args.deliveryId);
    if (!d) return null;
    const attempts = d.attempts + 1;
    const now = Date.now();
    if (args.ok) {
      await ctx.db.patch("webhookDeliveries", d._id, {
        attempts, status: "delivered", deliveredAt: now, lastStatusCode: args.statusCode, lastError: undefined,
      });
      return null;
    }
    const delay: number | null = attempts <= RETRY_DELAYS_MS.length ? RETRY_DELAYS_MS[attempts - 1] : null;
    await ctx.db.patch("webhookDeliveries", d._id, {
      attempts,
      status: delay === null ? "failed" : "pending",
      lastStatusCode: args.statusCode,
      lastError: args.error,
    });
    if (delay !== null) {
      await ctx.scheduler.runAfter(delay, internal.webhooks.deliver, { deliveryId: d._id });
    }
    return null;
  },
});

export async function sign(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const deliver = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  returns: v.null(),
  handler: async (ctx, { deliveryId }) => {
    const d = await ctx.runQuery(internal.webhooks.getDelivery, { deliveryId });
    if (!d || d.status !== "pending") return null;
    // Revérifiée à l'envoi : la politique a pu se durcir depuis l'enregistrement.
    try {
      assertOutboundUrl(d.url);
    } catch (err) {
      await ctx.runMutation(internal.webhooks.recordAttempt, {
        deliveryId,
        ok: false,
        error: err instanceof Error ? err.message : "URL refusée",
      });
      return null;
    }
    if (!d.enabled) {
      await ctx.runMutation(internal.webhooks.recordAttempt, { deliveryId, ok: false, error: "Webhook désactivé" });
      return null;
    }
    const t = Date.now();
    const signature = await sign(d.secret, t, d.payload);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(d.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "LogistiX-Webhooks/1",
          "X-LogistiX-Signature": `t=${t},v1=${signature}`,
        },
        body: d.payload,
        signal: controller.signal,
      });
      await ctx.runMutation(internal.webhooks.recordAttempt, {
        deliveryId,
        ok: res.status >= 200 && res.status < 300,
        statusCode: res.status,
        ...(res.status >= 300 ? { error: `HTTP ${res.status}` } : {}),
      });
    } catch (err) {
      await ctx.runMutation(internal.webhooks.recordAttempt, {
        deliveryId,
        ok: false,
        error: err instanceof Error && err.name === "AbortError" ? "Délai dépassé" : err instanceof Error ? err.message : "Erreur réseau",
      });
    } finally {
      clearTimeout(timer);
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Administration (admin)
// ---------------------------------------------------------------------------

function validateUrl(raw: string): string {
  return assertOutboundUrl(raw);
}

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("webhooks"),
      url: v.string(),
      events: v.array(webhookEventType),
      enabled: v.boolean(),
      secretHint: v.string(),
      recent: v.array(
        v.object({
          type: webhookEventType,
          status: v.string(),
          attempts: v.number(),
          lastStatusCode: v.optional(v.number()),
          lastError: v.optional(v.string()),
          createdAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const scope = await getOrgScope(ctx);
    if (!scope || scope.role !== "admin") return [];
    const hooks = await ctx.db.query("webhooks").withIndex("by_org", (q) => q.eq("orgId", scope.orgId)).collect();
    const out = [];
    for (const h of hooks) {
      const recent = await ctx.db
        .query("webhookDeliveries")
        .withIndex("by_webhook", (q) => q.eq("webhookId", h._id))
        .order("desc")
        .take(5);
      out.push({
        _id: h._id,
        url: h.url,
        events: h.events,
        enabled: h.enabled,
        secretHint: `••••${h.secret.slice(-4)}`,
        recent: recent.map((r) => ({
          type: r.type,
          status: r.status,
          attempts: r.attempts,
          createdAt: r.createdAt,
          ...(r.lastStatusCode !== undefined ? { lastStatusCode: r.lastStatusCode } : {}),
          ...(r.lastError !== undefined ? { lastError: r.lastError } : {}),
        })),
      });
    }
    return out;
  },
});

/** Crée un abonnement ; le secret de signature n'est renvoyé qu'ici. */
export const create = mutation({
  args: { url: v.string(), events: v.array(webhookEventType) },
  returns: v.object({ webhookId: v.id("webhooks"), secret: v.string() }),
  handler: async (ctx, args) => {
    const scope = requireRole(await getOrgScope(ctx), "admin");
    if (args.events.length === 0) throw new Error("Choisissez au moins un événement");
    const secret = `whsec_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const webhookId = await ctx.db.insert("webhooks", {
      orgId: scope.orgId,
      url: validateUrl(args.url),
      secret,
      events: [...new Set(args.events)],
      enabled: true,
      createdAt: Date.now(),
    });
    return { webhookId, secret };
  },
});

export const setEnabled = mutation({
  args: { webhookId: v.id("webhooks"), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { webhookId, enabled }) => {
    const scope = requireRole(await getOrgScope(ctx), "admin");
    const hook = await ctx.db.get("webhooks", webhookId);
    if (!hook || hook.orgId !== scope.orgId) throw new Error("Webhook introuvable");
    await ctx.db.patch("webhooks", webhookId, { enabled });
    return null;
  },
});

export const remove = mutation({
  args: { webhookId: v.id("webhooks") },
  returns: v.null(),
  handler: async (ctx, { webhookId }) => {
    const scope = requireRole(await getOrgScope(ctx), "admin");
    const hook = await ctx.db.get("webhooks", webhookId);
    if (!hook || hook.orgId !== scope.orgId) throw new Error("Webhook introuvable");
    const deliveries = await ctx.db.query("webhookDeliveries").withIndex("by_webhook", (q) => q.eq("webhookId", webhookId)).collect();
    for (const d of deliveries) await ctx.db.delete("webhookDeliveries", d._id);
    await ctx.db.delete("webhooks", webhookId);
    return null;
  },
});

/** Envoie un événement de test (type shipment.status_changed fictif) au webhook. */
export const sendTest = mutation({
  args: { webhookId: v.id("webhooks") },
  returns: v.null(),
  handler: async (ctx, { webhookId }) => {
    const scope = requireRole(await getOrgScope(ctx), "admin");
    const hook = await ctx.db.get("webhooks", webhookId);
    if (!hook || hook.orgId !== scope.orgId) throw new Error("Webhook introuvable");
    const now = Date.now();
    const deliveryId = await ctx.db.insert("webhookDeliveries", {
      orgId: scope.orgId,
      webhookId,
      eventId: `evt_test_${now.toString(36)}`,
      type: "shipment.status_changed",
      payload: JSON.stringify({ id: `evt_test_${now.toString(36)}`, type: "shipment.status_changed", test: true, createdAt: new Date(now).toISOString(), data: { reference: "EX-TEST", status: "in_transit" } }),
      attempts: 0,
      status: "pending",
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.webhooks.deliver, { deliveryId });
    return null;
  },
});
