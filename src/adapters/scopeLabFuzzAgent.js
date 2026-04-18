/**
 * Thin adapter: Mythos (ESM) ↔ Cloud Brain scope-lab `lib/fuzzAgent.js` (CommonJS).
 *
 * Keeps one hardened implementation in `cloud-brain-scope-lab/lib/`; Mythos imports it here
 * without duplicating probe logic.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolved absolute path to scope-lab fuzzAgent.cjs entry */
export const SCOPE_LAB_FUZZ_AGENT_PATH = resolve(
  __dirname,
  '..',
  '..',
  'cloud-brain-scope-lab',
  'lib',
  'fuzzAgent.js'
);

const require = createRequire(import.meta.url);
const fuzzAgent = require(SCOPE_LAB_FUZZ_AGENT_PATH);

export const {
  DEFAULT_BUDGET,
  HARD_CEILING,
  clampBudget,
  generateProbes,
  runFuzzPlan,
  validateProposedProbe,
  buildExpandPrompt,
  parseExpandResponse,
  buildReviewPrompt,
  parseReviewResponse,
  triageProbe,
  sameShape
} = fuzzAgent;

/**
 * @returns {{ labRoot: string, fuzzAgentPath: string }}
 */
export function getScopeLabAdapterInfo() {
  const labRoot = resolve(__dirname, '..', '..', 'cloud-brain-scope-lab');
  return {
    labRoot,
    fuzzAgentPath: SCOPE_LAB_FUZZ_AGENT_PATH
  };
}
