export const CONSENT_STORAGE_KEY = "grimicorn:analytics-consent";

export const CONSENT_LIFETIME_DAYS = 180;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export const CONSENT_CHOICES = {
  accepted: "accepted",
  declined: "declined",
} as const;

export type ConsentChoice =
  (typeof CONSENT_CHOICES)[keyof typeof CONSENT_CHOICES];

export type ConsentStorage = Pick<Storage, "getItem" | "setItem">;

const UNAVAILABLE_STORAGE: ConsentStorage = {
  getItem: () => null,
  setItem: () => {},
};

// Reading window.localStorage throws in Safari with "Block all cookies" and in
// some locked-down webviews. Fall back to a store that always reads back null so
// every caller fails closed: analytics stays off and the banner asks again.
export function getConsentStorage(): ConsentStorage {
  try {
    const probeKey = `${CONSENT_STORAGE_KEY}:probe`;
    window.localStorage.setItem(probeKey, probeKey);
    window.localStorage.removeItem(probeKey);
    return window.localStorage;
  } catch (error) {
    console.warn("Analytics consent storage is unavailable.", error);
    return UNAVAILABLE_STORAGE;
  }
}

function isConsentChoice(value: unknown): value is ConsentChoice {
  return (
    value === CONSENT_CHOICES.accepted || value === CONSENT_CHOICES.declined
  );
}

function parseStoredConsent(rawValue: string | null) {
  if (!rawValue) {
    return null;
  }
  try {
    return JSON.parse(rawValue) as { choice?: unknown; expiresAt?: unknown };
  } catch {
    return null;
  }
}

// Null for every unusable state (never answered, malformed, unknown choice, or
// expired), because each one is treated the same way: no consent, ask again.
export function readConsentChoice(
  storage: ConsentStorage,
  now: number = Date.now(),
): ConsentChoice | null {
  const stored = parseStoredConsent(storage.getItem(CONSENT_STORAGE_KEY));
  if (!stored || !isConsentChoice(stored.choice)) {
    return null;
  }
  if (typeof stored.expiresAt !== "number" || stored.expiresAt <= now) {
    return null;
  }
  return stored.choice;
}

export function writeConsentChoice(
  storage: ConsentStorage,
  choice: ConsentChoice,
  now: number = Date.now(),
) {
  const expiresAt = now + CONSENT_LIFETIME_DAYS * MILLISECONDS_PER_DAY;
  try {
    storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ choice, expiresAt }));
  } catch (error) {
    console.warn("Analytics consent choice could not be saved.", error);
  }
}

// A privacy signal counts as a declined choice, so it never reaches storage.
export function shouldLoadAnalytics(
  storage: ConsentStorage,
  privacySignalPresent: boolean,
  now: number = Date.now(),
) {
  if (privacySignalPresent) {
    return false;
  }
  return readConsentChoice(storage, now) === CONSENT_CHOICES.accepted;
}

export function shouldPromptForConsent(
  storage: ConsentStorage,
  privacySignalPresent: boolean,
  now: number = Date.now(),
) {
  if (privacySignalPresent) {
    return false;
  }
  return readConsentChoice(storage, now) === null;
}
