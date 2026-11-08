import { describe, it, expect } from "vitest";
import {
  buildSentryVitePlugins,
  readSentryIngestOrigin,
  shouldUploadSourceMaps,
} from "../sentry-build";

const DSN = "https://publicKey@o123.ingest.us.sentry.io/456";
const INGEST_ORIGIN = "https://o123.ingest.us.sentry.io";
const UPLOAD_ENVIRONMENT = {
  SENTRY_AUTH_TOKEN: "sntrys_test",
  SENTRY_ORG: "example-org",
  SENTRY_PROJECT: "example-project",
};

type ApplyFunction = (
  _config: unknown,
  _configEnvironment: { isSsrBuild?: boolean },
) => boolean;

function applyFunctions() {
  return buildSentryVitePlugins(UPLOAD_ENVIRONMENT).map(
    (plugin) => plugin.apply as ApplyFunction,
  );
}

describe("readSentryIngestOrigin", () => {
  it("returns null when no DSN is set, so the CSP stays first-party", () => {
    expect(readSentryIngestOrigin(undefined)).toBeNull();
    expect(readSentryIngestOrigin("")).toBeNull();
  });

  it("returns the DSN's origin without the public key or project path", () => {
    expect(readSentryIngestOrigin(DSN)).toBe(INGEST_ORIGIN);
  });

  it("fails loud on dotenvx ciphertext that was never decrypted", () => {
    expect(() =>
      readSentryIngestOrigin("encrypted:BExampleCiphertext"),
    ).toThrow(/must be an https:\/\/ URL/);
  });

  it("rejects a non-https DSN", () => {
    expect(() =>
      readSentryIngestOrigin("http://publicKey@o123.ingest.sentry.io/456"),
    ).toThrow(/must be an https:\/\/ URL/);
  });
});

describe("shouldUploadSourceMaps", () => {
  it("is on only when an auth token is present", () => {
    expect(shouldUploadSourceMaps(UPLOAD_ENVIRONMENT)).toBe(true);
    expect(shouldUploadSourceMaps({})).toBe(false);
    expect(shouldUploadSourceMaps({ SENTRY_AUTH_TOKEN: "" })).toBe(false);
  });
});

describe("buildSentryVitePlugins", () => {
  it("adds no plugins without an auth token", () => {
    expect(buildSentryVitePlugins({})).toEqual([]);
  });

  it("fails loud when the token is set but the org or project is not", () => {
    expect(() =>
      buildSentryVitePlugins({ SENTRY_AUTH_TOKEN: "sntrys_test" }),
    ).toThrow(/SENTRY_ORG, SENTRY_PROJECT is not/);
    expect(() =>
      buildSentryVitePlugins({
        SENTRY_AUTH_TOKEN: "sntrys_test",
        SENTRY_ORG: "example-org",
      }),
    ).toThrow(/SENTRY_PROJECT is not/);
  });

  it("returns the upload plugins when fully configured", () => {
    const plugins = buildSentryVitePlugins(UPLOAD_ENVIRONMENT);
    expect(plugins.length).toBeGreaterThan(0);
    expect(plugins.map((plugin) => plugin.name)).toContain(
      "sentry-vite-plugin",
    );
  });

  it("applies every plugin to the client build only, never VitePress's SSR build", () => {
    for (const apply of applyFunctions()) {
      expect(apply({}, { isSsrBuild: false })).toBe(true);
      expect(apply({}, { isSsrBuild: true })).toBe(false);
    }
  });
});
