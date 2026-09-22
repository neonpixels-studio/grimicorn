import { defineConfig, type HeadConfig } from "vitepress";
import type { SiteConfig } from "vitepress";
import tailwindcss from "@tailwindcss/vite";
import { OG_WIDTH, OG_HEIGHT, OG_IMAGE_FILENAME } from "../og-banner-spec.mjs";
import { HERO_AVIF_HREF } from "../hero-image-spec.mjs";
import { writeCspHeaders } from "./write-headers";
import { withAssetCacheBust } from "./asset-cache-bust";
import { assertBuildOutputHasNoDisallowedOrigins } from "./scan-origins";
import {
  SITE_TITLE,
  NOT_FOUND_TITLE,
  NOT_FOUND_DESCRIPTION,
} from "./not-found-meta";

const SITE_URL = "https://grimicorn.dev";
// Google Analytics (GA4) measurement ID. This is the one deliberate third-party
// integration on an otherwise first-party site: the gtag loader is fetched from
// googletagmanager.com and measurement beacons go to google-analytics.com, which
// is why headers.ts widens script-src/connect-src/img-src to those origins.
const GA_MEASUREMENT_ID = "G-0R2LBBYFB7";
// GA loads only on the Netlify production deploy. Netlify sets CONTEXT to
// "production" for the live site and to "deploy-preview"/"branch-deploy"
// otherwise; it is unset in `vitepress dev` and a bare local build. Gating on it
// keeps dev, preview, and branch traffic out of the GA property. When disabled,
// buildEnd tells headers.ts to omit the Google origins too, so every
// non-production build stays strictly first-party.
const ANALYTICS_ENABLED = process.env.CONTEXT === "production";

// The gtag loader is external (covered by script-src's googletagmanager.com
// origin); the inline config script carries no hash here because
// collectScriptHashes hashes it out of the built HTML at build time, exactly like
// VitePress's own inline bootstrap scripts. Empty when analytics is disabled so no
// GA tag reaches dev/preview/branch output.
const GA_HEAD_ENTRIES: HeadConfig[] = ANALYTICS_ENABLED
  ? [
      [
        "script",
        {
          async: "",
          src: `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`,
        },
      ],
      [
        "script",
        {},
        `window.dataLayer = window.dataLayer || [];\nfunction gtag(){dataLayer.push(arguments);}\ngtag('js', new Date());\n\ngtag('config', '${GA_MEASUREMENT_ID}');`,
      ],
    ]
  : [];
const DESCRIPTION =
  "A chaotic AI coding sidekick — builds what you don't have time for, then unleashes gremlins to break it before production does.";
// Shared by og:title and twitter:title, which must stay identical — extracted so
// the two can't drift the way two independent literals could.
const SOCIAL_TITLE = "Grimicorn – AI Coding Sidekick";
// The ?v= cache-bust token is the single source of truth in ./asset-cache-bust,
// shared with the hero <picture> srcsets in GrimicornPage.vue so an avif client
// never fetches a different URL than the preload warmed.
const OG_IMAGE = withAssetCacheBust(`${SITE_URL}/assets/${OG_IMAGE_FILENAME}`);
const OG_IMAGE_WIDTH = String(OG_WIDTH);
const OG_IMAGE_HEIGHT = String(OG_HEIGHT);
const OG_IMAGE_ALT =
  "Grimicorn: a psychedelic, skeletal unicorn with a spiraled horn and flowing rainbow-colored mane, prancing before a rainbow over a surreal landscape.";

// The hero <picture> in GrimicornPage.vue is the LCP element on every content page.
// avif is its first (preferred) source, so preloading only the avif — gated by type
// so non-avif browsers skip it and fall back to the normal picture resolution —
// matches what an avif-capable client actually fetches with no wasted bytes. A second
// type-differentiated preload (webp) would double-download in browsers that support
// both formats, so we intentionally omit it.
const HERO_IMAGE_HREF = withAssetCacheBust(HERO_AVIF_HREF);
const HERO_IMAGE_TYPE = "image/avif";
const HERO_PRELOAD_HEAD_ENTRY: HeadConfig = [
  "link",
  {
    rel: "preload",
    as: "image",
    href: HERO_IMAGE_HREF,
    type: HERO_IMAGE_TYPE,
    fetchpriority: "high",
  },
];

// Grimicorn is free, so the schema.org Offer carries a real price of 0 — the
// offers field the SoftwareApplication markup was missing. There is no real review
// data, so aggregateRating and review stay omitted rather than fabricated; the
// Offer is valid schema.org on its own.
const OFFER_PRICE = "0";
const OFFER_CURRENCY = "USD";

const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Grimicorn",
  description: DESCRIPTION,
  url: SITE_URL,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "All",
  image: OG_IMAGE,
  offers: {
    "@type": "Offer",
    price: OFFER_PRICE,
    priceCurrency: OFFER_CURRENCY,
  },
});

