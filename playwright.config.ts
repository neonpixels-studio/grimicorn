import { defineConfig, devices } from "@playwright/test";

// A single real-browser smoke test for the interactive behaviors (Konami rave,
// pause-control focus handling, cursor parallax) that the happy-dom unit suite
// structurally can't exercise: real matchMedia change events, focus, and the
// requestAnimationFrame-driven transform. It runs against the production build
// served with the generated Content-Security-Policy (see .vitepress/e2e/serve-dist.mjs),
// so a CSP regression that blocks the inline bootstrap — and therefore hydration —
// fails here the way it would in production. `vitepress preview` would not apply
// that header, which is why the small static server exists.

// Off the vitepress preview/dev default (4173) so a stray `npm run preview` on that
// port can't be reused as the server — which would serve the site with no CSP and
// silently defeat the CSP-regression check.
const PORT = 4319;
// 127.0.0.1, not localhost: the static server binds IPv4 loopback exclusively, so
// matching the host here avoids a wasted ::1 connection attempt per request.
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./.vitepress/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    // Playwright defaults reducedMotion to "no-preference", so the parallax and
    // auto-advancing stream run; the reduced-motion assertions opt into "reduce"
    // explicitly per test via page.emulateMedia.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Serve the production build with its per-build CSP headers so the smoke test
    // runs against exactly what Netlify ships. The build itself runs in the
    // `test:e2e` npm script (not here) so a reused local server can never serve a
    // stale dist — which would defeat the CSP-regression check.
    command: `node .vitepress/e2e/serve-dist.mjs ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
