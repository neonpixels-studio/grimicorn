// CommonJS (not .json) specifically so the largest-contentful-paint budget below
// can carry an inline rationale comment next to the number it justifies — JSON
// has no comment syntax, and duplicating the reasoning only in README.md let it
// drift from the number it was supposed to explain. The .cjs extension (rather
// than .js) forces CommonJS regardless of this package's "type": "module" in
// package.json, since Node/lhci resolve plain .js as ESM there and `module.exports`
// would fail to load.

// Single source of truth for the port serve-dist.mjs listens on, referenced by
// both `url` and `startServerCommand` below so they can't drift apart.
const SERVER_PORT = 4319;

const ORIGIN = `http://127.0.0.1:${SERVER_PORT}`;

// The 404 is audited at its built file path, not at an unknown route: serve-dist.mjs
// answers a missing route with 404.html but a 404 status, whereas `/404.html` is a
// real file and answers 200. Auditing the file keeps the result independent of how a
// static server maps a miss to a status code.
const HOME_URL = `${ORIGIN}/`;
const NOT_FOUND_URL = `${ORIGIN}/404.html`;

// assertMatrix matchingUrlPattern values are regexes tested against the audited URL.
const HOME_PATTERN = `^${ORIGIN}/$`;
const NOT_FOUND_PATTERN = `^${ORIGIN}/404\\.html$`;

// Homepage gates, values unchanged. The performance and size budgets below are tuned
// to the homepage's hero and deliberately do not apply to the 404.
const CATEGORY_GATE = ["error", { minScore: 0.9 }];
const AUDIT_MUST_PASS = ["error", { minScore: 1 }];

const HOME_ASSERTIONS = {
  "categories:performance": CATEGORY_GATE,
  "categories:accessibility": CATEGORY_GATE,
  "categories:seo": CATEGORY_GATE,
  // Error, not warn (#210): this gate assumes GA stays unloaded in the
  // build it audits. GA only loads when `ANALYTICS_ENABLED`
  // (CONTEXT === "production", see .vitepress/config.ts) is true.
  // lighthouse.yml's first step fails the job if CONTEXT is production
  // (enforced by lighthouse-context-guard.test.ts). If that guard trips,
  // fix it in lighthouse.yml, not by loosening this assertion back to
  // warn.
  "categories:best-practices": CATEGORY_GATE,
  // Not the textbook 2500ms: under lhci's default mobile formFactor +
  // simulated throttling, this page's LCP breakdown is ~450ms TTFB (a fixed
  // floor from the simulated network profile, not real server latency) plus
  // ~2.5s render delay from the simulated 4x CPU slowdown applied to
  // hydrating the VitePress bundle alongside the animated hero (cursor
  // parallax, backdrop blur/gradient glow, auto-advancing tagline/log
  // stream). Every Lighthouse opportunity audit that could explain that gap
  // (render-blocking-resources, prioritize-lcp-image, uses-text-compression,
  // modern-image-formats) already scores a clean 1 with no further
  // estimated savings, so there's no remaining actionable fix short of
  // cutting real interactivity or switching to a desktop formFactor —
  // which would stop testing the mobile experience this gate exists to
  // protect. 3200ms leaves real headroom over the measured ~3000ms local
  // median for cross-runner variance, while still failing on a materially
  // heavier hero/hydration bundle. It is NOT what catches serve-dist.mjs
  // losing its gzip step — that regression is asserted directly below via
  // uses-text-compression, since an LCP budget alone could pass by luck
  // (lhci checks the best of numberOfRuns) even with compression broken.
  "largest-contentful-paint": ["error", { maxNumericValue: 3200 }],
  // Direct regression guard for the gzip step in serve-dist.mjs (see
  // COMPRESSIBLE_EXTENSIONS there): if compression is ever dropped, this
  // fails on every run, unlike the LCP budget above which only fails if the
  // resulting slowdown is large enough and consistent across runs.
  "uses-text-compression": AUDIT_MUST_PASS,
  // Size budgets are error, not warn (#267): a heavier hero image or font
  // must fail the gate. Transfer sizes measured on the current build
  // (deterministic across runs): total 344 KB, image 206 KB, font 55 KB.
  // Total and image leave roughly 50% headroom over that baseline; font
  // is capped at 100 KB (~80% headroom), down from 150 KB, which allowed
  // a 2.7x regression.
  // Raise a number here deliberately when the baseline shifts.
  "resource-summary:total:size": ["error", { maxNumericValue: 512000 }],
  "resource-summary:font:size": ["error", { maxNumericValue: 100000 }],
  "resource-summary:image:size": ["error", { maxNumericValue: 300000 }],
};

// The 404 keeps the same 0.9 accessibility and best-practices gates as the homepage.
// SEO is asserted per audit instead of by category: the 404 is intentionally
// `noindex, follow` (see NotFound.vue and the 404 head in config.ts), so the
// is-crawlable audit fails by design and would drag the category under 0.9. Every
// other SEO audit that applies to a 404 must still pass; http-status-code is left out
// because a correct 404 page is served with a 404 status on Netlify.
const NOT_FOUND_SEO_AUDITS = [
  "document-title",
  "meta-description",
  "viewport",
  "link-text",
  "crawlable-anchors",
  "hreflang",
];

const NOT_FOUND_ASSERTIONS = {
  "categories:accessibility": CATEGORY_GATE,
  "categories:best-practices": CATEGORY_GATE,
  ...Object.fromEntries(
    NOT_FOUND_SEO_AUDITS.map((audit) => [audit, AUDIT_MUST_PASS]),
  ),
};

module.exports = {
  ci: {
    collect: {
      url: [HOME_URL, NOT_FOUND_URL],
      startServerCommand: `node .vitepress/e2e/serve-dist.mjs ${SERVER_PORT}`,
      startServerReadyPattern: "Serving",
      startServerReadyTimeout: 30000,
      numberOfRuns: 3,
      settings: {
        skipAudits: ["canonical"],
      },
    },
    assert: {
      assertMatrix: [
        { matchingUrlPattern: HOME_PATTERN, assertions: HOME_ASSERTIONS },
        {
          matchingUrlPattern: NOT_FOUND_PATTERN,
          assertions: NOT_FOUND_ASSERTIONS,
        },
      ],
    },
  },
};
