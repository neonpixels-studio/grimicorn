import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import { CONSENT_STORAGE_KEY } from "../../theme/analytics/consent";
import { GA_SCRIPT_ELEMENT_ID } from "../../theme/analytics/googleAnalytics";

const MEASUREMENT_ID = "G-CTRL123";

async function loadController() {
  vi.resetModules();
  vi.stubEnv("VITE_GA_MEASUREMENT_ID", MEASUREMENT_ID);
  return import("../../theme/analytics/consent-controller");
}

function gaScript() {
  return document.getElementById(GA_SCRIPT_ELEMENT_ID);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  gaScript()?.remove();
  delete (window as unknown as Record<string, unknown>).dataLayer;
  delete (window as unknown as Record<string, unknown>).gtag;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("initAnalyticsConsent", () => {
  it("prompts and loads nothing when there is no choice", async () => {
    const controller = await loadController();
    controller.initAnalyticsConsent();

    expect(controller.bannerOpen.value).toBe(true);
    expect(gaScript()).toBeNull();
    expect((window as unknown as Record<string, unknown>).dataLayer).toBe(
      undefined,
    );
  });

  it("loads GA without prompting after a stored accept", async () => {
    localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ choice: "accepted", expiresAt: Date.now() + 60_000 }),
    );
    const controller = await loadController();
    controller.initAnalyticsConsent();

    expect(controller.bannerOpen.value).toBe(false);
    expect(gaScript()).not.toBeNull();
  });

  it("loads nothing and shows no banner or link under a privacy signal", async () => {
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    const controller = await loadController();
    controller.initAnalyticsConsent();

    expect(controller.analyticsAvailable.value).toBe(false);
    expect(controller.bannerOpen.value).toBe(false);
    expect(gaScript()).toBeNull();
  });

  it("clears leftover GA cookies under a privacy signal", async () => {
    document.cookie = "_ga=1; path=/";
    vi.stubGlobal("navigator", { doNotTrack: "1" });
    const controller = await loadController();
    controller.initAnalyticsConsent();

    expect(document.cookie).not.toContain("_ga=");
  });

  it("does nothing on builds without a measurement ID", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "");
    const controller = await import("../../theme/analytics/consent-controller");
    controller.initAnalyticsConsent();

    expect(controller.analyticsAvailable.value).toBe(false);
    expect(controller.bannerOpen.value).toBe(false);
  });
});

describe("accept, withdraw, and reopen", () => {
  it("accept loads GA and closes the banner; decline withdraws it", async () => {
    const controller = await loadController();
    controller.initAnalyticsConsent();

    controller.acceptAnalytics();
    expect(gaScript()).not.toBeNull();
    expect(controller.bannerOpen.value).toBe(false);

    controller.reopenAnalyticsChoice();
    expect(controller.bannerOpen.value).toBe(true);

    controller.declineAnalytics();
    expect(
      (window as unknown as Record<string, unknown>)[
        `ga-disable-${MEASUREMENT_ID}`
      ],
    ).toBe(true);
    expect(JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY)!).choice).toBe(
      "declined",
    );
    expect(controller.bannerOpen.value).toBe(false);
  });
});
