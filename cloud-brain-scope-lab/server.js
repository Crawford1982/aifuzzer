const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

const { browsePage } = require('./lib/browsePage');
const {
  isJsRenderedPolicyHost,
  looksHardOutOfScope,
  isDangerousHost,
  assertSafeFetchTarget,
  extractHttpUrls: extractHttpUrlsSafe,
  extractWildcardHosts: extractWildcardHostsSafe,
  detectHackerOneHandle,
  fetchHackerOneScope,
  expandHostPattern
} = require('./lib/scopeHelpers');
const { runFuzzPlan, generateProbes, DEFAULT_BUDGET, HARD_CEILING } = require('./lib/fuzzAgent');
const { discoverSurface, DEFAULT_PREFIXES } = require('./lib/surfaceAgent');
const { checkDynatraceProgramTarget } = require('./lib/dynatraceScope');

// In-memory plan store for the plan-and-fuzz flow. Plans expire after 30 min.
const PLAN_STORE = new Map();
const PLAN_TTL_MS = 30 * 60 * 1000;
function storePlan(plan) {
  const id = 'plan_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  PLAN_STORE.set(id, { ...plan, createdAt: Date.now() });
  setTimeout(() => PLAN_STORE.delete(id), PLAN_TTL_MS).unref?.();
  return id;
}
function loadPlan(id) {
  const plan = PLAN_STORE.get(id);
  if (!plan) return null;
  if (Date.now() - plan.createdAt > PLAN_TTL_MS) {
    PLAN_STORE.delete(id);
    return null;
  }
  return plan;
}

const app = express();
const PORT = process.env.PORT || 5000;
const CONVERSATIONS_DIR = path.join(__dirname, 'conversations');

if (!fs.existsSync(CONVERSATIONS_DIR)) {
  fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 12
  }
});

const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) {
  console.error('OPENROUTER_API_KEY not found in .env');
  process.exit(1);
}

console.log('OpenRouter API key loaded');

const USE_FREE_MODELS = process.env.USE_FREE_MODELS === 'true';
console.log(USE_FREE_MODELS ? 'Using :free chat model endpoints' : 'Using paid chat model endpoints');

const models = {
  auto: {
    id: 'auto',
    name: 'Auto Router',
    cost: 'Mixed',
    context: '-',
    bestFor: USE_FREE_MODELS
      ? 'Routes to free endpoints only'
      : 'Routes by task (reasoning vs writing vs speed)'
  },
  'gemma4-31': {
    id: USE_FREE_MODELS ? 'google/gemma-4-31b-it:free' : 'google/gemma-4-31b-it',
    name: 'Gemma 4 31B',
    cost: USE_FREE_MODELS ? 'FREE' : 'Paid',
    context: '256K',
    bestFor: 'General chat, balanced quality',
    maxTokens: {
      default: 4096,
      long: 8192
    }
  },
  'gemma4-26': {
    id: USE_FREE_MODELS ? 'google/gemma-4-26b-a4b-it:free' : 'google/gemma-4-26b-a4b-it',
    name: 'Gemma 4 26B MoE',
    cost: USE_FREE_MODELS ? 'FREE (fastest)' : 'Paid (fastest)',
    context: '256K',
    bestFor: 'Faster replies and everyday use',
    maxTokens: {
      default: 3072,
      long: 6144
    }
  },
  'deepseek-r1': {
    id: 'deepseek/deepseek-r1',
    name: 'DeepSeek R1',
    cost: 'PAID (reasoning)',
    context: '64K',
    bestFor: 'Step-by-step reasoning',
    maxTokens: {
      default: 4096,
      long: 8192
    }
  },
  kimi: {
    id: 'moonshotai/kimi-k2.5',
    name: 'Kimi K2.5',
    cost: '$0.38/$1.72 per M',
    context: '256K',
    bestFor: 'Longer planning and writing',
    maxTokens: {
      default: 8192,
      long: 16384
    }
  }
};

const imageModels = {
  gemini: {
    id: 'google/gemini-2.5-flash-image',
    name: 'Gemini 2.5 Flash Image',
    bestFor: 'Fast and reliable image generation',
    modalities: ['image', 'text'],
    maxTokens: 512
  },
  flux: {
    id: 'black-forest-labs/flux.2-flex',
    name: 'FLUX.2 Flex',
    bestFor: 'Alternative style and composition',
    modalities: ['image'],
    maxTokens: 256
  }
};

const ROUTER_POLICY = {
  profiles: {
    free: {
      extractor: ['gemma4-31', 'gemma4-26'],
      scout: ['gemma4-26', 'gemma4-31'],
      skeptic: ['gemma4-31', 'gemma4-26'],
      planner: ['gemma4-31', 'gemma4-26'],
      summary: ['gemma4-31', 'gemma4-26']
    },
    balanced: {
      extractor: ['gemma4-31', 'gemma4-26'],
      scout: ['gemma4-26', 'gemma4-31'],
      skeptic: ['deepseek-r1', 'gemma4-31'],
      planner: ['kimi', 'gemma4-31'],
      summary: ['gemma4-31', 'kimi']
    },
    premium: {
      extractor: ['kimi', 'gemma4-31'],
      scout: ['kimi', 'gemma4-31'],
      skeptic: ['deepseek-r1', 'kimi'],
      planner: ['kimi', 'deepseek-r1'],
      summary: ['kimi', 'gemma4-31']
    }
  },
  tokenBudgets: {
    extractor: 1400,
    scout: 800,
    skeptic: 1000,
    planner: 1600,
    summary: 1100
  }
};

