'use strict';

/**
 * Scope extraction helpers: SSRF guard, URL hygiene, known-host detection,
 * and a HackerOne-specific fast path that pulls structured scope from their
 * public GraphQL endpoint instead of relying on LLM page parsing.
 *
 * Pass D additions:
 *   - expandHostPattern(): turn an H1-style wildcard (e.g. *.example.com)
 *     into concrete candidate hostnames for the Surface layer to probe.
 */

// Hosts whose policy pages are client-rendered (React/SPA). Plain HTTP fetch
// returns a shell; these need headless-browser rendering to be usable.
const JS_RENDERED_POLICY_HOSTS = new Set([
  'hackerone.com',
  'www.hackerone.com',
  'bugcrowd.com',
  'www.bugcrowd.com',
  'intigriti.com',
  'www.intigriti.com',
  'yeswehack.com',
  'www.yeswehack.com',
  'hackenproof.com',
  'www.hackenproof.com'
]);

// Hosts that should never appear as fuzz targets even if the LLM or
// regex extracts them. Add to this list rather than editing looksOutOfScope.
const HARD_OOS_HOSTS = new Set([
  'github.com',
  'gist.github.com',
  'githubusercontent.com',
  'raw.githubusercontent.com',
  'gitlab.com',
  'bitbucket.org',
  'twitter.com',
  'x.com',
  'facebook.com',
  'linkedin.com',
  'youtube.com',
  'medium.com',
  'gravatar.com',
  'www.gravatar.com',
  'secure.gravatar.com',
  'google.com',
  'www.google.com',
  'googletagmanager.com',
  'google-analytics.com',
  'cloudflare.com',
  'statuspage.io',
  'hackerone.com',
  'www.hackerone.com',
  'hackerone-user-content.com',
  'bugcrowd.com',
  'www.bugcrowd.com',
  'intigriti.com',
  'www.intigriti.com',
  'yeswehack.com',
  'www.yeswehack.com',
  'schema.org',
  'w3.org',
  'www.w3.org'
]);

// Patterns in OOS host suffix form.
const HARD_OOS_SUFFIXES = [
  '.github.com',
  '.githubusercontent.com',
  '.gravatar.com',
  '.hackerone.com',
  '.bugcrowd.com',
  '.intigriti.com',
  '.yeswehack.com',
  '.google-analytics.com',
  '.googletagmanager.com',
  '.doubleclick.net'
];

function hostFromUrl(u) {
  try {
    return new URL(String(u)).hostname.toLowerCase();
  } catch (_e) {
    return '';
  }
}

function isJsRenderedPolicyHost(url) {
  return JS_RENDERED_POLICY_HOSTS.has(hostFromUrl(url));
}

function looksHardOutOfScope(u) {
  const host = hostFromUrl(u);
  if (!host) return true;
  if (HARD_OOS_HOSTS.has(host)) return true;
  for (const suffix of HARD_OOS_SUFFIXES) {
    if (host.endsWith(suffix)) return true;
  }
  return false;
}

// SSRF guard: reject private IP ranges, localhost, and AWS/GCP/Azure
// instance-metadata endpoints. Called on BOTH the policy URL we fetch
// and every candidate fuzz target.
function isDangerousHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h === 'ip6-localhost' || h === 'ip6-loopback') return true;

  // Metadata endpoints.
  if (h === '169.254.169.254') return true; // AWS, GCP, Azure IMDS
  if (h === 'metadata.google.internal') return true;

  // IPv4 literal parsing.
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // multicast + reserved
  }

  // IPv6 literal: reject anything bracketed loopback/link-local/ULA.
  if (h.startsWith('[')) {
    const inner = h.replace(/^\[|\]$/g, '');
    if (inner === '::1' || inner === '::' ) return true;
    if (inner.startsWith('fe80')) return true; // link-local
    if (inner.startsWith('fc') || inner.startsWith('fd')) return true; // ULA
  }

  return false;
}

