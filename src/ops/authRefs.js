/**
 * Resolve Authorization values from process.env (no secrets in job files).
 */

const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

/**
 * @param {string} name
 */
export function assertSafeEnvName(name) {
  if (typeof name !== 'string' || !ENV_NAME_RE.test(name.trim())) {
    throw new Error(
      `Invalid env var name for auth reference: must match ${ENV_NAME_RE} (e.g. MYTHOS_API_TOKEN)`
    );
  }
}

/**
 * @param {{
 *   auth?: string | null,
 *   authEnv?: string | null,
 *   authAlt?: string | null,
 *   authAltEnv?: string | null,
 * }} jobOrCli
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ auth: string | null, authAlt: string | null }}
 */
export function resolveAuthFields(jobOrCli, env = process.env) {
  const authInline = jobOrCli.auth != null && String(jobOrCli.auth).trim() !== '' ? String(jobOrCli.auth).trim() : null;
  const authEnvName =
    jobOrCli.authEnv != null && String(jobOrCli.authEnv).trim() !== ''
      ? String(jobOrCli.authEnv).trim()
      : null;
  const altInline =
    jobOrCli.authAlt != null && String(jobOrCli.authAlt).trim() !== ''
      ? String(jobOrCli.authAlt).trim()
      : null;
  const altEnvName =
    jobOrCli.authAltEnv != null && String(jobOrCli.authAltEnv).trim() !== ''
      ? String(jobOrCli.authAltEnv).trim()
      : null;

  if (authInline && authEnvName) {
    throw new Error('Use either auth / --auth or authEnv, not both');
  }
  if (altInline && altEnvName) {
    throw new Error('Use either authAlt / --auth-alt or authAltEnv, not both');
  }

  let auth = authInline;
  if (authEnvName) {
    assertSafeEnvName(authEnvName);
    const v = env[authEnvName];
    if (v == null || String(v).trim() === '') {
      throw new Error(`Environment variable ${authEnvName} is unset or empty (auth by reference)`);
    }
    auth = String(v).trim();
  }

  let authAlt = altInline;
  if (altEnvName) {
    assertSafeEnvName(altEnvName);
    const v = env[altEnvName];
    if (v == null || String(v).trim() === '') {
      throw new Error(`Environment variable ${altEnvName} is unset or empty (auth-alt by reference)`);
    }
    authAlt = String(v).trim();
  }

  return { auth, authAlt };
}