// These tags all assert "this URL is the real, indexable Grimicorn homepage" —
// wrong on the 404, which is neither canonical nor the SoftwareApplication the
// JSON-LD describes, nor the page whose title/image the Twitter Card should
// preview. VitePress's head merge (mergeHead) can only add or override a `meta`
// tag that shares its first attribute key/value with a later entry; it can't
// remove a `link` or `script` tag once it's in the static site-wide `head` array.
// So these live here, added per-page by transformHead (see below), instead of in
// the static `head` list — the only way to omit them on the 404 rather than
// merely duplicate or override them. Twitter Card tags are included alongside
// Open Graph: X, Slack, and Discord all fall back to `twitter:*` when `og:*` is
// absent, so leaving them static would still preview the 404 as the homepage.
// This covers the tags in the issue's acceptance criteria (canonical, OG,
// Twitter, JSON-LD). The page `<title>`/meta description are a separate concern
// (see NOT_FOUND_TITLE/NOT_FOUND_DESCRIPTION below and transformHtml).
const INDEXABLE_HEAD_ENTRIES: HeadConfig[] = [
  ["link", { rel: "canonical", href: SITE_URL }],
  ["meta", { property: "og:type", content: "website" }],
  ["meta", { property: "og:locale", content: "en_US" }],
  ["meta", { property: "og:url", content: SITE_URL }],
  ["meta", { property: "og:title", content: SOCIAL_TITLE }],
  ["meta", { property: "og:description", content: DESCRIPTION }],
  ["meta", { property: "og:image", content: OG_IMAGE }],
  ["meta", { property: "og:image:width", content: OG_IMAGE_WIDTH }],
  ["meta", { property: "og:image:height", content: OG_IMAGE_HEIGHT }],
  ["meta", { property: "og:image:alt", content: OG_IMAGE_ALT }],
  ["meta", { name: "twitter:card", content: "summary_large_image" }],
  ["meta", { name: "twitter:title", content: SOCIAL_TITLE }],
  ["meta", { name: "twitter:description", content: DESCRIPTION }],
  ["meta", { name: "twitter:image", content: OG_IMAGE }],
  ["meta", { name: "twitter:image:alt", content: OG_IMAGE_ALT }],
  ["script", { type: "application/ld+json" }, JSON_LD],
];

// Tells crawlers the 404 itself isn't a real destination while leaving "follow"
// so the real links it renders (home, GitHub) still pass link equity.
const NOT_FOUND_ROBOTS_HEAD_ENTRY: HeadConfig = [
  "meta",
  { name: "robots", content: "noindex, follow" },
];

// VitePress has no 404.md in this repo (AppLayout.vue renders NotFound.vue
// purely off `page.isNotFound`, the current non-deprecated pattern — see
// vitepress's own `Theme.NotFound` deprecation notice), so every 404 render
// — static build and client-side soft-404 alike — falls back to VitePress's
// internal `notFoundPageData` object, which hardcodes title "404" and
// description "Not Found". Those two values happen to already differ from
// the homepage's, but they're an accident of VitePress internals, not a
// deliberate, owned page description — and "Not Found" gives a scraper or
// search result no real information. NOT_FOUND_TITLE/NOT_FOUND_DESCRIPTION
// (imported from ./not-found-meta, shared with AppLayout.vue's client-side
// override) are this page's actual, owned copy.
//
// Added via transformHead below. VitePress's own HTML template skips its
// auto-generated `<meta name="description">` whenever the merged head already
// carries one (see `isDescriptionOverridden` in vitepress's renderPage), so
// this replaces, rather than duplicates, the generic "Not Found" fallback.
const NOT_FOUND_DESCRIPTION_HEAD_ENTRY: HeadConfig = [
  "meta",
  { name: "description", content: NOT_FOUND_DESCRIPTION },
];

// [\s\S] (not `.`) so a <title> VitePress ever wraps across a newline still
// matches. Used by transformHtml below.
const TITLE_TAG_PATTERN = /<title>[\s\S]*?<\/title>/;

