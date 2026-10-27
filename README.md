# Errand Runs Lagos

[![Netlify Status](https://api.netlify.com/api/v1/badges/08579a53-a17a-40f2-acde-7bbc2a41f79e/deploy-status?branch=main)](https://app.netlify.com/projects/sage-sundae-a2b6d6/deploys)

Errand Runs currently has two web surfaces:

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

Deploy the repository root to Netlify. `netlify.toml` sets the publish directory to `.` and the build command to empty, so the static site remains available at the same paths.

## Next.js application

Requirements: Node.js compatible with the installed Next.js version and npm.

```sh
cd web
npm install
npm run dev
```

Create `.env.local` from `.env.example` and set the Supabase URL and anon key before using features that need Supabase.

Run the app checks from `web/`:

```sh
npm test
npm run lint
npm run build
```

The app's available routes are `/`, `/runner`, `/ops` and `/track/[token]`. Do not commit `.env.local` or other credentials.

## Current product scope

The static WhatsApp site is the live MVP. The Next.js app is a separate, evolving platform interface; its presence does not change the static site's deployment. Product decisions and backend capabilities should be documented alongside the implementation that owns them.
