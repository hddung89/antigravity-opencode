/**
 * Per-conversation Antigravity request-envelope identity.
 *
 * Mirrors the real `antigravity/hub` client: `requestId` is
 * `agent/<agentId>/<ts>/<trajectoryId>/<step>` where `agentId`/`trajectoryId`
 * are UUIDs persistent for the conversation and `step` is a monotonic counter;
 * `sessionId` is a signed-decimal int63 — SHA-256 of the first user text when
 * available, else random — and `labels` carry `trajectory_id`,
 * `last_step_index`, `last_execution_id`, `model_enum` and `used_claude*`.
 *
 * Ported from oh-my-pi `packages/ai/src/providers/google-gemini-cli.ts`.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ANTIGRAVITY_MODEL_WIRE_PROFILES } from "../models/wire-profiles.js";
import type { GeminiContent, GeminiPart } from "../types/index.js";

const INT63_MASK = (1n << 63n) - 1n;
const ANTIGRAVITY_RANDOM_BOUND = 9_000_000_000_000_000_000n;

function formatSignedDecimalSessionId(value: bigint): string {
  return `${value.toString()}`;
}

function deriveSignedDecimalFromHash(text: string): string {
  const digest = createHash("sha256").update(text).digest();
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value = (value << 8n) | BigInt(digest[index] ?? 0);
  }
  return formatSignedDecimalSessionId(value & INT63_MASK);
}

function randomBoundedInt63(maxExclusive: bigint): bigint {
  while (true) {
    const bytes = randomBytes(8);
    let value = 0n;
    for (const byte of bytes) {
      value = (value << 8n) | BigInt(byte);
    }
    value &= INT63_MASK;
    if (value < maxExclusive) {
      return value;
    }
  }
}

function randomSignedDecimalSessionId(): string {
  return formatSignedDecimalSessionId(randomBoundedInt63(ANTIGRAVITY_RANDOM_BOUND));
}

function getFirstUserText(contents: GeminiContent[] | undefined): string | undefined {
  for (const message of contents ?? []) {
    if (message.role !== "user") continue;
    const parts = Array.isArray(message.parts) ? message.parts : [];
    const firstTextPart = parts.find(
      (item): item is GeminiPart & { text: string } =>
        typeof (item as GeminiPart)?.text === "string",
    );
    if (firstTextPart) return firstTextPart.text;
  }
  return undefined;
}

/**
 * Signed-decimal int63 session id: deterministic SHA-256 of the first user
 * text when present (same conversation → same id), random otherwise.
 */
export function deriveAntigravitySessionId(contents: GeminiContent[] | undefined): string {
  const text = getFirstUserText(contents);
  if (text && text.trim().length > 0) {
    return deriveSignedDecimalFromHash(text);
  }
  return randomSignedDecimalSessionId();
}

export interface AntigravityTrajectoryState {
  agentId: string;
  trajectoryId: string;
  /** Steps consumed so far; the next request uses `stepIndex + 1`. */
  stepIndex: number;
  /** Prior response id, echoed as `labels.last_execution_id`. */
  lastExecutionId?: string;
}

/**
 * Trajectory state keyed by sessionId. Entries are tiny; the map is bounded
 * defensively so a long-lived process cannot grow it without limit.
 */
const MAX_TRAJECTORY_STATES = 512;
const trajectoryStates = new Map<string, AntigravityTrajectoryState>();

export function getTrajectoryState(sessionId: string): AntigravityTrajectoryState {
  let state = trajectoryStates.get(sessionId);
  if (!state) {
    if (trajectoryStates.size >= MAX_TRAJECTORY_STATES) {
      const oldest = trajectoryStates.keys().next().value;
      if (oldest !== undefined) trajectoryStates.delete(oldest);
    }
    state = { agentId: randomUUID(), trajectoryId: randomUUID(), stepIndex: 0 };
    trajectoryStates.set(sessionId, state);
  }
  return state;
}

/** Record the response id of a completed request for `last_execution_id`. */
export function recordExecutionId(sessionId: string, responseId: string | undefined): void {
  if (!responseId) return;
  const state = trajectoryStates.get(sessionId);
  if (state) state.lastExecutionId = responseId;
}

export interface AntigravitySessionEnvelope {
  sessionId: string;
  requestId: string;
  labels: Record<string, string>;
}

export interface BuildSessionEnvelopeOptions {
  contents: GeminiContent[] | undefined;
  wireModelId: string;
  /** Whether the wire model is Claude-backed (drives `used_claude*` labels). */
  claude: boolean;
  /** Caller-pinned session id; derived from contents when omitted. */
  sessionId?: string;
}

/**
 * Build the request envelope identity (sessionId, structured requestId,
 * labels), advancing the per-conversation step counter. Call once per logical
 * request — retries of the same request must reuse the returned envelope.
 */
export function buildSessionEnvelope(
  opts: BuildSessionEnvelopeOptions,
): AntigravitySessionEnvelope {
  const sessionId = opts.sessionId ?? deriveAntigravitySessionId(opts.contents);
  const state = getTrajectoryState(sessionId);
  const step = ++state.stepIndex;

  const labels: Record<string, string> = {};
  if (state.lastExecutionId) labels.last_execution_id = state.lastExecutionId;
  labels.last_step_index = String(step - 1);
  const profile = ANTIGRAVITY_MODEL_WIRE_PROFILES[opts.wireModelId];
  if (profile?.modelEnum !== undefined) labels.model_enum = profile.modelEnum;
  labels.trajectory_id = state.trajectoryId;
  if (opts.claude) {
    labels.used_claude = "1";
    labels.used_claude_conservative = "1";
  }

  return {
    sessionId,
    requestId: `agent/${state.agentId}/${Date.now()}/${state.trajectoryId}/${step}`,
    labels,
  };
}

/**
 * Last endpoint that produced a successful response, tried first on the next
 * request. Module-scoped: the plugin has no per-session transport state.
 */
let lastGoodEndpoint: string | undefined;

export function getLastGoodEndpoint(): string | undefined {
  return lastGoodEndpoint;
}

export function setLastGoodEndpoint(endpoint: string): void {
  lastGoodEndpoint = endpoint;
}
