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
  allowUrls: RegExp[];
  denyUrls: RegExp[];
  ignoreErrors: RegExp[];
  tracesSampleRate?: number;
};

function initOptions() {
  const app = {} as App;
  initErrorReporting(app, DSN);
  expect(init).toHaveBeenCalledOnce();
  return { app, options: init.mock.calls[0][0] as InitOptions };
}

const matchesAny = (rules: RegExp[], value: string) =>
  rules.some((rule) => rule.test(value));

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

  it("allows only first-party script URLs", () => {
    const { allowUrls } = initOptions().options;
    const isAllowed = (url: string) => matchesAny(allowUrls, url);
    expect(isAllowed("https://grimicorn.dev/assets/app.abc.js")).toBe(true);
    expect(isAllowed("https://www.grimicorn.dev/assets/app.js")).toBe(true);
    expect(isAllowed("https://grimicorn.dev")).toBe(true);
    expect(isAllowed("https://grimicorn.devx/app.js")).toBe(false);
    expect(isAllowed("http://localhost:4173/assets/app.js")).toBe(true);
    expect(isAllowed("http://127.0.0.1:4319/assets/app.js")).toBe(true);
    expect(isAllowed("https://grimicorn.dev.evil.com/app.js")).toBe(false);
    expect(isAllowed("https://cdn.example.com/inject.js")).toBe(false);
    expect(isAllowed("chrome-extension://abc/content.js")).toBe(false);
  });

  it("denies browser-extension script URLs", () => {
    const { denyUrls } = initOptions().options;
    const isDenied = (url: string) => matchesAny(denyUrls, url);
    expect(isDenied("chrome-extension://abc/content.js")).toBe(true);
    expect(isDenied("safari-extension://abc/content.js")).toBe(true);
    expect(isDenied("moz-extension://abc/content.js")).toBe(true);
    expect(isDenied("safari-web-extension://abc/content.js")).toBe(true);
    expect(isDenied("https://grimicorn.dev/assets/app.js")).toBe(false);
  });

  it("ignores known benign browser messages only", () => {
    const { ignoreErrors } = initOptions().options;
    const isIgnored = (message: string) => matchesAny(ignoreErrors, message);
    expect(isIgnored("ResizeObserver loop limit exceeded")).toBe(true);
    expect(
      isIgnored(
        "ResizeObserver loop completed with undelivered notifications.",
      ),
    ).toBe(true);
    expect(
      isIgnored("Unhandled promise rejection: TypeError: x is undefined"),
    ).toBe(false);
    expect(isIgnored("TypeError: x is undefined")).toBe(false);
  });
});
