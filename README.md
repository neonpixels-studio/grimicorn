# grimicorn-landing

Landing page for [grimicorn.dev](https://grimicorn.dev), built with [VitePress](https://vitepress.dev). A single marketing page with a custom theme, self-hosted fonts, a build-time Content-Security-Policy, and a set of guarded invariants that keep the caching and CSP contracts honest. This README documents the npm scripts and, more importantly, the non-obvious build machinery a contributor would otherwise have to reverse-engineer.

## Requirements

- Node `24.16.0` (pinned in `.nvmrc`; Netlify builds on `NODE_VERSION = 24`). The build relies on `Dirent.parentPath` (Node 20.12+), so older Node will break `write-headers.ts` / `scan-origins.ts`.
- npm (the repo ships a `package-lock.json`; CI runs `npm ci`).

## npm scripts

| Script                | Command                                          | What it does                                                                                                                                                                  |
| --------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`         | `vitepress dev`                                  | Local dev server with HMR. Note: build-time hooks do **not** run here (see below).                                                                                            |
| `npm run build`       | `vitepress build`                                | Production build into `.vitepress/dist`. Runs the `buildEnd` hooks that write `_headers` and scan the output for disallowed origins.                                          |
| `npm run preview`     | `vitepress preview`                              | Serves the built `.vitepress/dist` locally. Use this (not `dev`) to verify the CSP, the hero preload, and other build-only output.                                            |
| `npm run test`        | `vitest`                                         | Unit/snapshot tests in watch mode.                                                                                                                                            |
| `npm run test:ci`     | `vitest run`                                     | Single-shot test run used by CI and the Netlify build.                                                                                                                        |
| `npm run test:e2e`    | `vitepress build && playwright test`             | Builds the site, then runs the Playwright real-browser smoke test against the built production output.                                                                        |
| `npm run typecheck`   | `vue-tsc --noEmit`                               | Type-checks the theme (Vue SFCs) and the `.vitepress` TypeScript.                                                                                                             |
| `npm run lint`        | `prettier --check . && eslint .`                 | Formatting + lint check (no writes).                                                                                                                                          |
| `npm run lint:fix`    | `prettier --write . && eslint . --fix`           | Auto-fix formatting and lint issues.                                                                                                                                          |
| `npm run generate:og` | `node scripts/generate-og-banner.mjs`            | Regenerates the Open Graph banner (`public/assets/grimicorn-og.png`) from `og-banner-spec.mjs`. Run and commit the result when the banner changes.                            |
| `npm run lock:assets` | `node scripts/regenerate-asset-version-lock.mjs` | Rewrites `.vitepress/asset-version-lock.json` from the current asset bytes and the live `ASSET_CACHE_BUST` token. Run after bumping the token when a versioned asset changes. |
| `npm run audit`       | `npm audit --omit=dev --audit-level=high`        | Fails on high/critical advisories in **production** deps only (dev-only advisories in vitepress/vite/esbuild never ship to the static site).                                  |

### Dev vs. build

`transformHead` and `buildEnd` are build-time hooks, so the hero image preload, the generated CSP, and the origin scan only exist under `vitepress build` / `vitepress preview`, never under `vitepress dev`. Verify anything in that list against a production build (`npm run build && npm run preview`), not the dev server.

## Deployment (Netlify)

`netlify.toml` sets the build command to `npm run test:ci && npm run build` and publishes `.vitepress/dist`. It also sets the static security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS, and immutable one-year caching for `/fonts/*`, `/assets/*`, `/images/*`). The Content-Security-Policy is deliberately **absent** from `netlify.toml` (see below).

## CI

- **`ci.yml`** runs `lint`, `typecheck`, `test:ci`, and `build` on pushes/PRs to `main`.
- **`security.yml`** runs a gitleaks secret scan and an `npm audit` gate (production deps, high/critical).

Run `npm run lint && npm run typecheck && npm run test:ci && npm run build` locally before pushing to match CI.

## Non-obvious invariants

These are the contracts a naive change can silently break. Each is enforced by code and/or tests; read this before touching fonts, headers, cached assets, or `netlify.toml`.

### 1. The CSP is generated per build into `_headers`, not `netlify.toml`

VitePress emits inline bootstrap scripts (dark-mode / macOS detection, `__VP_SITE_DATA__`) whose contents change per build. To let `script-src` drop `'unsafe-inline'`, the CSP must carry a `'sha256-...'` hash of each of those scripts, which a static config cannot express.

So the CSP is built at build time: `buildEnd` in `.vitepress/config.ts` calls `writeCspHeaders` (`.vitepress/write-headers.ts`), which reads every rendered `.html` file, hashes each executable inline script (`.vitepress/headers.ts`), and writes the policy into the generated `.vitepress/dist/_headers` file. `headers.ts` is filesystem-free and unit-tested against fixture HTML.

Two guardrails fail the build loud rather than shipping a broken policy:

- Zero collected script hashes (VitePress changed its output) throws instead of shipping a CSP that would block the bootstrap scripts.
- An existing `_headers` in the output (e.g. a `public/_headers`) throws rather than being overwritten.

**Do not add a `Content-Security-Policy` to `netlify.toml`.** For a shared header name, `netlify.toml` takes precedence over `_headers`, so a static CSP there would silently override the hashed policy and break the site. This is why `netlify.toml` carries only an explanatory comment marking the deliberate omission instead of a `Content-Security-Policy` directive.

### 2. First-party-only origins are scanned in the built output

The site is first-party-only: the CSP (`headers.ts`) allows no third-party origins. `.vitepress/origins.ts` holds the `DISALLOWED_ORIGINS` list (the Google Fonts origins the site used before self-hosting) as the single source of truth.

Two scans guard it against drift:

- **Source-level** (`.vitepress/tests/fonts.test.ts`): proves the theme source and `index.md` reference no disallowed origin.
- **Build-output** (`.vitepress/scan-origins.ts`, wired into `buildEnd`): walks the rendered `.html`/`.css`/`.js` and fails the build if a dependency or plugin reintroduced a disallowed origin the source scan can't see.

If you ever need a legitimate third-party origin, add it to the relevant CSP directive in `headers.ts`, remove it from `DISALLOWED_ORIGINS` in `origins.ts` if it is listed there (the list is a deny list), and update the tests together.

### 3. The `?v=` cache-bust invariant

`netlify.toml` serves `/fonts/*`, `/assets/*`, and `/images/*` with a one-year `immutable` cache. Files under `public/` are **not** content-hashed by Vite, so a `?v=` query string is the only way to force a refetch when the bytes behind a stable URL change. There are two independent tokens; bump the relevant one whenever the underlying file changes.

- **Font token** (`?v=20260813`): shared by the `url()`s in `.vitepress/theme/fonts.css` and the font `preload` hrefs in `.vitepress/config.ts`. They must stay in lockstep, or the preload misses the cache and the font double-fetches. `fonts.test.ts` enforces that every preload href matches a declared `@font-face` url.
- **Asset token** (`ASSET_CACHE_BUST` in `.vitepress/asset-cache-bust.ts`): the single source of truth for the hero/portrait/OG/manifest assets. Imported by `config.ts` (OG image, hero preload, web manifest) and `GrimicornPage.vue` (hero + portrait `<picture>` sources) so an avif client never fetches a different URL than the preload warmed. The favicons in `config.ts` carry their own inline `?v=` and are bumped by hand when they change.

### 4. Fonts are self-hosted

Space Grotesk and JetBrains Mono are served first-party from `public/fonts` via `@font-face` in `.vitepress/theme/fonts.css`, not from Google Fonts. This keeps the LCP path free of cross-origin round trips and lets `style-src`/`font-src` stay first-party-only.

- Both are variable fonts: one woff2 per subset spans the `400 700` weight axis, so each `@font-face` declares a weight **range** (not a single weight) with `font-display: swap`.
- Only the `latin` and `latin-ext` subsets are hosted; other subsets fall back to the system font.
- To refresh or add a subset, follow the instructions in the header comment of `fonts.css` (re-download with the `wght@400..700` **range** syntax, drop the woff2 into `public/fonts`, and bump the `?v=` token in both `fonts.css` and the `config.ts` preloads).
- Licenses (SIL OFL 1.1) travel with the binaries in `public/fonts/*-OFL.txt`.

## Project layout

- `index.md` — the single content page (front matter only; the layout is the custom theme).
- `.vitepress/config.ts` — site config, `<head>` (SEO/OG/preloads), and the `buildEnd` hooks.
- `.vitepress/theme/` — custom theme: `AppLayout.vue`, `components/GrimicornPage.vue`, `components/NotFound.vue`, `fonts.css`, `style.css`.
- `.vitepress/headers.ts`, `write-headers.ts`, `scan-origins.ts`, `origins.ts`, `asset-cache-bust.ts` — the build-time CSP / origin / cache-bust machinery described above.
- `.vitepress/tests/` — Vitest unit and snapshot tests covering the config, headers, origins, fonts, cache-bust, and components.
- `og-banner-spec.mjs`, `hero-image-spec.mjs`, `scripts/generate-og-banner.mjs` — single-source specs and the OG banner generator.
- `public/` — static assets (fonts, images, `assets/`, `llms.txt`, `robots.txt`) copied verbatim into the build.
