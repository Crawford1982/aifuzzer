/**
 * LLM provider settings — env only, never committed.
 */

/**
 * @returns {{ apiKey: string, baseUrl: string, model: string }}
 */
export function getLlmEnv() {
  const apiKey =
    process.env.MYTHOS_LLM_API_KEY?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim() ||
    '';

  const baseUrl =
    process.env.MYTHOS_LLM_BASE_URL?.trim() ||
    'https://openrouter.ai/api/v1/chat/completions';

  const model = process.env.MYTHOS_LLM_MODEL?.trim() || 'openai/gpt-4o-mini';

  return { apiKey, baseUrl, model };
}
