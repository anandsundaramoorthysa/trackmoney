import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/api-errors";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { seedDatabase } from "@/lib/db/seed";
import { DEMO_USER_EMAIL } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reset demo data — PLAN.md §6.2.
 *
 * Puts the account back on Free, clears the conversation, the orders and the
 * audit trail, and re-seeds the transactions. Exists so a full run-through can
 * be replayed cleanly in front of a panel without touching the database by
 * hand.
 */
async function handlePOST() {
  const user = await getAuthenticatedUser();

  // Reset rebuilds the seeded account from scratch. Letting a signed-up user
  // trigger it would delete data that is theirs, so it is refused for anyone
  // but the demo account.
  if (user.email !== DEMO_USER_EMAIL) {
    return NextResponse.json(
      { error: "Reset is only available on the demo account." },
      { status: 403 },
    );
  }

  const summary = await seedDatabase();
  return NextResponse.json({ reset: true, ...summary });
}

export async function POST() {
  try {
    return await handlePOST();
  } catch (error) {
    return handleRouteError(error);
  }
}
