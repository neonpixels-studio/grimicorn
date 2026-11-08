import { init, type getDefaultIntegrations } from "@sentry/vue";
import type { App } from "vue";

// v11 no longer re-exports the Integration type from @sentry/vue.
type Integration = ReturnType<typeof getDefaultIntegrations>[number];

// Browser half of Sentry error reporting, loaded only by builds that carry a
// DSN (see enhanceApp in ./index.ts). The DSN lives only in .env.production, so
// every event this sends is from the live site.
const SENTRY_ENVIRONMENT = "production";
// Release-health sessions: one request to Sentry on every page load, error or
// not. Dropped so a visitor who hits no error sends Sentry nothing.
const SESSION_INTEGRATION_NAME = "BrowserSession";

function withoutSessionTracking(integrations: Integration[]) {
  return integrations.filter(
    (integration) => integration.name !== SESSION_INTEGRATION_NAME,
  );
}

export function initErrorReporting(app: App, dsn: string) {
  init({
    app,
    dsn,
    environment: SENTRY_ENVIRONMENT,
    // Errors only: no tracing, session replay or session tracking.
    integrations: withoutSessionTracking,
    // v11 defaults collect user info (Sentry infers the visitor's IP from it)
    // and cookies (GA's _ga ids on production), so both are turned off.
    dataCollection: { userInfo: false, cookies: false },
  });
}
