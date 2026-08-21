<p align="left">
  <img src="public/logo-wordmark.svg" alt="TrackMoney" width="240" />
</p>

**Razorpay AI Buildathon — Track 1: AI Growth & Agentic Commerce**

TrackMoney is a small expense tracker that sells its own Pro upgrade. An agent
notices something true about your account, explains it in your own numbers, asks,
and — only if you say yes — prepares a Razorpay test-mode order that you then
authorise yourself.

The interesting part is not that an agent can sell you something. It is what the
agent is *not allowed* to do, and the fact that you can read every one of those
refusals afterwards.

> **Test mode only.** No real money moves anywhere in this project. The app
> refuses to start against a live Razorpay key.

---

## The bar, mapped to code

Track 1's bar: *"Every money action explainable, bounded and gated. Show the audit
trail and one failure handled gracefully."*

### Explainable

Three layers, in order, in [`lib/facts.ts`](lib/facts.ts),
[`lib/agent/prompt.ts`](lib/agent/prompt.ts) and
[`lib/agent/grounding.ts`](lib/agent/grounding.ts):

1. `computeUsageFacts()` computes every number deterministically from real rows.
   No model is involved and none may be.
2. The model receives that object and nothing else as factual input. It has no
   database access and is not asked to compute anything. Its job is wording.
3. `checkGrounding()` then verifies that **every number in what the model wrote
   exists in the facts object**. If one does not, the whole generation is thrown
   away and a deterministic template is used instead.

So the agent's sentences are the model's; its numbers never are. A fabricated
figure cannot reach the user, and cannot reach the audit trail.

The trail stores both halves — the wording *and* the facts the agent was handed
when it wrote it, in `agent_events.facts`. You can diff them.

### Bounded

Enforced in [`lib/agent/tools.ts`](lib/agent/tools.ts) and
[`lib/razorpay.ts`](lib/razorpay.ts), in the handlers rather than the prompt. A
system prompt asking a model to behave is a request, not a boundary; every rule
below holds even if the model is jailbroken, confused, or swapped for a worse one
tomorrow.

| Rule | Enforced in | What it stops |
|---|---|---|
| Exactly two tools exist | `lib/agent/run.ts` | A hallucinated tool name is refused and audited, not ignored |
| Consent must already be recorded | `lib/agent/tools.ts` | The model cannot assert that you agreed |
| One open order per user | `lib/razorpay.ts` | A retry loop cannot stack up orders |
| Hard stop after a decline | `lib/agent/tools.ts` | No second pitch, no nagging |
| Already on Pro | `lib/razorpay.ts` | Charging someone twice |

Two of those live in `createProUpgradeOrder()` rather than in the agent, because
they apply to human callers too.

### Gated

Three separate human actions stand between the suggestion and money moving:

1. you say yes in the conversation — classified deterministically in
   [`lib/agent/intent.ts`](lib/agent/intent.ts), *before* any model runs, and it
   only counts if it came after the pitch;
2. you click **Open secure checkout** — the agent cannot open Razorpay's
   checkout, because Checkout.js runs in your browser and it does not;
3. you authorise inside Razorpay's own window.

The classifier is deliberately lopsided: anything it cannot read as a clear yes
is not a yes. "Yes, but what do I lose on Free?" is a question, not consent. A
false *unclear* costs one extra turn of conversation; a false *affirmative* would
charge someone who did not agree.

**And there is a plain "Upgrade to Pro" button that has nothing to do with the
agent.** That matters twice over. A real product always has a manual path, so an
agent-only checkout would look staged. More importantly, the agent's tool calls
**the same function** the button calls — `createProUpgradeOrder()` in
[`lib/razorpay.ts`](lib/razorpay.ts), the only place in this codebase that creates
a Razorpay order. The agent has no payment path of its own, and therefore no
privilege you do not already have.

### Audit trail

[`/agent-activity`](app/agent-activity/page.tsx), written by
[`lib/audit.ts`](lib/audit.ts). One row per thing the agent did *or was stopped
from doing*: what it noticed, what it said, how your reply was classified, what
order it created, how the payment ended.

Refusals are logged as loudly as successes. A bound nobody can watch being
enforced is indistinguishable from a bound that does not exist.

### One failure handled gracefully

Both failure paths are wired, because they prove different things:

- **You decline.** The conversation moves to `declined`, the agent acknowledges
  it in one sentence and will not raise it again. Proves gating.
- **The payment fails.** Use test card `4000 0000 0000 0002`. The order is marked
  `failed` with its reason, the account stays on Free, the agent says plainly
  what happened and points at the billing page. No crash, no silent retry loop.
  Proves graceful failure. See
  [`app/api/checkout/failed/route.ts`](app/api/checkout/failed/route.ts).

A signature that does not verify is also treated as a failed payment rather than
being swallowed — [`app/api/checkout/verify/route.ts`](app/api/checkout/verify/route.ts).

---

## Running it

