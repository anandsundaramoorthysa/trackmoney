# Demo run-through

The exact clicks, in order, with what to say alongside them in
[`PITCH.md`](../PITCH.md). Rehearse it twice; the second time, have someone
interrupt you.

## Preflight

```bash
npm run check:providers    # every external service answers
```

Then, in the browser:

1. Open the live URL once — Neon suspends after five minutes idle and the first
   request takes a second or two to wake it.
2. Sign in with **Try the demo account**.
3. Click **Reset demo data**. The account must read **19 of 20**.

## The run

| # | Where | Do | Expect |
|---|---|---|---|
| 1 | `/transactions` | Add any transaction | Saves. "0 of 20 left on Free" |
| 2 | `/transactions` | Add another | **Refused.** "That transaction was not saved." |
| 3 | `/` | Read the agent's opening | "You have used all 20…", ₹499 |
| 4 | `/` | Ask "how much did I spend on food?" | Answers from real category totals |
| 5 | `/` | Type "no thanks" | Stops. Offer withdrawn |
| 6 | `/` | Type "actually yes, go ahead" | **Refused out loud** |
| 7 | — | **Reset demo data** | Back to 19 |
| 8 | `/` | Type "yes please" | Order prepared, button appears |
| 9 | `/` | Click **Open secure checkout** | Razorpay modal |
| 10 | modal | `5267 3181 8797 5449`, any future expiry, any CVV, OTP `1234` | Verified → Pro |
| 11 | `/` | Look at what changed | Full month, recurring **named**, Export CSV |
| 12 | `/agent-activity` | Expand a row | The facts object behind the sentence |
| 13 | `/api/catalog` | Show the raw JSON | Machine-readable, prices in paise |
| 14 | `/billing` | **Issue a mandate**, copy it | Shown once |
| 15 | terminal | `npm run buyer-agent -- --mandate tmm_…` | Buys, then every over-reach refused |

## The failure path, if you have time

Reset, say **"yes please"**, click **Open secure checkout**, and pay with
the same card and then an incorrect OTP.

Expect: *"That payment did not go through… You are still on Free and nothing was
charged."* The order shows as `failed` on Billing with its reason, and the
account is untouched.

## Test cards

| Card | Outcome |
|---|---|
| `5267 3181 8797 5449` | succeeds — a domestic card, with OTP `1234` |
| the same card, wrong OTP | fails, and the app records the reason |

> `4111 1111 1111 1111` is the card most Razorpay examples use, and it does
> **not** work here: the account has international cards disabled, so the
> checkout answers *"International cards are not supported"*. Verified
> against the deployed app on 1 September 2026.

Any future expiry, any CVV.

## If it goes wrong

- **Agent slow or silent** — it falls to Gemini, then to templates. Say that out
  loud; degrading in tiers is the point.
- **Anything worse** — go to `/billing` and pay with the plain button. The
  payment flow works with no agent involved, which is half of why it exists.
- **Network gone** — play the recording.

## Recording the backup video

Record steps 1–15 in one take, no edits, ~4 minutes. Do not narrate over it;
you will be talking live. What matters is that the panel can see the refusal at
step 2, the refusal at step 6, and the buyer agent's refusals at step 15 — those
three are the submission.
