/**
 * Orchestrator — single pipeline for v0.1 (multi-agent later).
 */

import fs from 'fs';
import path from 'path';

import { probeRestSurface } from '../surface/RestSurfaceProbe.js';
import { SemanticModel } from '../semantic/SemanticModel.js';
import { expandPatterns, expandAuthPatterns } from '../hypothesis/HypothesisEngine.js';
import { executeCases, ensureOutputDir } from '../execution/HttpFuzzAgent.js';
import { ResponseIndex } from '../feedback/ResponseIndex.js';
import { triageResults } from '../verify/BasicTriage.js';

/**
 * @param {{ target: string, auth?: string | null, concurrency: number, maxRequests: number, timeoutMs: number, outputDir: string }} cfg
 */
export async function runMythosPipeline(cfg) {
  const model = new SemanticModel();
  const index = new ResponseIndex();

  const authHeaders = cfg.auth
    ? { Authorization: cfg.auth.startsWith('Bearer ') ? cfg.auth : `Bearer ${cfg.auth}` }
    : {};

  const surface = await probeRestSurface(cfg.target, {
    headers: authHeaders,
    timeoutMs: cfg.timeoutMs,
  });

  model.observe({ kind: 'surface', surface });

  const patterns = expandPatterns(cfg.target, { maxRequests: cfg.maxRequests });
  const remaining = Math.max(0, cfg.maxRequests - patterns.length);
  const authCases = expandAuthPatterns(cfg.target, {
    maxRequests: remaining,
    hasAuth: Boolean(cfg.auth),
  });

  const cases = [...patterns, ...authCases].slice(0, cfg.maxRequests);

  const execResults = await executeCases(cases, {
    concurrency: cfg.concurrency,
    timeoutMs: cfg.timeoutMs,
    authHeader: cfg.auth || null,
  });

  for (const r of execResults) {
    if (!r.bodyPreview && !r.status) continue;
    const key = index.noveltyKey(r.status ?? 'err', r.bodyPreview || '');
    index.score(key);
  }

  const findings = triageResults(execResults);

  const report = {
    generatedAt: new Date().toISOString(),
    target: cfg.target,
    limits: {
      maxRequests: cfg.maxRequests,
      concurrency: cfg.concurrency,
      timeoutMs: cfg.timeoutMs,
    },
    surfaceSummary: {
      origin: surface.origin,
      probeCount: surface.probes.length,
      statuses: surface.probes.map((p) => p.status),
    },
    semanticSnapshot: model.snapshot(),
    executed: execResults.length,
    findings,
    raw: execResults,
  };

  const outDir = ensureOutputDir(cfg.outputDir);
  const outfile = path.join(outDir, `mythos-report-${Date.now()}.json`);
  fs.writeFileSync(outfile, JSON.stringify(report, null, 2));

  return { outfile, report };
}
