/**
 * Retry delay parser for Google Cloud Code Assist HTTP responses.
 */

export function extractRetryDelay(
  errorText: string,
  response?: { headers?: Headers | Record<string, string | string[] | undefined> } | null,
): number | null {
  // Check headers first
  if (response?.headers) {
    const getHeader = (name: string): string | null => {
      if (typeof (response.headers as Headers).get === "function") {
        return (response.headers as Headers).get(name);
      }
      const val = (response.headers as Record<string, string | string[] | undefined>)[name];
      if (Array.isArray(val)) return val[0] || null;
      return typeof val === "string" ? val : null;
    };

    const retryAfter = getHeader("retry-after");
    if (retryAfter) {
      const sec = parseFloat(retryAfter);
      if (!isNaN(sec)) return Math.ceil(sec * 1000);
      const date = Date.parse(retryAfter);
      if (!isNaN(date)) {
        const delay = date - Date.now();
        return delay > 0 ? delay : 0;
      }
    }

    const resetAfter = getHeader("x-ratelimit-reset-after");
    if (resetAfter) {
      const sec = parseFloat(resetAfter);
      if (!isNaN(sec)) return Math.ceil(sec * 1000);
    }
  }

  // Fallback to searching error body text
  if (errorText) {
    // Look for "Please retry in 2.5s" or "reset after 30s"
    const retryInMatch = errorText.match(/(?:retry|reset)\s+(?:in|after)\s+([0-9.]+)\s*s(?:econds?)?/i);
    if (retryInMatch && retryInMatch[1]) {
      const sec = parseFloat(retryInMatch[1]);
      if (!isNaN(sec)) return Math.ceil(sec * 1000);
    }

    // Look for `"retryDelay": "500ms"` or `"retryDelay": "2.5s"`
    const jsonMatch = errorText.match(/"retryDelay":\s*"([0-9.]+)(ms|s)"/i);
    if (jsonMatch && jsonMatch[1] && jsonMatch[2]) {
      const val = parseFloat(jsonMatch[1]);
      if (!isNaN(val)) {
        return jsonMatch[2].toLowerCase() === "s" ? Math.ceil(val * 1000) : Math.ceil(val);
      }
    }
  }

  return null;
}

/**
 * Classify a 429 body using `google.rpc.ErrorInfo` reasons and the
 * capacity-exhaustion phrasing the Antigravity backend emits.
 * Ported from oh-my-pi `packages/ai/src/error/rate-limit.ts`.
 */
export type AntigravityRateLimitReason =
  | "QUOTA_EXHAUSTED"
  | "RATE_LIMIT_EXCEEDED"
  | "INSUFFICIENT_G1_CREDITS_BALANCE";

const GOOGLE_RPC_ERROR_INFO_TYPE = "type.googleapis.com/google.rpc.ErrorInfo";
const ANTIGRAVITY_MODEL_QUOTA_PATTERN = /\bexhausted your capacity on this model\b/i;

export function parseAntigravityRateLimitReason(
  errorText: string,
): AntigravityRateLimitReason | undefined {
  if (!errorText) return undefined;
  try {
    const parsed = JSON.parse(errorText) as Record<string, unknown>;
    const details = (parsed?.error as Record<string, unknown> | undefined)?.details;
    if (Array.isArray(details)) {
      for (const detail of details) {
        const record = detail as Record<string, unknown>;
        if (record?.["@type"] !== GOOGLE_RPC_ERROR_INFO_TYPE) continue;
        const reason = record.reason;
        if (
          reason === "QUOTA_EXHAUSTED" ||
          reason === "RATE_LIMIT_EXCEEDED" ||
          reason === "INSUFFICIENT_G1_CREDITS_BALANCE"
        ) {
          return reason;
        }
      }
    }
  } catch {
    // fall through to text matching
  }
  if (ANTIGRAVITY_MODEL_QUOTA_PATTERN.test(errorText)) return "QUOTA_EXHAUSTED";
  return undefined;
}
