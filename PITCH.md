# TrackMoney — the five-minute pitch

**Razorpay AI Buildathon · Track 1: AI Growth & Agentic Commerce**

Read this before the run-through in `docs/DEMO.md`. Timings are a guide, not a
script to recite — the panel will interrupt, and the interruptions are the
interesting part.

---

## Before you start

- `npm run check:providers` — five seconds, and it catches the failure mode that
  is invisible until you are on stage.
- Load the live URL once so Neon is awake. It suspends after five minutes idle.
- **Reset demo data** so the account sits at 19 of 20.
- Have `/agent-activity` open in a second tab.

---

## 0:00 — The opening (20 seconds)

> "Most agentic commerce demos show you an agent that can sell you something.
> I want to show you the opposite: everything mine is **not allowed** to do, and
> the fact that you can read every one of those refusals afterwards.
>
> TrackMoney is a small expense tracker. It sells its own Pro upgrade. The
> tracker is real — you can sign in, log spending, hit a limit. That matters,
> because the agent needs something true to reason about."

Do not apologise for the tracker being small. Say it is deliberately small and
move on.

---

## 0:20 — Cause the trigger yourself (50 seconds)

Sign in with **Try the demo account**. Go to **Transactions**.

> "Nineteen transactions this month. Free allows twenty."

Add one. It saves. **"Zero left."**

Add another.

> "Refused. Not hidden — refused. The row was never written."

> "That is worth a sentence. A cap that only decides how many rows to *display*
> is a label, not a limit, and it means the product does not keep its own rule.
> This one is enforced where transactions are written, so there is exactly one
> place it can be enforced from."

**This is your strongest opening because the panel watched you cause it.**

---

## 1:10 — The agent notices (50 seconds)

Go to the **Dashboard**.

> "It has opened with my numbers. Twenty of twenty, three recurring charges,
> ₹499. Not marketing copy — those figures came out of the database before any
> model ran."

Ask it something real: **"how much did I spend on food?"**

> "It answers from the same data. It is not only a salesperson."

Then the line that matters:

> "The sentence is the model's. **The numbers never are.** Facts are computed in
> SQL, the model is handed that object and nothing else, and afterwards every
> number it wrote is checked back against those facts. If one does not match,
> the whole generation is thrown away and a deterministic template goes out
> instead."

---

## 2:00 — Say no, and watch it stop (40 seconds)

Type **"no thanks."**

> "Conversation closed."

Now type **"actually yes, go ahead."**

> "Refused — out loud, and written down. It will not sell to me again in this
> conversation, and the Billing page is still there if I change my mind."

> "Also worth showing: 'what happens if I don't upgrade?' is a **question**, not
> a refusal, even though it contains 'don't'. Declining is the one irreversible
> thing a user can do here, so it is never inferred."

---

## 2:40 — Buy it, and notice what the agent cannot do (50 seconds)

Reset. Say **"yes please."**

> "It has prepared a ₹499 test-mode order and handed me a button. It cannot
> press it. Checkout.js runs in my browser; the agent runs on the server. That
> is structural, not a policy."

Pay with `4111 1111 1111 1111`.

> "Verified server-side by recomputing the HMAC signature. The browser saying it
> worked proves nothing."

Show what changed: full month listed, recurring charges **named**, **Export CSV**
appears.

> "That is what the ₹499 bought. Every line the agent quoted when it sold this
> corresponds to something the account gained."

---

## 3:30 — The audit trail (40 seconds)

Open **`/agent-activity`**.

> "Every action in order — what it noticed, what it said, how my reply was
> classified, the order, the outcome. Expand any row and you get the exact facts
> object it was given when it spoke. You can diff the sentence against the data."

Point at a refusal.

> "Refusals are logged as loudly as successes. A bound nobody can watch being
> enforced is indistinguishable from a bound that is not there."

Point at the initiator column.

> "And the plain Upgrade button on Billing calls **the same function** the agent
> calls — the only place in the codebase that creates a Razorpay order. The
> agent has no payment path of its own, so it has no privilege you do not."

---

## 4:10 — The half nobody builds (40 seconds)

> "Track 1 also asks for a merchant that is transactable by an AI **buyer**. So:"

Show `/api/catalog` — one tab, raw JSON.

> "Machine-readable. Products, prices in paise, the purchase protocol, and every
> gate named."

Show the mandate on **Billing**, then run the buyer agent:

```
npm run buyer-agent -- --mandate tmm_...
```

> "That is a separate party. It reads the catalogue, presents a mandate I signed
> — one product, capped, expiring, single-use — and buys.
>
> Then it tries to exceed what it was granted: replay the mandate, buy a
> different product, buy with none. Every attempt refused."

> "The boundary is the point. A mandate authorises an **order**, never a
> payment. The buyer can commit me to a purchase; it cannot move my money."

---

## 4:50 — Close (20 seconds)

> "Six bounds, all enforced in handlers rather than in the prompt — because a
> prompt asking a model to behave is a request, not a boundary. Swap in a worse
> model tomorrow and not one of them moves.
>
> 148 assertions across three suites, including a scriptable fake model that
> fabricates numbers and invents tool names on demand, so the layers meant to
> contain a bad model can be shown containing one."

---

# Questions they will ask

**"What did you actually build? This tracker is thin."**
> Deliberately. The tracker exists so the money layer has something true to
> reason about. The money layer is the deliverable, and it is production-shaped:
> one shared order function, HMAC verification, a state machine where success is
> terminal, and constraints in the database rather than checks in the code.

**"How do I know the agent can't just be talked into charging me?"**
> It has no capability to charge. It can request one of two tools; the handler
> decides. Consent is classified by code before any model runs, and must postdate
> the pitch. Try to jailbreak it live — the bounds are not in the prompt.

**"Isn't the grounding check just a regex?"**
> Yes, and I will tell you its two limits before you find them: it confirms a
> figure came from the data, not that it was used for the right thing, and it
> only inspects digits, not numbers spelled out in words. Both are asserted by
> tests. It is narrow and real rather than broad and claimed.

**"Why one agent? Everyone else has a crew."**
> Every extra agent is another thing that can touch money and another thing I
> have to prove is bounded. The bar rewards provable restraint. The one place a
> second agent is honest is the buyer — a different party, not this one split in
> two to claim the word.

**"What would you do next?"**
> Webhooks as the source of truth for settlement, because someone closing the
> tab mid-redirect never reaches the verify route. Then subscriptions, which is
> Track 3's territory and why I did not mix it in.

**"What broke while you were building it?"**
> Both hosted model defaults went stale — Groq retired the Llama model and
> Gemini 404s on 2.0-flash. Both failed exactly the way an outage does: quietly,
> straight to the template tier. The fallback looked healthy while no model had
> run at all. That is why there is a preflight command now.

---

# If something fails live

- **The model is slow or down** — nothing to do. It falls to Gemini, then to
  templates, and the flow completes either way. Say so out loud; it is a feature.
- **Neon is cold** — first request takes a second or two. Keep talking.
- **Anything at all goes wrong with the agent** — go to Billing and pay with the
  plain button. The payment flow works without the agent, which is half the
  reason it exists.
- **The venue network dies** — play the recording.
