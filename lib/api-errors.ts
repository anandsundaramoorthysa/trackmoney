import { NextResponse } from "next/server";

/**
 * What a failing route says out loud.
 *
 * A fresh clone has no database and no keys yet. Returning an opaque 500 from
 * every route in that state is unhelpful to anyone reading this repo cold, so
 * the setup cases are recognised and answered as 503 with the instruction that
 * fixes them — those messages are about missing configuration and describe
 * nothing about anybody's data.
 *
 * Every other failure gets a fixed sentence. The distinction is deliberate:
 * telling a developer their DATABASE_URL is unset is help, and telling a
 * stranger which columns their query touched is a disclosure.
 */
const SETUP_HINTS = [
  "DATABASE_URL",
  "Demo user not found",
  "plan_config",
  "Razorpay keys are missing",
  "not a test-mode key",
];

export function handleRouteError(error: unknown): NextResponse {
  const message =
    error instanceof Error ? error.message : "Something went wrong.";

  if (message === "Not signed in.") {
    return NextResponse.json({ error: message }, { status: 401 });
  }

  if (SETUP_HINTS.some((hint) => message.includes(hint))) {
    return NextResponse.json(
      { error: message, setupRequired: true },
      { status: 503 },
    );
  }

  /**
   * Everything else is answered with a fixed sentence.
   *
   * The message on a failure that got this far is written for whoever wrote
   * the code, not for whoever is using the app. A Drizzle failure carries the
   * whole statement — every column name, and the parameter values with it —
   * and returning that put the schema and a row of somebody's data in the
   * browser of anyone who could make a request fail.
   *
   * The detail is not lost, it is just sent somewhere it belongs: the server
   * log above has the error object entire.
   */
  console.error("[api]", error);
  return NextResponse.json(
    { error: "Something went wrong. The problem has been logged." },
    { status: 500 },
  );
}
