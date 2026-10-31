# Errand Runs Lagos

Tell us what needs doing, pay one upfront price, and a verified runner gets it done while you watch progress live.
MVP 1: **Run** (errands) and **Send** (local delivery) in a Mainland pilot cluster.
Product spec: *Errand Runs Lagos — PRD v1*.

## What's here

```
supabase/
  migrations/   Postgres + PostGIS schema, the order engine, access rules
  seed.sql      Dev data: placeholder zones and fares (not launch values)
  tests/        Scenario tests for the engine (run against a real Postgres)
web/            Next.js installable web app: customer (/), runner (/runner), ops (/ops), tracking (/track/[token])
```

The database is the backbone. Apps never write a job's status. They call order-engine functions, which check the allowed move, who is making it, and the rules (proof, OTP, reasons). A trigger rejects any status write that bypasses the engine, even from the service role.

### Order lifecycle

`quoted → paid → assigned → picked_up → on_the_way → completed`

There are also two holding states. `needs_ops` covers cases like no runner after 5 minutes, a stall, or a declined change. `customer_approval` covers a substitution, an extra stop, extra waiting or a budget top-up. A job leaves a holding state back to where it was. `cancelled` and `failed` can happen from any open state and always need a reason code.

### Engine functions (what the apps call)

| Area | Functions | PRD |
|---|---|---|
| Quote & order | `quote_job`, `create_job`, `join_waitlist` | C2–C4, O4 |
| Payment | `attach_payment_ref`, `confirm_payment` (service role, idempotent) | C5 |
| Dispatch | `suggest_runners`, `offer_job` (45 s timer), `respond_to_offer`, `ops_assign` | R2, R3, O3 |
| On the job | `transition_job`, `raise_change`, `decide_change`, `add_proof`, `complete_job`, `record_locations` | R4–R7, C7 |
| Tracking & safety | `get_tracking` (no login), `raise_emergency` | C6 |
| Money | `cancel_job` (fee rules), `issue_refund`, `record_float` | Trust & policies |
| Ops admin | `ops_alerts`, `ops_set_runner_status`, `draft_price_table_from`, `activate_price_table`, `ops_adjust_price` | O1, O5–O7 |

### Pricing

`Price = zone fare(A→B) + task fee + extra stops × stop fee + size fee + peak surcharge`

Every quote is checked against a 20% contribution floor and raised in ₦50 steps until it clears. Price tables are versioned. A published table is locked, changes go into a new draft that ops publishes, and every job stores the version it was priced with. Customers never see the cost side. Money is stored in kobo.

## Run it

**Database tests** (needs Postgres 16 + PostGIS):

```bash
PGHOST=/tmp PGPORT=54329 supabase/tests/run_local.sh
```

This rebuilds a throwaway database and runs the scenarios, which include the PRD worked example (₦4,000 price, ₦1,040 / 26% contribution).

**Supabase project:** apply `supabase/migrations` in order (`supabase db push`), then optionally `seed.sql` for a dev project. Never apply `tests/local_supabase_shim.sql` to Supabase.

**Netlify:** the main repository's `netlify.toml` builds `web/` as a Next.js app. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the Netlify environment, enable phone sign-in and an SMS provider in Supabase Auth, and add the production Netlify URL to Supabase's allowed redirect URLs.

**Web app:**

```bash
cd web
cp .env.example .env.local   # add your Supabase URL + anon key
npm install
npm run dev                  # http://localhost:3000
npm test && npm run lint && npm run build
```

The app also exposes JSON endpoints under `/api`: `GET /jobs`, `POST /jobs`, `POST /jobs/quote`, `POST /waitlist`, `GET /tracking/{token}`; runner profile, offers, jobs, availability, offer response, job transition, location, and proof endpoints; and ops alerts, job board, runner list, runner suggestions, dispatch, and runner-status endpoints. Handlers call the database order engine, which remains responsible for authorization and job-state rules. Quote, waitlist, and token-based tracking are public; customer, runner, and ops endpoints require a Supabase session. Phone OTP sign-in creates the customer profile required for job creation. SMS delivery must be configured in Supabase Auth, and payment endpoints are not implemented.

## Status and next steps

Done: schema, order engine, access rules, pricing, tests, app shell, recipient tracking page, phone OTP sign-in, and customer/runner/ops API foundations.

Next, in roughly this order:

1. Connect the full customer order form to quotes and job creation, then add Paystack checkout
2. Paystack edge functions: initialise payment, then a signature-checked webhook that calls `confirm_payment`, plus top-up collection and refund execution
3. Runner app: onboarding uploads, location every 15 s with an offline buffer, proof capture, and job completion
4. Ops console: live map, WhatsApp intake, runner queue, zone and price editors
5. WhatsApp/SMS notifications

## Open decisions (from the PRD, plus build notes)

- **Fare table:** seed fares are placeholders. At ₦1,500, a same-zone envelope can't clear the 20% floor, and the engine raises it to ₦2,200.
- **Zone boundaries:** seed zones are rough boxes. Redraw them before launch.
- **Payment fee base:** Paystack charges on the whole amount, including a Buy & bring item budget, so the engine counts the fee on price + budget. The PRD worked example counts it on the service price only. These match when there's no budget.
- **Handover OTP:** required for Buy & bring, Collect, Multi-stop and Send. Drop & submit and Queue & wait have no recipient handover, so they need proof only.
- **Declined changes** go to Needs ops for a human decision rather than straight to Cancelled.
- **Stack:** the PRD says Vercel hosting. Netlify also works for Next.js if you'd rather stay on it.
