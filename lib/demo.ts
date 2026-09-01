import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";

/**
 * The demo identity
 *
 * TrackMoney has no login. There is one seeded account and a "Reset demo data"
 * button. That is a deliberate scope decision, not an omission: a repo that
 * stays public forever cannot leak personal data it has no way to collect.
 *
 * The rule that survives the missing auth layer is this one: the user id is
 * resolved here, on the server, and is NEVER accepted from a request body.
 * `POST /api/checkout` takes no userId parameter. That is what keeps the
 * "bounded" claim honest — no client, and no agent, can direct a money action
 * at an account other than the one the server itself resolved.
 */

export const DEMO_USER_EMAIL = "demo@trackmoney.app";
export const DEMO_USER_NAME = "Ananya Rao";

export async function getDemoUser(): Promise<User> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, DEMO_USER_EMAIL))
    .limit(1);

  if (!user) {
    throw new Error(
      "Demo user not found. Run `npm run db:seed` to create the demo account.",
    );
  }

  return user;
}
