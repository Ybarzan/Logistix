import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getOrgScope, requireOwned, requireRole } from "./orgContext";
import { recordTrackingEvent } from "./tracking";

/**
 * Lien de suivi public pour le client final : sans compte, révocable,
 * n'exposant que ce qu'un destinataire a besoin de savoir. Jamais : le
 * nom du transporteur, les incidents internes, la position exacte du
 * camion (arrondie à ~1 km), ni l'identité de l'organisation au-delà
 * de son nom commercial.
 */

const PUBLIC_EVENT_TYPES = new Set(["created", "processed", "in_transit", "delayed", "delivered", "cancelled"]);

export const createLink = mutation({
  args: { shipmentId: v.id("shipments") },
  returns: v.string(),
  handler: async (ctx, { shipmentId }) => {
    const scope = requireRole(await getOrgScope(ctx), "operator");
    const shipment = await requireOwned(ctx, "shipments", shipmentId, scope.orgId);
    if (shipment.trackingToken) return shipment.trackingToken;
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    await ctx.db.patch("shipments", shipmentId, { trackingToken: token });
    await recordTrackingEvent(ctx, {
      orgId: scope.orgId,
      shipmentId,
      eventType: "custom",
      description: "Lien de suivi client généré",
    });
    return token;
  },
});

export const revokeLink = mutation({
  args: { shipmentId: v.id("shipments") },
  returns: v.null(),
  handler: async (ctx, { shipmentId }) => {
    const scope = requireRole(await getOrgScope(ctx), "operator");
    await requireOwned(ctx, "shipments", shipmentId, scope.orgId);
    await ctx.db.patch("shipments", shipmentId, { trackingToken: undefined });
    return null;
  },
});

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Vue publique (sans authentification) d'une expédition via son jeton. */
export const get = query({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      reference: v.string(),
      organizationName: v.string(),
      status: v.string(),
      fromCity: v.string(),
      toCity: v.string(),
      estimatedDelivery: v.optional(v.number()),
      actualDelivery: v.optional(v.number()),
      predictedArrival: v.optional(v.object({ eta: v.number(), low: v.number(), high: v.number() })),
      approxPosition: v.optional(v.object({ lat: v.number(), lng: v.number(), recordedAt: v.number() })),
      events: v.array(v.object({ at: v.number(), description: v.string(), eventType: v.string() })),
    }),
  ),
  handler: async (ctx, { token }) => {
    if (token.length < 32) return null;
    const shipment = await ctx.db
      .query("shipments")
      .withIndex("by_tracking_token", (q) => q.eq("trackingToken", token))
      .first();
    if (!shipment?.orgId) return null;
    const orgId = shipment.orgId;
    const [from, to, org] = await Promise.all([
      ctx.db.get("hubs", shipment.fromHubId),
      ctx.db.get("hubs", shipment.toHubId),
      ctx.db.get("organizations", orgId),
    ]);
    const events = await ctx.db
      .query("trackingEvents")
      .withIndex("by_org_and_shipment", (q) => q.eq("orgId", orgId).eq("shipmentId", shipment._id))
      .order("desc")
      .take(50);
    const live = shipment.status === "in_transit" || shipment.status === "delayed" || shipment.status === "loading";
    return {
      reference: shipment.reference,
      organizationName: org?.name ?? "",
      status: shipment.status,
      fromCity: from?.city ?? "",
      toCity: to?.city ?? "",
      ...(shipment.estimatedDelivery !== undefined ? { estimatedDelivery: shipment.estimatedDelivery } : {}),
      ...(shipment.actualDelivery !== undefined ? { actualDelivery: shipment.actualDelivery } : {}),
      ...(live && shipment.prediction
        ? { predictedArrival: { eta: shipment.prediction.eta, low: shipment.prediction.low, high: shipment.prediction.high } }
        : {}),
      ...(live && shipment.lastPosition
        ? {
            approxPosition: {
              lat: round2(shipment.lastPosition.lat),
              lng: round2(shipment.lastPosition.lng),
              recordedAt: shipment.lastPosition.recordedAt,
            },
          }
        : {}),
      events: events
        .filter((e) => PUBLIC_EVENT_TYPES.has(e.eventType))
        .map((e) => ({ at: e._creationTime, description: e.description, eventType: e.eventType })),
    };
  },
});