export default defineConfig({
  title: SITE_TITLE,
  description: DESCRIPTION,
  lang: "en-US",
  sitemap: {
    hostname: SITE_URL,
  },
  head: [
    // Fonts are self-hosted via @font-face in .vitepress/theme/fonts.css
    // (served from /public/fonts), so no Google Fonts preconnect or stylesheet
    // is needed here and the CSP stays first-party-only for fonts. Preload only
    // the two latin (default) subsets — they'd otherwise be discovered late, after
    // the CSS bundle parses. crossorigin is required even same-origin: font fetches
    // are always CORS-mode, so a bare preload would download the file twice. The
    // ?v= must match fonts.css or the preload misses the cache and double-fetches.
    [
      "link",
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: "/fonts/space-grotesk-latin.woff2?v=20260813",
        crossorigin: "",
      },
    ],
    [
      "link",
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: "/fonts/jetbrains-mono-latin.woff2?v=20260813",
        crossorigin: "",
      },
    ],
    // Theme color. Canonical, Open Graph, Twitter Card, and structured data are
    // page-conditional — see INDEXABLE_HEAD_ENTRIES above — omitted on the 404.
    ["meta", { name: "theme-color", content: "#0a0a0b" }],
    // Favicon
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        href: "/images/favicon-96x96.png?v=20260618",
        sizes: "96x96",
      },
    ],
    [
      "link",
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/images/favicon.svg?v=20260618",
      },
    ],
    ["link", { rel: "shortcut icon", href: "/images/favicon.ico?v=20260618" }],
    [
      "link",
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/images/apple-touch-icon.png?v=20260618",
      },
    ],
    [
      "meta",
      { name: "apple-mobile-web-app-title", content: "Grimicorn Agent" },
    ],
    // The manifest lives under /images and is now long-cached immutable, so its ?v=
    // must bump whenever its body changes (it just gained versioned icon srcs) or
    // returning visitors keep a stale copy for a year.
    [
      "link",
      { rel: "manifest", href: withAssetCacheBust("/images/site.webmanifest") },
    ],
    // Google Analytics (GA4), production-only (see ANALYTICS_ENABLED / GA_HEAD_ENTRIES
    // above). Spread here so it lands in the static `head` — rendered on every page
    // including the 404, which we want to measure — rather than transformHead, which
    // is scoped per page.
    ...GA_HEAD_ENTRIES,
  ],
  // Scope the hero preload and INDEXABLE_HEAD_ENTRIES (see rationale above) to
  // every page except the 404. AppLayout shows NotFound (no hero) when
  // page.isNotFound and GrimicornPage otherwise, so this mirrors that exact
  // condition: preloading the hero on the 404 would burn a high-priority request
  // and trip Chrome's "preloaded but not used" warning.
  //
  // transformHead is a build-time hook: both effects are baked into the static
  // HTML under `vitepress build`/`preview`, not `vitepress dev` — verify against a
  // production build. This also means it's SSR-only in both directions — a
  // client-side route change never re-runs it (VitePress's client-side head
  // updater works off the static `siteData.head`), so a client-side nav onto the
  // 404 still shows the indexable tags, and a client-side nav off the 404 leaves
  // its `noindex` meta in the DOM for the rest of that SPA session. Crawlers and
  // scrapers fetch each URL directly and get the correct baked-in head, which is
  // the case this guards against, so the practical risk is low — but don't "fix"
  // the client-side gap by moving INDEXABLE_HEAD_ENTRIES back into the static
  // `head` array; that reintroduces the bug this change fixes.
  transformHead: ({ pageData }) => {
    if (pageData.isNotFound) {
      return [NOT_FOUND_ROBOTS_HEAD_ENTRY, NOT_FOUND_DESCRIPTION_HEAD_ENTRY];
    }
    return [HERO_PRELOAD_HEAD_ENTRY, ...INDEXABLE_HEAD_ENTRIES];
  },
  // The <title> tag has no equivalent override seam: it's written directly by
  // VitePress's renderPage from `createTitle(siteData, pageData)`, and unlike
  // the description meta tag, nothing skips or overrides it based on the head
  // array. transformHtml — the one hook that sees the fully-assembled HTML
  // string before it's written to disk — is therefore the only supported way
  // to give the 404 its own title. Checks `pageData.isNotFound`, the same
  // signal transformHead and AppLayout.vue's client-side override use
  // (rather than matching the page id string), so all three can't disagree
  // about what counts as the 404.
  transformHtml: (code, _id, { pageData }) => {
    if (!pageData.isNotFound) {
      return code;
    }
    if (!TITLE_TAG_PATTERN.test(code)) {
      // Fail loud: a silent no-op here would ship the generic VitePress
      // fallback title with no signal that the override stopped applying.
      throw new Error(
        `404 transformHtml: no <title> tag found to override in ${pageData.relativePath}`,
      );
    }
    // A replacer function, not a template-string second argument, so a
    // literal "$" in NOT_FOUND_TITLE can never be read as a replacement
    // pattern token (e.g. "$&", "$1") by String.prototype.replace.
    return code.replace(
      TITLE_TAG_PATTERN,
      () => `<title>${NOT_FOUND_TITLE}</title>`,
    );
  },
  vite: {
    // tailwindcss() is typed against the top-level `vite` package, which npm
    // hoists to v8 to satisfy vitest 5's peer range. vitepress bundles its own
    // vite@5 internally and types `vite.plugins` against that copy, so the two
    // Plugin types are structurally different even though they're both valid
    // Vite plugin objects at runtime. Cast through `any` to bridge the two
    // physical vite installations rather than fighting npm's dependency graph.
    plugins: [tailwindcss()] as any,
  },
  buildEnd(siteConfig: SiteConfig) {
    writeCspHeaders(siteConfig.outDir, ANALYTICS_ENABLED);
    // Guard the rendered output too: the source-level scan can't see an origin a
    // dependency or plugin injects into the built HTML/CSS/JS (see scan-origins.ts).
    assertBuildOutputHasNoDisallowedOrigins(siteConfig.outDir);
  },
});
