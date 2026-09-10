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
        "categories:best-practices": ["warn", { minScore: 0.9 }],
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
        // median for cross-runner variance, while still failing on a regression
        // back to uncompressed responses or a materially heavier hero/hydration
        // bundle.
        "largest-contentful-paint": ["error", { maxNumericValue: 3200 }],
        "resource-summary:total:size": ["warn", { maxNumericValue: 512000 }],
        "resource-summary:font:size": ["warn", { maxNumericValue: 150000 }],
        "resource-summary:image:size": ["warn", { maxNumericValue: 300000 }],
      },
    },
  },
};