function assertSafeFetchTarget(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (_e) {
    throw new Error('Invalid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }
  if (isDangerousHost(parsed.hostname)) {
    throw new Error(`Blocked host for safety: ${parsed.hostname}`);
  }
  return parsed;
}

// Conservative TLD-shaped token check: drop "node.js", "v1.2.3", "e.g.".
const COMMON_TLDS = new Set([
  'com', 'net', 'org', 'io', 'co', 'dev', 'app', 'ai', 'cloud', 'tech',
  'info', 'biz', 'uk', 'us', 'ca', 'de', 'fr', 'nl', 'jp', 'cn', 'au',
  'in', 'br', 'ru', 'eu', 'me', 'xyz', 'site', 'online', 'store', 'gov',
  'edu', 'mil', 'int', 'pro', 'name', 'mobi', 'tv', 'cc', 'ly', 'it',
  'es', 'se', 'no', 'fi', 'pl', 'ch', 'at', 'be', 'dk', 'ie', 'nz', 'za',
  'mx', 'ar', 'cl', 'kr', 'tw', 'hk', 'sg', 'il', 'tr', 'gr', 'pt',
  'cz', 'hu', 'ro', 'sk', 'ua', 'bg', 'hr', 'ee', 'lv', 'lt', 'is',
  'lu', 'ph', 'my', 'th', 'vn', 'id', 'pk', 'sa', 'ae', 'eg'
]);

function cleanUrlToken(token) {
  return String(token || '').replace(/[)\].,;!?'"`]+$/g, '').replace(/^['"`(<]+/, '');
}

function extractHttpUrls(text = '') {
  const matches = String(text).match(/https?:\/\/[^\s"'<>]+/gi) || [];
  return [...new Set(matches.map(cleanUrlToken))]
    .filter((u) => {
      try {
        const parsed = new URL(u);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        if (isDangerousHost(parsed.hostname)) return false;
        return true;
      } catch (_e) {
        return false;
      }
    });
}

function extractWildcardHosts(text = '') {
  const out = new Set();
  // Explicit wildcards: *.foo.com — keep these as-is, they're intentional.
  const wildcard = String(text).match(/\*\.[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+/gi) || [];
  for (const w of wildcard) out.add(w.toLowerCase());
  // Plain hostnames: require at least one dot and a real-looking TLD.
  const plain = String(text).match(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+\b/gi) || [];
  for (const p of plain) {
    const lower = p.toLowerCase();
    const tld = lower.split('.').pop();
    // Drop version strings like 1.2.3, 10.0.0.1, etc.
    if (/^\d+$/.test(tld)) continue;
    if (!COMMON_TLDS.has(tld)) continue;
    // Drop 1-character labels (often false positives from code snippets).
    if (lower.split('.').some((lab) => lab.length < 2)) continue;
    out.add(lower);
  }
  return [...out];
}

/**
 * Pass D: take an H1-style wildcard like `*.example.com` and produce a
 * short list of CONCRETE hostname candidates the Surface layer can probe.
 * We don't know what subdomains actually exist, so we emit common
 * application-surface prefixes. The Surface layer filters out the ones
 * that don't resolve / don't respond.
 *
 * Non-wildcard hosts (bare FQDN like "example.com" or "api.example.com")
 * are returned as-is in a single-element array.
 */
const COMMON_SUBDOMAIN_PREFIXES = [
  'api', 'app', 'admin', 'auth', 'beta', 'cdn', 'console', 'dashboard',
  'dev', 'docs', 'edge', 'gateway', 'graphql', 'internal', 'login',
  'portal', 'public', 'rest', 'staging', 'status', 'support', 'sso',
  'test', 'v1', 'v2', 'web', 'www'
];

function expandHostPattern(pattern, { maxExpansions = 14 } = {}) {
  const s = String(pattern || '').trim().toLowerCase();
  if (!s) return [];
  // Strip leading scheme if any (H1 sometimes puts them in).
  const stripped = s.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!stripped.includes('*')) {
    // Not a wildcard — accept as literal host if shape looks ok.
    if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(stripped)) return [stripped];
    return [];
  }
  // Only support leading "*." — H1 format. Bail on other shapes.
  if (!stripped.startsWith('*.')) return [];
  const base = stripped.slice(2);
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(base)) return [];
  // Include the naked base itself (often resolves) plus common prefixes.
  const out = [base];
  for (const prefix of COMMON_SUBDOMAIN_PREFIXES) {
    if (out.length >= maxExpansions) break;
    out.push(`${prefix}.${base}`);
  }
  return [...new Set(out)].slice(0, maxExpansions);
}

/**
 * HackerOne fast-path: their policy page at
 *   https://hackerone.com/<handle>/policy_scopes
 * is entirely client-rendered from a public GraphQL endpoint. We can fetch
 * structured scope directly, which is *dramatically* more accurate than
 * asking an LLM to read a screenshot of the same data.
 *
 * Handle extraction is lenient: accepts /policy, /policy_scopes, /thanks, etc.
 */
function detectHackerOneHandle(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'hackerone.com' && host !== 'www.hackerone.com') return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    const handle = parts[0];
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(handle)) return null;
    // Skip HackerOne's own route prefixes.
    const reserved = new Set([
      'hacktivity', 'leaderboard', 'bug-bounty-programs', 'opportunities',
      'directory', 'users', 'sessions', 'settings', 'reports', 'api',
      'changelog', 'privacy', 'security', 'pricing', 'product', 'company',
      'customers', 'resources', 'partners', 'trust', 'contact', 'signin',
      'signup', 'invitations', 'organizations'
    ]);
    if (reserved.has(handle.toLowerCase())) return null;
    return handle;
  } catch (_e) {
    return null;
  }
}

