"use server";

import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { DEMO_USER_EMAIL } from "@/lib/demo";
import { refreshDemoIfMonthRolled } from "@/lib/demo-refresh";
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
import {
  RESET_CODE_COOKIE,
  clearOnce,
  stashOnce,
  stashValue,
} from "@/lib/one-time-cookie";
import { createSession, destroyAllSessions, destroySession } from "./session";

/**
 * Authentication, as server actions
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

  const lockedNow =
    user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now();
  if (lockedNow) {
    fail("/login", `Too many attempts. Try again in ${LOCKOUT_MINUTES} minutes.`);
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    // A lock that has run out starts the count again. Carrying the old tally
    // forward meant one wrong password after the wait re-locked immediately,
    // so a fifteen-minute lockout was effectively permanent.
    const previous = user.lockedUntil === null ? user.failedLogins : 0;
    const failures = previous + 1;
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

  await refreshDemoIfMonthRolled(demo.id);

  await createSession(demo.id);
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

/**
 * Is the demo allowed to print a reset code on screen?
 *
 * There is no mail provider here, so without this the reset flow cannot be
 * demonstrated at all. It is off unless explicitly switched on, and when it is
 * on it prints a code for *every* address — a real one for an account that
 * exists, a decoy for one that does not. Either way the page is the same shape,
 * which is the whole point: the affordance must not become the oracle.
 */
function showsDemoCode(): boolean {
  return process.env.SHOW_DEMO_RESET_CODE === "true";
}

/** The floor every reset request is padded up to, whatever it actually did. */
const RESET_FLOOR_MS = 700;

export async function requestResetAction(form: FormData): Promise<void> {
  const started = Date.now();
  const email = readEmail(form);

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  /**
   * One answer, byte for byte, whoever asks.
   *
   * This used to redirect a registered address to `?sent=<handle>` and an
   * unregistered one to `?sent=1`, then render a code and a "continue" link for
   * the first and neither for the second. The prose said the right thing — "if
   * that address has an account" — while the URL, the page and the response
   * size all said the opposite. Anyone could test an address and learn whether
   * it belonged to somebody.
   *
   * Three things have to match, not one: where it redirects, what it renders,
   * and how long it took.
   */
  const isReal = Boolean(user && user.passwordHash);
  const overLimit = isReal && (await recentResetCount(user!.id)) >= 3;

  // The hash runs on every path. On the real path it is the cost the account
  // would have paid anyway; on the others it is there so the two are alike.
  if (!isReal || overLimit) {
    await burnPasswordTime(email);
  }

  const token =
    isReal && !overLimit
      ? await issueResetToken(user!.id)
      : // Never stored, never valid. It exists so the demo page below has the
        // same shape to render for an address that has no account.
        crypto.randomBytes(24).toString("base64url");

  if (showsDemoCode()) {
    // Written on every submission, which is what makes the nonce unnecessary:
    // the cookie always belongs to the request that just happened, so there is
    // no stale code from an earlier address left to display.
    await stashValue(RESET_CODE_COOKIE, token);
  }

  await padTo(started, RESET_FLOOR_MS);
  redirect("/forgot-password?sent=1");
}

/**
 * Wait until the request has taken at least `floor` milliseconds.
 *
 * The work genuinely differs — a real address writes a token and counts recent
 * ones, an unknown address cannot — so the durations are levelled rather than
 * matched. This does not make the endpoint constant-time in the cryptographic
 * sense, and on a cold serverless invocation the absolute numbers still move
 * for reasons that have nothing to do with the address. What it removes is the
 * steady, reproducible gap that made the difference readable.
 */
async function padTo(started: number, floor: number): Promise<void> {
  const remaining = floor - (Date.now() - started);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}


export async function resetPasswordAction(form: FormData): Promise<void> {
  const token = String(form.get("token") ?? "").trim();
  const password = String(form.get("password") ?? "");

  const problem = assessPassword(password);
  if (problem) {
    // Keep the code in the cookie and out of the redirect, so a rejected
    // password does not put a live reset token into the URL bar.
    const nonce = await stashOnce(RESET_CODE_COOKIE, token);
    redirect(
      `/reset-password?code=${encodeURIComponent(nonce)}&error=${encodeURIComponent(problem)}`,
    );
  }

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
  await clearOnce(RESET_CODE_COOKIE);

  // A reset is also how someone recovers a compromised account, so every
  // existing session is revoked rather than left running.
  await destroyAllSessions(lookup.userId);

  redirect("/login?notice=Password+changed.+Sign+in+with+your+new+password.");
}
