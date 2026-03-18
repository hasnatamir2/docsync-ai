/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions_generate_docs from "../actions/generate_docs.js";
import type * as actions_sync_docs from "../actions/sync_docs.js";
import type * as doc_drafts from "../doc_drafts.js";
import type * as orgs from "../orgs.js";
import type * as pull_requests from "../pull_requests.js";
import type * as repos from "../repos.js";
import type * as runs from "../runs.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/generate_docs": typeof actions_generate_docs;
  "actions/sync_docs": typeof actions_sync_docs;
  doc_drafts: typeof doc_drafts;
  orgs: typeof orgs;
  pull_requests: typeof pull_requests;
  repos: typeof repos;
  runs: typeof runs;
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
