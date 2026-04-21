/**
 * Minimal CLI parsing — no dependencies.
 */

export function parseArgv(argv) {
  const args = {
    target: null,
    auth: null,
    concurrency: 4,
    maxRequests: 120,
    timeoutMs: 8000,
    outputDir: 'output',
    openapiPath: null,
    scopeFile: null,
    maxRps: 0,
    useStubPlan: false,
    planWithLlm: false,
    evidencePack: false,
    aiMutationHints: false,
    maxResponseBodyChars: undefined,
    wordlistFile: null,
    maxWordlistInjections: 64,
    maxBodyMutationsPerOp: 0,
    authAlt: null,
    namespaceReplayBudget: 24,
    namespaceReplayBudgetExplicit: false,
    useCuratedWordlist: false,
    campaignMemoryFile: null,
    authEnv: null,
    authAltEnv: null,
    ci: false,
    ciFailOnFindings: false,
    ciRequireScope: false,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--target' || a === '-t') args.target = argv[++i];
    else if (a === '--auth' || a === '-a') args.auth = argv[++i];
    else if (a === '--concurrency' || a === '-c') args.concurrency = Number(argv[++i]);
    else if (a === '--max-requests') args.maxRequests = Number(argv[++i]);
    else if (a === '--timeout-ms') args.timeoutMs = Number(argv[++i]);
    else if (a === '--output-dir') args.outputDir = argv[++i];
    else if (a === '--openapi') args.openapiPath = argv[++i];
    else if (a === '--scope-file') args.scopeFile = argv[++i];
    else if (a === '--max-rps') args.maxRps = Number(argv[++i]);
    else if (a === '--stub-plan') args.useStubPlan = true;
    else if (a === '--plan-with-llm') args.planWithLlm = true;
    else if (a === '--evidence-pack') args.evidencePack = true;
    else if (a === '--ai-mutation-hints') args.aiMutationHints = true;
    else if (a === '--max-response-chars') args.maxResponseBodyChars = Number(argv[++i]);
    else if (a === '--wordlist') args.wordlistFile = argv[++i];
    else if (a === '--max-wordlist-injections') args.maxWordlistInjections = Number(argv[++i]);
    else if (a === '--max-body-mutations-per-op') args.maxBodyMutationsPerOp = Number(argv[++i]);
    else if (a === '--auth-alt') args.authAlt = argv[++i];
    else if (a === '--namespace-replay-budget') {
      args.namespaceReplayBudget = Number(argv[++i]);
      args.namespaceReplayBudgetExplicit = true;
    }
    else if (a === '--curated-wordlist') args.useCuratedWordlist = true;
    else if (a === '--campaign-memory') args.campaignMemoryFile = argv[++i];
    else if (a === '--ci') args.ci = true;
    else if (a === '--ci-fail-on-findings') args.ciFailOnFindings = true;
    else if (a === '--ci-require-scope') args.ciRequireScope = true;
    else if (a === '--auth-env') args.authEnv = argv[++i];
    else if (a === '--auth-alt-env') args.authAltEnv = argv[++i];
  }

  return args;
}
