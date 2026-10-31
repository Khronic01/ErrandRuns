# OJAH — Every Market, One Place.

[![Netlify Status](https://api.netlify.com/api/v1/badges/08579a53-a17a-40f2-acde-7bbc2a41f79e/deploy-status?branch=main)](https://app.netlify.com/projects/sage-sundae-a2b6d6/deploys)

OJAH currently has two web surfaces:

- The live WhatsApp ordering site is a static HTML, CSS and JavaScript site at the repository root. It has no build step.
- `web/` is a separate Next.js application for the customer, runner, operations and tracking experiences. It is under active development and has its own dependencies, environment and commands.

## Repository layout

```text
.
├── assets/
│   ├── css/site.css       # Static-site styles
│   ├── js/site.js         # WhatsApp links, order form and page interactions
│   ├── archivo.woff2
│   ├── icon-192.png
│   └── share.png
├── index.html             # Static site entry point
├── netlify.toml           # Publishes the repository root without a build
└── web/
    ├── public/            # Next.js static assets
    └── src/               # App Router pages, components and libraries
```

`.editorconfig` defines shared text-file formatting, and the root `.gitignore` excludes local dependencies, build output and environment files. The two applications retain separate dependency manifests because they have different deployment and runtime requirements.

## Live static site

The site lets customers describe an errand and open a pre-filled WhatsApp message to **0814 069 4034**. Price, payment and dispatch are handled in that chat; the site does not collect payments or store orders.

To change the WhatsApp number, edit `WHATSAPP` in `assets/js/site.js` using international format without a leading `+`. All WhatsApp links are generated from that value.

The root static site remains in the repository as the original MVP. Netlify now builds the Next.js application from `web/`; its adapter serves the application pages and `/api` route handlers. Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the Netlify site environment and set the deployed URL in the Supabase Auth URL allowlist.

## Next.js application

Requirements: Node.js compatible with the installed Next.js version and npm.

```sh
cd web
npm install
npm run dev
```

Create `.env.local` from `.env.example` and set the Supabase URL and anon key before using features that need Supabase. Keep `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false` until Google OAuth is enabled and configured in Supabase Auth.

Run the app checks from `web/`:

```sh
npm test
npm run lint
npm run build
```

The app's available routes include `/`, `/sign-in`, `/onboarding/roles`, `/dashboard`, `/orders`, `/runner`, `/ops` and `/track/[token]`. Do not commit `.env.local` or other credentials.

Role onboarding uses the existing `profiles` table and supports email/password, with Google sign-in available after provider setup. Email confirmation and email/password authentication must be enabled in Supabase Auth. To enable Google sign-in, configure the Google OAuth client credentials in Supabase Auth, allowlist the app's `/auth/callback` URL in Supabase Auth redirect URLs, and set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` in the web app environment. The prepared role and email-auth migrations require the existing `public.profiles` schema; the email-auth migration makes `profiles.phone` optional while retaining existing phone values. Phone-only accounts must first have an email identity linked and verified in Supabase before they can use email sign-in. Runner verification remains governed by `runners.status`, and business-owner selection does not approve or publish a store.

### Web API

The Next.js app exposes JSON endpoints under `/api` for authentication profile sync, role selection, public quote and waitlist requests, customer job creation/listing, tracking, runner operations, and the ops board. The handlers use the authenticated Supabase session; authorization and state transitions remain enforced by the database. `/auth/callback` exchanges verified email/Google OAuth codes for the server-side session and provisions the existing profile.

Endpoints: `POST /account/profile`, `GET /account/roles`, `POST /account/roles`; `GET /jobs`, `POST /jobs`, `POST /jobs/quote`, `POST /waitlist`, `GET /tracking/{token}`; `GET /runner/{profile,offers,jobs}`, `POST /runner/online`, `POST /runner/offers/{offerId}`, `POST /runner/jobs/{jobId}/{transition,complete,locations,proof}`; `GET /ops/{alerts,jobs,runners}`, `GET /ops/jobs/{jobId}/suggestions`, `POST /ops/jobs/{jobId}/dispatch`, and `POST /ops/runners/{runnerId}/status`.

Quote, waitlist, and token-based tracking are public. Customer, runner, and ops endpoints require a valid Supabase session, and runner/ops permissions are checked again by the database. Email sign-in creates the customer profile required by `create_job`; the migration that makes profile phone optional must be applied before email-only accounts can complete profile creation. The runner and ops pages now read and act through the API. Job quotes require coordinates for each stop. The existing WhatsApp order flow remains available, and payment endpoints are not implemented.

## Current product scope

The root static WhatsApp site remains the original MVP source. The Netlify deployment now targets the Next.js app, which contains the customer interface, OTP sign-in, and Supabase-backed APIs. Product decisions and backend capabilities should be documented alongside the implementation that owns them.

updates
