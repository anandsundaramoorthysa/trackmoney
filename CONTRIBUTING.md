# Contributing to TrackMoney

Thanks for looking. Issues and pull requests are welcome — including ones that
only point out that something here is wrong.

## Getting it running

You need Node 22 — the version CI builds against — and a Postgres database.
[Neon](https://neon.tech)'s free tier is what this was built on.

```bash
git clone https://github.com/anandsundaramoorthysa/trackmoney.git
cd trackmoney
npm install
cp .env.example .env.local   # then fill it in — see below
npm run db:migrate
npm run db:seed              # creates the demo account
npm run dev
```

`.env.example` lists every variable and what it is for. The two that are not
optional are `DATABASE_URL` and a Razorpay **test** key pair. The app refuses to
start against a live key, on purpose: nothing in this project should ever be one
configuration mistake away from moving real money.

The language model is optional. With no `GROQ_API_KEY` or `GEMINI_API_KEY` the
assistant falls back to deterministic templates and everything still works —
that is the tier the whole browser suite runs in, so it is a supported state
rather than a degraded one.

## The three suites

```bash
npm run test:facts        # pure functions, no database, no network
npm run test:integration  # real Postgres, stand-in model and payment gateway
npm run test:e2e          # Playwright, against a production build
```

`npm test` runs all three. CI runs the first plus typecheck, lint, build and a
scan of the built bundle for leaked secrets.

`npm run typecheck` covers the application. The test harness lives outside the
repository — see the note in `tsconfig.json` — so `npm run typecheck:tests`
checks that separately when you have it.

## What a change has to pass

Beyond the suites, two things:

**A change in behaviour comes with a test that can fail.** The standard here is
that a test which passes whatever the code does is worse than no test, because it
looks like coverage. The practical form: revert your fix and watch your test go
red. If it stays green, it is not testing what you think.

**Comments say why, not what.** The code in this repository explains its own
reasoning at some length, and that is deliberate — most of it concerns money
moving, and a future reader needs to know what was considered and rejected, not
a restatement of the line below. If you remove a guard, the comment explaining
why it existed should be answered rather than deleted.

## Things that are deliberate and look like bugs

Before filing these, know that they are on purpose:

- **The agent cannot complete a payment.** It prepares an order; a person
  authorises it in Razorpay's own window. This is the point of the project.
- **`/api/checkout/failed` throws on a non-string reason.** A test uses that
  exact throw to prove the error handler does not leak SQL to the caller.
- **The assistant says nothing when you open it.** What it notices on its own
  goes to the notification bell, not to the top of a conversation nobody asked
  for.
- **Free accounts are told how many charges repeat, not which.** Naming them is
  what the paid plan is for, so the pitch must not give it away.

## Pull requests

Keep them focused — one subject per pull request. Say what was wrong, what you
changed, and how you know it works. If you are unsure whether something is worth
doing, open an issue first and ask; that is cheaper for both of us than a
rejected branch.

Commits here are written as prose explaining the reasoning, not as a summary of
the diff. Matching that is appreciated but not required.

## Security

Please do not open a public issue for a vulnerability. [`SECURITY.md`](SECURITY.md)
has the private route.

## Licence

By contributing you agree that your contributions are licensed under the
[MIT Licence](LICENSE), the same terms as the rest of the project.
