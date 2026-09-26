import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { getOrgScope, requireOwned, requireRole } from "./orgContext";
import { recordTrackingEvent } from "./tracking";
import { normalizeBaseUrl, parseFleethubTime, recordPosition } from "./fleethub";
import { isTerminal } from "./shipmentStatus";
import type { Id } from "./_generated/dataModel";

/**
 * Pont FleetMarket : quand le réseau propre ne suffit pas (retard, hub
 * saturé, pas de camion), LogistiX publie l'expédition comme charge sur
 * FleetMarket, affiche les propositions de transporteurs vérifiés
 * fleet-hub, accepte depuis LogistiX, puis récupère camion et GPS du
 * transporteur tiers via le tunnel FleetMarket → fleet-hub.
 *
 * Contrat HTTP FleetMarket (clé API donneur d'ordre, en-tête X-Api-Key) :
 *   POST /api/loads · GET /api/loads/mine · GET /api/proposals/for-load/{id}
 *   POST /api/proposals/{id}/accept · GET /api/proposals/{id}/vehicle-position
 */

const HTTP_TIMEOUT_MS = 8000;
/** Statuts FleetMarket pour lesquels on continue de synchroniser. */
const LIVE_LOAD_STATUSES = new Set(["OPEN", "MATCHED"]);

async function call(
  baseUrl: string,
  apiKey: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method: init.method ?? "GET",
      headers: {
        "X-Api-Key": apiKey,
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function errorText(res: { status: number; body: unknown }): string {
  const msg =
    typeof res.body === "object" && res.body !== null && "message" in res.body
      ? String((res.body as { message: unknown }).message)
      : "";
  if (res.status === 401) return "Clé FleetMarket refusée (invalide ou révoquée)";
  return msg ? `FleetMarket ${res.status} : ${msg}` : `FleetMarket a répondu ${res.status}`;
}

function describeFetchError(err: unknown): string {
  if (err instanceof Error) {
    return err.name === "AbortError" ? "FleetMarket injoignable (délai dépassé)" : err.message;
  }
  return "Erreur inconnue";
}

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Configuration (admin)
// ---------------------------------------------------------------------------

export const getConfig = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      baseUrl: v.string(),
      keyHint: v.string(),
      enabled: v.boolean(),
      lastSyncAt: v.optional(v.number()),
      lastError: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return null;
    const cfg = await ctx.db
      .query("fleetmarketIntegrations")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .first();
    if (!cfg) return null;
    return {
      baseUrl: cfg.baseUrl,
      keyHint: `••••${cfg.apiKey.slice(-4)}`,
      enabled: cfg.enabled,
      ...(cfg.lastSyncAt !== undefined ? { lastSyncAt: cfg.lastSyncAt } : {}),
      ...(cfg.lastError !== undefined ? { lastError: cfg.lastError } : {}),
    };
  },
});

