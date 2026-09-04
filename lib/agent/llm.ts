/**
 * Provider layer
 *
 * Groq first, Gemini on any failure or timeout, and `null` if both are down.
 * `null` is not an error path: callers fall back to the deterministic template
 * built from the same facts (§6.8 layer 3), so the demo degrades to plain
 * wording rather than breaking. Combined, the agent cannot fully fail — which
 * is the point, given it has to survive a live five-minute pitch.
 *
 * Deliberately written against the raw HTTP APIs. Two vendor SDKs would be two
 * more version-churn risks for maybe forty lines saved.
 */

const TIMEOUT_MS = 12_000;

/**
 * Read per call, never captured at module load.
 *
 * Module-level `process.env` reads freeze whatever happened to be set the
 * instant the module was first imported, which makes behaviour depend on import
 * order — the kind of thing that works in production and quietly does the wrong
 * thing everywhere else. The base URLs are overridable so the test suite can
 * drive both providers deterministically, including making one fail to prove
 * the fallback actually falls back. Production never sets them.
 */
function config() {
  return {
    // Verified against both APIs on 2026-08-23. Hosted model catalogues retire
    // names without warning, and a retired name fails the same way a network
    // outage does — quietly, straight to the template tier — so the fallback
    // looks healthy while no model has run at all. Both are overridable, and
    // `npm run check:providers` re-verifies them.
    groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
    // An alias rather than a pinned version, so this does not go stale again.
    geminiModel: process.env.GEMINI_MODEL ?? "gemini-flash-latest",
    groqBase: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
    geminiBase:
      process.env.GEMINI_BASE_URL ??
      "https://generativelanguage.googleapis.com/v1beta",
  };
}

export type LlmProvider = "groq" | "gemini" | "template";

/**
 * What a call cost, when the provider says.
 *
 * Both providers report it and neither was being read. On a project about
 * money actions, the cost of the thing deciding the wording is worth writing
 * down beside the wording: it goes into the audit trail with everything else,
 * so a reader can see what a turn cost as well as what it said.
 *
 * Optional because it is the provider's word, not ours. A provider that stops
 * reporting usage should leave the field absent rather than have us invent a
 * zero, which would read as a free turn.
 */
export type TokenUsage = {
  prompt: number;
  completion: number;
  total: number;
};

export type LlmResult = {
  text: string;
  provider: Exclude<LlmProvider, "template">;
  usage?: TokenUsage;
};

/** What one provider call returns before it is labelled with its provider. */
type Answer = { text: string; usage?: TokenUsage };

function readUsage(
  prompt: unknown,
  completion: unknown,
  total: unknown,
): TokenUsage | undefined {
  const p = typeof prompt === "number" ? prompt : undefined;
  const c = typeof completion === "number" ? completion : undefined;
  const t = typeof total === "number" ? total : undefined;
  if (p === undefined && c === undefined && t === undefined) return undefined;
  return {
    prompt: p ?? 0,
    completion: c ?? 0,
    total: t ?? (p ?? 0) + (c ?? 0),
  };
}

async function callGroq(system: string, user: string): Promise<Answer> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set");

  const { groqBase, groqModel } = config();

  const response = await fetch(
    `${groqBase}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: groqModel,
        temperature: 0.2,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    throw new Error(`Groq responded ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq returned no content");
  return {
    text,
    usage: readUsage(
      data.usage?.prompt_tokens,
      data.usage?.completion_tokens,
      data.usage?.total_tokens,
    ),
  };
}

async function callGemini(system: string, user: string): Promise<Answer> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const { geminiBase, geminiModel } = config();

  const response = await fetch(
    `${geminiBase}/models/${geminiModel}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 500,
          responseMimeType: "application/json",
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini responded ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");
  return {
    text,
    usage: readUsage(
      data.usageMetadata?.promptTokenCount,
      data.usageMetadata?.candidatesTokenCount,
      data.usageMetadata?.totalTokenCount,
    ),
  };
}

export async function callLLM(
  system: string,
  user: string,
): Promise<LlmResult | null> {
  const attempts: { provider: "groq" | "gemini"; fn: () => Promise<Answer> }[] = [
    { provider: "groq", fn: () => callGroq(system, user) },
    { provider: "gemini", fn: () => callGemini(system, user) },
  ];

  for (const attempt of attempts) {
    try {
      const answer = await attempt.fn();
      return {
        text: answer.text,
        provider: attempt.provider,
        ...(answer.usage ? { usage: answer.usage } : {}),
      };
    } catch (error) {
      console.warn(
        `[agent] ${attempt.provider} unavailable, falling through:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return null;
}

/** Models wrap JSON in prose or code fences often enough to be worth handling. */
export function parseJsonLoosely<T>(raw: string): T | null {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;

  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
