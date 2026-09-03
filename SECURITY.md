# Security Policy

## Reporting a vulnerability

**Please do not open a public issue.** A public report tells everyone about the
problem at the same moment it tells me, and the fix takes longer than the read.

Two private routes, either is fine:

1. **GitHub private vulnerability reporting** — the *Report a vulnerability*
   button under this repository's **Security** tab. This is preferred: it keeps
   the discussion attached to the code.
2. **Email** — <sanand03072005@gmail.com>, with `SECURITY` in the subject line.

Please include what you found, the steps to reproduce it, and what an attacker
gets out of it. A proof of concept helps; a description of the shape of the
problem is enough to start.

## What to expect

| | |
|---|---|
| First reply | within 3 days |
| Assessment of severity and scope | within 7 days |
| Fix or a stated plan | depends on severity, and I will tell you which |

If you do not hear back in a week, assume the mail went astray and chase it —
that is not you being a nuisance.

I will credit you in the release notes when the fix ships, unless you would
rather I did not. Please give me a reasonable window to fix it before publishing.

## Scope

This is a demonstration project. It runs against **Razorpay test mode only** and
the application refuses to start with a live key, so there is no path here to
moving real money. That narrows what a vulnerability can cost, but it does not
make the code uninteresting: the deployment is public, anyone can sign up, and
real accounts hold real session cookies and whatever data people type in.

**In scope, and genuinely worth reporting:**

- Anything that reads or writes another account's data
- Session handling — fixation, tokens surviving a sign-out, cookie flags
- Authentication: enumeration through timing or differing responses, lockout bypass
- Payment integrity: reaching Pro without a verified signature, replaying an
  order or a mandate, spending a nonce twice
- Anything that makes the agent act without a recorded yes, or act outside its
  three tools
- Secrets reaching the browser bundle
- SQL injection, XSS, CSRF, SSRF

**Out of scope:**

- That Razorpay is in test mode, or that test card numbers work
- That signup is open to anybody — that is a deliberate trade for a public demo
- Missing hardening headers with no demonstrated impact
- Automated scanner output with no working proof of concept
- Denial of service by volume against the free-tier hosting
- Social engineering

## What is already defended, and how

Worth knowing before you report, so you can aim at something real. Each of these
is enforced in code rather than by prompt or convention:

- Session tokens are random 256-bit values stored only as SHA-256 hashes; signing
  out deletes the row, not just the cookie
- The Secure cookie flag is derived from the host rather than a forwardable
  header, so a spoofed header can only fail in the safe direction
- Passwords are scrypt-hashed; an unknown address burns the same time as a known
  one, so timing does not reveal which addresses exist
- Payment signatures are verified server-side with HMAC before any plan changes
- Consent is classified deterministically, before the model is called — the model
  is never what decides that somebody agreed
- Every figure the assistant states is checked against the facts it was given,
  and every notification body passes the same two checks before it is served
- The build is scanned for secret values, and the scan fails if it cannot prove
  it was reading the right files

If you find a way around any of those, that is exactly the report I want.
