/**
 * Per-request context for multi-tenant (hosted) deployments.
 *
 * When the server runs behind Smithery (or any gateway) that collects each
 * user's own Replicate token, the HTTP layer parses that token per request and
 * runs the request inside `requestContext.run({ replicateToken }, ...)`. The
 * Replicate client factory then uses that token for this request only, instead
 * of the process-wide env token pool.
 *
 * AsyncLocalStorage propagates through awaits, so the token set around
 * `transport.handleRequest(...)` reaches every tool handler invoked for that
 * request without threading it through any function signatures. stdio / local
 * single-token deployments never set a context, so `getRequestToken()` returns
 * undefined and the env token pool is used as before.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  /** The caller's Replicate token for this request. Overrides the env pool. */
  replicateToken?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/** The per-request Replicate token, if one is set for the current async
 *  context. Returns undefined for stdio / single-token deployments. */
export function getRequestToken(): string | undefined {
  return requestContext.getStore()?.replicateToken;
}
