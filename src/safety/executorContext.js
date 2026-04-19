/**
 * Shared HTTP transport options (scope, rate limit).
 */

import { createRateLimiter } from './rateLimiter.js';

/**
 * @param {{
 *   timeoutMs: number,
 *   authHeader?: string | null,
 *   scopePolicy?: import('./scopePolicy.js').ScopePolicy | null,
 *   maxRps?: number,
 * }} cfg
 */
export function buildTransportOpts(cfg) {
  return {
    timeoutMs: cfg.timeoutMs,
    authHeader: cfg.authHeader ?? null,
    scopePolicy: cfg.scopePolicy ?? null,
    rateLimiter: createRateLimiter(cfg.maxRps ?? 0),
  };
}
