import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export const roleSchema = v.union(
  v.literal("admin"),
  v.literal("manager"),
  v.literal("operator"),
  v.literal("viewer"),
);

export const positionSchema = v.object({
  lat: v.number(),
  lng: v.number(),
  speedKph: v.optional(v.number()),
  // Horodatage de la mesure côté télématique (pas de la synchro).
  recordedAt: v.number(),
});

export const fleetmarketLinkSchema = v.object({
  loadId: v.number(),
  // Statut de la charge côté FleetMarket (OPEN, MATCHED, CANCELLED, DONE).
  status: v.string(),
  proposalCount: v.number(),
  postedAt: v.number(),
  acceptedProposalId: v.optional(v.number()),
  carrierName: v.optional(v.string()),
  carrierComplianceScore: v.optional(v.number()),
  // Identifiant stable du transporteur côté FleetMarket (pour son historique chez nous).
  carrierId: v.optional(v.number()),
});

export const customsSchema = v.object({
  suggestions: v.array(
    v.object({ code: v.string(), description: v.optional(v.string()), confidence: v.optional(v.number()) }),
  ),
  // Identifiant de la suggestion côté Praxio (pour lui renvoyer la confirmation).
  praxioSuggestionId: v.optional(v.string()),
  checkedAt: v.number(),
  confirmedHsCode: v.optional(v.string()),
  confirmedAt: v.optional(v.number()),
  error: v.optional(v.string()),
});

export const predictionSchema = v.object({
  eta: v.number(),
  low: v.number(),
  high: v.number(),
  method: v.union(v.literal("gps"), v.literal("route_history"), v.literal("route_plan")),
  explanation: v.string(),
  computedAt: v.number(),
});

export const eventSourceSchema = v.union(
  v.literal("manual"),
  v.literal("auto"),
  v.literal("gps"),
  v.literal("api"),
);

export const webhookEventType = v.union(
  v.literal("shipment.created"),
  v.literal("shipment.status_changed"),
  v.literal("incident.opened"),
  v.literal("incident.resolved"),
);

