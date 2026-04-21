/**
 * Orchestrator — deterministic executor owns HTTP; OpenAPI + stateful chains + stub plans.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { buildSessionSummary, mergeCampaignMemory } from '../campaign/sessionMemory.js';
import { harvestIdsFromResults } from '../feedback/idHarvest.js';
import { harvestParentIdsByCollection } from '../feedback/parentIdHarvest.js';
import { prioritizeCases } from '../feedback/casePrioritizer.js';

import { probeRestSurface } from '../surface/RestSurfaceProbe.js';
import { SemanticModel } from '../semantic/SemanticModel.js';
import { expandPatterns, expandAuthPatterns } from '../hypothesis/HypothesisEngine.js';
import { executeCases, ensureOutputDir } from '../execution/HttpFuzzAgent.js';
import { ResponseIndex } from '../feedback/ResponseIndex.js';
import { triageResults } from '../verify/BasicTriage.js';
import { attachEvidenceCurls } from '../verify/evidencePack.js';
import { buildTransportOpts } from '../safety/executorContext.js';
import { buildBaselineFingerprints, canonicalRouteKey } from '../verify/baseline.js';
import { enrichFindingsWithConfidence } from '../verify/confidence.js';
import { enrichFindingsWithStatistics } from '../verify/statsSignals.js';
import { minimizationHint } from '../verify/minimize.js';
import { buildHarLog, buildReplayBundle } from '../verify/evidenceExport.js';
import { runCheckerPipeline } from '../verify/checkerEngine.js';
import { MYTHOS_CHECKERS } from '../verify/checkerRegistry.js';

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
 *   maxResponseBodyChars?: number,
 *   aiMutationHints?: boolean,
 *   wordlistFile?: string | null,
 *   maxWordlistInjections?: number,
 *   maxBodyMutationsPerOp?: number,
 *   authAlt?: string | null,
 *   namespaceReplayBudget?: number,
 *   useCuratedWordlist?: boolean,
 *   campaignMemoryFile?: string | null,
 * }} cfg
 */
