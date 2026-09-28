import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { applyStatusChange, createShipmentCore, shipmentStatusSchema } from "./shipments";
import { shipmentPayload } from "./webhooks";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * Fonctions internes derrière l'API REST v1 (http.ts). L'organisation vient
 * TOUJOURS de la clé d'API authentifiée, jamais du corps de la requête ; les
 * hubs sont désignés par leur code (lisible par un ERP), les expéditions par
 * leur référence.
 */

async function hubByCode(ctx: QueryCtx, orgId: Id<"organizations">, code: string): Promise<Doc<"hubs"> | null> {
  const rows = await ctx.db
    .query("hubs")
    .withIndex("by_code", (q) => q.eq("code", code.trim().toUpperCase()))
    .collect();
  return rows.find((h) => h.orgId === orgId) ?? null;
}

async function byReference(ctx: QueryCtx, orgId: Id<"organizations">, reference: string) {
  return await ctx.db
    .query("shipments")
    .withIndex("by_org_and_reference", (q) => q.eq("orgId", orgId).eq("reference", reference))
    .first();
}

async function fullPayload(ctx: QueryCtx, s: Doc<"shipments">) {
  const [from, to] = await Promise.all([ctx.db.get("hubs", s.fromHubId), ctx.db.get("hubs", s.toHubId)]);
  const orgId = s.orgId;
  const events = orgId
    ? await ctx.db
        .query("trackingEvents")
        .withIndex("by_org_and_shipment", (q) => q.eq("orgId", orgId).eq("shipmentId", s._id))
        .order("desc")
        .take(50)
    : [];
  return {
    ...shipmentPayload(s),
    fromHub: from ? { code: from.code, city: from.city, country: from.country } : null,
    toHub: to ? { code: to.code, city: to.city, country: to.country } : null,
    customs: s.customs?.confirmedHsCode ? { hsCode: s.customs.confirmedHsCode } : null,
    events: events.map((e) => ({
      at: new Date(e._creationTime).toISOString(),
      type: e.eventType,
      description: e.description,
      source: e.source ?? "manual",
      location: e.location ?? null,
    })),
  };
}

export const createShipment = internalMutation({
  args: {
    orgId: v.id("organizations"),
    fromHubCode: v.string(),
    toHubCode: v.string(),
    weightKg: v.number(),
    priority: v.optional(v.union(v.literal("low"), v.literal("normal"), v.literal("high"), v.literal("urgent"))),
    customerName: v.string(),
    customerRef: v.optional(v.string()),
    estimatedDelivery: v.optional(v.number()),
    goodsDescription: v.optional(v.string()),
    declaredValueEur: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const from = await hubByCode(ctx, args.orgId, args.fromHubCode);
    const to = await hubByCode(ctx, args.orgId, args.toHubCode);
    if (!from) throw new Error(`Hub de départ inconnu : ${args.fromHubCode}`);
    if (!to) throw new Error(`Hub d'arrivée inconnu : ${args.toHubCode}`);
    // Idempotence pratique : même référence client déjà créée → on renvoie l'existante.
    if (args.customerRef) {
      const recent = await ctx.db
        .query("shipments")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .order("desc")
        .take(500);
      const dup = recent.find((s) => s.customerRef === args.customerRef && s.customerName === args.customerName.trim());
      if (dup) return { created: false, shipment: await fullPayload(ctx, dup) };
    }
    const id = await createShipmentCore(
      ctx,
      args.orgId,
      {
        fromHubId: from._id,
        toHubId: to._id,
        weight: args.weightKg,
        priority: args.priority ?? "normal",
        customerName: args.customerName,
        ...(args.customerRef ? { customerRef: args.customerRef } : {}),
        ...(args.estimatedDelivery !== undefined ? { estimatedDelivery: args.estimatedDelivery } : {}),
        ...(args.goodsDescription ? { goodsDescription: args.goodsDescription } : {}),
        ...(args.declaredValueEur !== undefined ? { declaredValueEur: args.declaredValueEur } : {}),
      },
      "api",
    );
    const s = await ctx.db.get("shipments", id);
    return { created: true, shipment: s ? await fullPayload(ctx, s) : null };
  },
});

export const getShipment = internalQuery({
  args: { orgId: v.id("organizations"), reference: v.string() },
  returns: v.any(),
  handler: async (ctx, { orgId, reference }) => {
    const s = await byReference(ctx, orgId, reference);
    return s ? await fullPayload(ctx, s) : null;
  },
});

export const listShipments = internalQuery({
  args: { orgId: v.id("organizations"), status: v.optional(shipmentStatusSchema), limit: v.number() },
  returns: v.any(),
  handler: async (ctx, { orgId, status, limit }) => {
    const n = Math.min(Math.max(1, limit), 200);
    const rows = status
      ? await ctx.db
          .query("shipments")
          .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", status))
          .order("desc")
          .take(n)
      : await ctx.db.query("shipments").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(n);
    return rows.map(shipmentPayload);
  },
});

export const setStatus = internalMutation({
  args: { orgId: v.id("organizations"), reference: v.string(), status: shipmentStatusSchema, note: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { orgId, reference, status, note }) => {
    const s = await byReference(ctx, orgId, reference);
    if (!s) return null;
    await applyStatusChange(ctx, s, status, {
      source: "api",
      ...(note?.trim() ? { description: note.trim().slice(0, 300) } : {}),
    });
    const fresh = await ctx.db.get("shipments", s._id);
    return fresh ? await fullPayload(ctx, fresh) : null;
  },
});
