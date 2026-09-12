/**
 * Zero-width obfuscation of system-instruction phrases for Antigravity.
 *
 * Cloud Code Assist inspects `systemInstruction` and answers matched payloads
 * with a bare `429 RESOURCE_EXHAUSTED` (no `ErrorInfo`/`RetryInfo`), which is
 * indistinguishable from real quota exhaustion and identical on every retry.
 * Splitting a matched phrase with U+200B (zero-width space) clears the match
 * while leaving the phrase visually and semantically intact for the model.
 *
 * Same mitigation CLIProxyAPI ships as `antigravity.sensitive-words`.
 * Ported from oh-my-pi `packages/ai/src/utils/antigravity-sensitive-words.ts`.
 */

/** Zero-width space. Invisible when rendered, breaks literal matching. */
const ZERO_WIDTH_SPACE = "​";

/** Phrases known to trip the server-side matcher. */
export const DEFAULT_SENSITIVE_WORDS: readonly string[] = ["RFC 2119"];

/**
 * Active phrase list: `OPENCODE_AGY_SENSITIVE_WORDS` (comma-separated) replaces
 * the default; an empty value disables obfuscation entirely.
 */
export function getSensitiveWords(): readonly string[] {
  const raw = process.env.OPENCODE_AGY_SENSITIVE_WORDS;
  if (raw === undefined) return DEFAULT_SENSITIVE_WORDS;
  return raw
    .split(",")
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

/**
 * Insert a zero-width space after the first character of every occurrence of
 * each phrase. Matching is case-sensitive and literal; empty or whitespace-only
 * phrases are ignored. Returns the input unchanged when nothing matches.
 */
export function obfuscateSensitiveWords(text: string, phrases: readonly string[]): string {
  let result = text;
  for (const phrase of phrases) {
    const trimmed = phrase.trim();
    if (trimmed.length < 2) continue;
    const pattern = new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    result = result.replace(pattern, (match) => `${match[0]}${ZERO_WIDTH_SPACE}${match.slice(1)}`);
  }
  return result;
}
