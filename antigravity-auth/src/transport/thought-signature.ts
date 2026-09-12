/**
 * Thought Signature Cache & Fallback for Google Antigravity.
 *
 * Prevents Google Cloud Code Assist HTTP 400 Bad Request ("Missing thought signature"
 * or "Invalid signature") during multi-turn tool calling with reasoning models
 * (Gemini 2.0 Flash Thinking, Gemini 3, Claude 3.7 Thinking).
 *
 * Stores signatures captured from streaming responses keyed by session and tool call identifier.
 * Provides fallback default signatures for orphaned tool calls.
 */

export const DEFAULT_THINKING_AG_SIGNATURE =
  "EuwGCukGAXLI2nxwZIq54WWSoL/YN0P3TsDZ7zRnLi8g0S4aVr2HUGxvaHKySuY6HAVzcE0GPGjXrytLIldxthSvfxgUlJh6Qa9Z+Oj5QZBlYdg6HaJ6yuY5R7waE6rdwBsRf7Ft2j3DJ9rMi9qhWFqApewYtPhls3VHtuvND3l8Rm09+lbAXQs6KKWEWrxNLKTBkfpMgXhRERc/TQRMZu1twAablm6/Zk1tsYRvfWKLsNbeKF+CCojJdXJKvnR/8Ouuoa+Y2Ti20hcW7aZIIjZDFYPU//k6Ybmhg69J/imbFai2ckhfLaisqdDkdoIiBJScTOUvYqP6AE9d4MsydSC+UlhIMk4hoP76R8vUSCZRMkjOaDXstf/QoVZKbt94wyRZgAJ1G0BqI8L5ow86kLpA4wJEtxsRGymOE4bKUvApveBakYDNM9APkf+LbtbzWSseGjoZcSlycF9iN8Q2XNYKRrHbv3Lr5Y8JjdH/5y/6SHkNehTEZugaeGnSPSyCTWto1kQgHpxdWmhkLfJGNUGLmue7Mesj4TSms4J33mRpYVhNB/J333FCqIP0hr/E7BkkjEn7yZ4X7SQlh+xKPurapsnHRwiKmtsilmEFrnTE9iQr+pMr6M29qqFNv1tr5yumbaJw8JW9sB15tNsRv+dW6BjNanbsKz7HCgKUBc8tGy+7YuhXzAfViyRefcjK7eZW0Fbyt7AbybJTKz";

const MAX_SIGNATURE_ENTRIES = 2048;

/** In-memory cache mapping cacheKey -> thoughtSignature */
const signatureCache = new Map<string, string>();

/** Generate cache keys */
function makeKey(sessionId: string, identifier: string): string {
  return `${sessionId}::${identifier}`;
}

/**
 * Cache a thought signature for a session and call identifier / tool name.
 */
export function recordThoughtSignature(
  sessionId: string,
  identifier: string | undefined,
  signature: string | undefined,
): void {
  if (!sessionId || !identifier || !signature) return;
  if (signatureCache.size >= MAX_SIGNATURE_ENTRIES) {
    const oldest = signatureCache.keys().next().value;
    if (oldest !== undefined) signatureCache.delete(oldest);
  }
  signatureCache.set(makeKey(sessionId, identifier), signature);
}

/**
 * Retrieve a cached thought signature for a session and identifier.
 */
export function getCachedThoughtSignature(
  sessionId: string,
  identifier: string | undefined,
): string | undefined {
  if (!sessionId || !identifier) return undefined;
  return signatureCache.get(makeKey(sessionId, identifier));
}

/**
 * Resolve thought signature with fallback:
 * 1. Check cached signature for callId
 * 2. Check cached signature for tool name
 * 3. Fallback to DEFAULT_THINKING_AG_SIGNATURE
 */
export function resolveThoughtSignatureWithFallback(
  sessionId: string | undefined,
  callId: string | undefined,
  toolName: string | undefined,
  options: { fallback?: boolean } = {},
): string | undefined {
  if (sessionId) {
    if (callId) {
      const cached = getCachedThoughtSignature(sessionId, callId);
      if (cached) return cached;
    }
    if (toolName) {
      const cached = getCachedThoughtSignature(sessionId, toolName);
      if (cached) return cached;
    }
  }
  if (options.fallback !== false) {
    return DEFAULT_THINKING_AG_SIGNATURE;
  }
  return undefined;
}

/** Clear all cached signatures (useful for testing) */
export function clearThoughtSignatureCache(): void {
  signatureCache.clear();
}
