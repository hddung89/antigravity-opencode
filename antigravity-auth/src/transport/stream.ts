/**
 * SSE stream unwrapping & transformation for Cloud Code Assist responses.
 * Strips the outer Antigravity envelope `{ response: { candidates: [...] } }`
 * so @ai-sdk/google can parse chunks as native Gemini SSE.
 */

export interface SseStreamHooks {
  onResponseId?: (responseId: string) => void;
  onThoughtSignature?: (identifier: string, signature: string) => void;
}

export function transformSseDataLine(
  line: string,
  hooks?: SseStreamHooks | ((responseId: string) => void),
): string {
  const m = line.match(/^data:\s?(.*)$/);
  if (!m) return line;
  const jsonStr = m[1]?.trim() ?? "";
  if (!jsonStr || jsonStr === "[DONE]") {
    return line.startsWith("data:") ? line : `data: ${jsonStr}`;
  }
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === "object") {
      const onResponseId = typeof hooks === "function" ? hooks : hooks?.onResponseId;
      const onThoughtSignature = typeof hooks === "object" ? hooks?.onThoughtSignature : undefined;

      const responseId =
        (parsed as Record<string, unknown>).responseId ??
        ((parsed as Record<string, unknown>).response as Record<string, unknown> | undefined)
          ?.responseId;
      if (typeof responseId === "string" && responseId) onResponseId?.(responseId);

      // Extract thought signatures from candidates parts
      if (onThoughtSignature) {
        const candidateList =
          (parsed as Record<string, unknown>).candidates ||
          ((parsed as Record<string, unknown>).response as Record<string, unknown> | undefined)
            ?.candidates;
        if (Array.isArray(candidateList)) {
          for (const cand of candidateList) {
            const content = cand?.content;
            const parts = content?.parts;
            if (Array.isArray(parts)) {
              for (const part of parts) {
                const sig = part?.thoughtSignature || part?.functionCall?.thoughtSignature;
                if (typeof sig === "string" && sig) {
                  const fc = part?.functionCall;
                  if (fc?.id && typeof fc.id === "string") {
                    onThoughtSignature(fc.id, sig);
                  }
                  if (fc?.name && typeof fc.name === "string") {
                    onThoughtSignature(fc.name, sig);
                  }
                }
              }
            }
          }
        }
      }

      if ("response" in parsed && parsed.response != null) {
        return `data: ${JSON.stringify(parsed.response)}`;
      }
    }
  } catch {
    // leave unmodified if JSON parsing fails
  }
  return line;
}

export function unwrapSseResponseStream(
  body: ReadableStream<Uint8Array>,
  hooks?: SseStreamHooks | ((responseId: string) => void),
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.length) {
              const rest = buffer.replace(/\r$/, "");
              if (rest.startsWith("data:")) {
                controller.enqueue(encoder.encode(transformSseDataLine(rest, hooks) + "\n"));
              } else if (rest.trim()) {
                controller.enqueue(encoder.encode(rest));
              }
            }
            controller.close();
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          let out = "";
          for (const line of lines) {
            if (line.startsWith("data:")) {
              out += transformSseDataLine(line, hooks) + "\n";
            } else {
              out += line + "\n";
            }
          }
          if (out) {
            controller.enqueue(encoder.encode(out));
          }
        }
      } catch (err) {
        controller.error(err);
      } finally {
        try {
          reader?.releaseLock();
        } catch {
          // ignore
        }
      }
    },
    async cancel(reason) {
      try {
        if (reader) {
          await reader.cancel(reason);
        } else {
          await body.cancel(reason);
        }
      } catch {
        /* ignore */
      }
    },
  });
}
