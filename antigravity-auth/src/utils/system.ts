/**
 * System-instruction sanitizer for Antigravity requests.
 *
 * The real client does not inject an identity prompt — verified live: the
 * backend accepts arbitrary prompts, and a stale injected prompt becomes a
 * static fingerprint when Google rotates theirs. What remains useful is
 * erasing OpenCode/Claude-SDK branding from the caller's own prompt and
 * obfuscating phrases the server-side matcher answers with a bare 429.
 */
import { getSensitiveWords, obfuscateSensitiveWords } from "./sensitive-words.js";

export const ANTIGRAVITY_PROMPT_REWRITES = [
  { from: /You are a Claude agent, built on Anthropic's Claude Agent SDK\./gi, to: "" },
  {
    from: /opencode/gi,
    to: (m: string) => (m === "OpenCode" ? "Antigravity" : m === "OPENCODE" ? "ANTIGRAVITY" : "antigravity"),
  },
];

export function sanitizeSystemPrompt(text: string): string {
  if (!text || typeof text !== "string") return text;
  let sanitized = text;
  for (const rewrite of ANTIGRAVITY_PROMPT_REWRITES) {
    if (typeof rewrite.to === "function") {
      sanitized = sanitized.replace(rewrite.from, rewrite.to);
    } else {
      sanitized = sanitized.replace(rewrite.from, rewrite.to);
    }
  }
  return obfuscateSensitiveWords(sanitized, getSensitiveWords());
}

/**
 * Sanitize an existing `systemInstruction` in place: rewrite branding,
 * obfuscate sensitive phrases, tag `role: "user"`. Adds nothing when the
 * caller sent no system instruction — matching the real client.
 */
export function sanitizeSystemInstruction<
  T extends { systemInstruction?: { role?: string; parts?: Array<{ text?: string }> } },
>(geminiBody: T): T {
  const rawParts = geminiBody.systemInstruction?.parts;
  if (!Array.isArray(rawParts) || rawParts.length === 0) return geminiBody;

  const request = { ...geminiBody };
  request.systemInstruction = {
    role: "user",
    parts: rawParts.map((p) => {
      if (typeof p?.text === "string") {
        return { ...p, text: sanitizeSystemPrompt(p.text) };
      }
      return p;
    }),
  };
  return request;
}
