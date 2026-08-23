import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

/**
 * Preflight — does every external service this demo needs actually answer?
 *
 * Written after both hosted model defaults went stale at once. A retired model
 * name fails exactly the way a network outage does: quietly, straight to the
 * template tier. The fallback then looks healthy on stage while no model has
 * run at all, and the "Groq → Gemini → template" claim is not true.
 *
 * Run before a demo, and after any long gap. Prints no secrets.
 */

let failures = 0;

function ok(line: string) {
  console.log(`  ok    ${line}`);
}

function fail(line: string) {
  failures += 1;
  console.log(`  FAIL  ${line}`);
}

function present(name: string): string | null {
  const value = process.env[name];
  if (!value || /^x+$/i.test(value.replace(/^rzp_test_/, ""))) return null;
  return value;
}

async function checkNeon() {
  const url = present("DATABASE_URL");
  if (!url) return fail("DATABASE_URL is missing or still the placeholder");
  try {
    const { neon } = await import("@neondatabase/serverless");
    const rows = await neon(url)`select current_database() as db`;
    ok(`database reachable — "${rows[0].db}"`);
  } catch (error) {
    fail(`database: ${error instanceof Error ? error.message : error}`);
  }
}

async function checkRazorpay() {
  const id = present("RAZORPAY_KEY_ID");
  const secret = present("RAZORPAY_KEY_SECRET");
  if (!id || !secret) return fail("Razorpay keys are missing or still placeholders");
  if (!id.startsWith("rzp_test_")) {
    return fail("RAZORPAY_KEY_ID is not a test-mode key");
  }

  try {
    const auth = Buffer.from(`${id}:${secret}`).toString("base64");
    const response = await fetch("https://api.razorpay.com/v1/payments?count=1", {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) ok("Razorpay test credentials accepted");
    else fail(`Razorpay rejected the credentials (HTTP ${response.status})`);
  } catch (error) {
    fail(`Razorpay: ${error instanceof Error ? error.message : error}`);
  }
}

/** Both providers are asked for the JSON shape the agent actually uses. */
async function checkGroq() {
  const key = present("GROQ_API_KEY");
  const model = process.env.GROQ_MODEL ?? "openai/gpt-oss-20b";
  if (!key) return console.log(`  skip  Groq (no key; the agent will start at Gemini)`);

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        // Same budget the agent uses. A tighter cap truncates before valid
        // JSON can form, which fails the check for a reason that is not real.
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: 'Reply with JSON only: {"reply": string, "tool": "none"}' },
          { role: "user", content: "Reply with a one-sentence greeting." },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      return fail(`Groq model "${model}" unusable (HTTP ${response.status}) — check GROQ_MODEL`);
    }
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    JSON.parse(data.choices?.[0]?.message?.content ?? "");
    ok(`Groq model "${model}" answered with valid JSON`);
  } catch (error) {
    fail(`Groq "${model}": ${error instanceof Error ? error.message : error}`);
  }
}

async function checkGemini() {
  const key = present("GEMINI_API_KEY");
  const model = process.env.GEMINI_MODEL ?? "gemini-flash-latest";
  if (!key) return console.log("  skip  Gemini (no key; no fallback if Groq fails)");

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: 'Reply with JSON only: {"reply": string, "tool": "none"}' }],
          },
          contents: [{ role: "user", parts: [{ text: "Reply with a one-sentence greeting." }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 500,
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) {
      return fail(`Gemini model "${model}" unusable (HTTP ${response.status}) — check GEMINI_MODEL`);
    }
    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
    ok(`Gemini model "${model}" answered with valid JSON`);
  } catch (error) {
    fail(`Gemini "${model}": ${error instanceof Error ? error.message : error}`);
  }
}

async function main() {
  console.log("\nTrackMoney preflight\n");
  await checkNeon();
  await checkRazorpay();
  await checkGroq();
  await checkGemini();

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed.\n`);
    process.exit(1);
  }
  console.log("\nAll external services answered.\n");
}

main();
