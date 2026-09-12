import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export const roleSchema = v.union(
  v.literal("admin"),
  v.literal("manager"),
  v.literal("operator"),
  v.literal("viewer"),
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
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
  }).index("by_slug", ["slug"]),

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
    orgId: v.optional(v.id("organizations")),
  }).index("by_reference", ["reference"])
    .index("by_status", ["status"])
    .index("by_from_hub", ["fromHubId"])
    .index("by_to_hub", ["toHubId"])
    .index("by_created_at", ["createdAt"])
    .index("by_org", ["orgId"])
    .index("by_org_and_status", ["orgId", "status"]),

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
    orgId: v.optional(v.id("organizations")),
  }).index("by_status", ["status"])
    .index("by_severity", ["severity"])
    .index("by_type", ["type"])
    .index("by_org", ["orgId"])
    .index("by_org_and_status", ["orgId", "status"]),
});