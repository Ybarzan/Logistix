import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { getOrgScope, requireOwned, requireRole } from "./orgContext";
import { recordTrackingEvent } from "./tracking";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Connecteur fleet-hub : la position GPS réelle des camions arrive seule
 * dans LogistiX. Contrat HTTP (côté fleet-hub, clé X-Marketplace-Key) :
 *   GET /api/marketplace/availability     → société, score, camions dispo
 *   GET /api/marketplace/vehicle-position?registration=… → position
 * Intégration par API uniquement : jamais d'accès à la base fleet-hub.
 */

/** Statuts pour lesquels on suit la position du camion. */
const TRACKED_STATUSES = ["loading", "in_transit", "delayed"] as const;

/** Nouvelle trace GPS conservée si le camion a bougé (≈50 m) ou toutes les 10 min. */
const MIN_MOVE_DEG = 0.0005;
const MIN_PING_INTERVAL_MS = 10 * 60 * 1000;

const HTTP_TIMEOUT_MS = 8000;

function normalizeBaseUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s]+$/.test(url)) {
    throw new Error("URL fleet-hub invalide (http(s)://…)");
  }
  return url;
}

/** Date locale fleet-hub (LocalDateTime sans fuseau) → epoch ms. */
export function parseFleethubTime(raw: unknown): number | null {
  if (typeof raw !== "string" || !raw) return null;
  const withZone = /[zZ]|[+-]\d\d:\d\d$/.test(raw) ? raw : `${raw}Z`;
  const t = Date.parse(withZone);
  return Number.isNaN(t) ? null : t;
}

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
      companyName: v.optional(v.string()),
      complianceScore: v.optional(v.number()),
      lastSyncAt: v.optional(v.number()),
      lastError: v.optional(v.string()),
      vehicleCount: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return null;
    const cfg = await ctx.db
      .query("fleethubIntegrations")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .first();
    if (!cfg) return null;
    const vehicles = await ctx.db
      .query("vehicles")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .collect();
    return {
      baseUrl: cfg.baseUrl,
      // Seuls les 4 derniers caractères quittent le serveur.
      keyHint: `••••${cfg.apiKey.slice(-4)}`,
      enabled: cfg.enabled,
      vehicleCount: vehicles.length,
      ...(cfg.companyName !== undefined ? { companyName: cfg.companyName } : {}),
      ...(cfg.complianceScore !== undefined ? { complianceScore: cfg.complianceScore } : {}),
      ...(cfg.lastSyncAt !== undefined ? { lastSyncAt: cfg.lastSyncAt } : {}),
      ...(cfg.lastError !== undefined ? { lastError: cfg.lastError } : {}),
    };
  },
});

export const saveConfig = mutation({
  args: {
    baseUrl: v.string(),
    // Absente = on garde la clé déjà enregistrée (modification de l'URL seule).
    apiKey: v.optional(v.string()),
    enabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scope = requireRole(await getOrgScope(ctx), "admin");
    const baseUrl = normalizeBaseUrl(args.baseUrl);
    const apiKey = args.apiKey?.trim();
    const existing = await ctx.db
      .query("fleethubIntegrations")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .first();
    if (existing) {
      await ctx.db.patch("fleethubIntegrations", existing._id, {
        baseUrl,
        enabled: args.enabled,
        lastError: undefined,
        ...(apiKey ? { apiKey } : {}),
      });
    } else {
      if (!apiKey) throw new Error("Clé fleet-hub requise");
      await ctx.db.insert("fleethubIntegrations", {
        orgId: scope.orgId,
        baseUrl,
        apiKey,
        enabled: args.enabled,
      });
    }
    if (args.enabled) {
      await ctx.scheduler.runAfter(0, internal.fleethub.syncOrg, { orgId: scope.orgId });
    }
    return null;
  },
});

export const syncNow = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const scope = requireRole(await getOrgScope(ctx), "operator");
    await ctx.scheduler.runAfter(0, internal.fleethub.syncOrg, { orgId: scope.orgId });
    return null;
  },
});

