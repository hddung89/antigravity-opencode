/**
 * Project discovery and account inspection for Google Antigravity.
 */
import { createHash } from "node:crypto";
import { DEFAULT_PROJECT_ID, DEFAULT_ENDPOINT, ANTIGRAVITY_DAILY } from "./constants.js";

/**
 * Deterministic UUID-shaped stable project ID derived from account email or seed.
 */
export function stableProjectId(seed: string): string {
  const bytes = createHash("sha1").update(`antigravity:${seed}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function defaultProjectId(seed = "antigravity-default"): string {
  return process.env.ANTIGRAVITY_PROJECT_ID?.trim() || stableProjectId(seed);
}

export async function getUserEmail(accessToken: string): Promise<string | undefined> {
  try {
    const response = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.ok) {
      const data = (await response.json()) as { email?: string };
      return data.email;
    }
  } catch {
    // optional
  }
  return undefined;
}

/**
 * Discover Cloud AI Companion project via loadCodeAssist, falling back
 * to a deterministic stableProjectId(email) if none is configured.
 */
export async function onboardUser(
  accessToken: string,
  endpoint = DEFAULT_ENDPOINT,
  tierId = "legacy-tier",
): Promise<boolean> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": "google-api-nodejs-client/9.15.1",
    "x-request-source": "local",
  };
  const body = JSON.stringify({
    tierId,
    metadata: {
      ideType: "ANTIGRAVITY",
      platform: process.platform === "darwin" ? "MACOS" : process.platform === "win32" ? "WINDOWS" : "LINUX",
      pluginType: "GEMINI",
    },
  });

  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`${endpoint}/v1internal:onboardUser`, {
        method: "POST",
        headers,
        body,
      });
      if (res.ok) {
        const data = (await res.json()) as { done?: boolean };
        if (data.done === true) return true;
      }
    } catch {
      // ignore and retry
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

/**
 * Discover Cloud AI Companion project via loadCodeAssist, falling back
 * to onboardUser or a deterministic stableProjectId(email) if none is configured.
 */
export async function discoverProject(accessToken: string, userEmail?: string): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": "google-api-nodejs-client/9.15.1",
    "x-request-source": "local",
  };
  const endpoints = [DEFAULT_ENDPOINT, ANTIGRAVITY_DAILY];
  const body = JSON.stringify({
    metadata: {
      ideType: "ANTIGRAVITY",
      platform: process.platform === "darwin" ? "MACOS" : process.platform === "win32" ? "WINDOWS" : "LINUX",
      pluginType: "GEMINI",
    },
  });

  let defaultTierId = "legacy-tier";

  for (const endpoint of endpoints) {
    try {
      const loadResponse = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers,
        body,
      });
      if (!loadResponse.ok) continue;
      const data = (await loadResponse.json()) as {
        cloudaicompanionProject?: string | { id?: string };
        allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
      };
      if (Array.isArray(data.allowedTiers)) {
        for (const tier of data.allowedTiers) {
          if (tier.isDefault && tier.id) {
            defaultTierId = tier.id.trim();
            break;
          }
        }
      }
      if (typeof data.cloudaicompanionProject === "string" && data.cloudaicompanionProject) {
        // Fire background onboarding if project exists
        onboardUser(accessToken, endpoint, defaultTierId).catch(() => {});
        return data.cloudaicompanionProject;
      }
      if (
        data.cloudaicompanionProject &&
        typeof data.cloudaicompanionProject === "object" &&
        data.cloudaicompanionProject.id
      ) {
        onboardUser(accessToken, endpoint, defaultTierId).catch(() => {});
        return data.cloudaicompanionProject.id;
      }
    } catch {
      // try next endpoint
    }
  }

  // Fallback: If no user project returned by loadCodeAssist, derive deterministic project ID from email
  const email = userEmail || (await getUserEmail(accessToken));
  if (email) {
    return stableProjectId(email);
  }

  return process.env.ANTIGRAVITY_PROJECT_ID?.trim() || DEFAULT_PROJECT_ID;
}
