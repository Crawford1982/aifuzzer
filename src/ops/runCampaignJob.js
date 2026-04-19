/**
 * Map a validated campaign job to `runMythosPipeline` and execute.
 */

import path from 'path';
import { resolveTargetUrl } from '../util/resolveTargetUrl.js';
import { runMythosPipeline } from '../orchestrator/MythosOrchestrator.js';
import { applyCiProfile } from './ciProfile.js';
import { resolveAuthFields } from './authRefs.js';

/**
 * @param {import('./campaignJob.js').CampaignJob} job
 */
export async function runCampaignJob(job) {
  const resolved = resolveTargetUrl(job.target);
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }

  const openapiAbs = job.openapiPath ? path.resolve(job.openapiPath) : null;
  const scopeAbs = job.scopeFile ? path.resolve(job.scopeFile) : null;

  const { auth: resolvedAuth, authAlt: resolvedAlt } = resolveAuthFields(job);

  /** @type {Record<string, unknown>} */
  const cfg = {
    target: resolved.url,
    auth: resolvedAuth,
    openapiPath: openapiAbs,
    scopeFile: scopeAbs,
    outputDir: job.outputDir ?? 'output',
    maxRequests: job.maxRequests ?? 120,
    concurrency: job.concurrency ?? 4,
    timeoutMs: job.timeoutMs ?? 8000,
    maxRps: job.maxRps ?? 0,
    useStubPlan: Boolean(job.useStubPlan),
    planWithLlm: Boolean(job.planWithLlm),
    evidencePack: Boolean(job.evidencePack),
    aiMutationHints: Boolean(job.aiMutationHints),
    maxResponseBodyChars: job.maxResponseBodyChars,
    wordlistFile: job.wordlistFile ?? null,
    maxWordlistInjections: job.maxWordlistInjections ?? 64,
    maxBodyMutationsPerOp: job.maxBodyMutationsPerOp ?? 0,
    authAlt: resolvedAlt,
    namespaceReplayBudget: job.namespaceReplayBudget ?? 24,
    useCuratedWordlist: Boolean(job.useCuratedWordlist),
    campaignMemoryFile: job.campaignMemoryFile
      ? path.resolve(job.campaignMemoryFile)
      : null,
  };

  if (job.ci) {
    applyCiProfile(cfg);
  }

  /** @type {import('../safety/scopePolicy.js').ScopePolicy | null} */
  let scopePolicy = null;
  if (scopeAbs) {
    const { loadScopePolicy } = await import('../safety/scopePolicy.js');
    scopePolicy = loadScopePolicy(scopeAbs, cfg.target);
  }

  return runMythosPipeline({
    target: /** @type {string} */ (cfg.target),
    auth: /** @type {string | null} */ (cfg.auth),
    concurrency: /** @type {number} */ (cfg.concurrency),
    maxRequests: /** @type {number} */ (cfg.maxRequests),
    timeoutMs: /** @type {number} */ (cfg.timeoutMs),
    outputDir: /** @type {string} */ (cfg.outputDir),
    openapiPath: openapiAbs,
    useStubPlan: Boolean(cfg.useStubPlan),
    planWithLlm: Boolean(cfg.planWithLlm),
    scopePolicy,
    maxRps: Number(cfg.maxRps) || 0,
    scopeFile: scopeAbs ? String(scopeAbs) : null,
    evidencePack: Boolean(cfg.evidencePack),
    aiMutationHints: Boolean(cfg.aiMutationHints),
    maxResponseBodyChars:
      cfg.maxResponseBodyChars != null && Number.isFinite(Number(cfg.maxResponseBodyChars))
        ? Number(cfg.maxResponseBodyChars)
        : undefined,
    wordlistFile: job.wordlistFile ? path.resolve(job.wordlistFile) : null,
    maxWordlistInjections: Number(cfg.maxWordlistInjections) || 64,
    maxBodyMutationsPerOp: Number(cfg.maxBodyMutationsPerOp) || 0,
    authAlt: resolvedAlt,
    namespaceReplayBudget: Number(cfg.namespaceReplayBudget) || 24,
    useCuratedWordlist: Boolean(cfg.useCuratedWordlist),
    campaignMemoryFile: cfg.campaignMemoryFile ? String(cfg.campaignMemoryFile) : null,
  });
}
