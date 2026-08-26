import { NextResponse } from "next/server";

/**
 * A fresh clone has no database and no keys yet. Returning a stack-trace 500
 * from every route in that state is unhelpful to anyone reading this repo cold,
 * so the setup cases are recognised and answered as 503 with an instruction.
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

  console.error("[api]", error);
  return NextResponse.json({ error: message }, { status: 500 });
}