function resolveProfile(requestedProfile = 'balanced') {
  const key = String(requestedProfile || '').toLowerCase();
  if (USE_FREE_MODELS) return 'free';
  if (ROUTER_POLICY.profiles[key]) return key;
  return 'balanced';
}

function pickModelForStage(stage, requestedProfile = 'balanced') {
  const profile = resolveProfile(requestedProfile);
  const candidates = ROUTER_POLICY.profiles[profile][stage] || ['gemma4-31'];
  for (const key of candidates) {
    if (models[key]) return { modelKey: key, profile };
  }
  return { modelKey: 'gemma4-31', profile };
}

function parseExtractorJson(raw) {
  let parsed = {};
  try {
    const m = String(raw).match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : JSON.parse(raw);
  } catch (_e) {
    parsed = { confidence: 'low', rules: ['Could not parse LLM JSON cleanly.'] };
  }
  return parsed;
}

function mergeParsedReports(a, b) {
  const uniq = (...arrays) =>
    [...new Set(arrays.flat().filter((x) => x != null && String(x).trim() !== ''))];
  const rank = { low: 0, medium: 1, high: 2 };
  const mergeConf = (c1, c2) => {
    const v = Math.max(rank[c1] ?? 0, rank[c2] ?? 0);
    return v === 2 ? 'high' : v === 1 ? 'medium' : 'low';
  };
  const pickProgram = () => {
    const pa = String(a.program || '').trim();
    const pb = String(b.program || '').trim();
    return pa.length >= pb.length ? pa : pb;
  };
  return {
    program: pickProgram(),
    inScopeAssets: uniq(a.inScopeAssets, b.inScopeAssets),
    explicitUrls: uniq(a.explicitUrls, b.explicitUrls),
    inScopeHostPatterns: uniq(a.inScopeHostPatterns, b.inScopeHostPatterns),
    outOfScopeNotes: uniq(a.outOfScopeNotes, b.outOfScopeNotes),
    rules: uniq(a.rules, b.rules),
    setupNotes: uniq(a.setupNotes, b.setupNotes),
    confidence: mergeConf(a.confidence || 'low', b.confidence || 'low')
  };
}

function visionModelIdForProfile(requestedProfile) {
  const profile = resolveProfile(requestedProfile);
  const defaults = {
    free: process.env.SCOPE_VISION_MODEL_FREE || 'google/gemini-2.0-flash-001',
    balanced: process.env.SCOPE_VISION_MODEL || 'google/gemini-2.0-flash-001',
    premium: process.env.SCOPE_VISION_MODEL_PREMIUM || 'openai/gpt-4o-mini'
  };
  return defaults[profile] || defaults.balanced;
}

