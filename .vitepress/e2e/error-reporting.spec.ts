import { test, expect } from "@playwright/test";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// `npm run test:e2e` runs a plain `vitepress build`, the same build CI and
// Deploy Previews ship. Sentry's DSN lives only in .env.production, so this
// build must carry neither the SDK chunk nor any traffic to Sentry. A regression
// here means non-production visitors are being reported to the production
// Sentry project.

const CHUNKS_DIR = resolve(process.cwd(), ".vitepress/dist/assets/chunks");
// The dynamic import in theme/index.ts emits this chunk only when a DSN is set.
const ERROR_REPORTING_CHUNK_PREFIX = "error-reporting.";
const SENTRY_HOST_PATTERN = /(^|\.)sentry\.io$/;

test("the plain build emits no error reporting chunk", () => {
  const chunks = readdirSync(CHUNKS_DIR);
  expect(chunks.length).toBeGreaterThan(0);
  expect(
    chunks.filter((name) => name.startsWith(ERROR_REPORTING_CHUNK_PREFIX)),
  ).toEqual([]);
});

test("the plain build neither loads the SDK nor contacts Sentry", async ({
  page,
}) => {
  const requestedUrls: string[] = [];
  page.on("request", (request) => requestedUrls.push(request.url()));
  await page.goto("/", { waitUntil: "networkidle" });
  expect(requestedUrls.length).toBeGreaterThan(0);
  const sentryRequests = requestedUrls.filter(
    (url) =>
      url.includes(ERROR_REPORTING_CHUNK_PREFIX) ||
      SENTRY_HOST_PATTERN.test(new URL(url).hostname),
  );
  expect(sentryRequests).toEqual([]);
});
