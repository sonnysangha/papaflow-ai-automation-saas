/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as connections from "../connections.js";
import type * as engine from "../engine.js";
import type * as executions from "../executions.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_plan from "../lib/plan.js";
import type * as lib_validators from "../lib/validators.js";
import type * as plan from "../plan.js";
import type * as steps from "../steps.js";
import type * as usage from "../usage.js";
import type * as webhookEvents from "../webhookEvents.js";
import type * as workflows from "../workflows.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  connections: typeof connections;
  engine: typeof engine;
  executions: typeof executions;
  "lib/auth": typeof lib_auth;
  "lib/plan": typeof lib_plan;
  "lib/validators": typeof lib_validators;
  plan: typeof plan;
  steps: typeof steps;
  usage: typeof usage;
  webhookEvents: typeof webhookEvents;
  workflows: typeof workflows;
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