async function runScopeExtraction(policyUrl, requestedProfile, browseEnabled) {
  const notes = [];

  // SSRF guard on the policy URL itself.
  try {
    assertSafeFetchTarget(policyUrl);
  } catch (e) {
    throw new Error(`Rejected policy URL: ${e.message}`);
  }

  // Auto-enable browse for known JS-rendered policy hosts (HackerOne,
  // Bugcrowd, Intigriti, YesWeHack). The user shouldn't need to remember
  // /scope-browse for sites that literally cannot be parsed without JS.
  let effectiveBrowse = Boolean(browseEnabled);
  if (!effectiveBrowse && isJsRenderedPolicyHost(policyUrl)) {
    effectiveBrowse = true;
    notes.push('Auto-enabled headless browse for JS-rendered policy host.');
  }

  const browseInfo = {
    used: effectiveBrowse,
    ok: false,
    title: '',
    finalUrl: '',
    screenshotBytes: 0,
    error: null
  };

  // HackerOne fast-path: their policy is fronted by a public GraphQL API.
  // When we can match this, we bypass LLM page parsing entirely and return
  // structured scope — dramatically more accurate.
  const h1Handle = detectHackerOneHandle(policyUrl);
  if (h1Handle) {
    const h1 = await fetchHackerOneScope(h1Handle);
    if (h1) {
      notes.push(`Used HackerOne GraphQL fast-path for program "${h1.program}" (handle: ${h1.handle}).`);
      let explicitUrls = [...new Set(h1.explicitUrls || [])];
      const hostPatterns = [...new Set(h1.inScopeHostPatterns || [])];
      if (String(h1Handle).toLowerCase() === 'dynatrace') {
        const before = explicitUrls.length;
        explicitUrls = explicitUrls.filter((u) => checkDynatraceProgramTarget(u).ok);
        if (before > explicitUrls.length) {
          notes.push(
            `Dynatrace scope filter: dropped ${before - explicitUrls.length} URL(s) not under .dynatrace.com / .dynatrace.cloud / .dynatracelabs.com (or blocked GitHub).`
          );
        }
      }
      let candidateTargets = [...new Set(explicitUrls)]
        .filter((u) => !looksHardOutOfScope(u))
        .slice(0, 40);
      if (String(h1Handle).toLowerCase() === 'dynatrace') {
        candidateTargets = candidateTargets.filter((u) => checkDynatraceProgramTarget(u).ok);
      }
      return {
        profile: resolveProfile(requestedProfile),
        extractorPick: { modelKey: 'hackerone_api', profile: resolveProfile(requestedProfile) },
        parsed: h1,
        explicitUrls,
        hostPatterns,
        candidateTargets,
        notes,
        browse: { ...browseInfo, used: false, ok: false, error: 'skipped_fast_path' },
        visionModelId: null
      };
    }
    notes.push('HackerOne GraphQL fast-path failed; falling back to HTML/LLM extraction.');
  }

  const pageRes = await fetch(policyUrl, {
    method: 'GET',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml'
    }
  });
  if (!pageRes.ok) {
    throw new Error(`Failed to fetch page: HTTP ${pageRes.status}`);
  }
  const html = await pageRes.text();

  let screenshotBase64 = '';
  let renderedText = '';
  if (effectiveBrowse) {
    try {
      const snap = await browsePage(policyUrl);
      browseInfo.ok = true;
      browseInfo.title = snap.title || '';
      browseInfo.finalUrl = snap.finalUrl || '';
      browseInfo.screenshotBytes = snap.screenshotBytes || 0;
      screenshotBase64 = snap.screenshotBase64 || '';
      renderedText = snap.text || '';
    } catch (e) {
      browseInfo.error = e.message || String(e);
      notes.push(`Headless browse failed (${browseInfo.error}). Using HTTP response text only.`);
    }
  }

  const textFromHtml = stripHtml(html).slice(0, 45000);
  const combinedText =
    renderedText.length > 200
      ? `${renderedText.slice(0, 55000)}\n\n--- markup text ---\n${textFromHtml.slice(0, 20000)}`
      : textFromHtml;

  const foundUrls = [...new Set([...extractHttpUrlsSafe(html), ...extractHttpUrlsSafe(renderedText)])];
  const foundHosts = extractWildcardHostsSafe(combinedText);

  const extractorPrompt = `
You are parsing a bug bounty policy or related page.
Return ONLY JSON:
{
  "program": "string",
  "inScopeAssets": ["string"],
  "explicitUrls": ["string"],
  "inScopeHostPatterns": ["string"],
  "outOfScopeNotes": ["string"],
  "rules": ["string"],
  "setupNotes": ["string"],
  "confidence": "low|medium|high"
}
Text:
${combinedText.slice(0, 62000)}
`;

  const extractorPick = pickModelForStage('extractor', requestedProfile);
  const rawExtract = await callOpenRouterChat({
    modelId: models[extractorPick.modelKey].id,
    messages: [{ role: 'user', content: extractorPrompt }],
    temperature: 0.1,
    maxTokens: ROUTER_POLICY.tokenBudgets.extractor
  });

  let parsedText = parseExtractorJson(rawExtract);
  let parsedVision = {};
  let visionModelId = null;

  if (
    effectiveBrowse &&
    browseInfo.ok &&
    typeof screenshotBase64 === 'string' &&
    screenshotBase64.length > 100
  ) {
    visionModelId = visionModelIdForProfile(requestedProfile);
    const visionPrompt = `
You see a screenshot of a web page (often a bug bounty scope / policy page).
Extract ONLY information that is clearly readable in the image. Do not guess URLs or hosts that are not visible.
Return ONLY valid JSON with this shape:
{
  "program": "string",
  "inScopeAssets": ["string"],
  "explicitUrls": ["string"],
  "inScopeHostPatterns": ["string"],
  "outOfScopeNotes": ["string"],
  "rules": ["string"],
  "setupNotes": ["string"],
  "confidence": "low|medium|high"
}
`;

    const rawVision = await callOpenRouterChat({
      modelId: visionModelId,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: visionPrompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${screenshotBase64}` }
            }
          ]
        }
      ],
      temperature: 0.1,
      maxTokens: ROUTER_POLICY.tokenBudgets.extractor
    });
    parsedVision = parseExtractorJson(rawVision);
  }

  const parsed = mergeParsedReports(parsedText, parsedVision);

  const explicitUrls = [
    ...new Set(
      [...(parsed.explicitUrls || []), ...foundUrls].filter((u) => /^https?:\/\//i.test(u))
    )
  ];
  const hostPatterns = [...new Set([...(parsed.inScopeHostPatterns || []), ...foundHosts])];
  const candidateTargets = explicitUrls
    .filter((u) => !looksHardOutOfScope(u))
    .slice(0, 40);

  return {
    profile: resolveProfile(requestedProfile),
    extractorPick,
    parsed,
    explicitUrls,
    hostPatterns,
    candidateTargets,
    notes,
    browse: browseInfo,
    visionModelId
  };
}

async function callOpenRouterChat({ modelId, messages, temperature = 0.2, maxTokens = 1200 }) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Cloud Brain Scope Analyzer'
    },
    body: JSON.stringify({
      model: modelId,
      messages,
      temperature,
      max_tokens: maxTokens
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${err.slice(0, 500)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  // Handle structured content (array of parts) as well as plain strings.
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (!trimmed) {
      const finishReason = data?.choices?.[0]?.finish_reason || 'unknown';
      return `_[model returned empty content; finish_reason=${finishReason}. Try a larger token budget or a different model.]_`;
    }
    return content;
  }
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('')
      .trim();
    if (!joined) {
      return `_[model returned no text parts; try a larger token budget or a different model.]_`;
    }
    return joined;
  }
  return '_[no content field in model response]_';
}

function stripHtml(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHttpUrls(text = '') {
  const matches = String(text).match(/https?:\/\/[^\s"'<>]+/gi) || [];
  return [...new Set(matches.map((u) => u.replace(/[),.;]+$/, '')))];
}

function extractWildcardHosts(text = '') {
  const wildcard = String(text).match(/\*\.[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  const plainHosts = String(text).match(/\b[a-z0-9.-]+\.[a-z]{2,}\b/gi) || [];
  const merged = [...wildcard, ...plainHosts];
  return [...new Set(merged.map((h) => h.toLowerCase()))];
}

function looksOutOfScope(u) {
  const host = (() => {
    try {
      return new URL(u).hostname.toLowerCase();
    } catch (_e) {
      return '';
    }
  })();
  return host === 'github.com' || host.endsWith('.github.com');
}

function chooseModelForTask(message = '', hasFiles = false) {
  const text = String(message).toLowerCase();
  const reasoningSignals = [
    'reason',
    'step by step',
    'prove',
    'math',
    'logic',
    'analyze deeply',
    'tradeoff',
    'compare options'
  ];
  const writingSignals = [
    'polish',
    'rewrite',
    'refactor writing',
    'proposal',
    'email',
    'tone',
    'pitch',
    'plan',
    'document'
  ];
  const speedSignals = ['quick', 'fast', 'brief', 'short'];

  if (USE_FREE_MODELS) {
    if (speedSignals.some((k) => text.includes(k))) return 'gemma4-26';
    return 'gemma4-31';
  }

  if (reasoningSignals.some((k) => text.includes(k))) return 'deepseek-r1';
  if (hasFiles || writingSignals.some((k) => text.includes(k))) return 'kimi';
  if (speedSignals.some((k) => text.includes(k))) return 'gemma4-26';
  return 'gemma4-31';
}

function parseMessagesFromBody(rawMessages) {
  if (Array.isArray(rawMessages)) return rawMessages;
  if (typeof rawMessages !== 'string') return [];
  try {
    const parsed = JSON.parse(rawMessages);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

function buildFilesContext(files = []) {
  if (!Array.isArray(files) || files.length === 0) return '';

  const textExts = new Set([
    '.txt',
    '.md',
    '.json',
    '.csv',
    '.tsv',
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.py',
    '.java',
    '.go',
    '.rs',
    '.c',
    '.cpp',
    '.h',
    '.hpp',
    '.css',
    '.html',
    '.xml',
    '.yaml',
    '.yml',
    '.toml',
    '.ini',
    '.log',
    '.sql'
  ]);

  return files
    .map((file, idx) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const isText = (file.mimetype || '').startsWith('text/') || textExts.has(ext);
      if (!isText) {
        return `File ${idx + 1}: ${file.originalname} (${file.mimetype || 'binary'}, ${file.size} bytes)\n[Binary file not inlined]`;
      }

      const content = file.buffer.toString('utf8').slice(0, 12000);
      return `File ${idx + 1}: ${file.originalname}\n\`\`\`\n${content}\n\`\`\``;
    })
    .join('\n\n');
}

