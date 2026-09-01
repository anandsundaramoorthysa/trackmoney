<p align="left">
  <img src="public/logo-wordmark.svg" alt="TrackMoney" width="240" />
</p>

**Razorpay AI Buildathon — Track 1: AI Growth & Agentic Commerce**

**Live demo: <https://trackmoney-anandsundaramoorthysa.vercel.app>** — press
*Try the demo account*, no signup needed. Razorpay runs in test mode throughout;
no real money moves.

TrackMoney is a small expense tracker that sells its own Pro upgrade. You sign
in, log what you spend, and hit the Free plan's limit — at which point an agent
notices something true about your account, explains it in your own numbers,
asks, and — only if you say yes — prepares a Razorpay test-mode order that you
then authorise yourself.

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
   exists in the facts object, in the unit the model was given it**. If one does
   not, the whole generation is thrown away and a deterministic template is used
   instead. Rupee figures only — admitting the paise original of the same amount
   would have let "₹49,900" pass as grounded against a ₹499 order.

So the agent's sentences are the model's; its numbers never are. A fabricated
figure cannot reach the user, and cannot reach the audit trail.

Two limits, stated rather than implied: the check confirms a figure came from
the facts, not that it was used for the right thing (3 is in the data as
"transactions over the cap", so using it as a recurring count would pass), and
it only inspects digits, not numbers spelled out in words. Both are narrow, and
both are cheaper to admit than to paper over.

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
| Hard stop after a decline | `lib/agent/tools.ts`, `lib/agent/run.ts` | No second pitch, no nagging — in every tier, including templates |
| One yes, one order | `lib/agent/conversation.ts` | Consent is spent when an order is created, so a failed payment cannot be silently retried |
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

The same care applies to no. Declining is the one irreversible thing a user can
do here, so it is never *inferred*: "what happens if I don't upgrade?" is a
question, not a refusal, even though it contains "don't". An outright "no
thanks" still ends it, question attached or not.

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

Payments you start yourself from the Billing page appear here too, labelled as
yours rather than the agent's — that is the point of the page, since both go
through the same function. The row labels describe what happened rather than
which branch ran: a failed Orders API call is "Order could not be created", not
a payment outcome, and neither it nor a deduplicated reuse counts toward the
money-actions tally.

### One failure handled gracefully

Both failure paths are wired, because they prove different things:

- **You decline.** The conversation moves to `declined`, the agent acknowledges
  it in one sentence and will not raise it again. Proves gating.
- **The payment fails.** Enter an incorrect OTP at the checkout. The order is marked
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

npm run db:migrate           # create the tables from the committed migrations
npm run db:seed              # load the demo account
npm run dev                  # http://localhost:3000
```

`.env.local` needs:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Neon connection string, including `?sslmode=require` |
| `RAZORPAY_KEY_ID` | Must start with `rzp_test_`; the app refuses live keys |
| `RAZORPAY_KEY_SECRET` | |
| `GROQ_API_KEY` | Optional |
| `GEMINI_API_KEY` | Optional |
| `GROQ_MODEL` | Optional override; defaults to a model verified to work |
| `GEMINI_MODEL` | Optional override; defaults to `gemini-flash-latest` |

Run **`npm run check:providers`** before a demo. Hosted model catalogues retire
names without notice, and a retired name fails exactly the way an outage does —
quietly, straight to the template tier — so the fallback looks healthy while no
model has run at all.

Both LLM keys are optional. With neither set the agent falls back to
deterministic templates and **the whole flow still works** — see *Demo-day
resilience* below.

```bash
npm run check:providers   # does every external service actually answer?
npm run typecheck
npm run lint
npm run build
```

`check:providers` is the one worth running first. It asks the database,
Razorpay and both model providers whether they actually answer, and names the
model it got a reply from — a retired model id fails silently otherwise,
straight to the template tier, so the fallback looks healthy while nothing has
run at all.

### How this was verified

The suite itself is not published, but what it covers is worth stating plainly:
209 assertions across three layers. The deterministic layers — consent
classification, the grounding check, CSV parsing, the IST date boundaries — run
without a database. The server layer runs against a real Postgres, rebuilt from
the committed migrations on every run, with Razorpay replaced by a local
stand-in that signs with the same secret, so signature verification is genuinely
exercised rather than stubbed out. The browser layer drives a production build.

Where a rule matters — the cap holding under concurrent writes, an account that
has paid not being charged again, one account never reaching another's data —
the check was confirmed by deliberately breaking the code and watching the right
assertion fail. A test that cannot fail is worse than no test, because it is
believed.

### Test cards

| Card | Outcome |
|---|---|
| `5267 3181 8797 5449` | succeeds — a domestic card. OTP `1234` |
| the same card, wrong OTP | fails — this is the graceful-failure demo |

> `4111 1111 1111 1111` appears in most Razorpay examples and does **not** work
> here: this account has international cards disabled, so the checkout answers
> *"International cards are not supported"*. Verified against the deployed app.

Any future expiry, any CVV.

---

## Walkthrough

1. **Dashboard** — a seeded account with 23 transactions this month against a
   Free cap of 20. Free shows the most recent 20 and tells you *how many* of
   your charges recur; it does not tell you which.
2. **The agent opens** with something specific to those numbers, not marketing
   copy. Ask it questions; it answers from the same facts.
3. **Say yes** — it prepares a ₹499 test-mode order and hands you a button. It
   cannot press it.
4. **Or say no** — it stops, and stays stopped.
5. **`/agent-activity`** — read back everything that happened, including
   anything it was refused.
6. **What you actually bought** — Pro lifts the cap so the full month is
   listed, names the recurring charges, and enables CSV export. The pitch quotes
   the plan's feature list, so every line of it has to be something the account
   gains.
7. **Reset demo data** on the dashboard puts it all back for the next run.

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
- **The tracker is small, but what Pro sells is real.** The cap, the recurring
  names and the CSV export all actually change when you pay. An upsell for
  features that do not exist would undercut the one thing this project is
  claiming: that the agent's explanations are true.
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

| Also | |
|---|---|
| [`PITCH.md`](PITCH.md) | The five-minute pitch, and the questions a panel will ask |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Diagrams: one turn, the three ways to buy, what enforces what |
| [`docs/DEMO.md`](docs/DEMO.md) | The exact clicks, in order |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Getting it onto Vercel |

## Licence

[MIT](LICENSE).
