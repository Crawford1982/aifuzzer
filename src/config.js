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
  }

  return args;
}
