import { afterEach, describe, it, expect, vi } from "vitest";

import { buildGaBootstrapScript } from "../analytics";

const MEASUREMENT_ID = "G-TEST123";
const LOADER_ORIGIN = "https://www.googletagmanager.com/gtag/js";

type FakeBrowser = {
  navigator: Record<string, unknown>;
  window: Record<string, unknown>;
  appended: Array<{ tagName?: string; src?: string; async?: boolean }>;
};

// Runs the generated inline script against a fake browser so the opt-out branch is
// exercised for real rather than asserted as a string.
function runBootstrap(signals: {
  navigator?: Record<string, unknown>;
  window?: Record<string, unknown>;
}): FakeBrowser {
  const appended: FakeBrowser["appended"] = [];
  const fakeWindow: Record<string, unknown> = { ...signals.window };
  const fakeNavigator = { ...signals.navigator };
  const fakeDocument = {
    createElement: (tagName: string) => ({ tagName }),
    head: {
      appendChild: (node: FakeBrowser["appended"][number]) =>
        appended.push(node),
    },
  };
  new Function(
    "navigator",
    "window",
    "document",
    buildGaBootstrapScript(MEASUREMENT_ID),
  )(fakeNavigator, fakeWindow, fakeDocument);
  return { navigator: fakeNavigator, window: fakeWindow, appended };
}

describe("buildGaBootstrapScript", () => {
  it("loads gtag and queues the config call when no opt-out signal is sent", () => {
    const { appended, window } = runBootstrap({});

    expect(appended).toHaveLength(1);
    expect(appended[0].tagName).toBe("script");
    expect(typeof window.gtag).toBe("function");
    expect(appended[0].src).toBe(`${LOADER_ORIGIN}?id=${MEASUREMENT_ID}`);
    expect(appended[0].async).toBe(true);
    const queued = (window.dataLayer as ArrayLike<unknown>[]).map((entry) =>
      Array.from(entry),
    );
    expect(queued[0][0]).toBe("js");
    expect(queued[1]).toEqual(["config", MEASUREMENT_ID]);
  });

  it("still tracks when GPC is false and DNT is 0", () => {
    const { appended } = runBootstrap({
      navigator: { globalPrivacyControl: false, doNotTrack: "0" },
    });

    expect(appended).toHaveLength(1);
  });

  it("throws on a measurement ID that could break out of the inline script", () => {
    expect(() => buildGaBootstrapScript("G-X</script>")).toThrow(
      /Invalid GA4 measurement ID/,
    );
  });

  it.each([
    ["Global Privacy Control", { navigator: { globalPrivacyControl: true } }],
    ["navigator.doNotTrack", { navigator: { doNotTrack: "1" } }],
    ["window.doNotTrack", { window: { doNotTrack: "1" } }],
    ["navigator.msDoNotTrack", { navigator: { msDoNotTrack: "1" } }],
  ])("does not load or fire gtag when %s is set", (_label, signals) => {
    const { appended, window } = runBootstrap(signals);

    expect(appended).toHaveLength(0);
    expect(window.dataLayer).toBeUndefined();
    expect(window.gtag).toBeUndefined();
  });
});

describe("GA head entries in config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadHead(context: string) {
    vi.stubEnv("CONTEXT", context);
    vi.resetModules();
    const { default: config } = await import("../config");
    return config.head ?? [];
  }

  it("ships only the opt-out aware inline bootstrap in production, with no static loader tag", async () => {
    const head = await loadHead("production");
    const scripts = head.filter(([tag]) => tag === "script");

    expect(scripts).toHaveLength(1);
    const [, attributes, body] = scripts[0];
    expect(attributes).toEqual({});
    expect(body).toBe(buildGaBootstrapScript("G-0R2LBBYFB7"));
    expect(
      head.some(([, entryAttributes]) =>
        String(entryAttributes?.src ?? "").includes("googletagmanager"),
      ),
    ).toBe(false);
  });

  it("ships no GA script outside production", async () => {
    const head = await loadHead("deploy-preview");

    expect(head.some(([tag]) => tag === "script")).toBe(false);
  });
});
