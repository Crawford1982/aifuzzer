/**
 * Orchestrator — deterministic executor owns HTTP; OpenAPI + stateful chains + stub plans.
 */

import fs from 'fs';
import path from 'path';

import { probeRestSurface } from '../surface/RestSurfaceProbe.js';
import { SemanticModel } from '../semantic/SemanticModel.js';
import { expandPatterns, expandAuthPatterns } from '../hypothesis/HypothesisEngine.js';
import { executeCases, ensureOutputDir } from '../execution/HttpFuzzAgent.js';
import { ResponseIndex } from '../feedback/ResponseIndex.js';
import { triageResults } from '../verify/BasicTriage.js';
import { attachEvidenceCurls } from '../verify/evidencePack.js';
import { buildTransportOpts } from '../safety/executorContext.js';
import { buildBaselineFingerprints } from '../verify/baseline.js';
import { enrichFindingsWithConfidence } from '../verify/confidence.js';
import { minimizationHint } from '../verify/minimize.js';
import { buildHarLog, buildReplayBundle } from '../verify/evidenceExport.js';

/**
 * @param {unknown} r
 */
function stripReplayBlob(r) {
  if (!r || typeof r !== 'object' || !('fullBody' in r)) return r;
  const { fullBody: _fb, ...rest } = /** @type {Record<string, unknown>} */ (r);
  return rest;
}

/**
 * @param {{
 *   target: string,
 *   auth?: string | null,
 *   concurrency: number,
 *   maxRequests: number,
 *   timeoutMs: number,
 *   outputDir: string,
 *   openapiPath?: string | null,
 *   useStubPlan?: boolean,
 *   planWithLlm?: boolean,
 *   scopePolicy?: import('../safety/scopePolicy.js').ScopePolicy | null,
 *   maxRps?: number,
 *   scopeFile?: string | null,
 *   evidencePack?: boolean,
 * }} cfg
 */
