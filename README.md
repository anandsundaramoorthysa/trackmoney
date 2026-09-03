<div align="center">

<img src="public/logo-wordmark.svg" alt="TrackMoney" width="260" />

# TrackMoney

**An expense tracker that sells its own Pro upgrade — and refuses, out loud, to do it badly.**

Razorpay AI Buildathon · Track 1: AI Growth &amp; Agentic Commerce

[![CI](https://github.com/anandsundaramoorthysa/trackmoney/actions/workflows/ci.yml/badge.svg)](https://github.com/anandsundaramoorthysa/trackmoney/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-0e7c7b.svg)](LICENSE)
![Next.js](https://img.shields.io/badge/Next.js-15-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)
![Razorpay](https://img.shields.io/badge/Razorpay-test%20mode-0e7c7b)

**[▶ Live demo](https://trackmoney-anandsundaramoorthysa.vercel.app)** — press
*Try the demo account*, no signup needed.

> **Test mode only.** No real money moves anywhere in this project.
> The app refuses to start against a live Razorpay key.

</div>

---

## Table of Contents

- [About the Project](#about-the-project)
- [The bar, mapped to code](#the-bar-mapped-to-code)
  - [Explainable](#explainable)
  - [Bounded](#bounded)
  - [Gated](#gated)
  - [Audit trail](#audit-trail)
  - [One failure handled gracefully](#one-failure-handled-gracefully)
- [Installation & Run the Project](#installation--run-the-project)
- [How this was verified](#how-this-was-verified)
- [Test cards](#test-cards)
- [Walkthrough](#walkthrough)
- [Demo-day resilience](#demo-day-resilience)
- [Architecture](#architecture)  ·  [ARCHITECTURE.md](ARCHITECTURE.md)
- [Scope, stated honestly](#scope-stated-honestly)
- [Repo map](#repo-map)
- [Contribution](#contribution)
- [Security](#security)
- [License](#license)
- [Contact Us](#contact-us)
- [Acknowledge](#acknowledge)

## About the Project

TrackMoney is a small expense tracker that sells its own Pro upgrade. You sign
in, log what you spend, and approach the Free plan's limit — at which point an
assistant called **Tracky AI** notices something true about your account,
explains it in your own numbers, asks, and — only if you say yes — prepares a
Razorpay test-mode order that you then authorise yourself.

The interesting part is not that an agent can sell you something. It is what the
agent is *not allowed* to do, and the fact that you can read every one of those
refusals afterwards.

What it notices on its own arrives as a **notification**, not as an unprompted
sales pitch at the top of the chat. The chat is for asking things.

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

`checkClaims()` closes the obvious gap in that: a figure can be genuine and still
be wrong in place, because 3 sits in the facts as "transactions left before the
cap", so a sentence claiming three charges recur passes a pure number check while
saying something false. Each claim binds a phrasing to the one fact allowed to
fill it.

One limit is stated rather than implied: grounding only inspects digits, so a
sentence with no numbers in it — "it is sunny in Bangalore" — passes every check
here. A numbers check cannot catch that, and the honest answer is that the tool
gates make an off-topic answer embarrassing rather than expensive.

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
| Exactly three tools exist | `lib/agent/run.ts` | A hallucinated tool name is refused and audited, not ignored |
| Consent must already be recorded | `lib/agent/tools.ts` | The model cannot assert that you agreed |
| One open order per user | `lib/razorpay.ts` | A retry loop cannot stack up orders |
| Hard stop after a decline | `lib/agent/tools.ts`, `lib/agent/run.ts` | No second pitch, no nagging — in every tier, including templates |
| One yes, one order | `lib/agent/conversation.ts` | Consent is spent when an order is created, so a failed payment cannot be silently retried |
| Already on Pro | `lib/razorpay.ts` | Charging someone twice |
| No tools on an explanation | `lib/agent/run.ts` | Opening a notification about your own data cannot become a sale |

Two of those live in `createProUpgradeOrder()` rather than in the agent, because
they apply to human callers too.

### Gated

Three separate human actions stand between the suggestion and money moving:

1. you say yes in the conversation — classified deterministically in
   [`lib/agent/intent.ts`](lib/agent/intent.ts), *before* any model runs, and it
   only counts if it came after the explanation;
2. you click **Open secure checkout** — the agent cannot open Razorpay's
   checkout, because Checkout.js runs in your browser and it does not;
3. you authorise inside Razorpay's own window.

The classifier is deliberately lopsided: anything it cannot read as a clear yes
is not a yes. "Yes, but what do I lose on Free?" is a question, not consent. A
false *unclear* costs one extra turn of conversation; a false *affirmative* would
charge someone who did not agree. A bare "ok" is an acknowledgement, not consent
— "ok thanks" must never create an order.

The same care applies to no. Declining is the one irreversible thing a user can
do here, so it is never *inferred*: "what happens if I don't upgrade?" is a
question, not a refusal, even though it contains "don't". A no while a drafted
transaction is on screen rejects the draft, not the upgrade — two subjects, and
consent must bind to the right one.

**And there is a plain "Upgrade to Pro" button that has nothing to do with the
agent.** That matters twice over. A real product always has a manual path, so an
agent-only checkout would look staged. More importantly, the agent's tool calls
**the same function** the button calls — `createProUpgradeOrder()` in
[`lib/razorpay.ts`](lib/razorpay.ts), the only place in this codebase that creates
a Razorpay order. The agent has no payment path of its own, and therefore no
privilege you do not already have.

### Audit trail

[`/agent-activity`](app/%28app%29/agent-activity/page.tsx), written by
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

Three failure paths are wired, because they prove different things:

- **You decline.** The conversation moves to `declined`, the agent acknowledges
  it in one sentence and will not raise it again — and the pending offer is
  withdrawn from the notification bell too, so a decline is not merely silenced
  on one surface. Proves gating.
- **The payment fails.** At the checkout, choose *Pay on bank's page* at the OTP
  step and then *Failure*. The order is marked `failed` with its reason, the
  account stays on Free, the agent says plainly what happened and points at the
  billing page. No crash, no silent retry loop. See
  [`app/api/checkout/failed/route.ts`](app/api/checkout/failed/route.ts).
- **The checkout will not open.** Razorpay reports this through a browser alert,
  which a page can neither style nor answer, and which used to leave the button
  stuck on "Opening checkout…". It is now caught and answered in the page.

A signature that does not verify is also treated as a failed payment rather than
being swallowed — [`app/api/checkout/verify/route.ts`](app/api/checkout/verify/route.ts).

## Installation & Run the Project

Requires **Node 22** (the version CI builds against), a
[Neon](https://neon.tech) Postgres database, and Razorpay **test-mode** keys.

```bash
git clone https://github.com/anandsundaramoorthysa/trackmoney.git
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
| `MERCHANT_SIGNING_KEY` | Optional; signs cart mandates when present |
| `GROQ_MODEL` | Optional override; defaults to a model verified to work |
| `GEMINI_MODEL` | Optional override; defaults to `gemini-flash-latest` |

Both LLM keys are optional. With neither set the agent falls back to
deterministic templates and **the whole flow still works** — see
[Demo-day resilience](#demo-day-resilience).

```bash
npm run check:providers   # does every external service actually answer?
npm run typecheck
npm run lint
npm run build
```

`check:providers` is the one worth running first. It asks the database, Razorpay
and both model providers whether they actually answer, and names the model it got
a reply from — a retired model id fails silently otherwise, straight to the
template tier, so the fallback looks healthy while nothing has run at all.

## How this was verified

The test suite is not published with the repository, but what it covers is worth
stating plainly: **350 assertions across three layers.**

| Layer | Assertions | What it runs against |
|---|---|---|
| Deterministic | 86 | Pure functions — consent classification, grounding, notification rules, CSV parsing, IST date boundaries. No database. |
| Integration | 91 | Real Postgres, rebuilt from the committed migrations each run, with Razorpay replaced by a local stand-in that signs with the same secret — so signature verification is genuinely exercised rather than stubbed. |
| Browser | 173 | Playwright against a production build. |

Where a rule matters — the cap holding under concurrent writes, an account that
has paid not being charged again, one account never reaching another's data — the
check was confirmed by deliberately breaking the code and watching the right
assertion fail. **A test that cannot fail is worse than no test, because it is
believed.**

## Test cards

| Card | Outcome |
|---|---|
| `5267 3181 8797 5449` | succeeds — a domestic card. OTP `1234` |
| the same card, *Pay on bank's page* → *Failure* | fails — this is the graceful-failure demo |

> A wrong OTP does **not** fail the payment; it simply asks again. Use the bank
> page's *Failure* button.

> `4111 1111 1111 1111` appears in most Razorpay examples and does **not** work
> here: this account has international cards disabled, so the checkout answers
> *"International cards are not supported"*. Verified against the deployed app.

Any future expiry, any CVV.

## Walkthrough

1. **Dashboard** — the seeded account sits at 19 transactions against a Free cap
   of 20. Free tells you *how many* of your charges recur; it does not tell you
   which.
2. **The bell** — what the assistant noticed on its own, waiting where you can
   choose to look at it rather than interrupting you.
3. **Open a notification** — Tracky AI explains that one thing, in your numbers.
   For the upgrade notice, this is also the moment the offer goes on record.
4. **Say yes** — it prepares a ₹499 test-mode order and hands you a button. It
   cannot press it.
5. **Or say no** — it stops, stays stopped, and the offer leaves the bell.
6. **`/agent-activity`** — read back everything that happened, including
   anything it was refused.
7. **What you actually bought** — Pro lifts the cap, names the recurring charges,
   and enables CSV export. The pitch quotes the plan's feature list, so every
   line of it has to be something the account gains.
8. **Reset demo data** on the dashboard puts it all back for the next run.

## Demo-day resilience

The agent degrades in three tiers rather than failing:

```
Groq  →  Gemini  →  deterministic template
```

If both providers are down or slow, `callLLM()`
([`lib/agent/llm.ts`](lib/agent/llm.ts)) returns null and the agent still
produces a correct, grounded, plainly-worded answer — and checkout still works.
The same template is the fallback when a generation fails the grounding check.

Notification text is **never** model-written, so the bell is unaffected by a
provider outage entirely.

The plain billing-page button is the other half of this: if the agent misbehaves
during a live demo, the payment flow can still be shown working on its own.

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
    │                            ├── 6. checkGrounding() + checkClaims()
    │                            └── 7. write agent_events        │
    │                                                             │
    ├── NotificationBell ───► GET  /api/notifications             │
    │                            └── templated, never generated   │
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

**Stack:** Next.js 15 (App Router), React 19, Neon Postgres, Drizzle ORM,
Tailwind 4, Razorpay Orders API + Checkout.js, Groq with a Gemini fallback.

The same merchant is reachable over **MCP** as over HTTP, through one shared gate
— two transports, one implementation, because two copies of a rule is one rule
and one liability.

> **[ARCHITECTURE.md](ARCHITECTURE.md)** goes further: the whole system, one
> turn of the agent drawn step by step, the three routes to a purchase, and a
> table of what each bound is enforced by — and, as importantly, what it is
> *not* enforced by.

## Scope, stated honestly

Things this deliberately does not do, and why:

- **No webhooks.** Verification recomputes the HMAC signature synchronously. In
  production `payment.captured` would be the source of truth, because someone
  closing the tab mid-redirect never reaches the verify route. For a gated,
  single-order demo this is the right scope, not an oversight.
- **One-time ₹499, not a subscription.** This uses the Orders API, not
  Subscriptions/Mandates. Advertising a monthly price while charging once would
  be a small dishonesty, so it is sold as what it is.
- **Detection is a rule, not ML.** Same merchant, same amount, two or more
  distinct months. The judged intelligence is in the gating and the trail.
- **Signup is open to anyone.** A deliberate trade for a public demo: a reviewer
  should be able to make their own account rather than share one. Razorpay stays
  in test mode throughout, so there is no path here to real money.
- **The tracker is small, but what Pro sells is real.** The cap, the recurring
  names and the CSV export all actually change when you pay. An upsell for
  features that do not exist would undercut the one thing this project is
  claiming: that the agent's explanations are true.
- **The expense tracker is thin on purpose.** It exists so the agent has
  something real to reason about.

All seeded data is fictional.

## Repo map

| Path | What lives there |
|---|---|
| [`lib/facts.ts`](lib/facts.ts) | Deterministic facts — the only source of numbers |
| [`lib/recurring.ts`](lib/recurring.ts) | The recurring-charge rule |
| [`lib/agent/intent.ts`](lib/agent/intent.ts) | Consent classification, no model involved |
| [`lib/agent/answers.ts`](lib/agent/answers.ts) | Which subject a reply is about, before any model runs |
| [`lib/agent/tools.ts`](lib/agent/tools.ts) | The three tools and their gates |
| [`lib/agent/grounding.ts`](lib/agent/grounding.ts) | Grounding, claims, and the templates |
| [`lib/agent/run.ts`](lib/agent/run.ts) | One turn, start to finish |
| [`lib/notifications/derive.ts`](lib/notifications/derive.ts) | What is worth notifying, and the words for it |
| [`lib/notifications/store.ts`](lib/notifications/store.ts) | Notification persistence, dedup and decay |
| [`lib/razorpay.ts`](lib/razorpay.ts) | The one shared order function; HMAC verification |
| [`lib/agent-commerce.ts`](lib/agent-commerce.ts) | The gate both the HTTP and MCP transports call |
| [`lib/auth/session.ts`](lib/auth/session.ts) | Hashed session tokens, expiry, sign-out |
| [`lib/audit.ts`](lib/audit.ts) | Audit-trail writer |
| [`lib/db/schema.ts`](lib/db/schema.ts) | The schema, fourteen tables |
| [`components/MobileNav.tsx`](components/MobileNav.tsx) | The phone drawer |
| [`app/(app)/agent-activity/`](app/%28app%29/agent-activity/) | The audit trail page |

## Contribution

Issues and pull requests are welcome — including ones that only point out that
something here is wrong.

[`CONTRIBUTING.md`](CONTRIBUTING.md) covers getting it running, the three test
suites, and the rule that matters most here: **a test that cannot fail is worse
than no test**, so a change to behaviour comes with a case that goes red when the
change is reverted.

Please also read [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md), and
[`CHANGELOG.md`](CHANGELOG.md) for what has changed and when.

## Security

Found a security problem? **Please do not open a public issue.**
[`SECURITY.md`](SECURITY.md) has the private route, what is in scope, and what is
already defended — worth reading before you spend an evening on it.

## License

This project is released under the MIT License. You are free to use, modify, and
distribute the code under the terms of this license. See the [LICENSE](LICENSE)
file in the repository for the full text.

Razorpay, and the other product names used here, belong to their respective
owners; this project is not affiliated with or endorsed by any of them.

## Contact Us

If you have any questions, feedback, or suggestions, feel free to reach out to
the author:

* **ANAND SUNDARAMOORTHY SA**: [sanand03072005@gmail.com](mailto:sanand03072005@gmail.com?subject=Question%20about%20TrackMoney&body=Dear%20Anand%2C%0A%0AI%20have%20a%20question%20regarding%20the%20TrackMoney%20project%2E%0A%0A%5BYour%20Question%20Here%5D%0A%0AThank%20you%21%0A%5BYour%20Name%5D)

## Acknowledge

I want to express my gratitude to:

* **Razorpay**, for the AI Buildathon that prompted this, and for a test mode
  thorough enough that a payment flow can be demonstrated end to end without a
  rupee moving.
* **[Neon](https://neon.tech)** and **[Vercel](https://vercel.com)**, whose free
  tiers host the database and the deployment this runs on.
* **[Groq](https://groq.com)** and **Google Gemini**, for the model tiers behind
  the assistant — and for being replaceable, which is the property the design
  actually depends on.
* The open-source projects this is built from: Next.js, React, Drizzle ORM,
  Tailwind CSS and Playwright.
