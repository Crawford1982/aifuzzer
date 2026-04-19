/**
 * CI "predictability" ≠ authorization. Optional enforcement: scope file must be present in CI runs.
 */

/**
 * @param {Record<string, unknown>} args parseArgv result
 * @param {NodeJS.ProcessEnv} [env]
 */
export function isCiRequireScope(args, env = process.env) {
  if (args && /** @type {Record<string, unknown>} */ (args).ciRequireScope === true) return true;
  const v = env.MYTHOS_CI_REQUIRE_SCOPE;
  return v === '1' || v === 'true' || v === 'yes';
}
