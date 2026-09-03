"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/guard";
import { addTransaction, deleteTransaction, rupeesToPaise } from "@/lib/transactions";

/**
 * Transaction form actions — server-rendered, like the rest of the app.
 *
 * Outcomes come back as a redirect with a query parameter so the page works
 * without JavaScript. The cap refusal is a first-class outcome here, not an
 * error: hitting a plan limit is a normal thing for the product to do.
 */

function back(params: Record<string, string>): never {
  const query = new URLSearchParams(params).toString();
  redirect(`/transactions${query ? `?${query}` : ""}`);
}

/**
 * Send the outcome back to the month the form was submitted from.
 *
 * Both forms carry the month on screen as a hidden field. Without it, deleting
 * a row while looking at August answered on September — the row did vanish, but
 * from a list the user was no longer being shown, which reads as the delete
 * having hit the wrong thing. The month is validated on the way back in, so a
 * hand-edited field cannot put anything but a month into the URL.
 */
function backToMonth(month: string, params: Record<string, string>): never {
  const withMonth = /^\d{4}-\d{2}$/.test(month)
    ? { ...params, month }
    : params;
  back(withMonth);
}

export async function addTransactionAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const month = String(form.get("month") ?? "");

  const amountPaise = rupeesToPaise(String(form.get("amount") ?? ""));
  if (amountPaise === null) {
    backToMonth(month, { error: "Enter an amount like 249 or 249.50." });
  }

  const result = await addTransaction(user, {
    merchant: String(form.get("merchant") ?? ""),
    category: String(form.get("category") ?? "Other"),
    amountPaise,
    occurredOn: String(form.get("occurredOn") ?? ""),
  });

  if (result.ok) {
    revalidatePath("/transactions");
    revalidatePath("/");
    backToMonth(month, { added: "1" });
  }

  if (result.reason === "cap_reached") {
    backToMonth(month, { capped: String(result.cap) });
  }
  if (result.reason === "duplicate") {
    backToMonth(month, {
      error: "You already have that exact transaction on that date.",
    });
  }
  backToMonth(month, { error: result.message });
}

export async function deleteTransactionAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const month = String(form.get("month") ?? "");

  const removed = await deleteTransaction(user, id);
  revalidatePath("/transactions");
  revalidatePath("/");
  backToMonth(
    month,
    removed ? { deleted: "1" } : { error: "That transaction no longer exists." },
  );
}