/**
 * Query HackerOne's public GraphQL for a program's scope. This is the same
 * data their own policy page renders — no auth required for public programs.
 * Returns null if the request fails; caller falls back to LLM extraction.
 */
async function fetchHackerOneScope(handle, { timeoutMs = 15000 } = {}) {
  const query = `
    query Team($handle: String!) {
      team(handle: $handle) {
        handle
        name
        policy
        structured_scopes(first: 200, archived: false) {
          edges {
            node {
              asset_identifier
              asset_type
              eligible_for_bounty
              eligible_for_submission
              instruction
              max_severity
              reference
            }
          }
        }
      }
    }
  `;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://hackerone.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      },
      body: JSON.stringify({ query, variables: { handle } }),
      signal: controller.signal
    });
    if (!res.ok) return null;
    const data = await res.json();
    const team = data?.data?.team;
    if (!team) return null;

    const scopes = (team.structured_scopes?.edges || [])
      .map((e) => e?.node)
      .filter(Boolean);

    const inScope = scopes.filter((s) => s.eligible_for_submission !== false);
    const outOfScope = scopes.filter((s) => s.eligible_for_submission === false);

    const explicitUrls = [];
    const hostPatterns = [];
    const assets = [];

    // Bare hostnames from H1 (no scheme) become probe seeds as https://host
    // Wildcards stay patterns only — fuzzer cannot hit *.example.com literally.
    const bareFqdn =
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\.?$/i;

    for (const s of inScope) {
      const id = String(s.asset_identifier || '').trim();
      if (!id) continue;
      assets.push(id);
      if (/^https?:\/\//i.test(id)) {
        explicitUrls.push(id);
      } else if (id.includes('*')) {
        hostPatterns.push(id);
      } else if (bareFqdn.test(id.replace(/\.$/, ''))) {
        explicitUrls.push(`https://${id.replace(/\.$/, '')}`);
      } else if (id.includes('.')) {
        hostPatterns.push(id);
      }
    }

    const oosNotes = outOfScope
      .map((s) => String(s.asset_identifier || '').trim())
      .filter(Boolean);

    return {
      program: team.name || team.handle || handle,
      handle: team.handle || handle,
      inScopeAssets: assets,
      explicitUrls: [...new Set(explicitUrls)],
      inScopeHostPatterns: [...new Set(hostPatterns)],
      outOfScopeNotes: oosNotes,
      rules: team.policy
        ? [String(team.policy).slice(0, 4000)]
        : [],
      setupNotes: [],
      confidence: 'high',
      source: 'hackerone_graphql'
    };
  } catch (_e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  isJsRenderedPolicyHost,
  looksHardOutOfScope,
  isDangerousHost,
  assertSafeFetchTarget,
  extractHttpUrls,
  extractWildcardHosts,
  expandHostPattern,
  detectHackerOneHandle,
  fetchHackerOneScope,
  COMMON_SUBDOMAIN_PREFIXES
};
