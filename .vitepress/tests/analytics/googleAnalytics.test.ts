import { afterEach, describe, it, expect, vi } from "vitest";

import {
  GA_SCRIPT_ELEMENT_ID,
  clearGoogleAnalyticsCookies,
  cookieDomainCandidates,
  disableGoogleAnalytics,
  loadGoogleAnalytics,
} from "../../theme/analytics/googleAnalytics";

const MEASUREMENT_ID = "G-TEST123";

type AnalyticsWindow = Record<string, unknown>;

afterEach(() => {
  document.getElementById(GA_SCRIPT_ELEMENT_ID)?.remove();
  const target = window as unknown as AnalyticsWindow;
  delete target.dataLayer;
  delete target.gtag;
  delete target[`ga-disable-${MEASUREMENT_ID}`];
});

describe("loadGoogleAnalytics", () => {
  it("requests nothing and creates no dataLayer until called", () => {
    expect(document.getElementById(GA_SCRIPT_ELEMENT_ID)).toBeNull();
    expect((window as unknown as AnalyticsWindow).dataLayer).toBeUndefined();
  });

  it("injects the loader once and queues js and config", () => {
    loadGoogleAnalytics(MEASUREMENT_ID);
    loadGoogleAnalytics(MEASUREMENT_ID);

    const loaders = document.querySelectorAll(`#${GA_SCRIPT_ELEMENT_ID}`);
    expect(loaders).toHaveLength(1);
    expect((loaders[0] as HTMLScriptElement).src).toBe(
      `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`,
    );
    const queued = (
      (window as unknown as AnalyticsWindow).dataLayer as ArrayLike<unknown>[]
    ).map((entry) => Array.from(entry));
    expect(queued[0][0]).toBe("js");
    expect(queued.filter((entry) => entry[0] === "config")).toEqual([
      ["config", MEASUREMENT_ID],
      ["config", MEASUREMENT_ID],
    ]);
  });

  it("re-enables hits after a withdrawal", () => {
    loadGoogleAnalytics(MEASUREMENT_ID);
    disableGoogleAnalytics(MEASUREMENT_ID);
    const target = window as unknown as AnalyticsWindow;
    expect(target[`ga-disable-${MEASUREMENT_ID}`]).toBe(true);

    loadGoogleAnalytics(MEASUREMENT_ID);
    expect(target[`ga-disable-${MEASUREMENT_ID}`]).toBe(false);
  });
});

describe("cookieDomainCandidates", () => {
  it("lists every parent suffix except the bare TLD", () => {
    expect(cookieDomainCandidates("www.grimicorn.dev")).toEqual([
      ".www.grimicorn.dev",
      ".grimicorn.dev",
    ]);
  });

  it("returns nothing for IPs and IPv6 hosts", () => {
    expect(cookieDomainCandidates("127.0.0.1")).toEqual([]);
    expect(cookieDomainCandidates("[::1]")).toEqual([]);
  });
});

describe("clearGoogleAnalyticsCookies", () => {
  it("expires the GA cookies and leaves other cookies alone", () => {
    document.cookie = "_ga=1; path=/";
    document.cookie = "_ga_ABC123=2; path=/";
    document.cookie = "keep=3; path=/";

    clearGoogleAnalyticsCookies();

    expect(document.cookie).toBe("keep=3");
    document.cookie = "keep=; max-age=0; path=/";
  });

  it("also expires cookies scoped to a parent domain", () => {
    const writes: string[] = [];
    const cookieSpy = vi
      .spyOn(document, "cookie", "get")
      .mockReturnValue("_ga=1; keep=2");
    vi.spyOn(document, "cookie", "set").mockImplementation((value) => {
      writes.push(value);
    });
    vi.stubGlobal("location", { hostname: "www.grimicorn.dev" });

    clearGoogleAnalyticsCookies();

    expect(cookieSpy).toHaveBeenCalled();
    expect(writes.filter((write) => write.startsWith("keep"))).toEqual([]);
    expect(writes.filter((write) => write.includes("max-age=0"))).toHaveLength(
      3,
    );
    expect(
      writes.some((write) => write.endsWith("domain=.grimicorn.dev")),
    ).toBe(true);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
