/**
 * Layer 2 — Semantic model (stub)
 * Later: invariants, roles, authorization graph. For now: append observations.
 */

export class SemanticModel {
  constructor() {
    /** @type {Array<Record<string, unknown>>} */
    this.observations = [];
    /** @type {Map<string, Set<string>>} */
    this.edges = new Map();
  }

  /** @param {Record<string, unknown>} obs */
  observe(obs) {
    this.observations.push({ at: new Date().toISOString(), ...obs });
  }

  /**
   * @param {string} from
   * @param {string} rel
   * @param {string} to
   */
  link(from, rel, to) {
    const key = `${from}|${rel}`;
    if (!this.edges.has(key)) this.edges.set(key, new Set());
    this.edges.get(key).add(to);
  }

  snapshot() {
    return {
      observationCount: this.observations.length,
      edgeKeys: [...this.edges.keys()],
      /** Full timeline (openapi, graphs, planner skips, Milestone G prioritization, etc.). */
      observations: [...this.observations],
    };
  }
}