app.post('/api/scope/analyze', async (req, res) => {
  try {
    const policyUrl = String(req.body?.policyUrl || '').trim();
    const requestedProfile = String(req.body?.profile || 'balanced');
    const browseEnabled = Boolean(req.body?.browse);

    if (!policyUrl || !/^https?:\/\//i.test(policyUrl)) {
      return res.status(400).json({ error: 'policyUrl must be a full http(s) URL.' });
    }

    const ext = await runScopeExtraction(policyUrl, requestedProfile, browseEnabled);

    const suggestedCommands = ext.candidateTargets.slice(0, 8).map((u) => ({
      target: u,
      command: `npm start -- --target "${u}" --concurrency 1 --max-requests 15 --timeout-ms 6000`
    }));

    const notes = [...ext.notes];
    if (ext.candidateTargets.length === 0 && /hacktivity/i.test(policyUrl)) {
      notes.push('Hacktivity pages are activity feeds and often do not contain policy scope URLs.');
      notes.push('Use the policy scope page URL for extraction (e.g., /policy_scopes).');
    }

    return res.json({
      policyUrl,
      profile: ext.profile,
      model: ext.extractorPick.modelKey,
      browse: ext.browse,
      visionModel: ext.visionModelId,
      report: {
        ...ext.parsed,
        explicitUrls: ext.explicitUrls,
        inScopeHostPatterns: ext.hostPatterns
      },
      candidateTargets: ext.candidateTargets,
      suggestedCommands,
      notes,
      safety: [
        'Review scope manually before probing.',
        'Start with concurrency=1 and low max-requests.',
        'Do not test generic github.com unless repo is explicitly in scope.'
      ]
    });
  } catch (error) {
    console.error('Scope analyze error:', error);
    return res.status(500).json({ error: 'Failed to analyze scope URL.' });
  }
});

