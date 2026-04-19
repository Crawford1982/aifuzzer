/**
 * Milestone E — CI / pipeline mode: conservative caps, no LLM side effects, deterministic exit codes.
 */

/**
 * @param {Record<string, unknown> | null} [args] parseArgv result; `ci: true` enables mode
 * @param {{ MYTHOS_CI?: string }} [env]
 */
export function isCiMode(args, env = process.env) {
  if (args && /** @type {Record<string, unknown>} */ (args).ci === true) return true;
  const v = env.MYTHOS_CI;
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * CI defaults: tighten anything that could make runs noisy, slow, or non-deterministic.
 * Mutates `cfg` in place (plain object from CLI assembly).
 *
 * @param {Record<string, unknown>} cfg
 */
export function applyCiProfile(cfg) {
  cfg.concurrency = Math.min(Number(cfg.concurrency) || 2, 2);
  cfg.maxRequests = Math.min(Number(cfg.maxRequests) || 48, 48);
  cfg.timeoutMs = Math.min(Number(cfg.timeoutMs) || 5000, 8000);
  const mr = Number(cfg.maxRps);
  cfg.maxRps = !Number.isFinite(mr) || mr === 0 ? 12 : Math.min(mr, 20);
  cfg.planWithLlm = false;
  cfg.aiMutationHints = false;
  cfg.evidencePack = false;
}

/**
 * @param {Record<string, unknown>} report Mythos JSON report (or minimal `{ findings?: unknown[] }`).
 * @param {{ ci?: boolean, failOnFindings?: boolean }} opts
 * @returns {number} 0 ok, 2 findings gate failed
 */
export function resolveMythosExitCode(report, opts = {}) {
  if (!opts.ci || !opts.failOnFindings) return 0;
  const findings = Array.isArray(report.findings) ? report.findings : [];
  return findings.length > 0 ? 2 : 0;
}