Requires Node 20+, a [Neon](https://neon.tech) Postgres database, and Razorpay
**test-mode** keys.

```bash
git clone <this repo>
cd trackmoney
npm install

cp .env.example .env.local   # then fill it in

npm run db:push              # create the tables
npm run db:seed              # load the demo account
npm run dev                  # http://localhost:3000
```

`.env.local` needs:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `RAZORPAY_KEY_ID` | Must start with `rzp_test_`; the app refuses live keys |
| `RAZORPAY_KEY_SECRET` | |
| `GROQ_API_KEY` | Optional |
| `GEMINI_API_KEY` | Optional |

Both LLM keys are optional. With neither set the agent falls back to
deterministic templates and **the whole flow still works** — see *Demo-day
resilience* below.

```bash
npm run test:facts   # the deterministic layers
npm run typecheck
```

### Test cards

| Card | Outcome |
|---|---|
| `4111 1111 1111 1111` | succeeds |
| `4000 0000 0000 0002` | fails — this is the graceful-failure demo |

Any future expiry, any CVV.

---

## Walkthrough

1. **Dashboard** — a seeded account with 23 transactions this month against a
   Free cap of 20, and three charges that repeat monthly.
2. **The agent opens** with something specific to those numbers, not marketing
   copy. Ask it questions; it answers from the same facts.
3. **Say yes** — it prepares a ₹499 test-mode order and hands you a button. It
   cannot press it.
4. **Or say no** — it stops, and stays stopped.
5. **`/agent-activity`** — read back everything that happened, including
   anything it was refused.
6. **Reset demo data** on the dashboard puts it all back for the next run.

---

## Demo-day resilience

The agent degrades in three tiers rather than failing:

```
Groq  →  Gemini  →  deterministic template
```

If both providers are down or slow, `callLLM()`
([`lib/agent/llm.ts`](lib/agent/llm.ts)) returns null and the agent still
produces a correct, grounded, plainly-worded suggestion — and checkout still
works. The same template is the fallback when a generation fails the grounding
check.

The plain billing-page button is the other half of this: if the agent misbehaves
during a live demo, the payment flow can still be shown working on its own.

---

## Architecture

```
  browser
    │
    ├── AgentPanel ─────────► POST /api/agent
    │                            │
    │                            ├── 1. log the user's words verbatim
    │                            ├── 2. classifyIntent()        ← deterministic, no model
    │                            ├── 3. computeUsageFacts()     ← deterministic, no model
    │                            ├── 4. callLLM()               ← Groq → Gemini → template
    │                            │      returns { reply, tool }
    │                            ├── 5. tool handler decides if that is allowed
    │                            │      └── createProUpgradeOrder() ─┐
    │                            ├── 6. checkGrounding() on the wording
    │                            └── 7. write agent_events        │
    │                                                             │
    └── UpgradeButton ──────► POST /api/checkout ─────────────────┤
                                                                  │
                                                    Razorpay Orders API (test)
                                                                  │
        Checkout.js (browser, user authorises) ───────────────────┘
                    │
                    └──► POST /api/checkout/verify → HMAC check → plan flips to Pro
```

Steps 2, 5 and 6 do not involve the model. That is why the model being wrong is
survivable.

**Stack:** Next.js 15 (App Router), Neon Postgres, Drizzle ORM, Tailwind 4,
Razorpay Orders API + Checkout.js, Groq with a Gemini fallback.

---

## Scope, stated honestly

Things this deliberately does not do, and why:

- **No authentication.** One seeded demo account and a reset button. It saves a
  day of a 13-day build, and it means a repo that stays public forever cannot
  leak personal data it has no way to collect. The rule that survives the
  missing auth layer: the user id is resolved server-side and **never** accepted
  from a request body, so no caller can aim a money action at another account.
  In production this would be session-scoped; the endpoints already take no
  `userId`.
- **No webhooks.** Verification recomputes the HMAC signature synchronously. In
  production `payment.captured` would be the source of truth, because someone
  closing the tab mid-redirect never reaches the verify route. For a gated,
  single-order demo this is the right scope, not an oversight.
- **One-time ₹499, not a subscription.** This uses the Orders API, not
  Subscriptions/Mandates. Advertising a monthly price while charging once would
  be a small dishonesty, so it is sold as what it is. Recurring mandates belong
  to Track 3.
- **Detection is a rule, not ML.** Same merchant, same amount, two or more
  distinct months. The judged intelligence is in the gating and the trail.
- **The expense tracker is thin on purpose.** It exists so the agent has
  something real to reason about.

All seeded data is fictional.

---

## Repo map

| Path | What lives there |
|---|---|
| [`lib/facts.ts`](lib/facts.ts) | Deterministic facts — the only source of numbers |
| [`lib/recurring.ts`](lib/recurring.ts) | The recurring-charge rule |
| [`lib/agent/intent.ts`](lib/agent/intent.ts) | Consent classification, no model involved |
| [`lib/agent/tools.ts`](lib/agent/tools.ts) | The two tools and their gates |
| [`lib/agent/grounding.ts`](lib/agent/grounding.ts) | The grounding check and templates |
| [`lib/agent/run.ts`](lib/agent/run.ts) | One turn, start to finish |
| [`lib/razorpay.ts`](lib/razorpay.ts) | The one shared order function; HMAC verification |
| [`lib/audit.ts`](lib/audit.ts) | Audit-trail writer |
| [`lib/db/schema.ts`](lib/db/schema.ts) | Six tables |
| [`app/agent-activity/`](app/agent-activity/) | The audit trail page |
| [`PLAN.md`](PLAN.md) | Why every one of these decisions was made |

[`PLAN.md`](PLAN.md) is the design record: track choice, the decisions and the
reasoning behind each, written before the code.

## Licence

[MIT](LICENSE).