app.post('/api/scope/discuss', async (req, res) => {
  try {
    const policyUrl = String(req.body?.policyUrl || '').trim();
    const requestedProfile = String(req.body?.profile || 'balanced').trim();
    const browseEnabled = Boolean(req.body?.browse);

    if (!policyUrl || !/^https?:\/\//i.test(policyUrl)) {
      return res.status(400).json({ error: 'policyUrl must be a full http(s) URL.' });
    }

    const ext = await runScopeExtraction(policyUrl, requestedProfile, browseEnabled);
    const parsed = ext.parsed;
    const explicitUrls = ext.explicitUrls;
    const hostPatterns = ext.hostPatterns;
    const candidateTargets = ext.candidateTargets;

    const debateContext = `
Policy URL: ${policyUrl}
Program: ${parsed.program || 'unknown'}
Candidate URLs (${candidateTargets.length}): ${candidateTargets.join(', ') || 'none'}
Host patterns: ${hostPatterns.join(', ') || 'none'}
Rules: ${(parsed.rules || []).join(' | ') || 'none'}
Out-of-scope notes: ${(parsed.outOfScopeNotes || []).join(' | ') || 'none'}
Setup notes: ${(parsed.setupNotes || []).join(' | ') || 'none'}
`;

    const scoutPick = pickModelForStage('scout', requestedProfile);
    const scout = await callOpenRouterChat({
      modelId: models[scoutPick.modelKey].id,
      messages: [
        {
          role: 'user',
          content:
            `You are Scope Scout. In 6 bullets, list likely in-scope target URLs to start with and why.\n${debateContext}`
        }
      ],
      temperature: 0.2,
      maxTokens: ROUTER_POLICY.tokenBudgets.scout
    });

    const skepticPick = pickModelForStage('skeptic', requestedProfile);
    const skeptic = await callOpenRouterChat({
      modelId: models[skepticPick.modelKey].id,
      messages: [
        {
          role: 'user',
          content:
            `You are Scope Skeptic. Identify policy traps, out-of-scope risk, and what NOT to probe.\n${debateContext}`
        }
      ],
      temperature: 0.2,
      maxTokens: ROUTER_POLICY.tokenBudgets.skeptic
    });

    const plannerPick = pickModelForStage('planner', requestedProfile);
    const planner = await callOpenRouterChat({
      modelId: models[plannerPick.modelKey].id,
      messages: [
        {
          role: 'user',
          content:
            `You are Run Planner. Build a cautious first-run plan (3 phases) with low traffic limits and exact command templates.\n${debateContext}`
        }
      ],
      temperature: 0.2,
      maxTokens: ROUTER_POLICY.tokenBudgets.planner
    });

    const summaryPrompt = `
Synthesize this into one practical response:

Scout:
${scout}

Skeptic:
${skeptic}

Planner:
${planner}

Return concise markdown with:
1) what page type this is (policy vs hacktivity etc),
2) top 5 safe starting URLs,
3) first command to run.
`;

    const summaryPick = pickModelForStage('summary', requestedProfile);
    const summary = await callOpenRouterChat({
      modelId: models[summaryPick.modelKey].id,
      messages: [{ role: 'user', content: summaryPrompt }],
      temperature: 0.2,
      maxTokens: ROUTER_POLICY.tokenBudgets.summary
    });

    const notes = [...ext.notes];
    if (candidateTargets.length === 0 && /hacktivity/i.test(policyUrl)) {
      notes.push('This appears to be a Hacktivity page; it often lacks policy scope details.');
      notes.push('Try the program policy URL (for Dynatrace: /policy_scopes).');
    }

    return res.json({
      policyUrl,
      profile: resolveProfile(requestedProfile),
      browse: ext.browse,
      routing: {
        extractor: ext.extractorPick.modelKey,
        visionExtractor: ext.visionModelId,
        scout: scoutPick.modelKey,
        skeptic: skepticPick.modelKey,
        planner: plannerPick.modelKey,
        summary: summaryPick.modelKey
      },
      report: {
        ...parsed,
        explicitUrls,
        inScopeHostPatterns: hostPatterns
      },
      candidateTargets,
      discussion: [
        { agent: 'Scope Scout', modelKey: scoutPick.modelKey, content: scout },
        { agent: 'Scope Skeptic', modelKey: skepticPick.modelKey, content: skeptic },
        { agent: 'Run Planner', modelKey: plannerPick.modelKey, content: planner }
      ],
      summary,
      notes
    });
  } catch (error) {
    console.error('Scope discuss error:', error);
    return res.status(500).json({ error: 'Failed to run scope discussion.' });
  }
});

/**
 * Plan-and-fuzz: run scope extraction + agent debate, then stash an approval
 * plan the user confirms before any probing actually fires. Returns a planId.
 *
 * Flow:
 *   1. POST /api/scope/plan-and-fuzz { policyUrl, profile, browse }
 *      → returns { planId, candidateTargets, summary }
 *   2. User ticks which targets to approve.
 *   3. POST /api/fuzz/run { planId, approvedTargets, budget, authToken }
 *      → streams probe results as JSONL, then a final summary.
 */
app.post('/api/scope/plan-and-fuzz', async (req, res) => {
  try {
    const policyUrl = String(req.body?.policyUrl || '').trim();
    const requestedProfile = String(req.body?.profile || 'balanced');
    const browseEnabled = Boolean(req.body?.browse);

    if (!policyUrl || !/^https?:\/\//i.test(policyUrl)) {
      return res.status(400).json({ error: 'policyUrl must be a full http(s) URL.' });
    }

    const ext = await runScopeExtraction(policyUrl, requestedProfile, browseEnabled);
    const planId = storePlan({
      policyUrl,
      profile: ext.profile,
      candidateTargets: ext.candidateTargets,
      hostPatterns: ext.hostPatterns,
      parsed: ext.parsed,
      extractorPick: ext.extractorPick,
      visionModelId: ext.visionModelId || null
    });

    return res.json({
      planId,
      policyUrl,
      profile: ext.profile,
      browse: ext.browse,
      extractorModel: ext.extractorPick?.modelKey || null,
      visionModel: ext.visionModelId || null,
      candidateTargets: ext.candidateTargets,
      hostPatterns: ext.hostPatterns,
      outOfScopeNotes: ext.parsed?.outOfScopeNotes || [],
      rules: ext.parsed?.rules || [],
      notes: ext.notes,
      safety: [
        'Review each candidate target before approving.',
        'Do NOT approve any target listed in outOfScopeNotes.',
        'You can optionally run Surface discovery first (POST /api/surface/discover) to find API endpoints on approved hosts.',
        'Budget is capped server-side; max 80 requests and concurrency 4 regardless of what you send.'
      ]
    });
  } catch (error) {
    console.error('plan-and-fuzz error:', error);
    return res.status(500).json({ error: error.message || 'Failed to build fuzz plan.' });
  }
});

