# The agent: what it does, and what it is not allowed to do

TrackMoney's agent is not interesting because it can sell you something. It is
interesting because of how narrow its authority is, and because you can read
every refusal afterwards.

This document is the honest version: what each piece does, what changed, and
what is deliberately still missing.

---

## The shape of one turn

Seven steps. Four of them never involve the model at all.

| # | Step | Who decides |
|---|---|---|
| 1 | Log the user's words verbatim | code |
| 2 | **Classify intent** — yes, no, question, unclear | **code** |
| 3 | Compute the facts: counts, totals, recurring, price | **code** |
| 4 | Call the model with the facts and the tool list | model |
| 5 | **Run the requested tool through its gates** | **code** |
| 6 | **Check every number in the reply against the facts** | **code** |
| 7 | Write the audit row | code |

The model chooses words and asks for a tool. It never decides whether consent
happened, never decides whether a rule is satisfied, and never gets to state a
number that is not in the data.

### Why consent is step 2 and not step 4

A model that can be talked into believing you agreed is a model that can be
talked into taking a money action. So agreement is decided before the model is
called, by a function with a word list, and the classifier is deliberately
lopsided: anything it cannot read as a clear yes is not a yes. A false
"unclear" costs one extra turn of conversation. A false "affirmative" charges
somebody who did not agree to be charged.

This is also where the sharpest bug in the project lived. `"I'm not sure"`
contains `"sure"`, and neither refusal list held a bare `not` — so hesitation
was read as consent to a ₹499 charge. It is fixed and pinned by tests.

---

## The three tools

Nothing else is callable. The gates run in the handler, never in the prompt,
because a prompt asking a model not to do something is a request, not a bound.

### 1. `explainSuggestion` — pitch the upgrade

Marks the conversation as pitched. Refused after a decline (rule 4), refused
for an account already on Pro (rule 5), refused if it has already pitched once
in this conversation (rule 1).

### 2. `createCheckoutOrder` — prepare an order

Refused without recorded consent that postdates an explanation (rule 2).
Refused while another order is open (rule 3, enforced by a partial unique
index, not a check). Refused for an account already on Pro (rule 5, read from
the database rather than from the caller's copy).

It prepares an order and hands back a button. **The agent cannot open the
checkout and cannot pay.** A person authorises the payment in Razorpay's own
sheet, and the signature is verified with HMAC before a plan moves.

### 3. `proposeTransaction` — draft a ledger row *(new)*

Reads "450 for lunch at Blue Tokai yesterday" and drafts a transaction. It
**writes nothing**. The draft comes back as an editable card, and confirming it
goes through `addTransaction` — the same path a typed transaction takes, so the
Free cap, the duplicate index and the date rules all still apply.

Nothing on the card is trusted when it comes back, because the card is
editable. Every field is parsed again on the way in.

---

## What changed, and why

**Before:** the agent had one job. It could pitch and it could prepare an
order. That made the whole demonstration about a purchase, which is a thin
answer to "what can an agent safely do inside a ledger?"

**Now:** the same guarantees applied to something other than selling. The
agent can draft, and a person confirms. The gates did not need loosening to
allow it — a draft is not a write, so it needed no new authority at all.

That is the point worth making: widening what an agent can *suggest* costs
nothing, as long as the thing that *commits* stays on the user's side of the
line.

---

## What is deliberately not built

Being explicit about this is cheaper than being asked.

- **`recategorise` and `set_a_rule` as agent proposals.** The rules engine
  exists and has a page; the agent cannot yet propose one. Same propose→confirm
  shape, not yet wired.
- **Multi-turn planning.** The agent handles one turn against current facts. It
  does not plan across turns, and nothing in the design assumes it could.
- **Anything that spends without a human.** Not a gap — a boundary. Purchase
  mandates exist for AI buyers, and even those authorise an *order*, never a
  payment.

---

## The two limits of the grounding check

Stated rather than implied, because a check that is trusted beyond its reach is
worse than no check.

1. It confirms a figure came from the facts, **not that it was used for the
   right thing**. `3` is in the data as "transactions over the cap", so using it
   as a recurring count would pass.
2. It inspects digits, not numbers spelled out in words.

Both are narrow. Both are cheaper to admit than to paper over.
