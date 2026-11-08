import type { Theme } from "vitepress";
import AppLayout from "./AppLayout.vue";
import "./fonts.css";
import "./style.css";

// Set only in .env.production. Every other build compiles this to undefined,
// so the dynamic import below is dead code and the Sentry SDK chunk is never
// emitted.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;

export default {
  Layout: AppLayout,
  // VitePress awaits enhanceApp before it mounts, so Sentry is attached in time
  // to catch hydration errors.
  async enhanceApp({ app }) {
    if (import.meta.env.SSR || !SENTRY_DSN) {
      return;
    }
    // Error reporting must never take the site down with it: a blocked chunk
    // or a failed init leaves the page working, unreported.
    try {
      const { initErrorReporting } = await import("./error-reporting");
      initErrorReporting(app, SENTRY_DSN);
    } catch (error) {
      console.error("Error reporting failed to start", error);
    }
  },
} satisfies Theme;
