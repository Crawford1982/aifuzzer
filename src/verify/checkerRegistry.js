/**
 * Mythos checker registry — RESTler-style metadata without copying their implementation.
 * LLMs never interpret these; orchestration maps fired checkers here for reporting only.
 */

/**
 * @typedef {{
 *   checkerId: string,
 *   title: string,
 *   precondition: string,
 *   owaspMapping: string[],
 *   bountyTierHint: 'low' | 'medium' | 'high',
 * }} CheckerDefinition
 */

/** @type {CheckerDefinition[]} */
export const MYTHOS_CHECKERS = [
  {
    checkerId: 'leak_after_failed_create',
    title: 'Possible create/list leakage after failed mutating request',
    precondition:
      'A POST/PUT/PATCH returned 4xx (failed create/update), then a collection GET returned 200 with a JSON array body.',
    owaspMapping: ['API8:2023', 'API10:2023'],
    bountyTierHint: 'medium',
  },
  {
    checkerId: 'delete_still_readable',
    title: 'Resource still readable after successful DELETE',
    precondition:
      'DELETE returned success (2xx), then GET to the same resource path returned 2xx with a body.',
    owaspMapping: ['API8:2023'],
    bountyTierHint: 'medium',
  },
  {
    checkerId: 'resource_hierarchy_cross_parent',
    title: 'Same response body across different parent contexts (possible BOLA)',
    precondition:
      'Two GETs to the same route shape (normalized path template) with different parent IDs both returned 200 with identical normalized body fingerprints.',
    owaspMapping: ['API1:2023'],
    bountyTierHint: 'high',
  },
];

const BY_ID = new Map(MYTHOS_CHECKERS.map((c) => [c.checkerId, c]));

/**
 * @param {string} id
 */
export function getCheckerDefinition(id) {
  return BY_ID.get(id);
}

/** @returns {Record<string, CheckerDefinition>} */
export function checkerRegistryExport() {
  return Object.fromEntries(BY_ID);
}