export const listVehicles = query({
  args: {},
  returns: v.array(v.object({ registration: v.string(), capacityTons: v.optional(v.number()) })),
  handler: async (ctx) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return [];
    const rows = await ctx.db
      .query("vehicles")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .collect();
    return rows
      .map((r) => ({
        registration: r.registration,
        ...(r.capacityTons !== undefined ? { capacityTons: r.capacityTons } : {}),
      }))
      .sort((a, b) => a.registration.localeCompare(b.registration));
  },
});

/**
 * Affecte (ou retire, avec null) un camion à une expédition. L'affectation
 * déclenche une synchro immédiate pour afficher la position sans attendre.
 */
export const assignTruck = mutation({
  args: { shipmentId: v.id("shipments"), registration: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scope = requireRole(await getOrgScope(ctx), "operator");
    const shipment = await requireOwned(ctx, "shipments", args.shipmentId, scope.orgId);
    const registration = args.registration?.trim().toUpperCase() || null;
    await ctx.db.patch("shipments", shipment._id, {
      truckRegistration: registration ?? undefined,
      // Une position appartient à un camion : on l'oublie si le camion change.
      ...(registration !== (shipment.truckRegistration ?? null) ? { lastPosition: undefined } : {}),
      updatedAt: Date.now(),
    });
    await recordTrackingEvent(ctx, {
      orgId: scope.orgId,
      shipmentId: shipment._id,
      eventType: "custom",
      description: registration ? `Camion ${registration} affecté` : "Camion retiré",
    });
    if (registration) {
      await ctx.scheduler.runAfter(0, internal.fleethub.syncOrg, { orgId: scope.orgId });
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Synchronisation (interne)
// ---------------------------------------------------------------------------

export const listEnabledOrgIds = internalQuery({
  args: {},
  returns: v.array(v.id("organizations")),
  handler: async (ctx) => {
    const rows = await ctx.db.query("fleethubIntegrations").collect();
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
      tracked: v.array(v.object({ shipmentId: v.id("shipments"), registration: v.string() })),
    }),
  ),
  handler: async (ctx, { orgId }) => {
    const cfg = await ctx.db
      .query("fleethubIntegrations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!cfg?.enabled) return null;
    const tracked: Array<{ shipmentId: Id<"shipments">; registration: string }> = [];
    for (const status of TRACKED_STATUSES) {
      const rows = await ctx.db
        .query("shipments")
        .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", status))
        .collect();
      for (const s of rows) {
        if (s.truckRegistration) tracked.push({ shipmentId: s._id, registration: s.truckRegistration });
      }
    }
    return { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, tracked };
  },
});

const positionResult = v.object({
  shipmentId: v.id("shipments"),
  lat: v.number(),
  lng: v.number(),
  speedKph: v.optional(v.number()),
  recordedAt: v.number(),
});

export const applySyncResult = internalMutation({
  args: {
    orgId: v.id("organizations"),
    now: v.number(),
    error: v.optional(v.string()),
    company: v.optional(
      v.object({
        name: v.optional(v.string()),
        complianceScore: v.optional(v.number()),
        trucks: v.array(v.object({ registration: v.string(), capacityTons: v.optional(v.number()) })),
      }),
    ),
    positions: v.array(positionResult),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cfg = await ctx.db
      .query("fleethubIntegrations")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();
    if (!cfg) return null;
    await ctx.db.patch("fleethubIntegrations", cfg._id, {
      lastSyncAt: args.now,
      lastError: args.error,
      ...(args.company?.name !== undefined ? { companyName: args.company.name } : {}),
      ...(args.company?.complianceScore !== undefined
        ? { complianceScore: args.company.complianceScore }
        : {}),
    });

    if (args.company) {
      const existing = await ctx.db
        .query("vehicles")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .collect();
      for (const row of existing) await ctx.db.delete("vehicles", row._id);
      for (const truck of args.company.trucks) {
        await ctx.db.insert("vehicles", {
          orgId: args.orgId,
          registration: truck.registration,
          syncedAt: args.now,
          ...(truck.capacityTons !== undefined ? { capacityTons: truck.capacityTons } : {}),
        });
      }
    }

    for (const p of args.positions) {
      await recordPosition(ctx, args.orgId, p);
    }
    return null;
  },
});

async function recordPosition(
  ctx: Parameters<typeof recordTrackingEvent>[0],
  orgId: Id<"organizations">,
  p: { shipmentId: Id<"shipments">; lat: number; lng: number; speedKph?: number; recordedAt: number },
) {
  const shipment: Doc<"shipments"> | null = await ctx.db.get("shipments", p.shipmentId);
  if (!shipment || shipment.orgId !== orgId) return;
  const prev = shipment.lastPosition;
  // Mesure plus ancienne que celle déjà connue : on ignore.
  if (prev && p.recordedAt < prev.recordedAt) return;

  const position = {
    lat: p.lat,
    lng: p.lng,
    recordedAt: p.recordedAt,
    ...(p.speedKph !== undefined ? { speedKph: p.speedKph } : {}),
  };
  await ctx.db.patch("shipments", shipment._id, { lastPosition: position });

  const moved =
    !prev ||
    Math.abs(prev.lat - p.lat) > MIN_MOVE_DEG ||
    Math.abs(prev.lng - p.lng) > MIN_MOVE_DEG;
  if (moved || p.recordedAt - prev.recordedAt >= MIN_PING_INTERVAL_MS) {
    await ctx.db.insert("positionPings", { orgId, ...position, shipmentId: shipment._id });
  }
  if (!prev) {
    await recordTrackingEvent(ctx, {
      orgId,
      shipmentId: shipment._id,
      eventType: "custom",
      description: `Première position GPS reçue (camion ${shipment.truckRegistration ?? "?"})`,
      location: `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`,
      source: "gps",
    });
  }
}

async function fetchJson(url: string, apiKey: string): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "X-Marketplace-Key": apiKey, Accept: "application/json" },
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

function num(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
}

/**
 * Synchronise une organisation : infos société + camions disponibles, puis
 * position de chaque camion affecté à une expédition suivie. Toute erreur
 * est enregistrée sur l'intégration (visible dans Paramètres), jamais levée.
 */
export const syncOrg = internalAction({
  args: { orgId: v.id("organizations") },
  returns: v.null(),
  handler: async (ctx, { orgId }) => {
    const sync = await ctx.runQuery(internal.fleethub.getSyncContext, { orgId });
    if (!sync) return null;
    const now = Date.now();
    const base = `${sync.baseUrl}/api/marketplace`;

    let company:
      | { name?: string; complianceScore?: number; trucks: Array<{ registration: string; capacityTons?: number }> }
      | undefined;
    let error: string | undefined;
    const positions: Array<{
      shipmentId: Id<"shipments">;
      lat: number;
      lng: number;
      speedKph?: number;
      recordedAt: number;
    }> = [];

    try {
      const av = await fetchJson(`${base}/availability`, sync.apiKey);
      if (av.status === 401) throw new Error("Clé fleet-hub refusée (invalide ou partage désactivé)");
      if (av.status !== 200 || typeof av.body !== "object" || av.body === null) {
        throw new Error(`fleet-hub a répondu ${av.status}`);
      }
      const body = av.body as Record<string, unknown>;
      const trucks = Array.isArray(body.trucksAvailable) ? body.trucksAvailable : [];
      const name = typeof body.companyName === "string" ? body.companyName : undefined;
      const complianceScore = num(body.complianceScore);
      company = {
        ...(name !== undefined ? { name } : {}),
        ...(complianceScore !== undefined ? { complianceScore } : {}),
        trucks: trucks
          .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
          .filter((t) => typeof t.registration === "string")
          .map((t) => {
            const capacityTons = num(t.capacityTons);
            return {
              registration: String(t.registration),
              ...(capacityTons !== undefined ? { capacityTons } : {}),
            };
          }),
      };

      for (const item of sync.tracked) {
        const res = await fetchJson(
          `${base}/vehicle-position?registration=${encodeURIComponent(item.registration)}`,
          sync.apiKey,
        );
        if (res.status !== 200 || typeof res.body !== "object" || res.body === null) continue;
        const p = res.body as Record<string, unknown>;
        const lat = num(p.latitude);
        const lng = num(p.longitude);
        if (p.available !== true || lat === undefined || lng === undefined) continue;
        const speedKph = num(p.speedKph);
        positions.push({
          shipmentId: item.shipmentId,
          lat,
          lng,
          recordedAt: parseFleethubTime(p.lastGpsUpdate) ?? now,
          ...(speedKph !== undefined ? { speedKph } : {}),
        });
      }
    } catch (err) {
      error =
        err instanceof Error
          ? err.name === "AbortError"
            ? "fleet-hub injoignable (délai dépassé)"
            : err.message
          : "Erreur inconnue";
    }

    await ctx.runMutation(internal.fleethub.applySyncResult, {
      orgId,
      now,
      positions,
      ...(error !== undefined ? { error } : {}),
      ...(company !== undefined ? { company } : {}),
    });
    return null;
  },
});

export const syncAll = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const orgIds = await ctx.runQuery(internal.fleethub.listEnabledOrgIds, {});
    for (const orgId of orgIds) {
      await ctx.runAction(internal.fleethub.syncOrg, { orgId });
    }
    return null;
  },
});

