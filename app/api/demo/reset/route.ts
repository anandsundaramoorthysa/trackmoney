import { NextResponse } from "next/server";

import { seedDatabase } from "@/lib/db/seed";

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
export async function POST() {
  const summary = await seedDatabase();
  return NextResponse.json({ reset: true, ...summary });
}
