import { appendFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const NETLIFY_API_BASE_URL = "https://api.netlify.com/api/v1";
const REQUEST_TIMEOUT_MS = 30_000;
const DEPLOYS_PAGE_SIZE = 20;
const READY_STATE = "ready";
const PRODUCTION_CONTEXT = "production";
const AUTH_FAILURE_STATUSES = new Set([401, 403]);

export class LastDeployLookupError extends Error {}

// Netlify lists deploys newest first and includes failed and preview deploys, so
// the last successful production deploy is the first ready production entry.
export function findLastDeployedSha(deploys) {
  const lastReady = deploys.find(
    (deploy) =>
      deploy.state === READY_STATE &&
      deploy.context === PRODUCTION_CONTEXT &&
      deploy.commit_ref,
  );
  return lastReady ? lastReady.commit_ref : null;
}

export async function fetchLastDeployedSha({
  siteId,
  token,
  fetchImpl = fetch,
}) {
  const query = `production=true&per_page=${DEPLOYS_PAGE_SIZE}`;
  const response = await fetchImpl(
    `${NETLIFY_API_BASE_URL}/sites/${encodeURIComponent(siteId)}/deploys?${query}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (AUTH_FAILURE_STATUSES.has(response.status)) {
    throw new LastDeployLookupError(
      `Netlify API rejected NETLIFY_AUTH_TOKEN (HTTP ${response.status}).`,
    );
  }
  if (!response.ok) {
    throw new LastDeployLookupError(
      `Netlify API responded with HTTP ${response.status}.`,
    );
  }
  return findLastDeployedSha(await response.json());
}

// Returns whether to deploy and why. Every uncertain case deploys: a redundant
// deploy is cheap, a silently skipped one leaves a commit unshipped.
export async function decideDeploy({
  siteId,
  token,
  currentSha,
  fetchImpl = fetch,
  log = console.log,
}) {
  if (!siteId || !token) {
    log(
      "NETLIFY_SITE_ID or NETLIFY_AUTH_TOKEN is not set; cannot find the last deployed commit, so deploying.",
    );
    return { deploy: true };
  }
  let lastDeployedSha;
  try {
    lastDeployedSha = await fetchLastDeployedSha({ siteId, token, fetchImpl });
  } catch (error) {
    log(`Could not read the last deploy (${error.message}); deploying.`);
    return { deploy: true };
  }
  if (!lastDeployedSha) {
    log("No successful production deploy found; deploying.");
    return { deploy: true };
  }
  if (lastDeployedSha === currentSha) {
    log(`main (${currentSha}) is already live; skipping the deploy.`);
    return { deploy: false };
  }
  log(`Last deployed ${lastDeployedSha}, main is ${currentSha}; deploying.`);
  return { deploy: true };
}

export async function main(environment = process.env) {
  const { deploy } = await decideDeploy({
    siteId: environment.NETLIFY_SITE_ID,
    token: environment.NETLIFY_AUTH_TOKEN,
    currentSha: environment.CURRENT_SHA,
  });
  if (environment.GITHUB_OUTPUT) {
    appendFileSync(environment.GITHUB_OUTPUT, `skip=${!deploy}\n`);
  }
}

// Same shape as scripts/verify-netlify-deploy.mjs: import.meta.url is bound to the
// defining module, so the helper cannot be shared.
export function isMainModule(argv1 = process.argv[1]) {
  if (argv1 == null) {
    return false;
  }
  let resolvedPath;
  try {
    resolvedPath = realpathSync(argv1);
  } catch {
    resolvedPath = argv1;
  }
  return import.meta.url === pathToFileURL(resolvedPath).href;
}

if (isMainModule()) {
  await main();
}
