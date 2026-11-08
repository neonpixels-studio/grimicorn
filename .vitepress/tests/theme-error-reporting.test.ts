import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { App } from "vue";
import type { EnhanceAppContext } from "vitepress";

const initErrorReporting = vi.hoisted(() => vi.fn());

vi.mock("@theme/error-reporting", () => ({ initErrorReporting }));

const DSN = "https://publicKey@o123.ingest.us.sentry.io/456";

// The theme reads the DSN at module load, so each test stubs the env first and
// then imports a fresh copy.
async function enhanceFreshTheme() {
  vi.resetModules();
  const { default: theme } = await import("@theme/index");
  const app = {} as App;
  await theme.enhanceApp({ app } as EnhanceAppContext);
  return app;
}

beforeEach(() => {
  initErrorReporting.mockReset();
  vi.stubEnv("SSR", false);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("theme enhanceApp error reporting", () => {
  it("starts error reporting with the app and DSN when the build carries one", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", DSN);
    const app = await enhanceFreshTheme();
    expect(initErrorReporting).toHaveBeenCalledOnce();
    expect(initErrorReporting).toHaveBeenCalledWith(app, DSN);
  });

  it("does nothing when the build has no DSN", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    await enhanceFreshTheme();
    expect(initErrorReporting).not.toHaveBeenCalled();
  });

  it("does nothing during server rendering", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", DSN);
    vi.stubEnv("SSR", true);
    await enhanceFreshTheme();
    expect(initErrorReporting).not.toHaveBeenCalled();
  });

  it("does nothing when the visitor sends Global Privacy Control", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", DSN);
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    await enhanceFreshTheme();
    expect(initErrorReporting).not.toHaveBeenCalled();
  });

  it("still lets the app mount when error reporting fails to start", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", DSN);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    initErrorReporting.mockImplementation(() => {
      throw new Error("blocked");
    });
    await expect(enhanceFreshTheme()).resolves.toBeDefined();
    expect(consoleError).toHaveBeenCalledWith(
      "Error reporting failed to start",
      expect.any(Error),
    );
  });
});
