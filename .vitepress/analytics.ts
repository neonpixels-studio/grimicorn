// Builds the inline GA4 bootstrap. One script instead of a static loader tag plus a
// config tag, because the opt-out check has to run in the visitor's browser: the
// page is static HTML, so the build can't know who is opted out. When the browser
// sends Global Privacy Control or Do Not Track, the script returns before the gtag
// loader is injected or dataLayer is created, so nothing is fetched or fired.
//
// The loader is injected dynamically from googletagmanager.com, which script-src
// already allows by origin; the inline script itself is hashed into the CSP at
// build time like every other inline script (see headers.ts).
const GA_LOADER_URL = "https://www.googletagmanager.com/gtag/js";

// navigator.doNotTrack is "1" when set; older Safari exposes it on window and
// legacy IE/Edge on navigator.msDoNotTrack. GPC is a boolean.
const OPT_OUT_CHECK =
  'navigator.globalPrivacyControl===true||navigator.doNotTrack==="1"||window.doNotTrack==="1"||navigator.msDoNotTrack==="1"';

const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]+$/;

export function buildGaBootstrapScript(measurementId: string): string {
  if (!MEASUREMENT_ID_PATTERN.test(measurementId)) {
    throw new Error(`Invalid GA4 measurement ID: ${measurementId}`);
  }
  const loaderUrl = JSON.stringify(
    `${GA_LOADER_URL}?id=${encodeURIComponent(measurementId)}`,
  );
  const configId = JSON.stringify(measurementId);
  return [
    "(function(){",
    `if(${OPT_OUT_CHECK}){return;}`,
    "window.dataLayer=window.dataLayer||[];",
    "function gtag(){window.dataLayer.push(arguments);}",
    "window.gtag=gtag;",
    "var loader=document.createElement('script');",
    "loader.async=true;",
    `loader.src=${loaderUrl};`,
    "document.head.appendChild(loader);",
    "gtag('js',new Date());",
    `gtag('config',${configId});`,
    "})();",
  ].join("\n");
}
