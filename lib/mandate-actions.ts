"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { planConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { issueMandate } from "@/lib/mandates";
import { MANDATE_COOKIE, stashOnce } from "@/lib/one-time-cookie";

/**
 * Granting an AI buyer permission to purchase, once, up to a limit.
 *
 * The token is shown a single time. It is the whole authority, so it is treated
 * like one: hashed at rest, never re-displayed, and spent by the first order
 * that presents it.
 */
export async function issueMandateAction(form: FormData): Promise<void> {
  const user = await requireUser();

  if (user.plan === "pro") {
    redirect("/billing?mandateError=" + encodeURIComponent("This account is already on Pro."));
  }

  const [pro] = await db
    .select()
    .from(planConfig)
    .where(eq(planConfig.plan, "pro"))
    .limit(1);

  if (!pro) {
    redirect("/billing?mandateError=" + encodeURIComponent("No product to authorise."));
  }

  const purpose = String(form.get("purpose") ?? "").trim();
  const { token, expiresAt } = await issueMandate({
    userId: user.id,
    productId: "pro",
    maxAmountPaise: pro.pricePaise,
    purpose: purpose || "Issued from the billing page",
  });

  // The token never travels in the URL: it would outlive its 30 minutes in
  // browser history and in any log that records query strings.
  await stashOnce(MANDATE_COOKIE, token);

  redirect(`/billing?issued=1&expires=${encodeURIComponent(expiresAt.toISOString())}`);
}
