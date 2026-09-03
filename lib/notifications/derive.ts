import type { Conversation, NotificationKind } from "@/lib/db/schema";
import { hasUpgradeCase, type UsageFacts } from "@/lib/facts";
import { formatPaise } from "@/lib/money";

/**
 * What is worth interrupting somebody about, and what it says.
 *
 * Pure: no database, no model, no clock beyond what it is handed. That is what
 * lets the whole rule set be tested against fixtures with nothing running, the
 * same property `lib/recurring.ts` keeps and for the same reason.
 *
 * ── Why no model writes these ──────────────────────────────────────────────
 *
 * Grounding works because there is always a deterministic sentence to fall back
 * to. For a notification the candidate and the fallback would be the same
 * sentence, so calling a model and then discarding anything ungrounded is cost
 * and risk to arrive where we started.
 *
 * The stronger reason is that unsolicited is a different risk class. A wrong
 * chat reply lands inside a conversation the person can push back on next turn.
 * A wrong notification arrives with no conversation attached, is counted on a
 * badge, and is read at a glance — the format that gets the least scrutiny
 * would have been getting the least protection.
 *
 * The gates still run. `renderNotification` output is passed through
 * `checkGrounding` and `checkClaims` before it is served, in code and not only
 * in a test, so a template that hardcodes a number — or an edit that
 * interpolates the cap where it meant the remainder — fails exactly as a
 * model's sentence would.
 */

export type DerivedNotification = {
  kind: NotificationKind;
  dedupKey: string;
};

/** The month a notification is about, as "2026-09". */
export function monthKey(facts: UsageFacts): string {
  // `monthLabel` is "September 2026"; the key wants a sortable, stable form and
  // must not depend on the machine's locale.
  const [name, year] = facts.monthLabel.split(" ");
  const index = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ].indexOf(name.toLowerCase());
  const month = index === -1 ? "00" : String(index + 1).padStart(2, "0");
  return `${year ?? "0000"}-${month}`;
}

/**
 * A charge that repeats, identified by what makes it that charge.
 *
 * Merchant and amount, and deliberately not the month. A subscription is news
 * the first time it is spotted and not every thirty days afterwards, so the key
 * has to survive the calendar. A price change produces a different key and
 * fires again, which is correct — "this costs something else now" is news — and
 * it is why the wording below says a charge repeats at the same amount rather
 * than calling it new.
 */
function recurringKey(merchant: string, amountPaise: number): string {
  return `new_recurring:${merchant.toLowerCase().trim()}|${amountPaise}`;
}

/**
 * Which notifications this account should have right now.
 *
 * Ordered by how much the person needs it, because that is the order the bell
 * renders. A cap that has already been hit outranks one that is approaching,
 * and both outrank an offer.
 */
export function deriveNotifications(
  facts: UsageFacts,
  conversationState: Conversation["state"],
): DerivedNotification[] {
  const out: DerivedNotification[] = [];
  const month = monthKey(facts);
  const free = facts.currentPlan === "free";

  // The only notification that predicts a failure the person is about to walk
  // into: the next thing they save will be refused. Withheld from nobody —
  // someone who declined the upgrade still deserves to know their next entry
  // will not be kept. Declining a sale is not declining information.
  if (free && facts.atCap) {
    out.push({ kind: "cap_reached", dedupKey: `cap_reached:${month}` });
  }

  // One slot left is the last moment a decision changes the outcome. Suppressed
  // after a decline, and that line is a judgement call worth stating: the only
  // action this notice points at is the one they refused, so it reads as a
  // nudge rather than as news. `cap_reached` is different — it reports a fact
  // about their account that is true regardless of what they think of Pro.
  if (free && !facts.atCap && facts.remainingOnFree <= 1 && conversationState !== "declined") {
    out.push({ kind: "cap_near", dedupKey: `cap_near:${month}` });
  }

  // A charge crossing from "happened" to "happens every month" is the single
  // most useful thing this app can tell somebody, and the one kind a paying
  // account gets — so the bell is where Pro delivers rather than where it is
  // sold. On Free the count is notified and the merchant is not, because naming
  // it would give away the thing the paid plan is for.
  for (const candidate of facts.recurringCandidates) {
    out.push({
      kind: "new_recurring",
      dedupKey: recurringKey(candidate.merchant, candidate.amountPaise),
    });
  }

  // The offer, last. Only when the data supports it — the same `hasUpgradeCase`
  // that used to gate the opening turn, so nothing is manufactured — and never
  // to somebody who has already said no or already paid.
  if (
    free &&
    hasUpgradeCase(facts) &&
    (conversationState === "open" || conversationState === "pitched")
  ) {
    out.push({ kind: "upgrade_available", dedupKey: `upgrade_available:${month}` });
  }

  return out;
}