/**
 * Surface discovery: probe a small list of common API prefixes on the plan's
 * in-scope hosts (and wildcard-expansion of hostPatterns) to find endpoints
 * that are actually API-like, instead of CDN-fronted marketing pages.
 *
 * This is optional. The fuzzer still works without it — but for programs like
 * REI where candidate targets are the marketing homepage, surface discovery
 * is the thing that unlocks real findings.
 */
app.post('/api/surface/discover', async (req, res) => {
  try {
    const { planId, seeds: bodySeeds, includeHostPatterns } = req.body || {};
    const plan = planId ? loadPlan(planId) : null;
    if (planId && !plan) {
      return res.status(400).json({ error: 'Plan not found or expired. Re-run /api/scope/plan-and-fuzz.' });
    }

    // Assemble seeds: explicit body seeds ∪ plan.candidateTargets ∪ expanded hostPatterns.
    const seedSet = new Set();
    if (Array.isArray(bodySeeds)) {
      for (const s of bodySeeds) if (typeof s === 'string' && s.trim()) seedSet.add(s.trim());
    }
    if (plan) {
      for (const u of plan.candidateTargets || []) seedSet.add(u);
      if (includeHostPatterns !== false) {
        for (const pat of plan.hostPatterns || []) {
          for (const h of expandHostPattern(pat)) seedSet.add(`https://${h}`);
        }
      }
    }
    const seeds = [...seedSet];
    if (seeds.length === 0) {
      return res.status(400).json({ error: 'No seeds to discover from. Provide seeds[] or a planId.' });
    }

    // Apply program-specific scope enforcement (e.g. Dynatrace) as a belt-and-braces check.
    const handle = String(plan?.parsed?.handle || '').toLowerCase();
    const dynatracePolicy =
      handle === 'dynatrace' ||
      String(plan?.policyUrl || '')
        .toLowerCase()
        .includes('hackerone.com/dynatrace');
    const scopeTargetCheck = dynatracePolicy ? (u) => checkDynatraceProgramTarget(u) : null;

    const result = await discoverSurface({
      seeds,
      scopeTargetCheck
    });

    return res.json({
      planId: planId || null,
      seeds,
      approvedTargets: result.approvedTargets,
      attempts: result.attempts,
      stats: result.stats
    });
  } catch (error) {
    console.error('surface/discover error:', error);
    return res.status(500).json({ error: error.message || 'Surface discovery failed.' });
  }
});

