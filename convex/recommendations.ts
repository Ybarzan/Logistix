import { v } from "convex/values";
import { query } from "./_generated/server";
import { getOrgScope } from "./orgContext";
import type { Doc } from "./_generated/dataModel";

/**
 * « Que faire maintenant ? » — pour chaque incident ouvert, les actions
 * concrètes disponibles compte tenu de l'état réel (camion affecté ou non,
 * intégrations actives, charge déjà publiée…). Règles déterministes et
 * explicables : chaque action porte sa raison, rien n'est exécuté seul.
 */

export const actionKind = v.union(
  v.literal("assign_truck"),
  v.literal("publish_fleetmarket"),
  v.literal("review_proposals"),
  v.literal("track_carrier"),
  v.literal("share_tracking"),
  v.literal("hub_backlog"),
  v.literal("open_shipment"),
);

const SEVERITY_RANK: Record<Doc<"incidents">["severity"], number> = {
  critical: 3, high: 2, medium: 1, low: 0,
};
const PRIORITY_RANK: Record<Doc<"shipments">["priority"], number> = {
  urgent: 3, high: 2, normal: 1, low: 0,
};

export const openActions = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      incidentId: v.id("incidents"),
      severity: v.string(),
      title: v.string(),
      description: v.string(),
      shipmentId: v.optional(v.id("shipments")),
      shipmentRef: v.optional(v.string()),
      hubId: v.optional(v.id("hubs")),
      actions: v.array(v.object({ kind: actionKind, label: v.string(), reason: v.string() })),
    }),
  ),
  handler: async (ctx, args) => {
    const scope = await getOrgScope(ctx);
    if (!scope) return [];
    const orgId = scope.orgId;

    const incidents: Array<Doc<"incidents">> = [];
    for (const status of ["open", "investigating"] as const) {
      incidents.push(
        ...(await ctx.db
          .query("incidents")
          .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", status))
          .collect()),
      );
    }
    const fleetmarketOn = Boolean(
      (await ctx.db.query("fleetmarketIntegrations").withIndex("by_org", (q) => q.eq("orgId", orgId)).first())?.enabled,
    );

    const items = [];
    for (const inc of incidents) {
      const actions: Array<{ kind: typeof actionKind.type; label: string; reason: string }> = [];
      let shipment: Doc<"shipments"> | null = null;
      if (inc.shipmentId) {
        shipment = await ctx.db.get("shipments", inc.shipmentId);
        if (shipment && shipment.orgId !== orgId) shipment = null;
      }

      if (shipment && shipment.status !== "delivered" && shipment.status !== "cancelled") {
        const fm = shipment.fleetmarket;
        const fmLive = fm && (fm.status === "OPEN" || fm.status === "MATCHED");
        if (fm?.status === "OPEN" && fm.proposalCount > 0) {
          actions.push({
            kind: "review_proposals",
            label: `Choisir un transporteur (${fm.proposalCount} proposition${fm.proposalCount > 1 ? "s" : ""})`,
            reason: "Des transporteurs vérifiés ont répondu sur FleetMarket.",
          });
        } else if (fm?.status === "MATCHED") {
          actions.push({
            kind: "track_carrier",
            label: `Suivre ${fm.carrierName ?? "le transporteur"}`,
            reason: "Transporteur retenu : position GPS remontée automatiquement.",
          });
        }
        if (!shipment.truckRegistration && !fmLive) {
          actions.push({
            kind: "assign_truck",
            label: "Affecter un camion",
            reason: "Aucun camion affecté : pas de suivi GPS possible.",
          });
        }
        const urgent =
          SEVERITY_RANK[inc.severity] >= SEVERITY_RANK.high || PRIORITY_RANK[shipment.priority] >= PRIORITY_RANK.high;
        if (fleetmarketOn && !fmLive && (inc.type === "delay" || inc.type === "breakdown") && urgent) {
          actions.push({
            kind: "publish_fleetmarket",
            label: "Trouver un transporteur de secours",
            reason: "Publier la charge sur FleetMarket (transporteurs à conformité vérifiée).",
          });
        }
        if (inc.type === "delay") {
          actions.push({
            kind: "share_tracking",
            label: "Prévenir le client",
            reason: "Partager le lien de suivi en direct plutôt que subir l'appel du client.",
          });
        }
        actions.push({ kind: "open_shipment", label: "Ouvrir l'expédition", reason: "" });
      }

      if (inc.type === "capacity" && inc.hubId) {
        actions.push({
          kind: "hub_backlog",
          label: "Voir les départs en attente",
          reason: "Réaffecter ou externaliser une partie des expéditions de ce hub.",
        });
      }

      items.push({
        incidentId: inc._id,
        severity: inc.severity,
        title: inc.title,
        description: inc.description,
        actions,
        ...(shipment ? { shipmentId: shipment._id, shipmentRef: shipment.reference } : {}),
        ...(inc.hubId ? { hubId: inc.hubId } : {}),
        _rank: SEVERITY_RANK[inc.severity] * 10 + (shipment ? PRIORITY_RANK[shipment.priority] : 0),
        _createdAt: inc.createdAt,
      });
    }

    return items
      .sort((a, b) => b._rank - a._rank || b._createdAt - a._createdAt)
      .slice(0, Math.min(args.limit ?? 20, 100))
      .map(({ _rank, _createdAt, ...rest }) => rest);
  },
});
