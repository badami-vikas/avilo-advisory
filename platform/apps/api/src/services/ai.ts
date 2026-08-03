// Cloud model access, in one place.
//
// The app is offline-first: every feature that matters works with the network switched
// off, and this file is the single seam where that stops being true. Nothing here is a
// hard dependency — `groqRunner()` returns undefined when no key is configured, and every
// caller is written to carry on without it.
//
// Consolidated deliberately: the runner used to be inlined in the import service, which
// meant the settings lookup, the model default and the error handling were invisible to
// anything else that wanted a model.

import { eq } from "drizzle-orm";
import type { ModelRunner } from "@avilo/module";
import { getDb, schema } from "../db.js";

export const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

export function readSetting(key: string): string | null {
  const db = getDb();
  return (
    db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get()
      ?.value ?? null
  );
}

export interface GroqConfig {
  apiKey: string;
  model: string;
}

export function groqConfig(): GroqConfig | null {
  const apiKey = readSetting("groq_api_key");
  if (!apiKey) return null;
  return { apiKey, model: readSetting("groq_model") ?? DEFAULT_GROQ_MODEL };
}

/**
 * One call to Groq's OpenAI-compatible chat endpoint.
 *
 * Errors carry the provider's own message rather than a status code alone, because the
 * two failures users actually hit — a revoked key and a decommissioned model id — are
 * indistinguishable from "401" and "400" but obvious from the body.
 */
export async function callGroq(
  config: GroqConfig,
  prompt: string,
  maxTokens = 800,
): Promise<string> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? "";
    } catch {
      /* a non-JSON error body is not worth failing over */
    }
    throw new Error(
      detail || `Groq returned ${response.status} ${response.statusText}`,
    );
  }

  const json = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? "";
}

/** A runner for the module's model-optional entry points, or undefined when unconfigured. */
export function groqRunner(maxTokens?: number): ModelRunner | undefined {
  const config = groqConfig();
  if (!config) return undefined;
  return (prompt: string) => callGroq(config, prompt, maxTokens);
}
