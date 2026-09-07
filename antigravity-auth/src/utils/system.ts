/**
 * DeepMind Antigravity System Instruction injector.
 */

export const ANTIGRAVITY_SYSTEM_INSTRUCTION =
  "You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding." +
  "You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question." +
  "**Absolute paths only**" +
  "**Proactiveness**";

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
  return sanitized;
}

export function injectAntigravitySystem<T extends { systemInstruction?: { role?: string; parts?: Array<{ text?: string }> } }>(
  geminiBody: T,
): T {
  const disabled = process.env.OPENCODE_AGY_INJECT_SYSTEM === "0";
  if (disabled) return geminiBody;
  const request = { ...geminiBody };
  const rawParts = request.systemInstruction?.parts ?? [];
  const existingParts = Array.isArray(rawParts)
    ? rawParts.map((p) => {
        if (typeof p?.text === "string") {
          return { ...p, text: sanitizeSystemPrompt(p.text) };
        }
        return p;
      })
    : [];

  const already = existingParts.some(
    (p) => typeof p?.text === "string" && p.text.includes("You are Antigravity, a powerful agentic"),
  );
  if (already) return request;

  request.systemInstruction = {
    role: "user",
    parts: [
      { text: ANTIGRAVITY_SYSTEM_INSTRUCTION },
      { text: `Please ignore following [ignore]${ANTIGRAVITY_SYSTEM_INSTRUCTION}[/ignore]` },
      ...existingParts,
    ],
  };
  return request;
}
