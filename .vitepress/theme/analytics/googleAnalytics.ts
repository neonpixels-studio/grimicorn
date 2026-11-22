// The only module that talks to Google Analytics (gtag.js). Whether to load it is
// decided in consent.ts; this file only knows how.
export const GA_SCRIPT_ELEMENT_ID = "grimicorn-ga-script";
const GA_LOADER_URL = "https://www.googletagmanager.com/gtag/js";

// GA4 writes `_ga` plus one `_ga_<container>` per property; other Google
// cookies (`_gads` and similar) are left alone.
const GA_COOKIE_NAME = "_ga";
const GA_PROPERTY_COOKIE_PREFIX = "_ga_";
const IP_HOST_PATTERN = /^\d+(\.\d+){3}$/;
const EPOCH_UTC = "Thu, 01 Jan 1970 00:00:00 GMT";

type GtagWindow = Window & {
  dataLayer?: unknown[];
  // eslint-disable-next-line no-unused-vars
  gtag?: (command: string, ...parameters: unknown[]) => void;
};

function analyticsWindow() {
  return window as unknown as GtagWindow & Record<string, unknown>;
}

function setDisableFlag(measurementId: string, disabled: boolean) {
  analyticsWindow()[`ga-disable-${measurementId}`] = disabled;
}

function injectGtagScript(measurementId: string) {
  const loader = document.createElement("script");
  loader.id = GA_SCRIPT_ELEMENT_ID;
  loader.async = true;
  loader.src = `${GA_LOADER_URL}?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(loader);
}

function bootstrapGtag(measurementId: string) {
  const target = analyticsWindow();
  const dataLayer = (target.dataLayer = target.dataLayer || []);
  target.gtag =
    target.gtag ||
    function gtag() {
      // gtag.js expects the raw `arguments` object, not a rest array.
      dataLayer.push(arguments);
    };
  target.gtag("js", new Date());
  target.gtag("config", measurementId);
}

// Idempotent: a repeat grant never adds a second script or `config` call.
export function loadGoogleAnalytics(measurementId: string) {
  setDisableFlag(measurementId, false);
  if (document.getElementById(GA_SCRIPT_ELEMENT_ID)) {
    analyticsWindow().gtag?.("config", measurementId);
    return;
  }
  injectGtagScript(measurementId);
  bootstrapGtag(measurementId);
}

// Google's documented opt-out switch. A script already loaded this page view
// cannot be unloaded, so this stops further hits from it.
export function disableGoogleAnalytics(measurementId: string) {
  setDisableFlag(measurementId, true);
}

export function cookieDomainCandidates(hostname: string): string[] {
  if (IP_HOST_PATTERN.test(hostname) || hostname.includes(":")) {
    return [];
  }
  const labels = hostname.replace(/\.$/, "").split(".");
  return labels
    .slice(0, -1)
    .map((_, index) => `.${labels.slice(index).join(".")}`);
}

function googleAnalyticsCookieNames() {
  return document.cookie
    .split(";")
    .map((pair) => pair.split("=")[0]?.trim() ?? "")
    .filter(
      (name) =>
        name === GA_COOKIE_NAME || name.startsWith(GA_PROPERTY_COOKIE_PREFIX),
    );
}

// GA sets its cookies on the registrable parent domain, so expire each name for
// the host and for every parent suffix.
function expireCookie(name: string) {
  const expiry = `${name}=; max-age=0; expires=${EPOCH_UTC}; path=/`;
  document.cookie = expiry;
  cookieDomainCandidates(location.hostname).forEach((domain) => {
    document.cookie = `${expiry}; domain=${domain}`;
  });
}

export function clearGoogleAnalyticsCookies() {
  googleAnalyticsCookieNames().forEach(expireCookie);
}
