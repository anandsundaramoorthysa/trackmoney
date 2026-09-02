# Deploying to Vercel

Fifteen minutes. Everything here needs an account only you can sign into, which
is why it is written down rather than done.

## 1. Import the repository

1. **https://vercel.com/new** → import `anandsundaramoorthysa/trackmoney`.
2. Framework preset: **Next.js** (detected).
3. Do **not** deploy yet — add the environment variables first, or the first
   build will succeed and the first request will show the setup notice.

## 2. Environment variables

Add these under **Settings → Environment Variables**, for **Production** and
**Preview** both.

| Name | Value | Notes |
|---|---|---|
| `DATABASE_URL` | your Neon **pooled** connection string | must include `?sslmode=require` |
| `RAZORPAY_KEY_ID` | `rzp_test_…` | the app refuses to start on a live key |
| `RAZORPAY_KEY_SECRET` | the secret from the same pair | |
| `GROQ_API_KEY` | `gsk_…` | optional, but the demo is better with it |
| `GEMINI_API_KEY` | `AIza…` | the fallback tier |

Leave `GROQ_MODEL` and `GEMINI_MODEL` unset unless `npm run check:providers`
tells you the defaults have gone stale again.

**Use the pooled Neon string** (`…-pooler.…neon.tech`). Serverless functions
open many short connections; the pooled endpoint is what that is for.

## 3. Deploy, then prepare the database

```bash
npm run db:migrate    # from your machine, against the same DATABASE_URL
npm run db:seed
```

Migrations are committed, so this applies exactly what the repository says.
Seeding creates the demo account the login page's one-click button needs.

## 4. Check it

```bash
npm run check:providers
```

Then in the browser:

- `/login` → **Try the demo account** → dashboard shows **19 of 20**
- `/api/catalog` returns JSON
- Add two transactions; the second is refused
- Pay with `5267 3181 8797 5449` and OTP `1234`

## 5. Before the pitch

- Open the URL once a minute beforehand. Neon suspends after five minutes idle
  and the first request afterwards is slow.
- **Reset demo data** so the account is at 19 of 20.
- Run `npm run check:providers` on the day. Hosted model catalogues change
  without notice, and that failure is silent.

## Setting the environment variables

Add all of them **before** the first deploy, or the build fails while collecting
page data.

| Variable | |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `RAZORPAY_KEY_ID` | Must start with `rzp_test_` |
| `RAZORPAY_KEY_SECRET` | |
| `GROQ_API_KEY` | Optional; the agent falls back without it |
| `GEMINI_API_KEY` | Optional; the second fallback |
| `MERCHANT_SIGNING_KEY` | Optional; signs cart mandates when present |

If you script this rather than pasting into the dashboard, read the values with
the helper rather than through `dotenv`:

```bash
npm run env:value DATABASE_URL > value.txt
npx vercel env add DATABASE_URL production < value.txt
```

**Why it matters.** `dotenv` prints its banner to *stdout*, not stderr, so
piping a value through it prepends about ninety characters of banner to the
value. That happened here: a Razorpay key id that should be twenty-three
characters arrived as a hundred and eighteen, and every one of the five was
wrong. Nothing failed loudly — the deployment simply could not reach anything.
The helper parses `.env.local` directly and writes only the value, and it
handles multi-line quoted values such as a PEM key.

To check what actually landed, the deployed app is the test: `/api/catalog`
proves the database, the assistant answering proves a model provider, and
`/api/agent-commerce/key` reports whether signing is on. Vercel marks these
Sensitive and will not read them back, so there is nothing to compare against
directly.

## If the demo looks empty

The seed lays its data out relative to the day it runs — this month, last
month, the one before — so an account seeded in one month has nothing in the
current one once the calendar turns over. Signing in through **Try the demo
account** now notices an empty month and refills it, so this should heal
itself. If you ever want to force it, `npm run db:seed` against the deployed
database does the same thing.

## Notes

- `ALLOW_DEMO_LOGIN=false` disables the one-click demo account. Leave it unset
  for the submission — a reviewer must not have to register.
- The deployment is public and anyone can sign up. That trade is deliberate: a
  reviewer must be able to see the real thing without being handed credentials.
  The banner on every page says not to enter real financial data.
- Razorpay needs no domain approval for test mode. The "Website/app details"
  section of their dashboard is a live-mode requirement.
