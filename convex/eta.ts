import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { formatOverrun, severityForDelay } from "./automation";
import {
  PREDICTED_DELAY_THRESHOLD_MS,
  median,
  predictEta,
  predictedOverrunMs,
} from "./etaModel";
import { openIncident, resolveIncident } from "./webhooks";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * ETA prédictive branchée sur les données : lit la position, les vitesses
 * récentes et l'historique de l'itinéraire, stocke la prédiction sur
 * l'expédition, et gère l'incident « retard prévu » :
 *  - ouvert quand l'arrivée prédite dépasse l'engagement de plus de 30 min
 *    alors qu'il n'est pas encore dépassé (on prévient AVANT) ;
 *  - clos automatiquement si la prédiction revient dans les temps ;
 *  - repris par le détecteur de retards classique une fois l'engagement passé.
 */

const PREDICTED_STATUSES = ["loading", "in_transit", "delayed"] as const;
const HISTORY_WINDOW_MS = 90 * 24 * 3600 * 1000;
const RECENT_SPEED_WINDOW_MS = 60 * 60 * 1000;

const clockFr = (t: number) =>
  new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

async function routeHistory(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  route: Doc<"routes">,
  now: number,
): Promise<{ ratio: number; samples: number } | undefined> {
  const delivered = await ctx.db
    .query("shipments")
    .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", "delivered"))
    .order("desc")
    .take(300);
  const ratios: Array<number> = [];
  for (const s of delivered) {
    if (s.routeId !== route._id || s.actualDelivery === undefined || s.actualDelivery < now - HISTORY_WINDOW_MS) continue;
    // Durée de ROULAGE (départ constaté → livraison), pas depuis la création :
    // l'attente à quai n'a rien à voir avec la durée du trajet.
    const departed = await departureTime(ctx, s);
    if (departed === undefined || departed >= s.actualDelivery) continue;
    const ratio = (s.actualDelivery - departed) / (route.avgDuration * 60_000);
    // Écarte les valeurs aberrantes (saisie tardive du statut, test…).
    if (ratio >= 0.5 && ratio <= 4) ratios.push(ratio);
  }
  const ratio = median(ratios);
  return ratio === null ? undefined : { ratio, samples: ratios.length };
}

async function departureTime(ctx: MutationCtx, shipment: Doc<"shipments">): Promise<number | undefined> {
  if (!shipment.orgId) return undefined;
  const orgId = shipment.orgId;
  const events = await ctx.db
    .query("trackingEvents")
    .withIndex("by_org_and_shipment", (q) => q.eq("orgId", orgId).eq("shipmentId", shipment._id))
    .collect();
  const departed = events.filter((e) => e.eventType === "in_transit").map((e) => e._creationTime);
  return departed.length > 0 ? Math.min(...departed) : undefined;
}

/** Recalcule la prédiction d'une expédition et gère l'incident prédictif. */
export async function refreshPrediction(ctx: MutationCtx, shipmentId: Id<"shipments">, now: number): Promise<void> {
  const shipment = await ctx.db.get("shipments", shipmentId);
  if (!shipment?.orgId) return;
  const orgId = shipment.orgId;
  if (!(PREDICTED_STATUSES as ReadonlyArray<string>).includes(shipment.status)) {
    if (shipment.prediction) await ctx.db.patch("shipments", shipmentId, { prediction: undefined });
    return;
  }
  const toHub = await ctx.db.get("hubs", shipment.toHubId);
  if (!toHub) return;
  const route = shipment.routeId ? await ctx.db.get("routes", shipment.routeId) : null;

  const pings = await ctx.db
    .query("positionPings")
    .withIndex("by_shipment_and_time", (q) => q.eq("shipmentId", shipmentId).gte("recordedAt", now - RECENT_SPEED_WINDOW_MS))
    .collect();
  const history = route ? await routeHistory(ctx, orgId, route, now) : undefined;
  const departedAt = shipment.status === "loading" ? undefined : await departureTime(ctx, shipment);

  const prediction = predictEta({
    now,
    destination: { lat: toHub.lat, lng: toHub.lng },
    recentSpeedsKph: pings.map((p) => p.speedKph).filter((x): x is number => x !== undefined),
    ...(shipment.lastPosition ? { position: shipment.lastPosition } : {}),
    ...(route ? { route: { distanceKm: route.distance, avgDurationMin: route.avgDuration } } : {}),
    ...(history ? { history } : {}),
    ...(departedAt !== undefined ? { departedAt } : {}),
  });
  if (!prediction) return;
  await ctx.db.patch("shipments", shipmentId, { prediction: { ...prediction, computedAt: now } });

  // --- Incident « retard prévu » -------------------------------------------
  const committed = shipment.estimatedDelivery;
  if (committed === undefined || committed <= now) return; // déjà en retard : détecteur classique
  const overrun = predictedOverrunMs(prediction, committed);

  const open: Array<Doc<"incidents">> = [];
  for (const status of ["open", "investigating"] as const) {
    const rows = await ctx.db
      .query("incidents")
      .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", status))
      .collect();
    open.push(...rows.filter((i) => i.shipmentId === shipmentId && i.type === "delay"));
  }
  const predictedIncident = open.find((i) => i.predicted === true && i.source === "auto");
  const description = `${shipment.reference} : arrivée prédite ${clockFr(prediction.eta)} au lieu de ${clockFr(committed)} (+${formatOverrun(Math.max(0, overrun))}) — ${prediction.explanation}`;

  if (overrun >= PREDICTED_DELAY_THRESHOLD_MS) {
    const severity = severityForDelay(overrun);
    if (predictedIncident) {
      await ctx.db.patch("incidents", predictedIncident._id, { severity, description });
    } else if (open.length === 0) {
      await openIncident(ctx, {
        orgId,
        shipmentId,
        type: "delay",
        severity,
        title: "Retard prévu",
        description,
        status: "open",
        source: "auto",
        predicted: true,
        createdAt: now,
      });
    }
  } else if (predictedIncident && overrun < PREDICTED_DELAY_THRESHOLD_MS / 2) {
    // Hystérésis (ouverture à +30 min, fermeture sous +15 min) : pas d'alerte qui clignote.
    // Rattrapé : on referme, avec la raison, pour garder la trace.
    await resolveIncident(ctx, predictedIncident, now, {
      description: `${predictedIncident.description} → rattrapé (arrivée prédite ${clockFr(prediction.eta)})`,
    });
  }
}

/** Cron : recalcule toutes les expéditions suivies d'une organisation. */
export const predictForOrg = internalMutation({
  args: { orgId: v.id("organizations"), now: v.number() },
  returns: v.number(),
  handler: async (ctx, { orgId, now }) => {
    let count = 0;
    for (const status of PREDICTED_STATUSES) {
      const rows = await ctx.db
        .query("shipments")
        .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", status))
        .collect();
      for (const s of rows) {
        await refreshPrediction(ctx, s._id, now);
        count += 1;
      }
    }
    return count;
  },
});

export const refreshOne = internalMutation({
  args: { shipmentId: v.id("shipments") },
  returns: v.null(),
  handler: async (ctx, { shipmentId }) => {
    await refreshPrediction(ctx, shipmentId, Date.now());
    return null;
  },
});