/**
 * Is this still worth showing, against facts recomputed right now?
 *
 * Decay without a sweep, a cron or a write. The moment somebody upgrades, every
 * cap notification stops being listed and stops counting toward the badge,
 * because the question is asked again from the same function the notice was
 * built from. A row cannot go stale when staleness is recomputed rather than
 * remembered.
 */
export function stillTrue(
  kind: NotificationKind,
  facts: UsageFacts,
  conversationState: Conversation["state"],
): boolean {
  const free = facts.currentPlan === "free";

  switch (kind) {
    case "cap_reached":
      return free && facts.atCap;
    case "cap_near":
      return free && !facts.atCap && facts.remainingOnFree <= 1 && conversationState !== "declined";
    case "new_recurring":
      return facts.recurringCount > 0;
    case "upgrade_available":
      return (
        free &&
        hasUpgradeCase(facts) &&
        (conversationState === "open" || conversationState === "pitched")
      );
  }
}

export type RenderedNotification = { title: string; body: string };

/**
 * The words.
 *
 * Every number here comes from the facts it is handed, and the phrasings are
 * chosen to match the patterns `checkClaims` already binds — "cap of N", "with
 * N left", "N transactions in". A body phrased so that no claim matches would
 * still pass grounding while nothing verified the number was being used for the
 * thing it describes, which is the failure the claims layer exists to catch.
 */
export function renderNotification(
  kind: NotificationKind,
  facts: UsageFacts,
): RenderedNotification {
  switch (kind) {
    case "cap_reached":
      return {
        title: "You have used every transaction on Free this month",
        body: `You have logged ${facts.txnCountThisMonth} transactions in ${facts.monthLabel}, against the Free plan's cap of ${facts.freeTxnCap}, with ${facts.remainingOnFree} left. The next one you add will not be saved.`,
      };

    case "cap_near":
      return {
        title: "You are one transaction from the Free cap",
        body: `You have logged ${facts.txnCountThisMonth} transactions in ${facts.monthLabel}, against the Free plan's cap of ${facts.freeTxnCap}, with ${facts.remainingOnFree} left.`,
      };

    case "new_recurring":
      return {
        title: facts.showsRecurringDetail
          ? "A charge on your account repeats every month"
          : "Some of your charges repeat every month",
        body: facts.showsRecurringDetail
          ? `${facts.recurringCount} of your charges repeat at the same amount every month: ${facts.recurringCandidates
              .map((c) => `${c.merchant} (${formatPaise(c.amountPaise)})`)
              .join(", ")}.`
          : // Free is told how many and not which. The timing of this notice
            // does narrow down which merchant it is, and that leak is not worth
            // engineering around: delaying or jittering it to protect a paywall
            // would make the product worse to defend the wrong thing.
            `${facts.recurringCount} of your charges repeat at the same amount every month. Free tells you how many; it does not name them.`,
      };

    case "upgrade_available":
      return {
        title: "Pro would lift the cap on this account",
        body: `You have logged ${facts.txnCountThisMonth} transactions in ${facts.monthLabel}, against the Free plan's cap of ${facts.freeTxnCap}, with ${facts.remainingOnFree} left. Pro is a one-time ${formatPaise(facts.proPricePaise)} unlock.`,
      };
  }
}
