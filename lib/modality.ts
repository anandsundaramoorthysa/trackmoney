/**
 * Was a person there when this was authorised?
 *
 * AP2 splits an agent purchase into three mandates — the intent a human
 * expressed, the cart a merchant bound to it, and a payment credential that
 * carries one fact onward to whoever settles it: whether a human was present.
 * Card networks have distinguished present from not-present for decades because
 * the two carry different risk, and an agent buying on someone's behalf is a
 * third case that neither label covers.
 *
 * TrackMoney has all three paths already and only ever recorded which code
 * started the order. Naming the modality alongside it costs nothing and is the
 * part an issuer would actually want: not "the assistant did it", but "a human
 * was at the keyboard when this was authorised, and the agent only drafted it".
 *
 * This is deliberately our own vocabulary rather than a claim of AP2
 * compliance. AP2 mandates are W3C Verifiable Credentials signed by a wallet,
 * and nothing here is signed by a wallet. What is honest to say is that the
 * same distinction is recorded, in the same three parts, and can be read back.
 */

/** Where an order came from. Matches `payments.initiated_by`. */
export type Initiator = "billing_page" | "agent" | "ai_buyer";

export type Modality =
  /** A person clicked, and no agent was involved at all. */
  | "human_present"
  /** A person agreed in their own words; an agent prepared the order. */
  | "human_present_agent_assisted"
  /** No person at the keyboard. An earlier mandate stands in for them. */
  | "human_not_present";

export function modalityOf(initiatedBy: Initiator): Modality {
  switch (initiatedBy) {
    case "billing_page":
      return "human_present";
    case "agent":
      // The agent cannot reach this path without recorded consent that
      // postdates an explanation, so a human said yes in their own words.
      return "human_present_agent_assisted";
    case "ai_buyer":
      return "human_not_present";
  }
}

/** How to say it to somebody reading the audit trail. */
export const MODALITY_LABELS: Record<Modality, string> = {
  human_present: "Human present",
  human_present_agent_assisted: "Human present, agent assisted",
  human_not_present: "Human not present, mandate held",
};
