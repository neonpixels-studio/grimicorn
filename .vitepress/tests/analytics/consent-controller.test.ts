import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import { CONSENT_STORAGE_KEY } from "../../theme/analytics/consent";
import { GA_SCRIPT_ELEMENT_ID } from "../../theme/analytics/googleAnalytics";

const MEASUREMENT_ID = "G-CTRL123";

async function loadController() {
  vi.resetModules();
  vi.stubEnv("VITE_GA_MEASUREMENT_ID", MEASUREMENT_ID);
  return import("../../theme/analytics/consent-controller");
}

function analyticsWindow() {
  return window as unknown as Record<string, unknown>;
}

function gaScript() {
  return document.getElementById(GA_SCRIPT_ELEMENT_ID);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  gaScript()?.remove();
  document.cookie = "_ga=; max-age=0; path=/";
  delete analyticsWindow()[`ga-disable-${MEASUREMENT_ID}`];
  delete analyticsWindow().dataLayer;
  delete analyticsWindow().gtag;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("initAnalyticsConsent", () => {
  it("prompts and loads nothing when there is no choice", async () => {
    const controller = await loadController();
    controller.initAnalyticsConsent();

    expect(controller.bannerOpen.value).toBe(true);
    expect(gaScript()).toBeNull();
    expect(analyticsWindow().dataLayer).toBe(undefined);
  });

  it("clears a lingering GA cookie after a stored decline", async () => {
    localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ choice: "declined", expiresAt: Date.now() + 60_000 }),
    );
    document.cookie = "_ga=1; path=/";
    const controller = await loadController();
    controller.initAnalyticsConsent();

    expect(document.cookie).not.toContain("_ga=");
    expect(gaScript()).toBeNull();
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
    expect(document.cookie).toContain("_ga=");
    vi.stubGlobal("navigator", { doNotTrack: "1" });
    const controller = await loadController();
    controller.initAnalyticsConsent();

    expect(document.cookie).not.toContain("_ga=");
  });

  it("does nothing on builds without a measurement ID, even after a stored accept", async () => {
    localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ choice: "accepted", expiresAt: Date.now() + 60_000 }),
    );
    vi.resetModules();
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "");
    const controller = await import("../../theme/analytics/consent-controller");
    controller.initAnalyticsConsent();

    expect(controller.analyticsAvailable.value).toBe(false);
    expect(controller.bannerOpen.value).toBe(false);
    expect(gaScript()).toBeNull();
  });
});

describe("accept, withdraw, and reopen", () => {
  it("accept loads GA and closes the banner; decline withdraws it", async () => {
    const controller = await loadController();
    controller.initAnalyticsConsent();

    controller.acceptAnalytics();
    expect(gaScript()).not.toBeNull();
    expect(controller.bannerOpen.value).toBe(false);

    controller.reopenAnalyticsChoice(null);
    expect(controller.bannerOpen.value).toBe(true);

    controller.declineAnalytics();
    expect(analyticsWindow()[`ga-disable-${MEASUREMENT_ID}`]).toBe(true);
    expect(JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY)!).choice).toBe(
      "declined",
    );
    expect(controller.bannerOpen.value).toBe(false);
  });
});