app.post('/api/fuzz/run', async (req, res) => {
  try {
    const { planId, approvedTargets, budget, authToken } = req.body || {};
    const plan = planId ? loadPlan(planId) : null;
    if (planId && !plan) {
      return res.status(400).json({ error: 'Plan not found or expired. Re-run /api/scope/plan-and-fuzz.' });
    }

    // Targets must be consistent with the plan: either an exact URL match against
    // candidateTargets, OR the target's HOST must be a candidate host or a wildcard
    // expansion of a hostPattern (this is what lets surface-discovered URLs through).
    const buildAllowedHosts = (plan) => {
      const hosts = new Set();
      for (const u of plan?.candidateTargets || []) {
        try { hosts.add(new URL(u).hostname.toLowerCase()); } catch (_e) { /* ignore */ }
      }
      for (const pat of plan?.hostPatterns || []) {
        for (const h of expandHostPattern(pat)) hosts.add(h.toLowerCase());
      }
      return hosts;
    };
    const targetHost = (u) => {
      try { return new URL(u).hostname.toLowerCase(); } catch (_e) { return ''; }
    };

    const rawTargets = Array.isArray(approvedTargets) ? approvedTargets : null;
    let targets;
    if (plan && (rawTargets === null || rawTargets.length === 0)) {
      // "/fuzz <planId>" with no explicit list = approve all plan candidates.
      targets = [...(plan.candidateTargets || [])];
    } else {
      const provided = Array.isArray(rawTargets) ? rawTargets : [];
      targets = provided.filter((t) => typeof t === 'string' && t.trim().length > 0);
      if (plan) {
        const allowedUrls = new Set(plan.candidateTargets || []);
        const allowedHosts = buildAllowedHosts(plan);
        const accept = (t) => allowedUrls.has(t) || allowedHosts.has(targetHost(t));
        const rejected = targets.filter((t) => !accept(t));
        targets = targets.filter(accept);
        if (rejected.length > 0 && targets.length === 0) {
          return res.status(400).json({
            error: 'None of the approved targets matched this plan (by URL or host).',
            rejected
          });
        }
      }
    }
    if (targets.length === 0) {
      return res.status(400).json({
        error: plan
          ? 'Plan has no candidate targets to fuzz. Try a different policy URL or add targets manually.'
          : 'approvedTargets must contain at least one URL.'
      });
    }

    // Stream NDJSON so the frontend can render probe-by-probe.
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const emit = (event) => {
      try {
        res.write(JSON.stringify(event) + '\n');
      } catch (_e) {
        // Client disconnected; swallow.
      }
    };

    // Wire the LLM hooks into fuzzAgent using the existing router policy.
    // Scout does hypothesis expansion; Skeptic does finding triage.
    const profile = plan?.profile || 'balanced';
    const llm = {
      expand: async ({ prompt }) => {
        const pick = pickModelForStage('scout', profile);
        return callOpenRouterChat({
          modelId: models[pick.modelKey].id,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          maxTokens: ROUTER_POLICY.tokenBudgets.scout
        });
      },
      review: async ({ prompt }) => {
        const pick = pickModelForStage('skeptic', profile);
        return callOpenRouterChat({
          modelId: models[pick.modelKey].id,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          maxTokens: ROUTER_POLICY.tokenBudgets.skeptic
        });
      }
    };

    const enableAI = req.body?.enableAI !== false; // default on; pass false to disable

    const handle = String(plan?.parsed?.handle || '').toLowerCase();
    const dynatracePolicy =
      handle === 'dynatrace' ||
      String(plan?.policyUrl || '')
        .toLowerCase()
        .includes('hackerone.com/dynatrace');
    const scopeTargetCheck = dynatracePolicy ? (u) => checkDynatraceProgramTarget(u) : null;

    try {
      await runFuzzPlan({
        targets,
        budget,
        authToken: typeof authToken === 'string' && authToken.trim() ? authToken.trim() : null,
        llm: enableAI ? llm : null,
        onEvent: emit,
        scopeTargetCheck
      });
    } catch (e) {
      emit({ type: 'error', error: e.message || String(e) });
    }

    res.end();
  } catch (error) {
    console.error('fuzz/run error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message || 'Failed to run fuzz plan.' });
    }
    try { res.end(); } catch (_e) { /* ignore */ }
  }
});

app.get('/api/fuzz/limits', (req, res) => {
  res.json({
    defaultBudget: DEFAULT_BUDGET,
    hardCeiling: HARD_CEILING,
    surfacePrefixes: DEFAULT_PREFIXES
  });
});