export default defineSchema({
  // Tables requises par @convex-dev/auth. La table `users` est redéfinie
  // pour ajouter les champs métier (role, orgId) tout en conservant les
  // index "email"/"phone" exigés par la bibliothèque.
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    role: v.optional(roleSchema),
    orgId: v.optional(v.id("organizations")),
    // Jeton d'invitation transmis à l'inscription ; consommé puis
    // effacé par `afterUserCreatedOrUpdated` (jamais conservé).
    inviteToken: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_org", ["orgId"]),

  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    // Compteur de références d'expédition (EX-AAAA-000001), par org.
    shipmentSeq: v.optional(v.number()),
    // Facteur d'émission route (kg CO2e par tonne·km) ; défaut dans co2.ts.
    co2FactorKgPerTkm: v.optional(v.number()),
  }).index("by_slug", ["slug"]),

  invitations: defineTable({
    orgId: v.id("organizations"),
    email: v.string(),
    role: roleSchema,
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked")),
    // Secret du lien d'invitation : l'e-mail seul ne suffit pas (pas de
    // vérification d'e-mail avec le provider Password).
    token: v.string(),
    invitedBy: v.id("users"),
    createdAt: v.number(),
    acceptedAt: v.optional(v.number()),
  }).index("by_email_and_status", ["email", "status"])
    .index("by_token", ["token"])
    .index("by_org_and_status", ["orgId", "status"]),

  hubs: defineTable({
    name: v.string(),
    code: v.string(),
    city: v.string(),
    country: v.string(),
    capacity: v.number(),
    currentLoad: v.number(),
    lat: v.number(),
    lng: v.number(),
    isActive: v.boolean(),
    orgId: v.optional(v.id("organizations")),
  }).index("by_code", ["code"])
    .index("by_country", ["country"])
    .index("by_org", ["orgId"]),

  routes: defineTable({
    name: v.string(),
    fromHubId: v.id("hubs"),
    toHubId: v.id("hubs"),
    distance: v.number(),
    avgDuration: v.number(),
    isActive: v.boolean(),
    orgId: v.optional(v.id("organizations")),
  }).index("by_from_hub", ["fromHubId"])
    .index("by_to_hub", ["toHubId"])
    .index("by_org", ["orgId"]),

  shipments: defineTable({
    reference: v.string(),
    fromHubId: v.id("hubs"),
    toHubId: v.id("hubs"),
    routeId: v.optional(v.id("routes")),
    status: v.union(
      v.literal("pending"),
      v.literal("loading"),
      v.literal("in_transit"),
      v.literal("delivered"),
      v.literal("delayed"),
      v.literal("cancelled")
    ),
    weight: v.number(),
    priority: v.union(v.literal("low"), v.literal("normal"), v.literal("high"), v.literal("urgent")),
    customerName: v.string(),
    customerRef: v.optional(v.string()),
    estimatedDelivery: v.optional(v.number()),
    actualDelivery: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    // Camion affecté (immatriculation fleet-hub) et dernière position GPS
    // connue, alimentée automatiquement par la synchronisation fleet-hub.
    truckRegistration: v.optional(v.string()),
    lastPosition: v.optional(positionSchema),
    // Charge publiée sur FleetMarket (capacité de secours) et son suivi.
    fleetmarket: v.optional(fleetmarketLinkSchema),
    // Secret du lien de suivi public destiné au client final (/suivi/<token>).
    trackingToken: v.optional(v.string()),
    // Marchandise (pour la douane) et pré-contrôle douane via Praxio.
    goodsDescription: v.optional(v.string()),
    declaredValueEur: v.optional(v.number()),
    customs: v.optional(customsSchema),
    // ETA prédictive (voir etaModel.ts), recalculée à chaque position GPS et par le cron.
    prediction: v.optional(predictionSchema),
    // Texte indexé pour la recherche (référence, client, référence client).
    searchText: v.optional(v.string()),
    orgId: v.optional(v.id("organizations")),
  }).index("by_reference", ["reference"])
    .index("by_org_and_weight", ["orgId", "weight"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["orgId", "status", "priority"] })
    .index("by_tracking_token", ["trackingToken"])
    .index("by_status", ["status"])
    .index("by_from_hub", ["fromHubId"])
    .index("by_to_hub", ["toHubId"])
    .index("by_created_at", ["createdAt"])
    .index("by_org", ["orgId"])
    .index("by_org_and_status", ["orgId", "status"])
    .index("by_org_and_reference", ["orgId", "reference"])
    .index("by_org_and_created_at", ["orgId", "createdAt"]),

  trackingEvents: defineTable({
    shipmentId: v.id("shipments"),
    eventType: v.union(
      v.literal("created"),
      v.literal("processed"),
      v.literal("in_transit"),
      v.literal("delayed"),
      v.literal("delivered"),
      v.literal("cancelled"),
      v.literal("custom")
    ),
    description: v.string(),
    location: v.optional(v.string()),
    // Provenance : "manual" (saisi), "auto" (règle/cron), "gps" (télématique).
    source: v.optional(eventSourceSchema),
    orgId: v.optional(v.id("organizations")),
  }).index("by_org_and_shipment", ["orgId", "shipmentId"])
    .index("by_org", ["orgId"]),

  incidents: defineTable({
    shipmentId: v.optional(v.id("shipments")),
    hubId: v.optional(v.id("hubs")),
    type: v.union(
      v.literal("breakdown"),
      v.literal("customs"),
      v.literal("capacity"),
      v.literal("delay"),
      v.literal("damage"),
      v.literal("other")
    ),
    severity: v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical")),
    title: v.string(),
    description: v.string(),
    status: v.union(v.literal("open"), v.literal("investigating"), v.literal("resolved")),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
    // "auto" = créé par le cron de détection (peut être escaladé ou
    // clôturé automatiquement) ; absent/"manual" = saisi par un humain.
    source: v.optional(v.union(v.literal("auto"), v.literal("manual"))),
    // true = retard PRÉDIT (l'engagement n'est pas encore dépassé).
    predicted: v.optional(v.boolean()),
    orgId: v.optional(v.id("organizations")),
  }).index("by_status", ["status"])
    .index("by_severity", ["severity"])
    .index("by_type", ["type"])
    .index("by_org", ["orgId"])
    .index("by_org_and_status", ["orgId", "status"])
    .index("by_org_and_created_at", ["orgId", "createdAt"]),

  // Connexion d'une organisation à fleet-hub (clé X-Marketplace-Key de la
  // société transporteur). La clé n'est jamais renvoyée au navigateur.
  fleethubIntegrations: defineTable({
    orgId: v.id("organizations"),
    baseUrl: v.string(),
    apiKey: v.string(),
    enabled: v.boolean(),
    companyName: v.optional(v.string()),
    complianceScore: v.optional(v.number()),
    lastSyncAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  }).index("by_org", ["orgId"]),

  // Camions disponibles côté fleet-hub, remplacés à chaque synchro.
  vehicles: defineTable({
    orgId: v.id("organizations"),
    registration: v.string(),
    capacityTons: v.optional(v.number()),
    syncedAt: v.number(),
  }).index("by_org", ["orgId"])
    .index("by_org_and_registration", ["orgId", "registration"]),

  // Historique GPS par expédition (trace sur la carte, base de l'ETA).
  positionPings: defineTable({
    orgId: v.id("organizations"),
    shipmentId: v.id("shipments"),
    lat: v.number(),
    lng: v.number(),
    speedKph: v.optional(v.number()),
    recordedAt: v.number(),
  }).index("by_shipment_and_time", ["shipmentId", "recordedAt"]),

  // Connexion d'une organisation à FleetMarket (clé API donneur d'ordre).
  fleetmarketIntegrations: defineTable({
    orgId: v.id("organizations"),
    baseUrl: v.string(),
    apiKey: v.string(),
    enabled: v.boolean(),
    lastSyncAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  }).index("by_org", ["orgId"]),

  // Connexion à Praxio (moteur de conformité douane), clé API rattachée
  // à la société Praxio de l'organisation.
  praxioIntegrations: defineTable({
    orgId: v.id("organizations"),
    baseUrl: v.string(),
    apiKey: v.string(),
    enabled: v.boolean(),
    lastCallAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  }).index("by_org", ["orgId"]),

  // Clés d'API d'organisation (intégration ERP/WMS). Seul le SHA-256 est stocké.
  apiKeys: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    keyHash: v.string(),
    prefix: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  }).index("by_hash", ["keyHash"])
    .index("by_org", ["orgId"]),

  // Abonnements webhooks sortants (signés HMAC-SHA256).
  webhooks: defineTable({
    orgId: v.id("organizations"),
    url: v.string(),
    secret: v.string(),
    events: v.array(webhookEventType),
    enabled: v.boolean(),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]),

  // Journal de livraison (et file de relance) des webhooks.
  webhookDeliveries: defineTable({
    orgId: v.id("organizations"),
    webhookId: v.id("webhooks"),
    eventId: v.string(),
    type: webhookEventType,
    payload: v.string(),
    attempts: v.number(),
    status: v.union(v.literal("pending"), v.literal("delivered"), v.literal("failed")),
    lastStatusCode: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    deliveredAt: v.optional(v.number()),
  }).index("by_webhook", ["webhookId"])
    .index("by_org", ["orgId"]),
});
