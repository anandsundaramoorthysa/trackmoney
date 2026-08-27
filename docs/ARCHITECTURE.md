# Architecture

One idea runs through all of it: **the model writes sentences; code decides
what happens.** Every box below that touches money or consent is deterministic.

---

## The whole system

```
                        ┌───────────────────────────────┐
   a person ───────────▶│  Next.js app (server-rendered)│
                        │  auth · transactions · agent  │
   an AI buyer ────────▶│  billing · insights · trail   │
                        └───────────────┬───────────────┘
                                        │
              ┌─────────────────────────┼──────────────────────────┐
              ▼                         ▼                          ▼
      ┌───────────────┐        ┌─────────────────┐        ┌────────────────┐
      │ Neon Postgres │        │ Groq → Gemini   │        │ Razorpay       │
      │ 8 tables      │        │ → templates     │        │ Orders API     │
      │ constraints   │        │ (wording only)  │        │ (test mode)    │
      └───────────────┘        └─────────────────┘        └────────────────┘
```

The model is a leaf, not a hub. Nothing downstream of it can be reached without
passing through code that can say no.

---

## One turn of the agent

```
  user types something
          │
          ▼
  ① record it verbatim ─────────────────────────▶ agent_events
          │
          ▼
  ② classifyIntent()            ◀── NO MODEL. Plain code.
     yes / no / question / unclear                lib/agent/intent.ts
          │
          ▼
  ③ computeUsageFacts()         ◀── NO MODEL. SQL.
     counts, cap, categories, price               lib/facts.ts
          │
          ▼
  ④ callLLM(facts, transcript)  ◀── the model's only job: wording
     Groq → Gemini → template                     lib/agent/llm.ts
     returns { reply, tool }
          │
          ▼
  ⑤ tool handler decides        ◀── NO MODEL. Five bounds.
     may this run, right now?                     lib/agent/tools.ts
          │
          ▼
  ⑥ checkGrounding(reply)       ◀── NO MODEL. Set membership.
     every number traced to ③, or discard         lib/agent/grounding.ts
          │
          ▼
  ⑦ write what happened ────────────────────────▶ agent_events
     including refusals
```

**Steps ②, ⑤ and ⑥ never involve the model.** That is why the model being wrong
is survivable, and why a jailbreak changes nothing.

---

## Three ways to buy, one function

```
   a person, on Billing          the assistant            an AI buyer
   "Upgrade to Pro"              "yes please"             POST + mandate
          │                            │                        │
          │                    consent recorded          mandate: one product,
          │                    after the pitch           capped, expiring,
          │                            │                 single-use
          │                            │                        │
          └────────────┬───────────────┴────────────────────────┘
                       ▼
          createProUpgradeOrder()          ← the ONLY place an order is created
                       │                     lib/razorpay.ts
             ┌─────────┴─────────┐
             │ already on Pro?   │ refuse
             │ open order?       │ reuse it (DB constraint, not a check)
             └─────────┬─────────┘
                       ▼
              Razorpay Orders API
                       │
                       ▼
        ┌──────────────────────────────┐
        │  a HUMAN authorises, in       │  ← no caller reaches past this line
        │  Razorpay's own checkout      │
        └──────────────┬───────────────┘
                       ▼
        POST /api/checkout/verify
        recompute HMAC, constant-time compare
                       │
              verified │ not verified
                       ▼            ▼
                 plan → pro    recorded as failed
```

The agent has no payment path of its own. Neither does the AI buyer. That is
the claim the audit trail exists to let someone check.

---

## What each bound is enforced by

| Bound | Enforced by | Not by |
|---|---|---|
| Only two tools exist | a name check in `run.ts` | the prompt |
| Consent must be on record, and postdate the pitch | `hasAffirmativeAfterSuggestion()` | the model's opinion |
| One yes buys one order | consent is spent when an order is created | trust |
| One open order per account | **a partial unique index** | a read-then-write |
| No second pitch after a decline | conversation state, in every tier | the prompt |
| Never charge an account already on Pro | `createProUpgradeOrder()` | the caller |
| The same charge cannot be imported twice | **a unique index** on a content hash | the import code |
| A mandate buys once | a conditional `UPDATE`, before the order | a flag |
| The Free cap holds under concurrency | **a conditional upsert** on `month_quota` | counting, then writing |

The three in bold are the ones that survive concurrency. All three were checks
in code first, and all three were promoted after a test caught two requests
passing the same check.

The cap is the interesting one, because it could not be solved the same way. A
limit of twenty is not a uniqueness rule, so there is no index to violate, and
the HTTP driver Neon speaks cannot open a transaction — a lock cannot be held
across a read and a write. What is left is a statement that is atomic by itself:
an upsert whose `DO UPDATE` re-reads the counter row under a row lock and
re-checks the limit against the value it finds there, not against anything the
request read a moment earlier. Concurrent writers queue on that row, and each
one sees the increment before it.

---

## Data model

```
users ──┬── sessions            (token stored as a hash, never in plaintext)
        ├── password_resets     (hashed, single-use, 15 minutes)
        ├── purchase_mandates   (hashed, single-use, 30 minutes, capped)
        ├── transactions        (unique per user + content fingerprint)
        ├── month_quota         (the Free cap, one row per account per month)
        ├── conversations ── agent_events   (the trail, with facts attached)
        └── payments           (≤ 1 open order per user, by constraint)

plan_config                      (cap, price, features — data, not constants)
```

All money is integer paise. One file is allowed to convert to rupees.

---

## Degrading rather than failing

```
Groq  ──fails──▶  Gemini  ──fails──▶  deterministic template
```

And independently: if a generation contains a number the facts do not support,
that generation is discarded and the same template is used. So there are two
different reasons the agent may speak in templates, and in both cases checkout
still works.

`npm run check:providers` exists because a retired model name fails exactly the
way an outage does — quietly. Both defaults went stale once already.

---

## Where to look in the code

| Claim | File |
|---|---|
| Numbers are computed, never generated | `lib/facts.ts` |
| Consent is decided before any model runs | `lib/agent/intent.ts` |
| The two tools and their gates | `lib/agent/tools.ts` |
| Wording is checked against the facts | `lib/agent/grounding.ts` |
| One turn, start to finish | `lib/agent/run.ts` |
| The only place an order is created | `lib/razorpay.ts` |
| What a machine can buy, and how | `app/api/catalog/route.ts` |
| Authority a person signed | `lib/mandates.ts` |
| The trail | `app/(app)/agent-activity/page.tsx` |
