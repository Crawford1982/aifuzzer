/**
 * Turn user paste into a valid absolute URL for fetch().
 * Handles common mistakes (no scheme, wildcards, Dynatrace env shortcuts).
 */

/**
 * @param {string} raw
 * @returns {{ ok: true, url: string } | { ok: false, error: string }}
 */
export function resolveTargetUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'Target is empty.' };
  }

  if (trimmed.includes('*')) {
    return {
      ok: false,
      error:
        'That looks like a wildcard scope (e.g. *.sprint…), not a URL. Paste a full address with https://, ' +
        'usually from Swagger/API docs — e.g. https://YOUR-ENV.sprint.dynatracelabs.com/...',
    };
  }

  // Shortcuts for Dynatrace sprint environments (authorized testing only)
  const s2 = /^sprint2:([\w-]+)(\/.*)?$/i.exec(trimmed);
  if (s2) {
    const env = s2[1];
    const path = s2[2] && s2[2].length > 0 ? s2[2] : '/';
    return {
      ok: true,
      url: `https://${env}.sprint.dynatracelabs.com${path === '/' ? '/' : path}`,
    };
  }

  const s3 = /^sprint3:([\w-]+)(\/.*)?$/i.exec(trimmed);
  if (s3) {
    const env = s3[1];
    const path = s3[2] && s3[2].length > 0 ? s3[2] : '/';
    return {
      ok: true,
      url: `https://${env}.sprint.apps.dynatracelabs.com${path === '/' ? '/' : path}`,
    };
  }

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const u = new URL(candidate);
    if (!u.hostname || !u.hostname.includes('.')) {
      return {
        ok: false,
        error: `Invalid hostname in: ${candidate}`,
      };
    }
    return { ok: true, url: u.toString() };
  } catch {
    return {
      ok: false,
      error: `Could not parse as URL. Try: https://your-host/... or sprint2:YOUR-ENV`,
    };
  }
}
