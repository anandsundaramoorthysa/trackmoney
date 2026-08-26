"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { DEMO_USER_EMAIL } from "@/lib/demo";
import {
  assessPassword,
  burnPasswordTime,
  hashPassword,
  verifyPassword,
} from "./password";
import {
  consumeResetToken,
  issueResetToken,
  lookupResetToken,
  recentResetCount,
  RESET_TTL_MINUTES,
} from "./reset";
import { createSession, destroyAllSessions, destroySession } from "./session";

/**
 * Authentication, as server actions — PLAN.md §10.3.
 *
 * Every flow is a plain form post handled on the server, so the whole of
 * authentication works with JavaScript disabled and no credential is ever
 * handled by browser code. Errors come back as a redirect with a query
 * parameter rather than as client state, for the same reason.
 */

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

function fail(path: string, code: string, extra = ""): never {
  redirect(`${path}?error=${encodeURIComponent(code)}${extra}`);
}

function readEmail(form: FormData): string {
  return String(form.get("email") ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 200);
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signUpAction(form: FormData): Promise<void> {
  const email = readEmail(form);
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const password = String(form.get("password") ?? "");

  if (!name) fail("/signup", "Enter your name.");
  if (!EMAIL_SHAPE.test(email)) fail("/signup", "Enter a valid email address.");

  const problem = assessPassword(password);
  if (problem) fail("/signup", problem);

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) fail("/signup", "That email is already registered.");

  const [created] = await db
    .insert(users)
    .values({ email, name, passwordHash: await hashPassword(password) })
    .returning();

  await createSession(created.id);
  redirect("/");
}

export async function signInAction(form: FormData): Promise<void> {
  const email = readEmail(form);
  const password = String(form.get("password") ?? "");

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Spend the same time whether or not the account exists, so response timing
  // does not reveal which addresses are registered.
  if (!user) {
    await burnPasswordTime(password);
    fail("/login", "Email or password is incorrect.");
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    fail("/login", `Too many attempts. Try again in ${LOCKOUT_MINUTES} minutes.`);
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    const failures = user.failedLogins + 1;
    await db
      .update(users)
      .set({
        failedLogins: failures,
        lockedUntil:
          failures >= LOCKOUT_THRESHOLD
            ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
            : null,
      })
      .where(eq(users.id, user.id));

    fail("/login", "Email or password is incorrect.");
  }

  await db
    .update(users)
    .set({ failedLogins: 0, lockedUntil: null })
    .where(eq(users.id, user.id));

  await createSession(user.id);
  redirect("/");
}

/**
 * One-click entry to the seeded account.
 *
 * A five-minute pitch cannot begin with an onboarding funnel, so a reviewer
 * must never have to register to see the product. Disabled by setting
 * ALLOW_DEMO_LOGIN=false.
 */
export async function demoSignInAction(): Promise<void> {
  if (process.env.ALLOW_DEMO_LOGIN === "false") {
    fail("/login", "The demo account is disabled here.");
  }

  const [demo] = await db
    .select()
    .from(users)
    .where(eq(users.email, DEMO_USER_EMAIL))
    .limit(1);

  if (!demo) fail("/login", "The demo account has not been seeded yet.");

  await createSession(demo.id);
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

export async function requestResetAction(form: FormData): Promise<void> {
  const email = readEmail(form);

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Always the same answer. Telling a stranger whether an address is
  // registered is a disclosure the reset flow has no reason to make.
  if (!user || !user.passwordHash) {
    redirect("/forgot-password?sent=1");
  }

  if ((await recentResetCount(user.id)) >= 3) {
    fail("/forgot-password", "Too many reset requests. Try again later.");
  }

  const token = await issueResetToken(user.id);

  // No mail provider in this demo, so the code is surfaced once, here, with the
  // production path stated plainly rather than pretended.
  redirect(`/forgot-password?sent=1&code=${encodeURIComponent(token)}`);
}

export async function resetPasswordAction(form: FormData): Promise<void> {
  const token = String(form.get("token") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const back = `/reset-password?token=${encodeURIComponent(token)}`;

  const problem = assessPassword(password);
  if (problem) fail(back, problem, "");

  const lookup = await lookupResetToken(token);
  if (!lookup.valid) {
    const message =
      lookup.reason === "expired"
        ? `That code expired. Codes last ${RESET_TTL_MINUTES} minutes — request a new one.`
        : lookup.reason === "used"
          ? "That code has already been used. Request a new one."
          : "That code is not valid. Request a new one.";
    fail("/forgot-password", message);
  }

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(password),
      failedLogins: 0,
      lockedUntil: null,
    })
    .where(eq(users.id, lookup.userId));

  await consumeResetToken(lookup.resetId);

  // A reset is also how someone recovers a compromised account, so every
  // existing session is revoked rather than left running.
  await destroyAllSessions(lookup.userId);

  redirect("/login?notice=Password+changed.+Sign+in+with+your+new+password.");
}
