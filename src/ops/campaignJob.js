/**
 * Milestone E — validated campaign job envelope (queue / worker / CI).
 */

export const CAMPAIGN_JOB_VERSION = 1;

/**
 * @typedef {{
 *   version: number,
 *   id?: string,
 *   target: string,
 *   openapiPath?: string | null,
 *   scopeFile?: string | null,
 *   outputDir?: string,
 *   auth?: string | null,
 *   authAlt?: string | null,
 *   maxRequests?: number,
 *   concurrency?: number,
 *   timeoutMs?: number,
 *   maxRps?: number,
 *   useStubPlan?: boolean,
 *   planWithLlm?: boolean,
 *   evidencePack?: boolean,
 *   aiMutationHints?: boolean,
 *   maxResponseBodyChars?: number,
 *   wordlistFile?: string | null,
 *   maxWordlistInjections?: number,
 *   maxBodyMutationsPerOp?: number,
 *   namespaceReplayBudget?: number,
 *   useCuratedWordlist?: boolean,
 *   campaignMemoryFile?: string | null,
 *   ci?: boolean,
 *   authEnv?: string | null,
 *   authAltEnv?: string | null,
 * }} CampaignJob
 */

/**
 * @param {unknown} raw
 * @returns {{ ok: true, job: CampaignJob } | { ok: false, errors: string[] }}
 */
export function validateCampaignJob(raw) {
  /** @type {string[]} */
  const errors = [];

  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['job must be a JSON object'] };
  }

  const o = /** @type {Record<string, unknown>} */ (raw);

  const version = Number(o.version);
  if (!Number.isFinite(version) || version !== CAMPAIGN_JOB_VERSION) {
    errors.push(`version must be ${CAMPAIGN_JOB_VERSION}`);
  }

  const target = o.target;
  if (typeof target !== 'string' || !target.trim()) {
    errors.push('target must be a non-empty string URL');
  } else {
    try {
      const u = new URL(target.trim());
      if (!['http:', 'https:'].includes(u.protocol)) {
        errors.push('target must use http or https');
      }
    } catch {
      errors.push('target must be a valid absolute URL');
    }
  }

  const maxRequests = o.maxRequests != null ? Number(o.maxRequests) : undefined;
  if (maxRequests != null && (!Number.isFinite(maxRequests) || maxRequests < 1 || maxRequests > 2048)) {
    errors.push('maxRequests must be between 1 and 2048 when set');
  }

  const openapiPath = o.openapiPath;
  if (openapiPath != null && typeof openapiPath !== 'string') {
    errors.push('openapiPath must be a string or null');
  }

  const useStubPlan = Boolean(o.useStubPlan);
  if (!useStubPlan && (openapiPath == null || openapiPath === '')) {
    errors.push('openapiPath is required unless useStubPlan is true');
  }

  const authEnvRaw = o.authEnv != null ? String(o.authEnv).trim() : '';
  const authAltEnvRaw = o.authAltEnv != null ? String(o.authAltEnv).trim() : '';
  const authInline = typeof o.auth === 'string' && o.auth.trim() !== '';
  const authAltInline = typeof o.authAlt === 'string' && o.authAlt.trim() !== '';

  if (authEnvRaw && authInline) {
    errors.push('use either auth or authEnv in the job, not both');
  }
  if (authAltEnvRaw && authAltInline) {
    errors.push('use either authAlt or authAltEnv in the job, not both');
  }
  if (authEnvRaw && !/^[A-Z_][A-Z0-9_]*$/.test(authEnvRaw)) {
    errors.push('authEnv must look like MYTHOS_API_TOKEN (uppercase env var name)');
  }
  if (authAltEnvRaw && !/^[A-Z_][A-Z0-9_]*$/.test(authAltEnvRaw)) {
    errors.push('authAltEnv must look like MYTHOS_API_TOKEN (uppercase env var name)');
  }

  if (errors.length) return { ok: false, errors };

  /** @type {CampaignJob} */
  const job = {
    version: CAMPAIGN_JOB_VERSION,
    id: typeof o.id === 'string' && o.id.trim() ? o.id.trim() : undefined,
    target: String(target).trim(),
    openapiPath:
      openapiPath != null && String(openapiPath).trim()
        ? String(openapiPath).trim()
        : null,
    scopeFile: typeof o.scopeFile === 'string' ? o.scopeFile : null,
    outputDir: typeof o.outputDir === 'string' && o.outputDir.trim() ? o.outputDir : 'output',
    auth: typeof o.auth === 'string' && o.auth.trim() !== '' ? o.auth : null,
    authAlt: typeof o.authAlt === 'string' && o.authAlt.trim() !== '' ? o.authAlt : null,
    authEnv: authEnvRaw || null,
    authAltEnv: authAltEnvRaw || null,
    maxRequests: maxRequests ?? 120,
    concurrency: Number.isFinite(Number(o.concurrency)) ? Number(o.concurrency) : 4,
    timeoutMs: Number.isFinite(Number(o.timeoutMs)) ? Number(o.timeoutMs) : 8000,
    maxRps: Number.isFinite(Number(o.maxRps)) ? Number(o.maxRps) : 0,
    useStubPlan,
    planWithLlm: Boolean(o.planWithLlm),
    evidencePack: Boolean(o.evidencePack),
    aiMutationHints: Boolean(o.aiMutationHints),
    maxResponseBodyChars:
      o.maxResponseBodyChars != null && Number.isFinite(Number(o.maxResponseBodyChars))
        ? Number(o.maxResponseBodyChars)
        : undefined,
    wordlistFile: typeof o.wordlistFile === 'string' ? o.wordlistFile : null,
    maxWordlistInjections: Number.isFinite(Number(o.maxWordlistInjections))
      ? Number(o.maxWordlistInjections)
      : 64,
    maxBodyMutationsPerOp: Number.isFinite(Number(o.maxBodyMutationsPerOp))
      ? Number(o.maxBodyMutationsPerOp)
      : 0,
    namespaceReplayBudget: Number.isFinite(Number(o.namespaceReplayBudget))
      ? Number(o.namespaceReplayBudget)
      : 24,
    useCuratedWordlist: Boolean(o.useCuratedWordlist),
    campaignMemoryFile: typeof o.campaignMemoryFile === 'string' ? o.campaignMemoryFile : null,
    ci: Boolean(o.ci),
  };

  return { ok: true, job };
}
