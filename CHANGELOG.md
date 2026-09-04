# Changelog

Notable changes to TrackMoney. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Dates are the day the work landed on `main`.

## [Unreleased]

### Added

- `npm run eval:agent`, which measures the gates rather than only asserting
  them: a fixed corpus of generations and adversarial inputs through the same
  functions that judge a real reply, reporting how much was shipped, what each
  gate stopped, and how many attacks were refused. Runs in CI. Two limits are
  measured and printed rather than hidden.
- A summary on the activity page counting what the gates did for a real
  account: turns a model answered, the share of its wording discarded as
  ungrounded, which rules refused a tool call, the exact figures thrown away,
  and what the turns cost in tokens. Derived from the rows already on the page,
  so it cannot disagree with them.
- Token usage from both providers, recorded per turn in the audit trail. Both
  reported it and neither was being read.

### Fixed

- A conditional yes was read as consent. "yes if it is free" matched the
  affirmative list and stopped there, so somebody setting a condition was
  recorded as accepting the offer on the table. Found by the new eval.
- Code fences survived text neutralisation, so a merchant named with a fence
  kept it all the way into the prompt. Also found by the eval.

- The phone layout, measured rather than assumed. Navigation moved into a drawer
  after the old strip was found to show two of seven destinations at 375px, and
  the account and sign-out moved with it: below 768px there had been no way to
  sign out at all. The assistant's message box is no longer pushed off-screen by
  a phone keyboard, and no page scrolls sideways at 320px.
- Three notifications that said the same sentence. One row was emitted per
  repeating charge, but the body was written for the whole set and on Free it
  cannot name a merchant, so the same words appeared three times.
- The build works from the repository rather than only from a machine with the
  test harness on disk.
- `.env.example` explained how to escape a PEM key using a real newline, which
  broke the sentence it was explaining.

### Changed

- The documentation an open-source repository is expected to carry: contributing
  guide, security policy, code of conduct, issue and pull request templates, and
  this file. `ARCHITECTURE.md` moved to the root and is published.

## [1.0.0] — 2026-09-03

First public release, built for the Razorpay AI Buildathon (Track 1: AI Growth
and Agentic Commerce).

### The product

An expense tracker that sells its own Pro upgrade, where the interesting part is
what the agent is not permitted to do. Free plan with a monthly transaction cap,
a Razorpay test-mode upgrade, CSV import and export, category rules, recurring
charge detection, and an audit trail of every action the agent took or was
stopped from taking.

### Agentic commerce

- An assistant, **Tracky AI**, that answers from a fixed set of facts and cannot
  invent a figure — every number it states is checked against what it was given,
  and a claim in the wrong place is caught even when the number is real
- Consent classified deterministically before any model call, so the model is
  never what decides that somebody agreed
- Three tools, and a name outside the set is refused and written to the trail
  rather than ignored
- The agent prepares orders; a person authorises them in Razorpay's own window
- x402-style 402 responses carrying the terms that would satisfy them, with
  single-use nonces bound to a product
- AP2-style purchase mandates, a merchant-signed cart, and recorded modality
- The same merchant reachable over MCP as over HTTP, through one shared gate

### Notifications

- What the assistant notices on its own goes to a bell rather than to the top of
  a conversation nobody asked for
- Notification text is templated, never model-written, and passes the same
  grounding and claims checks as a chat reply before it is served
- A decline in the chat withdraws a pending offer from the bell; cap warnings
  survive, because they are facts about the account rather than a sale

### Security and correctness

- Session tokens stored only as hashes; sign-out deletes the row, not just the
  cookie
- The Secure cookie flag derived from the host rather than a forwardable header
- Payment signatures verified server-side before a plan changes; an account that
  has paid cannot be charged again
- The Free cap holds when two requests arrive together
- Errors no longer describe the database to whoever caused them
- The build is scanned for secret values, and the scan fails rather than passing
  vacuously if it cannot prove it read the right files
- The app refuses to start against a live Razorpay key

### Interface

- Navigation on phones is a drawer rather than a horizontal strip that showed
  two of seven destinations, and the account and sign-out live in it — below
  768px there had been no way to sign out at all
- The assistant's message box is sized against the room actually left, so it is
  not pushed off-screen by a phone keyboard
- Every page checked from 320px upward for sideways scrolling, tap target size
  and contrast

### Tests

Three suites: pure functions with no database, integration against real Postgres
with a stand-in model and payment gateway, and Playwright against a production
build. The standard throughout is that a test which cannot fail is worse than no
test.

[Unreleased]: https://github.com/anandsundaramoorthysa/trackmoney/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/anandsundaramoorthysa/trackmoney/releases/tag/v1.0.0
