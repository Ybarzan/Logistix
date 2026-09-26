import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { applyStatusChange } from "./shipments";
import { canTransition } from "./shipmentStatus";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

const HOUR_MS = 60 * 60 * 1000;

/** Seuil de surcharge d'un hub (charge / capacité). */
export const OVERLOAD_RATIO = 0.9;

type Severity = "low" | "medium" | "high" | "critical";

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/**
 * Sévérité d'un incident de retard selon la durée de dépassement :
 * < 12h → low, 12-24h → medium, 24-48h → high, > 48h → critical.
 */
export function severityForDelay(overrunMs: number): Severity {
  if (overrunMs < 12 * HOUR_MS) return "low";
  if (overrunMs < 24 * HOUR_MS) return "medium";
  if (overrunMs < 48 * HOUR_MS) return "high";
  return "critical";
}

/**
 * Formate un dépassement en durée lisible, ex. 5h30, 1j 2h, 45min.
 */
export function formatOverrun(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}j ${hours}h`;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}`;
  return `${minutes}min`;
}

export const listOrganizationIds = internalQuery({
  args: {},
  returns: v.array(v.id("organizations")),
  handler: async (ctx) => {
    const orgs = await ctx.db.query("organizations").collect();
    return orgs.map((o) => o._id);
  },
});

async function openIncidents(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
): Promise<Array<Doc<"incidents">>> {
  const result: Array<Doc<"incidents">> = [];
  for (const status of ["open", "investigating"] as const) {
    const rows = await ctx.db
      .query("incidents")
      .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", status))
      .collect();
    result.push(...rows);
  }
  return result;
}

/**
 * Détection des retards pour une organisation, en une transaction :
 * - expédition active dont l'ETA est dépassée sans incident ouvert
 *   → incident "delay" automatique + passage au statut `delayed`
 *   quand la machine à états le permet ;
 * - incident automatique déjà ouvert → sévérité escaladée si le
 *   dépassement a franchi un seuil (jamais rétrogradée).
 */
export const detectDelaysForOrg = internalMutation({
  args: { orgId: v.id("organizations"), now: v.number() },
  returns: v.object({ created: v.number(), escalated: v.number() }),
  handler: async (ctx, { orgId, now }) => {
    const incidents = await openIncidents(ctx, orgId);
    const delayIncidentByShipment = new Map<Id<"shipments">, Doc<"incidents">>();
    for (const inc of incidents) {
      if (inc.type === "delay" && inc.shipmentId !== undefined) {
        delayIncidentByShipment.set(inc.shipmentId, inc);
      }
    }

    let created = 0;
    let escalated = 0;
    for (const status of ["pending", "loading", "in_transit", "delayed"] as const) {
      const shipments = await ctx.db
        .query("shipments")
        .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", status))
        .collect();
      for (const shipment of shipments) {
        if (shipment.estimatedDelivery === undefined || shipment.estimatedDelivery >= now) {
          continue;
        }
        const overrunMs = now - shipment.estimatedDelivery;
        const severity = severityForDelay(overrunMs);
        const description = `${shipment.reference} : retard de ${formatOverrun(overrunMs)} par rapport à la livraison estimée`;
        const existing = delayIncidentByShipment.get(shipment._id);

        if (existing) {
          // On n'escalade que nos propres incidents : un incident saisi
          // par un humain garde la sévérité qu'il lui a donnée.
          if (
            existing.source === "auto" &&
            SEVERITY_RANK[severity] > SEVERITY_RANK[existing.severity]
          ) {
            await ctx.db.patch("incidents", existing._id, { severity, description });
            escalated += 1;
          }
          continue;
        }

        const incidentId = await ctx.db.insert("incidents", {
          orgId,
          shipmentId: shipment._id,
          type: "delay",
          severity,
          title: "Retard détecté automatiquement",
          description,
          status: "open",
          source: "auto",
          createdAt: now,
        });
        // L'expédition passe en `delayed` juste après : elle sera relue
        // par l'itération "delayed" de cette même boucle, il faut donc
        // qu'elle soit déjà considérée comme couverte.
        const inserted = await ctx.db.get("incidents", incidentId);
        if (inserted) delayIncidentByShipment.set(shipment._id, inserted);
        created += 1;
        if (canTransition(shipment.status, "delayed")) {
          await applyStatusChange(
            ctx,
            shipment,
            "delayed",
            `Retard détecté automatiquement (${formatOverrun(overrunMs)})`,
          );
        }
      }
    }
    return { created, escalated };
  },
});

/**
 * Surcharge des hubs pour une organisation : ouvre un incident
 * "capacity" au-delà de 90 % et clôture l'incident automatique
 * correspondant quand la charge redescend (ou que le hub est désactivé).
 */
export const detectHubOverloadForOrg = internalMutation({
  args: { orgId: v.id("organizations"), now: v.number() },
  returns: v.object({ created: v.number(), resolved: v.number() }),
  handler: async (ctx, { orgId, now }) => {
    const incidents = await openIncidents(ctx, orgId);
    const capacityIncidentByHub = new Map<Id<"hubs">, Doc<"incidents">>();
    for (const inc of incidents) {
      if (inc.type === "capacity" && inc.hubId !== undefined) {
        capacityIncidentByHub.set(inc.hubId, inc);
      }
    }

    const hubs = await ctx.db
      .query("hubs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    let created = 0;
    let resolved = 0;
    for (const hub of hubs) {
      const ratio = hub.capacity > 0 ? hub.currentLoad / hub.capacity : 0;
      const overloaded = hub.isActive && ratio > OVERLOAD_RATIO;
      const existing = capacityIncidentByHub.get(hub._id);

      if (overloaded && !existing) {
        await ctx.db.insert("incidents", {
          orgId,
          hubId: hub._id,
          type: "capacity",
          severity: ratio >= 1 ? "high" : "medium",
          title: `Surcharge détectée : ${hub.name}`,
          description: `Capacité à ${Math.round(ratio * 100)}% — redirection recommandée`,
          status: "open",
          source: "auto",
          createdAt: now,
        });
        created += 1;
      } else if (!overloaded && existing?.source === "auto") {
        await ctx.db.patch("incidents", existing._id, { status: "resolved", resolvedAt: now });
        resolved += 1;
      }
    }
    return { created, resolved };
  },
});

/**
 * Point d'entrée du cron : une transaction par organisation et par
 * détecteur, pour qu'une organisation volumineuse ne bloque pas les autres.
 */
export const runAutomation = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const orgIds: Array<Id<"organizations">> = await ctx.runQuery(
      internal.automation.listOrganizationIds,
      {},
    );
    for (const orgId of orgIds) {
      await ctx.runMutation(internal.automation.detectDelaysForOrg, { orgId, now });
      await ctx.runMutation(internal.automation.detectHubOverloadForOrg, { orgId, now });
    }
    return null;
  },
});
