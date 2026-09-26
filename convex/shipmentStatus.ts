/**
 * Machine à états des expéditions. Module pur (sans dépendance Convex
 * runtime) : partagé entre les mutations serveur et l'UI, pour que les
 * boutons proposés soient exactement les transitions acceptées.
 */
export type ShipmentStatus =
  | "pending"
  | "loading"
  | "in_transit"
  | "delivered"
  | "delayed"
  | "cancelled";

export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ReadonlyArray<ShipmentStatus>> = {
  pending: ["loading", "in_transit", "cancelled"],
  loading: ["in_transit", "delayed", "cancelled"],
  in_transit: ["delivered", "delayed", "cancelled"],
  delayed: ["in_transit", "delivered", "cancelled"],
  // États terminaux : une expédition livrée ou annulée ne bouge plus.
  delivered: [],
  cancelled: [],
};

export function canTransition(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return SHIPMENT_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ShipmentStatus): boolean {
  return SHIPMENT_TRANSITIONS[status].length === 0;
}

/**
 * Référence lisible et unique par organisation : EX-2026-000042.
 * La séquence vient d'un compteur stocké sur l'organisation (les
 * mutations Convex sont sérialisables, donc pas de collision).
 */
export function formatShipmentReference(seq: number, now: number): string {
  const year = new Date(now).getUTCFullYear();
  return `EX-${year}-${String(seq).padStart(6, "0")}`;
}
