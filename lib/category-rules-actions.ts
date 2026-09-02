"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/guard";
import { createRule, deleteRule } from "@/lib/category-rules";

/**
 * The form side of category rules.
 *
 * Server actions rather than an API route, for the same reason the rest of the
 * app uses them: the page keeps working with JavaScript switched off, and the
 * account is resolved here rather than being sent by the caller.
 */

const RULES_PATH = "/rules";

function backWith(params: Record<string, string>): never {
  redirect(`${RULES_PATH}?${new URLSearchParams(params).toString()}`);
}

export async function createRuleAction(form: FormData): Promise<void> {
  const user = await requireUser();

  const result = await createRule({
    userId: user.id,
    pattern: String(form.get("pattern") ?? ""),
    matchType: String(form.get("matchType") ?? "contains"),
    category: String(form.get("category") ?? ""),
  });

  if (!result.ok) backWith({ error: result.message });

  revalidatePath(RULES_PATH);
  backWith({ added: "1" });
}

export async function deleteRuleAction(form: FormData): Promise<void> {
  const user = await requireUser();

  // Scoped to the owner inside deleteRule, so an id from anywhere else simply
  // matches nothing.
  const removed = await deleteRule(user.id, String(form.get("id") ?? ""));

  revalidatePath(RULES_PATH);
  backWith(removed ? { deleted: "1" } : { error: "That rule no longer exists." });
}