app.post('/api/fuzz/preview', (req, res) => {
  try {
    const target = String(req.body?.target || '').trim();
    if (!target) return res.status(400).json({ error: 'target is required.' });
    try {
      assertSafeFetchTarget(target);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    if (looksHardOutOfScope(target)) {
      return res.status(400).json({ error: 'Target matches hard out-of-scope denylist.' });
    }
    const probes = generateProbes(target, { hasAuth: Boolean(req.body?.hasAuth) });
    return res.json({ target, probeCount: probes.length, probes });
  } catch (error) {
    console.error('fuzz/preview error:', error);
    return res.status(500).json({ error: 'Failed to preview probes.' });
  }
});

app.get('/api/router/policy', (req, res) => {
  res.json({
    useFreeModels: USE_FREE_MODELS,
    availableModels: Object.keys(models).filter((k) => k !== 'auto'),
    policy: ROUTER_POLICY
  });
});

app.get('/api/conversations', (req, res) => {
  try {
    const files = fs.readdirSync(CONVERSATIONS_DIR);
    const conversations = files
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const data = JSON.parse(fs.readFileSync(path.join(CONVERSATIONS_DIR, f), 'utf-8'));
        return {
          id: f.replace('.json', ''),
          title: data.title || 'Untitled',
          createdAt: data.createdAt,
          messageCount: data.messages?.length || 0
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(conversations);
  } catch (error) {
    console.error('Error reading conversations:', error);
    res.status(500).json({ error: 'Failed to read conversations' });
  }
});

app.get('/api/conversations/:id', (req, res) => {
  try {
    const filePath = path.join(CONVERSATIONS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return res.json(data);
  } catch (error) {
    console.error('Error reading conversation:', error);
    return res.status(500).json({ error: 'Failed to read conversation' });
  }
});

app.post('/api/conversations', (req, res) => {
  try {
    const id = Date.now().toString();
    const conversation = {
      id,
      title: req.body.title || 'New Conversation',
      model: req.body.model || 'gemma4-31',
      createdAt: new Date().toISOString(),
      messages: []
    };
    fs.writeFileSync(
      path.join(CONVERSATIONS_DIR, `${id}.json`),
      JSON.stringify(conversation, null, 2)
    );
    res.json(conversation);
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

app.post('/api/conversations/:id/save', (req, res) => {
  try {
    const filePath = path.join(CONVERSATIONS_DIR, `${req.params.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving conversation:', error);
    res.status(500).json({ error: 'Failed to save conversation' });
  }
});

app.delete('/api/conversations/:id', (req, res) => {
  try {
    const filePath = path.join(CONVERSATIONS_DIR, `${req.params.id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

app.get('/api/models', (req, res) => {
  res.json(models);
});

app.get('/api/image-models', (req, res) => {
  res.json(imageModels);
});

app.post('/api/images', async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    const imageModelKey = req.body?.imageModel || 'gemini';
    if (!prompt) return res.status(400).json({ error: 'Prompt is required.' });
    if (!imageModels[imageModelKey]) return res.status(400).json({ error: 'Invalid image model.' });

    const modelCfg = imageModels[imageModelKey];
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Cloud Brain'
      },
      body: JSON.stringify({
        model: modelCfg.id,
        messages: [{ role: 'user', content: prompt }],
        modalities: modelCfg.modalities || ['image'],
        max_tokens: modelCfg.maxTokens || 512
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      let details = errorText;
      try {
        const parsed = JSON.parse(errorText);
        details = parsed?.error?.message || errorText;
      } catch (_e) {
        // keep raw text
      }
      return res.status(response.status).json({ error: details });
    }

    const data = await response.json();
    const msg = data?.choices?.[0]?.message || {};
    const imageUrlsFromImages = Array.isArray(msg.images)
      ? msg.images
          .map((img) => img?.image_url?.url)
          .filter(Boolean)
      : [];
    const contentParts = Array.isArray(msg.content) ? msg.content : [];
    const imageUrlsFromContent = contentParts
      .filter((part) => part?.type === 'image_url' && part?.image_url?.url)
      .map((part) => part.image_url.url);
    const imageUrls = [...imageUrlsFromImages, ...imageUrlsFromContent];
    const text =
      typeof msg.content === 'string'
        ? msg.content
        : contentParts
            .filter((part) => part?.type === 'text' && typeof part?.text === 'string')
            .map((part) => part.text)
            .join('\n');

    if (imageUrls.length === 0) {
      return res.status(502).json({ error: 'No image returned by provider.' });
    }

    return res.json({
      model: imageModelKey,
      modelName: modelCfg.name,
      prompt,
      text,
      imageUrls
    });
  } catch (error) {
    console.error('Image generation error:', error);
    return res.status(500).json({ error: 'Failed to generate image.' });
  }
});

app.post('/api/chat', upload.array('files', 12), async (req, res) => {
  try {
    const isMultipart = Boolean(req.headers['content-type']?.includes('multipart/form-data'));
    const message = isMultipart ? req.body.message : req.body.message;
    const requestedModel = isMultipart ? req.body.model : req.body.model;
    const messages = isMultipart
      ? parseMessagesFromBody(req.body.messages)
      : Array.isArray(req.body.messages)
        ? req.body.messages
        : [];
    const files = Array.isArray(req.files) ? req.files : [];

    const selectedModelKey =
      requestedModel === 'auto'
        ? chooseModelForTask(
            `${message || ''}\n${messages.map((m) => m?.content || '').join('\n')}`,
            files.length > 0
          )
        : requestedModel;
    const longAnswerRaw = isMultipart ? req.body.longAnswer : req.body.longAnswer;
    const longAnswerMode = longAnswerRaw === true || longAnswerRaw === 'true';

    if (!selectedModelKey || !models[selectedModelKey] || selectedModelKey === 'auto') {
      return res.status(400).json({ error: 'Invalid model' });
    }

    const modelConfig = models[selectedModelKey];
    const maxTokens =
      modelConfig?.maxTokens?.[longAnswerMode ? 'long' : 'default'] ||
      (longAnswerMode ? 4096 : 2048);
    const filesContext = buildFilesContext(files);
    const systemMessage = {
      role: 'system',
      content: `You are ${modelConfig.name} running via OpenRouter in Cloud Brain. If asked which model you are, answer exactly "${modelConfig.name}".`
    };
    const fullMessages = [
      systemMessage,
      ...(Array.isArray(messages)
        ? messages.map((m) => ({ role: m.role, content: m.content }))
        : []),
      {
        role: 'user',
        content: filesContext
          ? `${message}\n\nUse the attached context below when relevant:\n\n${filesContext}`
          : message
      }
    ];
    const recentMessages = fullMessages.slice(-20);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(
      `data: ${JSON.stringify({ model: selectedModelKey, modelName: modelConfig.name, fileCount: files.length, maxTokens })}\n\n`
    );

    const fetchResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Cloud Brain'
      },
      body: JSON.stringify({
        model: modelConfig.id,
        messages: recentMessages,
        stream: true,
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: maxTokens
      })
    });

    if (!fetchResponse.ok) {
      const error = await fetchResponse.text();
      console.error('OpenRouter Error:', error);
      let details = '';
      try {
        const parsed = JSON.parse(error);
        details = parsed?.error?.message ? ` - ${parsed.error.message}` : '';
      } catch (_e) {
        // Keep empty details if error body is not JSON.
      }
      res.write(
        `data: ${JSON.stringify({ error: `API Error: ${fetchResponse.status}${details}` })}\n\n`
      );
      res.end();
      return;
    }

    const reader = fetchResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') {
          res.write('data: [DONE]\n\n');
          continue;
        }
        try {
          const json = JSON.parse(data);
          const content = json?.choices?.[0]?.delta?.content;
          if (typeof content === 'string' && content.length > 0) {
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        } catch (_e) {
          // Malformed SSE chunk — skip and keep streaming.
        }
      }
    }

    res.end();
  } catch (error) {
    console.error('Chat error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message || 'Chat failed.' });
    }
    try {
      res.write(`data: ${JSON.stringify({ error: error.message || 'Chat failed.' })}\n\n`);
      res.end();
    } catch (_e) { /* ignore */ }
  }
});

app.listen(PORT, () => {
  console.log(`Cloud Brain Scope Lab listening on http://localhost:${PORT}`);
});