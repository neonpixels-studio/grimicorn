import { beforeEach, describe, it, expect, vi } from "vitest";
import type { App } from "vue";

const init = vi.hoisted(() => vi.fn());

vi.mock("@sentry/vue", () => ({ init }));

import { initErrorReporting } from "@theme/error-reporting";

const DSN = "https://publicKey@o123.ingest.us.sentry.io/456";

type InitOptions = {
  app: App;
  dsn: string;
  environment: string;
  integrations: (_defaults: Array<{ name: string }>) => Array<{
    name: string;
  }>;
  dataCollection: { userInfo: boolean; cookies: boolean };
  tracesSampleRate?: number;
};

function initOptions() {
  const app = {} as App;
  initErrorReporting(app, DSN);
  expect(init).toHaveBeenCalledOnce();
  return { app, options: init.mock.calls[0][0] as InitOptions };
}

beforeEach(() => {
  init.mockReset();
});

describe("initErrorReporting", () => {
  it("initializes Sentry for the given app and DSN in the production environment", () => {
    const { app, options } = initOptions();
    expect(options.app).toBe(app);
    expect(options.dsn).toBe(DSN);
    expect(options.environment).toBe("production");
  });

  it("drops release-health session tracking and keeps every other default", () => {
    const { options } = initOptions();
    const defaults = [
      { name: "InboundFilters" },
      { name: "BrowserSession" },
      { name: "GlobalHandlers" },
    ];
    expect(options.integrations(defaults).map(({ name }) => name)).toEqual([
      "InboundFilters",
      "GlobalHandlers",
    ]);
  });

  it("collects no user info (so no inferred IP) and no cookies", () => {
    const { options } = initOptions();
    expect(options.dataCollection).toEqual({ userInfo: false, cookies: false });
  });

  it("enables no performance tracing", () => {
    const { options } = initOptions();
    expect(options.tracesSampleRate).toBeUndefined();
  });
});
