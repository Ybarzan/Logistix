/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as automation from "../automation.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as hubs from "../hubs.js";
import type * as incidents from "../incidents.js";
import type * as orgContext from "../orgContext.js";
import type * as organizations from "../organizations.js";
import type * as routes from "../routes.js";
import type * as seed from "../seed.js";
import type * as shipments from "../shipments.js";
import type * as stats from "../stats.js";
import type * as tracking from "../tracking.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  automation: typeof automation;
  crons: typeof crons;
  http: typeof http;
  hubs: typeof hubs;
  incidents: typeof incidents;
  orgContext: typeof orgContext;
  organizations: typeof organizations;
  routes: typeof routes;
  seed: typeof seed;
  shipments: typeof shipments;
  stats: typeof stats;
  tracking: typeof tracking;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
