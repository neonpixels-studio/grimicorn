import { ref } from "vue";
import { hasPrivacyOptOut } from "../../privacy-opt-out";
import {
  CONSENT_CHOICES,
  getConsentStorage,
  shouldLoadAnalytics,
  shouldPromptForConsent,
  writeConsentChoice,
  type ConsentStorage,
} from "./consent";
import {
  clearGoogleAnalyticsCookies,
  disableGoogleAnalytics,
  loadGoogleAnalytics,
} from "./googleAnalytics";

// Empty on every build except the production deploy (see config.ts), which
// leaves analytics, the banner, and the footer link out entirely.
const MEASUREMENT_ID: string = import.meta.env.VITE_GA_MEASUREMENT_ID ?? "";

// Both start false so the server render and first client render match; they are
// set once, after mount.
export const analyticsAvailable = ref(false);
export const bannerOpen = ref(false);
// Bumped each time a visitor asks to change their choice, so the banner takes
// focus even when it is already open.
export const reopenRequests = ref(0);
// Live binding: read through the module namespace, never copied.
export let reopenTrigger: Element | null = null;

let storage: ConsentStorage | null = null;

function consentStorage() {
  storage = storage ?? getConsentStorage();
  return storage;
}

// Called once from the root layout's onMounted.
export function initAnalyticsConsent() {
  const privacySignalPresent = hasPrivacyOptOut();
  analyticsAvailable.value = Boolean(MEASUREMENT_ID) && !privacySignalPresent;
  if (privacySignalPresent) {
    clearGoogleAnalyticsCookies();
  }
  if (!analyticsAvailable.value) {
    return;
  }
  if (shouldLoadAnalytics(consentStorage(), privacySignalPresent)) {
    loadGoogleAnalytics(MEASUREMENT_ID);
  }
  bannerOpen.value = shouldPromptForConsent(
    consentStorage(),
    privacySignalPresent,
  );
}

export function acceptAnalytics() {
  writeConsentChoice(consentStorage(), CONSENT_CHOICES.accepted);
  loadGoogleAnalytics(MEASUREMENT_ID);
  bannerOpen.value = false;
}

export function declineAnalytics() {
  writeConsentChoice(consentStorage(), CONSENT_CHOICES.declined);
  disableGoogleAnalytics(MEASUREMENT_ID);
  clearGoogleAnalyticsCookies();
  bannerOpen.value = false;
}

// `trigger` is the control that was used; focus returns to it once the banner
// closes. Passed explicitly because Safari does not focus buttons on click.
export function reopenAnalyticsChoice(trigger: Element | null) {
  reopenTrigger = trigger;
  bannerOpen.value = true;
  reopenRequests.value += 1;
}

export function clearReopenTrigger() {
  reopenTrigger = null;
}