export const saveConfig = mutation({
  args: { baseUrl: v.string(), apiKey: v.optional(v.string()), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scope = requireRole(await getOrgScope(ctx), "admin");
    const baseUrl = normalizeBaseUrl(args.baseUrl);
    const apiKey = args.apiKey?.trim();
    const existing = await ctx.db
      .query("fleetmarketIntegrations")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .first();
    if (existing) {
      await ctx.db.patch("fleetmarketIntegrations", existing._id, {
        baseUrl,
        enabled: args.enabled,
        lastError: undefined,
        ...(apiKey ? { apiKey } : {}),
      });
    } else {
      if (!apiKey) throw new Error("Clé FleetMarket requise");
      await ctx.db.insert("fleetmarketIntegrations", {
        orgId: scope.orgId,
        baseUrl,
        apiKey,
        enabled: args.enabled,
      });
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Publication d'une expédition
// ---------------------------------------------------------------------------

export const publish = mutation({
  args: {
    shipmentId: v.id("shipments"),
    goodsType: v.optional(v.string()),
    indicativePriceEur: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scope = requireRole(await getOrgScope(ctx), "operator");
    const shipment = await requireOwned(ctx, "shipments", args.shipmentId, scope.orgId);
    if (isTerminal(shipment.status)) {
      throw new Error("Expédition livrée ou annulée : rien à publier");
    }
    if (shipment.fleetmarket && LIVE_LOAD_STATUSES.has(shipment.fleetmarket.status)) {
      throw new Error("Déjà publiée sur FleetMarket");
    }
    const cfg = await ctx.db
      .query("fleetmarketIntegrations")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .first();
    if (!cfg?.enabled) throw new Error("Intégration FleetMarket non configurée");
    if (args.indicativePriceEur !== undefined && !(args.indicativePriceEur > 0)) {
      throw new Error("Le prix indicatif doit être positif");
    }
    await ctx.scheduler.runAfter(0, internal.fleetmarket.publishLoad, {
      orgId: scope.orgId,
      shipmentId: shipment._id,
      ...(args.goodsType?.trim() ? { goodsType: args.goodsType.trim() } : {}),
      ...(args.indicativePriceEur !== undefined ? { indicativePriceEur: args.indicativePriceEur } : {}),
    });
    return null;
  },
});

export const getPublishContext = internalQuery({
  args: { orgId: v.id("organizations"), shipmentId: v.id("shipments") },
  returns: v.union(
    v.null(),
    v.object({
      baseUrl: v.string(),
      apiKey: v.string(),
      origin: v.string(),
      destination: v.string(),
      weightKg: v.number(),
      reference: v.string(),
      estimatedDelivery: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, { orgId, shipmentId }) => {
    const cfg = await ctx.db
      .query("fleetmarketIntegrations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    const shipment = await ctx.db.get("shipments", shipmentId);
    if (!cfg?.enabled || !shipment || shipment.orgId !== orgId) return null;
    const [from, to] = await Promise.all([
      ctx.db.get("hubs", shipment.fromHubId),
      ctx.db.get("hubs", shipment.toHubId),
    ]);
    if (!from || !to) return null;
    return {
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      origin: from.city,
      destination: to.city,
      weightKg: shipment.weight,
      reference: shipment.reference,
      ...(shipment.estimatedDelivery !== undefined
        ? { estimatedDelivery: shipment.estimatedDelivery }
        : {}),
    };
  },
});

export const publishLoad = internalAction({
  args: {
    orgId: v.id("organizations"),
    shipmentId: v.id("shipments"),
    goodsType: v.optional(v.string()),
    indicativePriceEur: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const pc = await ctx.runQuery(internal.fleetmarket.getPublishContext, {
      orgId: args.orgId,
      shipmentId: args.shipmentId,
    });
    if (!pc) return null;
    const now = Date.now();
    // Enlèvement dès que possible : aujourd'hui → demain (FleetMarket exige une date ≥ aujourd'hui).
    const body = {
      origin: pc.origin,
      destination: pc.destination,
      pickupWindowStart: isoDay(now),
      pickupWindowEnd: isoDay(now + 24 * 3600 * 1000),
      weightKg: pc.weightKg,
      goodsType: args.goodsType ?? `Expédition ${pc.reference}`,
      ...(args.indicativePriceEur !== undefined ? { indicativePriceEur: args.indicativePriceEur } : {}),
    };
    let result: { loadId?: number; error?: string };
    try {
      const res = await call(pc.baseUrl, pc.apiKey, "/loads", { method: "POST", body });
      const id =
        typeof res.body === "object" && res.body !== null
          ? (res.body as { id?: unknown }).id
          : undefined;
      result =
        res.status >= 200 && res.status < 300 && typeof id === "number"
          ? { loadId: id }
          : { error: errorText(res) };
    } catch (err) {
      result = { error: describeFetchError(err) };
    }
    await ctx.runMutation(internal.fleetmarket.recordPublication, {
      orgId: args.orgId,
      shipmentId: args.shipmentId,
      now,
      ...result,
    });
    return null;
  },
});

export const recordPublication = internalMutation({
  args: {
    orgId: v.id("organizations"),
    shipmentId: v.id("shipments"),
    now: v.number(),
    loadId: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.loadId !== undefined) {
      await ctx.db.patch("shipments", args.shipmentId, {
        fleetmarket: { loadId: args.loadId, status: "OPEN", proposalCount: 0, postedAt: args.now },
      });
      await recordTrackingEvent(ctx, {
        orgId: args.orgId,
        shipmentId: args.shipmentId,
        eventType: "custom",
        description: `Publiée sur FleetMarket (charge n°${args.loadId}) — en attente de transporteurs`,
        source: "auto",
      });
    } else {
      await recordTrackingEvent(ctx, {
        orgId: args.orgId,
        shipmentId: args.shipmentId,
        eventType: "custom",
        description: `Échec de publication FleetMarket : ${args.error ?? "erreur inconnue"}`,
        source: "auto",
      });
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Propositions : lecture et acceptation depuis LogistiX
// ---------------------------------------------------------------------------

const proposalFields = v.object({
  id: v.number(),
  carrierCompanyName: v.string(),
  carrierComplianceScore: v.optional(v.number()),
  truckRegistration: v.optional(v.string()),
  status: v.string(),
  proposedAt: v.optional(v.number()),
});

export const getLinkContext = internalQuery({
  args: { orgId: v.id("organizations"), shipmentId: v.id("shipments") },
  returns: v.union(
    v.null(),
    v.object({ baseUrl: v.string(), apiKey: v.string(), loadId: v.number() }),
  ),
  handler: async (ctx, { orgId, shipmentId }) => {
    const cfg = await ctx.db
      .query("fleetmarketIntegrations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    const shipment = await ctx.db.get("shipments", shipmentId);
    if (!cfg?.enabled || !shipment || shipment.orgId !== orgId || !shipment.fleetmarket) return null;
    return { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, loadId: shipment.fleetmarket.loadId };
  },
});

export const scopeForShipment = internalQuery({
  args: { shipmentId: v.id("shipments") },
  returns: v.union(v.null(), v.object({ orgId: v.id("organizations"), canAct: v.boolean() })),
  handler: async (ctx, { shipmentId }) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return null;
    const shipment = await ctx.db.get("shipments", shipmentId);
    if (!shipment || shipment.orgId !== scope.orgId) return null;
    const rank = { viewer: 0, operator: 1, manager: 2, admin: 3 } as const;
    return { orgId: scope.orgId, canAct: rank[scope.role] >= rank.operator };
  },
});

function parseProposals(body: unknown) {
  if (!Array.isArray(body)) return [];
  return body
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
    .filter((p) => typeof p.id === "number")
    .map((p) => {
      const score = typeof p.carrierComplianceScore === "number" ? p.carrierComplianceScore : undefined;
      const truck = typeof p.truckRegistration === "string" && p.truckRegistration ? p.truckRegistration : undefined;
      const at = parseFleethubTime(p.proposedAt);
      return {
        id: p.id as number,
        carrierCompanyName: typeof p.carrierCompanyName === "string" ? p.carrierCompanyName : "Transporteur",
        status: typeof p.status === "string" ? p.status : "PROPOSED",
        ...(score !== undefined ? { carrierComplianceScore: score } : {}),
        ...(truck !== undefined ? { truckRegistration: truck } : {}),
        ...(at !== null ? { proposedAt: at } : {}),
      };
    });
}

/** Propositions reçues pour la charge liée à l'expédition (lecture en direct). */
export const listProposals = internalAction({
  args: { shipmentId: v.id("shipments") },
  returns: v.object({ proposals: v.array(proposalFields), error: v.optional(v.string()) }),
  handler: async (ctx, { shipmentId }) => {
    const scope = await ctx.runQuery(internal.fleetmarket.scopeForShipment, { shipmentId });
    if (!scope) return { proposals: [], error: "Expédition introuvable" };
    const link = await ctx.runQuery(internal.fleetmarket.getLinkContext, { orgId: scope.orgId, shipmentId });
    if (!link) return { proposals: [] };
    try {
      const res = await call(link.baseUrl, link.apiKey, `/proposals/for-load/${link.loadId}`);
      if (res.status !== 200) return { proposals: [], error: errorText(res) };
      return { proposals: parseProposals(res.body) };
    } catch (err) {
      return { proposals: [], error: describeFetchError(err) };
    }
  },
});

export const acceptProposalAction = internalAction({
  args: { shipmentId: v.id("shipments"), proposalId: v.number() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { shipmentId, proposalId }) => {
    const scope = await ctx.runQuery(internal.fleetmarket.scopeForShipment, { shipmentId });
    if (!scope?.canAct) return "Permissions insuffisantes";
    const link = await ctx.runQuery(internal.fleetmarket.getLinkContext, { orgId: scope.orgId, shipmentId });
    if (!link) return "Expédition non publiée sur FleetMarket";
    try {
      // On revérifie que la proposition appartient bien à *cette* charge avant d'accepter.
      const list = await call(link.baseUrl, link.apiKey, `/proposals/for-load/${link.loadId}`);
      if (list.status !== 200) return errorText(list);
      if (!parseProposals(list.body).some((p) => p.id === proposalId)) {
        return "Proposition introuvable pour cette charge";
      }
      const res = await call(link.baseUrl, link.apiKey, `/proposals/${proposalId}/accept`, { method: "POST" });
      if (res.status < 200 || res.status >= 300) return errorText(res);
    } catch (err) {
      return describeFetchError(err);
    }
    await ctx.runAction(internal.fleetmarket.syncOrg, { orgId: scope.orgId });
    return null;
  },
});

// Points d'entrée publics (actions) : l'authentification est vérifiée dans
// scopeForShipment (getOrgScope sur l'identité de l'appelant, propagée
// par ctx.runQuery depuis l'action).

export const proposals = action({
  args: { shipmentId: v.id("shipments") },
  returns: v.object({ proposals: v.array(proposalFields), error: v.optional(v.string()) }),
  handler: async (ctx, args): Promise<{ proposals: Array<typeof proposalFields.type>; error?: string }> => {
    return await ctx.runAction(internal.fleetmarket.listProposals, args);
  },
});

export const acceptProposal = action({
  args: { shipmentId: v.id("shipments"), proposalId: v.number() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const error: string | null = await ctx.runAction(internal.fleetmarket.acceptProposalAction, args);
    if (error) throw new Error(error);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Synchronisation (cron) : statut des charges, transporteur retenu, GPS
// ---------------------------------------------------------------------------

export const listEnabledOrgIds = internalQuery({
  args: {},
  returns: v.array(v.id("organizations")),
  handler: async (ctx) => {
    const rows = await ctx.db.query("fleetmarketIntegrations").collect();
    return rows.filter((r) => r.enabled).map((r) => r.orgId);
  },
});

export const getSyncContext = internalQuery({
  args: { orgId: v.id("organizations") },
  returns: v.union(
    v.null(),
    v.object({
      baseUrl: v.string(),
      apiKey: v.string(),
      linked: v.array(
        v.object({
          shipmentId: v.id("shipments"),
          loadId: v.number(),
          status: v.string(),
          acceptedProposalId: v.optional(v.number()),
        }),
      ),
    }),
  ),
  handler: async (ctx, { orgId }) => {
    const cfg = await ctx.db
      .query("fleetmarketIntegrations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!cfg?.enabled) return null;
    const linked = [];
    for (const status of ["pending", "loading", "in_transit", "delayed"] as const) {
      const rows = await ctx.db
        .query("shipments")
        .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", status))
        .collect();
      for (const s of rows) {
        if (!s.fleetmarket || !LIVE_LOAD_STATUSES.has(s.fleetmarket.status)) continue;
        linked.push({
          shipmentId: s._id,
          loadId: s.fleetmarket.loadId,
          status: s.fleetmarket.status,
          ...(s.fleetmarket.acceptedProposalId !== undefined
            ? { acceptedProposalId: s.fleetmarket.acceptedProposalId }
            : {}),
        });
      }
    }
    return { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, linked };
  },
});

const loadUpdate = v.object({
  shipmentId: v.id("shipments"),
  status: v.string(),
  proposalCount: v.number(),
  accepted: v.optional(
    v.object({
      proposalId: v.number(),
      carrierName: v.string(),
      carrierComplianceScore: v.optional(v.number()),
      truckRegistration: v.optional(v.string()),
    }),
  ),
  position: v.optional(
    v.object({ lat: v.number(), lng: v.number(), speedKph: v.optional(v.number()), recordedAt: v.number() }),
  ),
});

export const applySync = internalMutation({
  args: {
    orgId: v.id("organizations"),
    now: v.number(),
    error: v.optional(v.string()),
    updates: v.array(loadUpdate),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cfg = await ctx.db
      .query("fleetmarketIntegrations")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();
    if (cfg) {
      await ctx.db.patch("fleetmarketIntegrations", cfg._id, { lastSyncAt: args.now, lastError: args.error });
    }
    for (const u of args.updates) {
      const shipment = await ctx.db.get("shipments", u.shipmentId);
      if (!shipment?.fleetmarket || shipment.orgId !== args.orgId) continue;
      const prev = shipment.fleetmarket;
      const next = {
        ...prev,
        status: u.status,
        proposalCount: u.proposalCount,
        ...(u.accepted
          ? {
              acceptedProposalId: u.accepted.proposalId,
              carrierName: u.accepted.carrierName,
              ...(u.accepted.carrierComplianceScore !== undefined
                ? { carrierComplianceScore: u.accepted.carrierComplianceScore }
                : {}),
            }
          : {}),
      };
      const newlyAccepted = u.accepted && prev.acceptedProposalId === undefined;
      await ctx.db.patch("shipments", shipment._id, {
        fleetmarket: next,
        ...(newlyAccepted && u.accepted?.truckRegistration
          ? { truckRegistration: u.accepted.truckRegistration, lastPosition: undefined }
          : {}),
      });
      if (u.proposalCount > prev.proposalCount && !u.accepted) {
        await recordTrackingEvent(ctx, {
          orgId: args.orgId,
          shipmentId: shipment._id,
          eventType: "custom",
          description: `${u.proposalCount} proposition(s) de transporteur sur FleetMarket`,
          source: "auto",
        });
      }
      if (newlyAccepted && u.accepted) {
        await recordTrackingEvent(ctx, {
          orgId: args.orgId,
          shipmentId: shipment._id,
          eventType: "custom",
          description: `Transporteur ${u.accepted.carrierName} retenu via FleetMarket${
            u.accepted.truckRegistration ? ` (camion ${u.accepted.truckRegistration})` : ""
          }${u.accepted.carrierComplianceScore !== undefined ? ` · conformité ${u.accepted.carrierComplianceScore}%` : ""}`,
          source: "auto",
        });
      }
      if (u.position) {
        await recordPosition(ctx, args.orgId, { shipmentId: shipment._id, ...u.position });
      }
    }
    return null;
  },
});

export const syncOrg = internalAction({
  args: { orgId: v.id("organizations") },
  returns: v.null(),
  handler: async (ctx, { orgId }) => {
    const sc = await ctx.runQuery(internal.fleetmarket.getSyncContext, { orgId });
    if (!sc || sc.linked.length === 0) {
      if (sc) await ctx.runMutation(internal.fleetmarket.applySync, { orgId, now: Date.now(), updates: [] });
      return null;
    }
    const now = Date.now();
    const updates: Array<typeof loadUpdate.type> = [];
    let error: string | undefined;
    try {
      const mine = await call(sc.baseUrl, sc.apiKey, "/loads/mine");
      if (mine.status !== 200 || !Array.isArray(mine.body)) throw new Error(errorText(mine));
      const loads = new Map<number, Record<string, unknown>>();
      for (const l of mine.body as Array<Record<string, unknown>>) {
        if (typeof l.id === "number") loads.set(l.id, l);
      }
      for (const item of sc.linked) {
        const load = loads.get(item.loadId);
        if (!load) continue;
        const status = typeof load.status === "string" ? load.status : item.status;
        const proposalCount = typeof load.proposalCount === "number" ? load.proposalCount : 0;
        const update: typeof loadUpdate.type = { shipmentId: item.shipmentId, status, proposalCount };

        let acceptedId = item.acceptedProposalId;
        if (status === "MATCHED" && acceptedId === undefined) {
          const res = await call(sc.baseUrl, sc.apiKey, `/proposals/for-load/${item.loadId}`);
          const accepted = res.status === 200 ? parseProposals(res.body).find((p) => p.status === "ACCEPTED") : undefined;
          if (accepted) {
            acceptedId = accepted.id;
            update.accepted = {
              proposalId: accepted.id,
              carrierName: accepted.carrierCompanyName,
              ...(accepted.carrierComplianceScore !== undefined
                ? { carrierComplianceScore: accepted.carrierComplianceScore }
                : {}),
              ...(accepted.truckRegistration !== undefined ? { truckRegistration: accepted.truckRegistration } : {}),
            };
          }
        }
        if (status === "MATCHED" && acceptedId !== undefined) {
          const pos = await call(sc.baseUrl, sc.apiKey, `/proposals/${acceptedId}/vehicle-position`);
          const p = pos.body as Record<string, unknown> | null;
          if (pos.status === 200 && p && p.available === true && typeof p.latitude === "number" && typeof p.longitude === "number") {
            update.position = {
              lat: p.latitude,
              lng: p.longitude,
              recordedAt: parseFleethubTime(p.lastGpsUpdate) ?? now,
              ...(typeof p.speedKph === "number" ? { speedKph: p.speedKph } : {}),
            };
          }
        }
        updates.push(update);
      }
    } catch (err) {
      error = describeFetchError(err);
    }
    await ctx.runMutation(internal.fleetmarket.applySync, {
      orgId,
      now,
      updates,
      ...(error !== undefined ? { error } : {}),
    });
    return null;
  },
});

export const syncAll = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const orgIds: Array<Id<"organizations">> = await ctx.runQuery(internal.fleetmarket.listEnabledOrgIds, {});
    for (const orgId of orgIds) {
      await ctx.runAction(internal.fleetmarket.syncOrg, { orgId });
    }
    return null;
  },
});
