import { CATEGORIES } from "@/lib/transactions";
import { isRealDate, istToday } from "@/lib/time";
import { rupeesToPaise } from "@/lib/transactions";

/**
 * A transaction the agent has drafted but not written.
 *
 * The agent could only ever do one thing: sell the upgrade. That made the whole
 * demonstration about a purchase, when the interesting claim is broader — that
 * an agent can act inside a ledger without ever being trusted with it.
 *
 * A proposal is the shape of that claim. The model reads "450 for lunch at Blue
 * Tokai yesterday" and drafts a row; nothing reaches the database until the
 * person looks at the draft and confirms it. The draft is editable, so nothing
 * in it is trusted at confirm time either — every field is checked again on the
 * way in, against the same rules a typed transaction passes through.
 */
export type TransactionProposal = {
  merchant: string;
  category: string;
  amountPaise: number;
  occurredOn: string;
};

export type ProposalDraft = {
  merchant?: unknown;
  category?: unknown;
  amount?: unknown;
  occurredOn?: unknown;
};

/**
 * Read a model's draft into a proposal, or refuse it.
 *
 * Deliberately strict and deliberately silent about *why* to the model: a
 * malformed draft becomes no proposal at all rather than a half-filled card
 * that invites someone to confirm a number nobody chose.
 */
export function readProposal(
  draft: ProposalDraft,
  today = istToday(),
): TransactionProposal | null {
  const merchant = typeof draft.merchant === "string" ? draft.merchant.trim() : "";
  if (merchant.length === 0 || merchant.length > 80) return null;

  // Amounts arrive as the model wrote them — "450", "1,299.50", "₹99". The
  // rupee parser is the only thing allowed to turn text into paise, so a model
  // cannot invent a denomination.
  const amountPaise =
    typeof draft.amount === "string"
      ? rupeesToPaise(draft.amount)
      : typeof draft.amount === "number" && Number.isFinite(draft.amount)
        ? rupeesToPaise(String(draft.amount))
        : null;

  if (amountPaise === null || amountPaise <= 0) return null;

  const occurredOn =
    typeof draft.occurredOn === "string" && isRealDate(draft.occurredOn)
      ? draft.occurredOn
      : today;

  // A date the ledger would refuse is not worth showing on a card.
  if (occurredOn > today) return null;

  const category =
    typeof draft.category === "string" &&
    (CATEGORIES as readonly string[]).includes(draft.category)
      ? draft.category
      : "Other";

  return { merchant, category, amountPaise, occurredOn };
}
