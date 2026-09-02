"use server";

import { revalidatePath } from "next/cache";

import { logAgentEvent } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { readProposal } from "@/lib/agent/proposal";
import { getOrCreateConversation } from "@/lib/agent/conversation";
import { addTransaction } from "@/lib/transactions";
import { formatPaise } from "@/lib/money";

export type ConfirmProposalResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Writing a transaction the agent drafted.
 *
 * This is the only door between a proposal and the ledger, and it is on the
 * user's side of it. The card is editable, so nothing arriving here is trusted:
 * the amount, the date, the merchant and the category are all read again
 * through the same parser the model's draft went through, and then written
 * through `addTransaction`, which is where the Free cap, the duplicate index
 * and the date rules actually live.
 *
 * That matters more than it sounds. If this action wrote rows itself, the agent
 * would have a second path into the ledger with its own opinion of the rules —
 * which is exactly the thing the checkout flow was built to avoid.
 */
export async function confirmProposalAction(
  form: FormData,
): Promise<ConfirmProposalResult> {
  const user = await requireUser();

  const proposal = readProposal({
    merchant: form.get("merchant"),
    category: form.get("category"),
    amount: form.get("amount"),
    occurredOn: form.get("occurredOn"),
  });

  if (!proposal) {
    return { ok: false, message: "That draft is not something I can save." };
  }

  const conversation = await getOrCreateConversation(user.id);
  const result = await addTransaction(user, { ...proposal, source: "manual" });

  if (!result.ok) {
    const message =
      result.reason === "cap_reached"
        ? `That would be past the Free plan's ${result.cap} for ${result.month}.`
        : result.reason === "duplicate"
          ? "That transaction is already recorded."
          : result.message;

    await logAgentEvent({
      userId: user.id,
      conversationId: conversation.id,
      type: "tool_refused",
      explanation: `The drafted transaction was not saved: ${message}`,
      meta: { rule: result.reason, stage: "confirm" },
    });

    return { ok: false, message };
  }

  await logAgentEvent({
    userId: user.id,
    conversationId: conversation.id,
    type: "checkout_result",
    explanation: `Saved ${formatPaise(proposal.amountPaise)} at ${proposal.merchant} on ${proposal.occurredOn}, after the draft was confirmed. No money moved: this is a ledger entry.`,
    meta: {
      outcome: "proposal_confirmed",
      moneyMoved: false,
      transactionId: result.id,
    },
  });

  revalidatePath("/transactions");
  revalidatePath("/");

  return {
    ok: true,
    message: `Saved ${formatPaise(proposal.amountPaise)} at ${proposal.merchant}.`,
  };
}
