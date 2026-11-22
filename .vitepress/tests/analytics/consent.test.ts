import { afterEach, describe, it, expect, vi } from "vitest";

import {
  CONSENT_CHOICES,
  CONSENT_LIFETIME_DAYS,
  CONSENT_STORAGE_KEY,
  getConsentStorage,
  readConsentChoice,
  shouldLoadAnalytics,
  shouldPromptForConsent,
  writeConsentChoice,
  type ConsentStorage,
} from "../../theme/analytics/consent";

const NOW = Date.UTC(2026, 10, 21);
const DAY = 24 * 60 * 60 * 1000;

function memoryStorage(initial?: string): ConsentStorage {
  const values = new Map<string, string>();
  if (initial !== undefined) {
    values.set(CONSENT_STORAGE_KEY, initial);
  }
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

function storedChoice(choice: unknown, expiresAt: unknown) {
  return JSON.stringify({ choice, expiresAt });
}

describe("no choice", () => {
  it("loads nothing and prompts", () => {
    const storage = memoryStorage();
    expect(readConsentChoice(storage, NOW)).toBeNull();
    expect(shouldLoadAnalytics(storage, false, NOW)).toBe(false);
    expect(shouldPromptForConsent(storage, false, NOW)).toBe(true);
  });
});

describe("grant", () => {
  it("stores { choice, expiresAt } 180 days out and then loads without prompting", () => {
    const storage = memoryStorage();
    writeConsentChoice(storage, CONSENT_CHOICES.accepted, NOW);

    expect(JSON.parse(storage.getItem("grimicorn:analytics-consent")!)).toEqual(
      { choice: "accepted", expiresAt: NOW + 180 * DAY },
    );
    expect(CONSENT_LIFETIME_DAYS).toBe(180);
    expect(shouldLoadAnalytics(storage, false, NOW)).toBe(true);
    expect(shouldPromptForConsent(storage, false, NOW)).toBe(false);
  });
});

describe("deny", () => {
  it("loads nothing and does not prompt again", () => {
    const storage = memoryStorage();
    writeConsentChoice(storage, CONSENT_CHOICES.declined, NOW);

    expect(shouldLoadAnalytics(storage, false, NOW)).toBe(false);
    expect(shouldPromptForConsent(storage, false, NOW)).toBe(false);
  });
});

describe("withdraw", () => {
  it("an accept followed by a decline stops loading", () => {
    const storage = memoryStorage();
    writeConsentChoice(storage, CONSENT_CHOICES.accepted, NOW);
    writeConsentChoice(storage, CONSENT_CHOICES.declined, NOW + DAY);

    expect(shouldLoadAnalytics(storage, false, NOW + DAY)).toBe(false);
  });
});

describe("expired choice", () => {
  it("loads nothing and prompts again once expiresAt has passed", () => {
    const storage = memoryStorage();
    writeConsentChoice(storage, CONSENT_CHOICES.accepted, NOW);
    const later = NOW + 180 * DAY;

    expect(shouldLoadAnalytics(storage, false, later - 1)).toBe(true);
    expect(shouldLoadAnalytics(storage, false, later)).toBe(false);
    expect(shouldPromptForConsent(storage, false, later)).toBe(true);
  });
});

describe("malformed choice", () => {
  it.each([
    ["not JSON", "accepted"],
    ["an unknown choice", storedChoice("maybe", NOW + DAY)],
    ["a missing expiry", storedChoice("accepted", undefined)],
    ["a string expiry", storedChoice("accepted", String(NOW + DAY))],
    ["a JSON null", "null"],
  ])("loads nothing for %s", (_label, raw) => {
    const storage = memoryStorage(raw);
    expect(shouldLoadAnalytics(storage, false, NOW)).toBe(false);
    expect(shouldPromptForConsent(storage, false, NOW)).toBe(true);
  });
});

describe("privacy signal", () => {
  it("counts as declined: loads nothing and never prompts, even after an accept", () => {
    const storage = memoryStorage();
    writeConsentChoice(storage, CONSENT_CHOICES.accepted, NOW);

    expect(shouldLoadAnalytics(storage, true, NOW)).toBe(false);
    expect(shouldPromptForConsent(memoryStorage(), true, NOW)).toBe(false);
  });
});

describe("unavailable storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to a store that reads back null, so nothing loads and the banner prompts", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const storage = getConsentStorage();

    writeConsentChoice(storage, CONSENT_CHOICES.accepted, NOW);
    expect(storage.getItem(CONSENT_STORAGE_KEY)).toBeNull();
    expect(shouldLoadAnalytics(storage, false, NOW)).toBe(false);
    expect(shouldPromptForConsent(storage, false, NOW)).toBe(true);
  });

  it("does not throw when saving a choice fails", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing: ConsentStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };

    expect(() =>
      writeConsentChoice(failing, CONSENT_CHOICES.declined, NOW),
    ).not.toThrow();
  });
});