export async function runMythosPipeline(cfg) {
  const model = new SemanticModel();
  const index = new ResponseIndex();

  /** @type {Record<string, unknown> | null} */
  let persistedCampaignMemory = null;
  if (cfg.campaignMemoryFile?.trim()) {
    const mp = path.resolve(cfg.campaignMemoryFile.trim());
    if (fs.existsSync(mp)) {
      try {
        persistedCampaignMemory = JSON.parse(fs.readFileSync(mp, 'utf8'));
      } catch {
        /* ignore corrupted memory */
      }
    }
  }

  const transport = buildTransportOpts({
    timeoutMs: cfg.timeoutMs,
    authHeader: cfg.auth ?? null,
    scopePolicy: cfg.scopePolicy ?? null,
    maxRps: cfg.maxRps ?? 0,
  });

  const previewCap =
    cfg.maxResponseBodyChars != null && Number.isFinite(cfg.maxResponseBodyChars)
      ? cfg.maxResponseBodyChars
      : cfg.evidencePack
        ? 262144
        : 8192;
  const bodyRead = { maxBodyPreviewChars: previewCap };

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
      ...bodyRead,
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

    const execOpts = { ...transport, ...bodyRead };

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
            ...bodyRead,
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

    // Milestone G: collect results from early execution phases for feedback signals
    const earlyResults = [...llmResults, ...chainFlatResults];

    const { expandFromOpenApi } = await import('../hypothesis/SpecHypothesisEngine.js');
    const aiReserve = cfg.aiMutationHints ? Math.min(8, Math.max(0, Math.floor(remaining / 4))) : 0;
    const flatBudget = Math.max(0, remaining - aiReserve);

    /** @type {string[]} */
    let wordlistLines = [];
    const __root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const curatedDefault = path.join(__root, 'data', 'seclists-curated', 'ids-small.txt');

    if (cfg.useCuratedWordlist && fs.existsSync(curatedDefault)) {
      const capCur = Math.min(24, cfg.maxWordlistInjections ?? 64);
      const curatedRaw = fs.readFileSync(curatedDefault, 'utf8');
      wordlistLines.push(
        ...curatedRaw
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, capCur)
      );
      model.observe({ kind: 'curated_wordlist', lines: wordlistLines.length });
    }

    const wlPath = cfg.wordlistFile?.trim();
    if (wlPath) {
      const resolvedWl = path.resolve(wlPath);
      let rawWl;
      try {
        rawWl = fs.readFileSync(resolvedWl, 'utf8');
      } catch (e) {
        throw new Error(
          `Wordlist unreadable: ${resolvedWl} (${/** @type {Error} */ (e).message})`
        );
      }
      const capWl = Math.min(Math.max(1, cfg.maxWordlistInjections ?? 64), 512);
      const fromFile = rawWl
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, capWl);
      wordlistLines = [...wordlistLines, ...fromFile];
    }

    const capTotal = Math.min(Math.max(1, cfg.maxWordlistInjections ?? 64), 512);
    wordlistLines = [...new Set(wordlistLines)].slice(0, capTotal);

    // Milestone G — live ID harvest: seed IDOR cases with real IDs from early responses
    if (earlyResults.length) {
      const harvested = harvestIdsFromResults(earlyResults, { maxIds: 48 });
      if (harvested.length) {
        wordlistLines = [...new Set([...wordlistLines, ...harvested])].slice(0, capTotal);
        model.observe({ kind: 'live_id_harvest', count: harvested.length });
      }
    }

    /** Keys = lowercase collection base path (`collectionBaseForNestedOp` ↔ list GET pathname). */
    let liveParentIdsByCollection = /** @type {Record<string, string[]>} */ ({});
    if (earlyResults.length) {
      liveParentIdsByCollection = harvestParentIdsByCollection(earlyResults, {
        maxPerKey: 16,
        maxIdsTotal: 96,
      });
      const nk = Object.keys(liveParentIdsByCollection).length;
      const nt = Object.values(liveParentIdsByCollection).reduce((a, xs) => a + xs.length, 0);
      if (nk) {
        model.observe({ kind: 'parent_id_harvest', collections: nk, ids: nt });
      }
    }

    /** @type {import('../hypothesis/HypothesisEngine.js').FuzzCase[]} */
    let aiHintCases = [];
    if (cfg.aiMutationHints && aiReserve > 0) {
      const { requestMutationHintsFromLlm, hintsToFuzzCases } = await import(
        '../planner/aiMutationAdvisor.js'
      );
      const hintsOut = await requestMutationHintsFromLlm({ spec, effectiveBaseUrl: surfaceTarget });
      if (hintsOut.ok && hintsOut.hints?.length) {
        aiHintCases = hintsToFuzzCases(spec, surfaceTarget, hintsOut.hints, { maxCases: aiReserve });
        model.observe({
          kind: 'ai_mutation_hints',
          count: aiHintCases.length,
          attempts: hintsOut.attempts,
        });
      } else {
        model.observe({
          kind: 'ai_mutation_hints_skipped',
          reason: hintsOut.ok ? 'no_hints' : hintsOut.reason || 'unknown',
          detail: hintsOut.detail || '',
        });
      }
    }

    const flatCases = expandFromOpenApi(spec, surfaceTarget, {
      maxRequests: flatBudget,
      hasAuth: Boolean(cfg.auth),
      wordlistValues: wordlistLines.length ? wordlistLines : undefined,
      maxWordlistInjections: cfg.maxWordlistInjections ?? 64,
      maxBodyMutationsPerOp: cfg.maxBodyMutationsPerOp ?? 0,
      liveParentIdsByCollection:
        Object.keys(liveParentIdsByCollection).length > 0 ? liveParentIdsByCollection : undefined,
    });

    // Milestone G — case prioritization: rank by campaign memory + route novelty
    let prioritizedFlat = flatCases;
    {
      // Routes ranked high in past campaigns (most errors/findings first)
      let rankedRouteKeys = /** @type {string[]} */ ([]);
      if (persistedCampaignMemory) {
        const { rankRoutesFromCampaignMemory } = await import('../ops/routeMemoryRank.js');
        rankedRouteKeys = rankRoutesFromCampaignMemory(persistedCampaignMemory, { limit: 100 });
      }

      // Routes already visited this run (chains + LLM) — prefer unseen routes
      const seenRouteKeys = new Set(
        earlyResults
          .filter((r) => !/** @type {Record<string,unknown>} */ (r).error)
          .map((r) => {
            const row = /** @type {Record<string, unknown>} */ (r);
            return canonicalRouteKey(String(row.method || 'GET'), String(row.url || ''));
          })
      );

      prioritizedFlat = prioritizeCases(flatCases, { rankedRouteKeys, seenRouteKeys });

      if (rankedRouteKeys.length || seenRouteKeys.size) {
        model.observe({
          kind: 'case_prioritization',
          rankedRoutes: rankedRouteKeys.length,
          seenRoutesThisRun: seenRouteKeys.size,
          flatCaseCount: flatCases.length,
        });
      }
    }

    const mergedFlat = [...prioritizedFlat, ...aiHintCases].slice(0, remaining);

    const flatResults = await executeCases(mergedFlat, {
      ...transport,
      ...bodyRead,
      concurrency: cfg.concurrency,
    });

    execResults = [...llmResults, ...chainFlatResults, ...flatResults];
    cases = [...llmCases, ...chainCases, ...mergedFlat];
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
      ...bodyRead,
      concurrency: cfg.concurrency,
    });
  }

  if (spec && cfg.auth?.trim() && cfg.authAlt?.trim()) {
    const nsCasesById = new Map(cases.map((c) => [c.id, c]));
    const { runNamespaceAuthReplay } = await import('../verify/namespaceReplay.js');
    const nsBudget = Math.min(Math.max(1, cfg.namespaceReplayBudget ?? 24), 48);
    const nsResults = await runNamespaceAuthReplay({
      execResults,
      casesById: nsCasesById,
      transport,
      bodyRead,
      concurrency: cfg.concurrency,
      budget: nsBudget,
      primaryAuth: cfg.auth,
      altAuth: cfg.authAlt,
    });

    if (nsResults.length) {
      execResults = [...execResults, ...nsResults];
      /** @type {typeof cases} */
      const extraCases = [];
      for (const nr of nsResults) {
        const cid = String(/** @type {Record<string, unknown>} */ (nr).caseId || '');
        const baseId = cid.replace(/:authAlt$/, '');
        const baseCase = nsCasesById.get(baseId);
        if (!baseCase) continue;
        extraCases.push({
          ...baseCase,
          id: cid,
          family: 'NAMESPACE_AUTH_REPLAY',
        });
      }
      cases = [...cases, ...extraCases];
      model.observe({ kind: 'namespace_replay', count: nsResults.length });
    }
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

  const ts = Date.now();
  const generatedAt = new Date(ts).toISOString();
  const outDir = ensureOutputDir(cfg.outputDir);
  const evidenceHarHint = cfg.evidencePack ? path.join(outDir, `mythos-evidence-${ts}.har`) : null;

  const baselines = buildBaselineFingerprints(execResults);
  let findings = triageResults(execResults);

  const checkerHits = runCheckerPipeline(execResults, {
    evidenceHarPath: evidenceHarHint,
  });
  findings = [...findings, ...checkerHits];

  findings = enrichFindingsWithConfidence(findings, execResults, baselines).map((f) => ({
    ...f,
    minimization:
      f.kind === 'checker' || f.kind === 'bounty_signal'
        ? null
        : minimizationHint(casesById.get(f.caseId)),
  }));
  findings = enrichFindingsWithStatistics(findings, execResults);

  const sessionSnapshot = buildSessionSummary(execResults);

  if (cfg.campaignMemoryFile?.trim()) {
    const mp = path.resolve(cfg.campaignMemoryFile.trim());
    const merged = mergeCampaignMemory(persistedCampaignMemory, sessionSnapshot);
    fs.writeFileSync(mp, JSON.stringify(merged, null, 2));
  }

  /** @type {{ har: string, replay: string } | null} */
  let evidencePack = null;
  if (cfg.evidencePack) {
    const harPath = path.join(outDir, `mythos-evidence-${ts}.har`);
    const replayPath = path.join(outDir, `mythos-replay-${ts}.json`);
    const evShrink = {
      generatedAt,
      authHeader: cfg.auth ?? null,
      dedupeReplayCurls: true,
      maxReplayEntries: 120,
    };
    const har = buildHarLog(execResults, casesById, evShrink);
    const bundle = buildReplayBundle(execResults, casesById, evShrink);
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
      maxResponseBodyChars: previewCap,
      aiMutationHints: Boolean(cfg.aiMutationHints),
      wordlistFile: cfg.wordlistFile || null,
      maxWordlistInjections: cfg.maxWordlistInjections ?? 64,
      maxBodyMutationsPerOp: cfg.maxBodyMutationsPerOp ?? 0,
      authAltConfigured: Boolean(cfg.authAlt?.trim()),
      namespaceReplayBudget: cfg.namespaceReplayBudget ?? 24,
      useCuratedWordlist: Boolean(cfg.useCuratedWordlist),
      campaignMemoryFile: cfg.campaignMemoryFile || null,
    },
    checkerRegistry: MYTHOS_CHECKERS,
    checkersFired: checkerHits,
    owaspMappingRef: 'data/owasp-api-mapping.json',
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
    sessionMemory: sessionSnapshot,
    executed: execResults.length,
    findings,
    results: sanitizedResults,
    raw: sanitizedRaw,
  };

  const outfile = path.join(outDir, `mythos-report-${ts}.json`);
  fs.writeFileSync(outfile, JSON.stringify(report, null, 2));

  return { outfile, report };
}
