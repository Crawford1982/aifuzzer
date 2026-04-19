/**
 * Global RPS cap — serializes minimum spacing between outbound requests per limiter instance.
 */

/**
 * @param {number} maxRps 0 or negative = unlimited
 * @returns {{ acquire: () => Promise<void> }}
 */
export function createRateLimiter(maxRps) {
  if (!maxRps || maxRps <= 0) {
    return { acquire: async () => {} };
  }

  const minMs = 1000 / maxRps;
  let slot = Date.now();

  return {
    async acquire() {
      const now = Date.now();
      const next = Math.max(now, slot);
      slot = next + minMs;
      const wait = next - now;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    },
  };
}
