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

module.exports = {
  ci: {
    collect: {
      url: [`http://127.0.0.1:${SERVER_PORT}/`],
      startServerCommand: `node .vitepress/e2e/serve-dist.mjs ${SERVER_PORT}`,
      startServerReadyPattern: "Serving",
      startServerReadyTimeout: 30000,
      numberOfRuns: 3,
      settings: {
        skipAudits: ["canonical"],
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.9 }],
        "categories:accessibility": ["error", { minScore: 0.9 }],
        "categories:seo": ["error", { minScore: 0.9 }],
        // Error, not warn (#210): this gate assumes GA stays unloaded in the
        // build it audits. GA only loads when `ANALYTICS_ENABLED`
        // (CONTEXT === "production", see .vitepress/config.ts) is true.
        // lighthouse.yml's first step fails the job if CONTEXT is production
        // (enforced by lighthouse-context-guard.test.ts). If that guard trips,
        // fix it in lighthouse.yml, not by loosening this assertion back to
        // warn.
        "categories:best-practices": ["error", { minScore: 0.9 }],
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
        "uses-text-compression": ["error", { minScore: 1 }],
        // Size budgets are error, not warn (#267): a heavier hero image or font
        // must fail the gate. Transfer sizes measured on the current build
        // (deterministic across runs): total 344 KB, image 206 KB, font 55 KB.
        // Thresholds leave roughly 50% headroom over that baseline (font is
        // tighter than before, 100 KB, since 150 KB allowed a 2.7x regression).
        // Raise a number here deliberately when the baseline shifts.
        "resource-summary:total:size": ["error", { maxNumericValue: 512000 }],
        "resource-summary:font:size": ["error", { maxNumericValue: 100000 }],
        "resource-summary:image:size": ["error", { maxNumericValue: 300000 }],
      },
    },
  },
};
