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
import { normalizeBaseUrl } from "./fleethub";
import { REGIME_LABELS, customsRegime, isValidHsCode } from "./customsRules";
import type { CustomsRegime } from "./customsRules";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * Pré-contrôle douane via Praxio (moteur de conformité) : pour un trajet
 * qui franchit une frontière douanière, Praxio classe la marchandise (code
 * SH par TARIC + ML + recherche sémantique), l'opérateur confirme depuis
 * LogistiX, et la confirmation est renvoyée à Praxio pour affiner sa
 * classification sur l'historique de la société. Tant qu'un envoi hors UE
 * n'a pas de code confirmé, un incident « douane » préventif est ouvert :
 * on règle la douane avant que le camion ne soit bloqué à la frontière.
 *
 * Contrat HTTP Praxio (en-tête X-API-Key, clé rattachée à la société) :
 *   POST {base}/api/v1/hs-suggestions/suggest      { productDescription }
 *   PUT  {base}/api/v1/hs-suggestions/{id}/confirm { selectedCode }
 */

const HTTP_TIMEOUT_MS = 10000;

async function call(
  baseUrl: string,
  apiKey: string,
  path: string,
  method: "POST" | "PUT",
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

function errorText(res: { status: number; body: unknown }): string {
  const b = res.body as Record<string, unknown> | null;
  const msg = b && typeof b.message === "string" ? b.message : b && typeof b.error === "string" ? b.error : "";
  if (res.status === 401) return "Clé Praxio refusée (invalide ou révoquée)";
  if (res.status === 403) return msg ? `Praxio : accès refusé (${msg})` : "Praxio : accès refusé (plan ou rôle insuffisant)";
  if (res.status === 429) return "Quota journalier Praxio atteint";
  return msg ? `Praxio ${res.status} : ${msg}` : `Praxio a répondu ${res.status}`;
}

async function regimeOf(ctx: QueryCtx | MutationCtx, shipment: Doc<"shipments">): Promise<CustomsRegime> {
  const [from, to] = await Promise.all([
    ctx.db.get("hubs", shipment.fromHubId),
    ctx.db.get("hubs", shipment.toHubId),
  ]);
  return from && to ? customsRegime(from.country, to.country) : "unknown";
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
      lastCallAt: v.optional(v.number()),
      lastError: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return null;
    const cfg = await ctx.db.query("praxioIntegrations").withIndex("by_org", (q) => q.eq("orgId", scope.orgId)).first();
    if (!cfg) return null;
    return {
      baseUrl: cfg.baseUrl,
      keyHint: `••••${cfg.apiKey.slice(-4)}`,
      enabled: cfg.enabled,
      ...(cfg.lastCallAt !== undefined ? { lastCallAt: cfg.lastCallAt } : {}),
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
    if (apiKey && !apiKey.startsWith("ic_")) throw new Error("Clé Praxio invalide (préfixe ic_ attendu)");
    const existing = await ctx.db.query("praxioIntegrations").withIndex("by_org", (q) => q.eq("orgId", scope.orgId)).first();
    if (existing) {
      await ctx.db.patch("praxioIntegrations", existing._id, {
        baseUrl,
        enabled: args.enabled,
        lastError: undefined,
        ...(apiKey ? { apiKey } : {}),
      });
    } else {
      if (!apiKey) throw new Error("Clé Praxio requise");
      await ctx.db.insert("praxioIntegrations", { orgId: scope.orgId, baseUrl, apiKey, enabled: args.enabled });
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// État douane d'une expédition
// ---------------------------------------------------------------------------

export const status = query({
  args: { shipmentId: v.id("shipments") },
  returns: v.union(
    v.null(),
    v.object({
      regime: v.string(),
      regimeLabel: v.string(),
      needsHsCode: v.boolean(),
      praxioEnabled: v.boolean(),
      checklist: v.array(v.object({ label: v.string(), ok: v.boolean() })),
    }),
  ),
  handler: async (ctx, { shipmentId }) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return null;
    const shipment = await ctx.db.get("shipments", shipmentId);
    if (!shipment || shipment.orgId !== scope.orgId) return null;
    const regime = await regimeOf(ctx, shipment);
    const cfg = await ctx.db.query("praxioIntegrations").withIndex("by_org", (q) => q.eq("orgId", scope.orgId)).first();
    const needsHsCode = regime === "extra_eu";
    const checklist =
      regime === "extra_eu" || regime === "intra_eu"
        ? [
            { label: "Description de la marchandise", ok: Boolean(shipment.goodsDescription) },
            { label: regime === "extra_eu" ? "Code SH confirmé" : "Code NC (DEB/Intrastat)", ok: Boolean(shipment.customs?.confirmedHsCode) },
            ...(regime === "extra_eu"
              ? [{ label: "Valeur déclarée", ok: shipment.declaredValueEur !== undefined }]
              : []),
          ]
        : [];
    return {
      regime,
      regimeLabel: REGIME_LABELS[regime],
      needsHsCode,
      praxioEnabled: Boolean(cfg?.enabled),
      checklist,
    };
  },
});

// ---------------------------------------------------------------------------
// Classification (Praxio)
// ---------------------------------------------------------------------------

export const getCallContext = internalQuery({
  args: { shipmentId: v.id("shipments") },
  returns: v.union(
    v.null(),
    v.object({
      orgId: v.id("organizations"),
      canAct: v.boolean(),
      baseUrl: v.string(),
      apiKey: v.string(),
      goodsDescription: v.optional(v.string()),
      praxioSuggestionId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { shipmentId }) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return null;
    const shipment = await ctx.db.get("shipments", shipmentId);
    if (!shipment || shipment.orgId !== scope.orgId) return null;
    const cfg = await ctx.db.query("praxioIntegrations").withIndex("by_org", (q) => q.eq("orgId", scope.orgId)).first();
    if (!cfg?.enabled) return null;
    const rank = { viewer: 0, operator: 1, manager: 2, admin: 3 } as const;
    return {
      orgId: scope.orgId,
      canAct: rank[scope.role] >= rank.operator,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      ...(shipment.goodsDescription ? { goodsDescription: shipment.goodsDescription } : {}),
      ...(shipment.customs?.praxioSuggestionId ? { praxioSuggestionId: shipment.customs.praxioSuggestionId } : {}),
    };
  },
});

const suggestionFields = v.object({
  code: v.string(),
  description: v.optional(v.string()),
  confidence: v.optional(v.number()),
});

export const recordClassification = internalMutation({
  args: {
    orgId: v.id("organizations"),
    shipmentId: v.id("shipments"),
    now: v.number(),
    suggestions: v.array(suggestionFields),
    praxioSuggestionId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cfg = await ctx.db.query("praxioIntegrations").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).first();
    if (cfg) await ctx.db.patch("praxioIntegrations", cfg._id, { lastCallAt: args.now, lastError: args.error });
    const shipment = await ctx.db.get("shipments", args.shipmentId);
    if (!shipment || shipment.orgId !== args.orgId) return null;
    await ctx.db.patch("shipments", args.shipmentId, {
      customs: {
        suggestions: args.suggestions,
        checkedAt: args.now,
        ...(args.praxioSuggestionId ? { praxioSuggestionId: args.praxioSuggestionId } : {}),
        ...(args.error ? { error: args.error } : {}),
        // Une nouvelle classification ne retire pas un code déjà confirmé par un humain.
        ...(shipment.customs?.confirmedHsCode
          ? { confirmedHsCode: shipment.customs.confirmedHsCode, confirmedAt: shipment.customs.confirmedAt }
          : {}),
      },
    });
    if (!args.error && args.suggestions.length > 0) {
      await recordTrackingEvent(ctx, {
        orgId: args.orgId,
        shipmentId: args.shipmentId,
        eventType: "custom",
        description: `Praxio suggère le code SH ${args.suggestions[0].code}${
          args.suggestions[0].confidence !== undefined ? ` (confiance ${Math.round(args.suggestions[0].confidence * 100)}%)` : ""
        }`,
        source: "auto",
      });
    }
    return null;
  },
});

function parseSuggestion(body: unknown): { id?: string; suggestions: Array<typeof suggestionFields.type> } {
  if (typeof body !== "object" || body === null) return { suggestions: [] };
  const b = body as Record<string, unknown>;
  const suggestions: Array<typeof suggestionFields.type> = [];
  for (const i of [1, 2, 3]) {
    const code = b[`suggestedCode${i}`];
    if (typeof code !== "string" || !code) continue;
    const description = b[`suggestedDescription${i}`];
    const confidence = b[`confidence${i}`];
    suggestions.push({
      code,
      ...(typeof description === "string" && description ? { description } : {}),
      ...(typeof confidence === "number" ? { confidence } : {}),
    });
  }
  return { ...(typeof b.id === "string" ? { id: b.id } : {}), suggestions };
}

/** Demande à Praxio une classification SH de la marchandise de l'expédition. */
export const classify = action({
  args: { shipmentId: v.id("shipments") },
  returns: v.null(),
  handler: async (ctx, { shipmentId }): Promise<null> => {
    const c = await ctx.runQuery(internal.praxio.getCallContext, { shipmentId });
    if (!c) throw new Error("Intégration Praxio non configurée ou expédition introuvable");
    if (!c.canAct) throw new Error("Permissions insuffisantes");
    if (!c.goodsDescription) throw new Error("Décrivez d'abord la marchandise (Modifier l'expédition)");
    const now = Date.now();
    let result: { suggestions: Array<typeof suggestionFields.type>; praxioSuggestionId?: string; error?: string };
    try {
      const res = await call(c.baseUrl, c.apiKey, "/hs-suggestions/suggest", "POST", {
        productDescription: c.goodsDescription,
      });
      if (res.status !== 200) {
        result = { suggestions: [], error: errorText(res) };
      } else {
        const parsed = parseSuggestion(res.body);
        result = {
          suggestions: parsed.suggestions,
          ...(parsed.id ? { praxioSuggestionId: parsed.id } : {}),
          ...(parsed.suggestions.length === 0 ? { error: "Praxio n'a proposé aucun code pour cette description" } : {}),
        };
      }
    } catch (err) {
      result = {
        suggestions: [],
        error: err instanceof Error && err.name === "AbortError" ? "Praxio injoignable (délai dépassé)" : err instanceof Error ? err.message : "Erreur inconnue",
      };
    }
    await ctx.runMutation(internal.praxio.recordClassification, { orgId: c.orgId, shipmentId, now, ...result });
    return null;
  },
});

/**
 * Confirme le code SH (choisi parmi les suggestions ou saisi) : clôt
 * l'incident douane préventif et renvoie le choix à Praxio, qui apprend de
 * l'historique confirmé de la société.
 */
export const confirmHsCode = mutation({
  args: { shipmentId: v.id("shipments"), code: v.string() },
  returns: v.null(),
  handler: async (ctx, { shipmentId, code }) => {
    const scope = requireRole(await getOrgScope(ctx), "operator");
    const shipment = await requireOwned(ctx, "shipments", shipmentId, scope.orgId);
    const clean = code.replace(/[\s.]/g, "");
    if (!isValidHsCode(clean)) throw new Error("Code SH invalide (6 à 10 chiffres)");
    const now = Date.now();
    await ctx.db.patch("shipments", shipmentId, {
      customs: {
        suggestions: shipment.customs?.suggestions ?? [],
        checkedAt: shipment.customs?.checkedAt ?? now,
        confirmedHsCode: clean,
        confirmedAt: now,
        ...(shipment.customs?.praxioSuggestionId ? { praxioSuggestionId: shipment.customs.praxioSuggestionId } : {}),
      },
    });
    await recordTrackingEvent(ctx, {
      orgId: scope.orgId,
      shipmentId,
      eventType: "custom",
      description: `Code SH ${clean} confirmé`,
    });
    await resolveCustomsIncidents(ctx, scope.orgId, shipmentId, now);
    if (shipment.customs?.praxioSuggestionId) {
      await ctx.scheduler.runAfter(0, internal.praxio.sendConfirmation, {
        orgId: scope.orgId,
        praxioSuggestionId: shipment.customs.praxioSuggestionId,
        code: clean,
      });
    }
    return null;
  },
});

async function resolveCustomsIncidents(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  shipmentId: Id<"shipments">,
  now: number,
) {
  for (const incidentStatus of ["open", "investigating"] as const) {
    const rows = await ctx.db
      .query("incidents")
      .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", incidentStatus))
      .collect();
    for (const inc of rows) {
      if (inc.shipmentId === shipmentId && inc.type === "customs" && inc.source === "auto") {
        await ctx.db.patch("incidents", inc._id, { status: "resolved", resolvedAt: now });
      }
    }
  }
}

export const getConfigForOrg = internalQuery({
  args: { orgId: v.id("organizations") },
  returns: v.union(v.null(), v.object({ baseUrl: v.string(), apiKey: v.string() })),
  handler: async (ctx, { orgId }) => {
    const cfg = await ctx.db.query("praxioIntegrations").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return cfg?.enabled ? { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey } : null;
  },
});

export const recordCallResult = internalMutation({
  args: { orgId: v.id("organizations"), now: v.number(), error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cfg = await ctx.db.query("praxioIntegrations").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).first();
    if (cfg) await ctx.db.patch("praxioIntegrations", cfg._id, { lastCallAt: args.now, lastError: args.error });
    return null;
  },
});

/** Renvoi best-effort de la confirmation à Praxio (apprentissage), jamais bloquant. */
export const sendConfirmation = internalAction({
  args: { orgId: v.id("organizations"), praxioSuggestionId: v.string(), code: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cfg = await ctx.runQuery(internal.praxio.getConfigForOrg, { orgId: args.orgId });
    if (!cfg) return null;
    let error: string | undefined;
    try {
      const res = await call(cfg.baseUrl, cfg.apiKey, `/hs-suggestions/${encodeURIComponent(args.praxioSuggestionId)}/confirm`, "PUT", {
        selectedCode: args.code,
      });
      if (res.status < 200 || res.status >= 300) error = errorText(res);
    } catch (err) {
      error = err instanceof Error ? err.message : "Erreur inconnue";
    }
    await ctx.runMutation(internal.praxio.recordCallResult, {
      orgId: args.orgId,
      now: Date.now(),
      ...(error !== undefined ? { error } : {}),
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Détection préventive (cron)
// ---------------------------------------------------------------------------

/**
 * Envoi hors UE, pas encore livré, sans code SH confirmé → incident
 * « douane » automatique (medium avant départ, high une fois en route).
 * Clôturé automatiquement à la confirmation du code (confirmHsCode).
 */
export const detectCustomsRiskForOrg = internalMutation({
  args: { orgId: v.id("organizations"), now: v.number() },
  returns: v.object({ created: v.number(), escalated: v.number() }),
  handler: async (ctx, { orgId, now }) => {
    const open: Array<Doc<"incidents">> = [];
    for (const incidentStatus of ["open", "investigating"] as const) {
      open.push(
        ...(await ctx.db
          .query("incidents")
          .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", incidentStatus))
          .collect()),
      );
    }
    const byShipment = new Map<Id<"shipments">, Doc<"incidents">>();
    for (const inc of open) if (inc.type === "customs" && inc.shipmentId) byShipment.set(inc.shipmentId, inc);

    let created = 0;
    let escalated = 0;
    for (const shipmentStatus of ["pending", "loading", "in_transit", "delayed"] as const) {
      const rows = await ctx.db
        .query("shipments")
        .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", shipmentStatus))
        .collect();
      for (const s of rows) {
        if (s.customs?.confirmedHsCode) continue;
        if ((await regimeOf(ctx, s)) !== "extra_eu") continue;
        const severity = shipmentStatus === "in_transit" || shipmentStatus === "delayed" ? "high" : "medium";
        const existing = byShipment.get(s._id);
        if (existing) {
          if (existing.source === "auto" && existing.severity === "medium" && severity === "high") {
            await ctx.db.patch("incidents", existing._id, { severity });
            escalated += 1;
          }
          continue;
        }
        await ctx.db.insert("incidents", {
          orgId,
          shipmentId: s._id,
          type: "customs",
          severity,
          title: "Douane à préparer",
          description: `${s.reference} franchit une frontière douanière sans code SH confirmé`,
          status: "open",
          source: "auto",
          createdAt: now,
        });
        created += 1;
      }
    }
    return { created, escalated };
  },
});