export const positionTrail = query({
  args: { shipmentId: v.id("shipments") },
  returns: v.array(v.object({ lat: v.number(), lng: v.number(), recordedAt: v.number() })),
  handler: async (ctx, args) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return [];
    const shipment = await ctx.db.get("shipments", args.shipmentId);
    if (!shipment || shipment.orgId !== scope.orgId) return [];
    const rows = await ctx.db
      .query("positionPings")
      .withIndex("by_shipment_and_time", (q) => q.eq("shipmentId", args.shipmentId))
      .order("desc")
      .take(200);
    return rows.reverse().map((r) => ({ lat: r.lat, lng: r.lng, recordedAt: r.recordedAt }));
  },
});

/** Données de la carte réseau : hubs + camions en mouvement. */
export const networkMap = query({
  args: {},
  returns: v.object({
    hubs: v.array(
      v.object({
        _id: v.id("hubs"),
        name: v.string(),
        code: v.string(),
        lat: v.number(),
        lng: v.number(),
        loadPct: v.number(),
        isActive: v.boolean(),
      }),
    ),
    trucks: v.array(
      v.object({
        shipmentId: v.id("shipments"),
        reference: v.string(),
        registration: v.string(),
        status: v.string(),
        lat: v.number(),
        lng: v.number(),
        speedKph: v.optional(v.number()),
        recordedAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return { hubs: [], trucks: [] };
    const hubs = await ctx.db
      .query("hubs")
      .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
      .collect();
    const trucks = [];
    for (const status of TRACKED_STATUSES) {
      const rows = await ctx.db
        .query("shipments")
        .withIndex("by_org_and_status", (q) => q.eq("orgId", scope.orgId).eq("status", status))
        .collect();
      for (const s of rows) {
        if (!s.lastPosition || !s.truckRegistration) continue;
        trucks.push({
          shipmentId: s._id,
          reference: s.reference,
          registration: s.truckRegistration,
          status: s.status,
          lat: s.lastPosition.lat,
          lng: s.lastPosition.lng,
          recordedAt: s.lastPosition.recordedAt,
          ...(s.lastPosition.speedKph !== undefined ? { speedKph: s.lastPosition.speedKph } : {}),
        });
      }
    }
    return {
      hubs: hubs.map((h) => ({
        _id: h._id,
        name: h.name,
        code: h.code,
        lat: h.lat,
        lng: h.lng,
        isActive: h.isActive,
        loadPct: h.capacity > 0 ? Math.round((h.currentLoad / h.capacity) * 100) : 0,
      })),
      trucks,
    };
  },
});
