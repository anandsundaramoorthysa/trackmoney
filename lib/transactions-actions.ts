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

export async function addTransactionAction(form: FormData): Promise<void> {
  const user = await requireUser();

  const amountPaise = rupeesToPaise(String(form.get("amount") ?? ""));
  if (amountPaise === null) {
    back({ error: "Enter an amount like 249 or 249.50." });
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
    back({ added: "1" });
  }

  if (result.reason === "cap_reached") {
    back({ capped: String(result.cap) });
  }
  if (result.reason === "duplicate") {
    back({ error: "You already have that exact transaction on that date." });
  }
  back({ error: result.message });
}

export async function deleteTransactionAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");

  const removed = await deleteTransaction(user, id);
  revalidatePath("/transactions");
  revalidatePath("/");
  back(removed ? { deleted: "1" } : { error: "That transaction no longer exists." });
}
