import { redirect } from "next/navigation";

import type { User } from "@/lib/db/schema";
import { getSessionUser } from "./session";

/**
 * Page-level authorization — PLAN.md §10.3.
 *
 * The check lives in the server component tree rather than in middleware, so
 * it is authoritative: middleware runs before the database is consulted and can
 * only see whether a cookie exists, not whether it means anything.
 */
export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages that only make sense signed out. */
export async function requireGuest(): Promise<void> {
  const user = await getSessionUser();
  if (user) redirect("/");
}