export async function runMythosPipeline(cfg) {
  const model = new SemanticModel();
  const index = new ResponseIndex();

  const transport = buildTransportOpts({
    timeoutMs: cfg.timeoutMs,
    authHeader: cfg.auth ?? null,
    scopePolicy: cfg.scopePolicy ?? null,
    maxRps: cfg.maxRps ?? 0,
  });

  const authHeaders = cfg.auth
    ? { Authorization: cfg.auth.startsWith('Bearer ') ? cfg.auth : `Bearer ${cfg.auth}` }
    : {};

  let surfaceTarget = cfg.target;
  /** @type {import('../openapi/OpenApiLoader.js').NormalizedSpec | null} */
  let spec = null;

  if (cfg.openapiPath) {
    const { loadOpenApi, resolveBaseUrl } = await import('../openapi/OpenApiLoader.js');
    spec = loadOpenApi(cfg.openapiPath);
    surfaceTarget = resolveBaseUrl(spec, cfg.target);
    model.observe({
      kind: 'openapi',
      title: spec.title,
      version: spec.version,
      operationCount: spec.operations.length,
      baseUrl: surfaceTarget,
    });
  }

  const surface = await probeRestSurface(surfaceTarget, {
    headers: authHeaders,
    timeoutMs: cfg.timeoutMs,
    scopePolicy: cfg.scopePolicy ?? null,
    rateLimiter: transport.rateLimiter,
  });

  model.observe({ kind: 'surface', surface });

  /** @type {import('../hypothesis/HypothesisEngine.js').FuzzCase[]} */
  let cases = [];

  /** Set in OpenAPI branch when LLM plan compiles (for report mode). */
  /** @type {import('../hypothesis/HypothesisEngine.js').FuzzCase[]} */
  let llmCases = [];

  /** @type {unknown[]} */
  let execResults = [];

  /** @type {Record<string, unknown> | null} */
  let activePlan = null;

  /** @type {unknown} */
  let dependencyGraphSummary = null;

  if (cfg.useStubPlan) {
    const { buildStubPlan } = await import('../planner/stubPlanner.js');
    const { compilePlanToCases } = await import('../planner/planCompiler.js');
    const plan = buildStubPlan();
    const compiled = compilePlanToCases(plan, { baseUrl: cfg.target });
    if (!compiled.ok) {
      throw new Error(`Stub plan rejected: ${compiled.errors.join('; ')}`);
    }
    cases = compiled.cases;
    activePlan = { source: 'stub', ...plan };
    model.observe({ kind: 'plan', ...activePlan });
    execResults = await executeCases(cases, {
      ...transport,
      concurrency: cfg.concurrency,
    });
  } else if (spec) {
    const { inferProducerConsumerEdges } = await import('../state/dependencyGraph.js');
    const { buildStatefulChains } = await import('../hypothesis/StatefulCampaignEngine.js');
    const { compileStatefulChain, executeStatefulChain } = await import('../execution/SequenceExecutor.js');
    const { compilePlanToCases } = await import('../planner/planCompiler.js');

    const graph = inferProducerConsumerEdges(spec.operations);
    dependencyGraphSummary = { edgeCount: graph.edges.length, edges: graph.edges };
    model.observe({ kind: 'dependencyGraph', ...dependencyGraphSummary });

    const byId = new Map(spec.operations.map((o) => [o.operationId, o]));
    const chains = buildStatefulChains(spec, graph, { maxChains: 10 });

    const execOpts = { ...transport };

    /** @type {unknown[]} */
    let llmResults = [];

    llmCases = [];

    /** @type {unknown[]} */
    const chainFlatResults = [];
    /** @type {import('../hypothesis/HypothesisEngine.js').FuzzCase[]} */
    const chainCases = [];

    let spent = 0;

    if (cfg.planWithLlm) {
      const { requestExecutionPlanFromLlm } = await import('../planner/llmPlanner.js');
      const llmOut = await requestExecutionPlanFromLlm({
        spec,
        effectiveBaseUrl: surfaceTarget,
        edges: graph.edges,
      });

      if (llmOut.ok && llmOut.plan) {
        const compiled = compilePlanToCases(llmOut.plan, { baseUrl: surfaceTarget });
        if (compiled.ok && compiled.cases.length) {
          const llmBudget = Math.min(
            compiled.cases.length,
            Math.min(16, Math.max(2, Math.floor(cfg.maxRequests * 0.25)))
          );
          llmCases = compiled.cases.slice(0, llmBudget);
          llmResults = await executeCases(llmCases, {
            ...transport,
            concurrency: cfg.concurrency,
          });
          spent += llmResults.length;
          activePlan = {
            source: 'llm',
            goal: llmOut.plan.goal,
            attackClass: llmOut.plan.attackClass,
            attempts: llmOut.attempts,
          };
          model.observe({ kind: 'llm_plan', ...activePlan });
        } else {
          model.observe({
            kind: 'llm_plan_skipped',
            reason: 'compile_failed',
            detail: compiled.errors.join('; '),
          });
        }
      } else if (!llmOut.ok) {
        model.observe({
          kind: 'llm_plan_skipped',
          reason: llmOut.reason || 'unknown',
          detail: llmOut.detail || '',
        });
      }
    }

    for (const ch of chains) {
      if (spent + 2 > cfg.maxRequests) break;
      try {
        const compiled = compileStatefulChain(ch, byId, surfaceTarget);
        const out = await executeStatefulChain(compiled, execOpts);
        chainFlatResults.push(...out.results);
        chainCases.push(...out.fuzzCases);
        spent += out.results.length;
      } catch (e) {
        model.observe({
          kind: 'chain_error',
          chainId: ch.id,
          message: /** @type {Error} */ (e).message,
        });
      }
    }

    const remaining = Math.max(0, cfg.maxRequests - spent);
    const { expandFromOpenApi } = await import('../hypothesis/SpecHypothesisEngine.js');
    const flatCases = expandFromOpenApi(spec, surfaceTarget, {
      maxRequests: remaining,
      hasAuth: Boolean(cfg.auth),
    });

    const flatResults = await executeCases(flatCases, {
      ...transport,
      concurrency: cfg.concurrency,
    });

    execResults = [...llmResults, ...chainFlatResults, ...flatResults];
    cases = [...llmCases, ...chainCases, ...flatCases];
  } else {
    const patterns = expandPatterns(cfg.target, { maxRequests: cfg.maxRequests });
    const remaining = Math.max(0, cfg.maxRequests - patterns.length);
    const authCases = expandAuthPatterns(cfg.target, {
      maxRequests: remaining,
      hasAuth: Boolean(cfg.auth),
    });
    cases = [...patterns, ...authCases].slice(0, cfg.maxRequests);
    execResults = await executeCases(cases, {
      ...transport,
      concurrency: cfg.concurrency,
    });
  }

  const casesById = new Map(cases.map((c) => [c.id, c]));
  const resultsWithEvidence = attachEvidenceCurls(execResults, casesById, {
    authHeader: cfg.auth || null,
  });

  /** Reports stay small: drop fullBody used only for binding (arrays can be megabytes). */
  const sanitizedResults = resultsWithEvidence.map(stripReplayBlob);
  const sanitizedRaw = execResults.map(stripReplayBlob);

  for (const r of execResults) {
    if (!r.bodyPreview && !r.status) continue;
    const key = index.noveltyKey(r.status ?? 'err', r.bodyPreview || '');
    index.score(key);
  }

  const baselines = buildBaselineFingerprints(execResults);
  let findings = triageResults(execResults);
  findings = enrichFindingsWithConfidence(findings, execResults, baselines).map((f) => ({
    ...f,
    minimization: minimizationHint(casesById.get(f.caseId)),
  }));

  const ts = Date.now();
  const generatedAt = new Date(ts).toISOString();
  const outDir = ensureOutputDir(cfg.outputDir);

  /** @type {{ har: string, replay: string } | null} */
  let evidencePack = null;
  if (cfg.evidencePack) {
    const harPath = path.join(outDir, `mythos-evidence-${ts}.har`);
    const replayPath = path.join(outDir, `mythos-replay-${ts}.json`);
    const har = buildHarLog(execResults, casesById, {
      generatedAt,
      authHeader: cfg.auth ?? null,
    });
    const bundle = buildReplayBundle(execResults, casesById, {
      generatedAt,
      authHeader: cfg.auth ?? null,
    });
    fs.writeFileSync(harPath, JSON.stringify(har, null, 2));
    fs.writeFileSync(replayPath, JSON.stringify(bundle, null, 2));
    evidencePack = { har: harPath, replay: replayPath };
  }

  const report = {
    generatedAt,
    target: cfg.target,
    effectiveBaseUrl: surfaceTarget,
    mode: cfg.useStubPlan
      ? 'stub_plan'
      : spec
        ? cfg.planWithLlm && llmCases.length
          ? 'openapi_stateful_llm'
          : 'openapi_stateful'
        : 'legacy_target',
    openapiPath: cfg.openapiPath || null,
    activePlan,
    dependencyGraph: dependencyGraphSummary,
    limits: {
      maxRequests: cfg.maxRequests,
      concurrency: cfg.concurrency,
      timeoutMs: cfg.timeoutMs,
      maxRps: cfg.maxRps ?? 0,
      scopeFile: cfg.scopeFile || null,
      scopePolicy: Boolean(cfg.scopePolicy),
    },
    verifier: {
      baselineRoutes: baselines.size,
      evidenceExport: Boolean(cfg.evidencePack),
    },
    evidencePack,
    surfaceSummary: {
      origin: surface.origin,
      probeCount: surface.probes.length,
      statuses: surface.probes.map((p) => p.status),
    },
    semanticSnapshot: model.snapshot(),
    executed: execResults.length,
    findings,
    results: sanitizedResults,
    raw: sanitizedRaw,
  };

  const outfile = path.join(outDir, `mythos-report-${ts}.json`);
  fs.writeFileSync(outfile, JSON.stringify(report, null, 2));

  return { outfile, report };
}
