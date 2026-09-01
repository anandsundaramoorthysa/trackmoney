import { seedDatabase } from "@/lib/db/seed";
import { istToday } from "@/lib/time";
import { countInMonth } from "@/lib/transactions";

/**
 * Put the demo back in the current month if the calendar has moved on.
 *
 * The seed lays its data out relative to the day it runs: this month, last
 * month, the one before. That is what makes the demo legible — and it means
 * the data ages out. Seeded on the 27th of August, the account had nineteen
 * transactions "this month". On the 1st of September it had none, and the
 * dashboard, the insights, the cap demonstration and everything the agent
 * reasons about were empty. Nothing errored; it quietly showed nothing.
 *
 * That is a poor way to greet a reviewer opening the link weeks after it was
 * deployed, so arriving at the demo account is the moment to check. Reseeding
 * only when the current month is empty makes it a no-op on every ordinary
 * visit, and the work is scoped to the demo account exactly as the reset
 * button is.
 *
 * This lives outside lib/auth/actions.ts deliberately: everything exported
 * from a "use server" module becomes an endpoint, and a function that takes a
 * user id and writes data has no business being one.
 */
export async function refreshDemoIfMonthRolled(demoUserId: string): Promise<void> {
  try {
    if ((await countInMonth(demoUserId, istToday())) > 0) return;
    await seedDatabase();
  } catch {
    // A stale demo is worth far less than a broken sign-in, so a failure here
    // must never stop anyone getting in.
  }
}
