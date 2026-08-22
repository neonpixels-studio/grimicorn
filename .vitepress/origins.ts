// Third-party origins the site's first-party-only CSP (see headers.ts) would block
// if any resource ever loaded from them. The fonts are self-hosted (see
// theme/fonts.css), which removed the only external origins the site used, so these
// Google Fonts origins are the reference case: a reappearance in the theme source or
// in the built output is a regression. Kept in one place so the source-level scan
// (tests/fonts.test.ts) and the build-output scan (scan-origins.ts) guard the same
// list rather than drifting apart.
export const DISALLOWED_ORIGINS = [
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
];
