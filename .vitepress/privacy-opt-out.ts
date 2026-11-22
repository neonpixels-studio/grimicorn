// The browser privacy signals that opt a visitor out of analytics and error
// reporting. Single source of truth for the theme, which checks at runtime before
// offering analytics consent or loading Sentry.
//
// navigator.doNotTrack is "1" when set; older Safari exposes it on window and
// legacy IE/Edge on navigator.msDoNotTrack. GPC is a boolean.
const OPT_OUT_SIGNALS = [
  { source: "navigator", property: "globalPrivacyControl", value: true },
  { source: "navigator", property: "doNotTrack", value: "1" },
  { source: "window", property: "doNotTrack", value: "1" },
  { source: "navigator", property: "msDoNotTrack", value: "1" },
] as const;

type SignalSource = (typeof OPT_OUT_SIGNALS)[number]["source"];

export type BrowserGlobals = Partial<
  Record<SignalSource, Record<string, unknown>>
>;

function currentBrowserGlobals(): BrowserGlobals {
  return {
    navigator: globalThis.navigator as unknown as Record<string, unknown>,
    window: globalThis.window as unknown as Record<string, unknown>,
  };
}

export function hasPrivacyOptOut(
  browserGlobals: BrowserGlobals = currentBrowserGlobals(),
): boolean {
  return OPT_OUT_SIGNALS.some(
    ({ source, property, value }) =>
      browserGlobals[source]?.[property] === value,
  );
}
