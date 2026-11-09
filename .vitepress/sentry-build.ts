import { sentryVitePlugin } from "@sentry/vite-plugin";

// Build-time half of Sentry error reporting (the browser half is
// theme/error-reporting.ts). Every value comes from .env.production through
// `dotenvx run`, so builds without it (dev, CI, Deploy Previews) get no ingest
// origin in the CSP and no source map upload.

type BuildEnvironment = Record<string, string | undefined>;
type ConfigEnvironment = { isSsrBuild?: boolean };

const REQUIRED_DSN_PROTOCOL = "https:";
const SECURITY_ENDPOINT_PATH = "security/";
// Tags CSP reports like the SDK tags its events; keep in step with
// SENTRY_ENVIRONMENT in theme/error-reporting.ts (not imported: that file pulls
// the browser SDK into the build config).
const CSP_REPORT_ENVIRONMENT = "production";
const UPLOAD_PROJECT_VARIABLES = ["SENTRY_ORG", "SENTRY_PROJECT"] as const;
// The client build's output. Hidden source maps are uploaded, then deleted so
// they never deploy.
export const SOURCE_MAP_FILES_GLOB = ".vitepress/dist/**/*.map";

// The origin the browser SDK posts events to, for the CSP's connect-src. Throws
// on anything but an https URL, which also catches dotenvx ciphertext
// ("encrypted:...") that slipped through without its private key.
export function readSentryIngestOrigin(dsn: string | undefined) {
  if (!dsn) {
    return null;
  }
  return parseHttpsDsn(dsn).origin;
}

function parseHttpsDsn(dsn: string) {
  const url = new URL(dsn);
  if (url.protocol !== REQUIRED_DSN_PROTOCOL) {
    throw new Error(
      `VITE_SENTRY_DSN must be an ${REQUIRED_DSN_PROTOCOL}// URL; got the ${url.protocol} scheme`,
    );
  }
  return url;
}

function splitDsnPath(url: URL) {
  const pathSegments = url.pathname.split("/").filter(Boolean);
  const projectId = pathSegments.pop();
  const pathPrefix = pathSegments.map((segment) => `/${segment}`).join("");
  return { pathPrefix, projectId };
}

function buildSecurityEndpointUrl(
  dsnUrl: URL,
  pathPrefix: string,
  projectId: string,
) {
  const endpoint = new URL(
    `${dsnUrl.origin}${pathPrefix}/api/${projectId}/${SECURITY_ENDPOINT_PATH}`,
  );
  endpoint.searchParams.set("sentry_key", decodeURIComponent(dsnUrl.username));
  endpoint.searchParams.set("sentry_environment", CSP_REPORT_ENVIRONMENT);
  return endpoint.toString();
}

// The Security Policy Reporting URL Sentry documents for CSP violation reports:
// https://<host>/api/<projectId>/security/?sentry_key=<publicKey>. Derived from the
// same DSN as the SDK, so no extra env var exists. Like readSentryIngestOrigin it
// throws on a malformed DSN (no public key or project id, or not https) rather than
// shipping a production CSP that silently reports nowhere.
export function readSentrySecurityEndpoint(dsn: string | undefined) {
  if (!dsn) {
    return null;
  }
  const url = parseHttpsDsn(dsn);
  const { pathPrefix, projectId } = splitDsnPath(url);
  if (!url.username || !projectId) {
    throw new Error(
      "VITE_SENTRY_DSN must carry a public key and a project id to build the CSP report endpoint",
    );
  }
  return buildSecurityEndpointUrl(url, pathPrefix, projectId);
}

export function shouldUploadSourceMaps(environment: BuildEnvironment) {
  return Boolean(environment.SENTRY_AUTH_TOKEN);
}

function assertUploadProjectIsSet(environment: BuildEnvironment) {
  const missing = UPLOAD_PROJECT_VARIABLES.filter((name) => !environment[name]);
  if (missing.length > 0) {
    throw new Error(
      `SENTRY_AUTH_TOKEN is set but ${missing.join(", ")} is not; source maps cannot be uploaded`,
    );
  }
}

// VitePress runs a client and an SSR build through the same plugin list. Only
// the client bundle reaches browsers, so only its maps are worth uploading.
function isClientBuild(_config: unknown, configEnvironment: ConfigEnvironment) {
  return !configEnvironment.isSsrBuild;
}

export function buildSentryVitePlugins(environment: BuildEnvironment) {
  if (!shouldUploadSourceMaps(environment)) {
    return [];
  }
  assertUploadProjectIsSet(environment);
  const plugins = sentryVitePlugin({
    authToken: environment.SENTRY_AUTH_TOKEN,
    org: environment.SENTRY_ORG,
    project: environment.SENTRY_PROJECT,
    telemetry: false,
    sourcemaps: { filesToDeleteAfterUpload: [SOURCE_MAP_FILES_GLOB] },
  });
  return plugins.map((plugin) => ({ ...plugin, apply: isClientBuild }));
}
