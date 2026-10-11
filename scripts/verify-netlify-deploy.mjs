import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";

const NETLIFY_API_BASE_URL = "https://api.netlify.com/api/v1";
const REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
export const DEFAULT_INTERVAL_MS = 15 * 1000;

export const DEPLOY_OUTCOME = {
  SUCCESS: "success",
  FAILURE: "failure",
  PENDING: "pending",
};

const SUCCESS_STATES = new Set(["ready"]);
// A skipped deploy means Netlify's ignore command cancelled the build, which a
// hook-triggered production build must never hit.
const FAILURE_STATES = new Set([
  "error",
  "cancelled",
  "canceled",
  "rejected",
  "skipped",
]);
const AUTH_FAILURE_STATUSES = new Set([401, 403]);
const NOT_FOUND_STATUS = 404;

export class DeployVerificationError extends Error {}

export function classifyDeployState(state) {
  if (SUCCESS_STATES.has(state)) {
    return DEPLOY_OUTCOME.SUCCESS;
  }
  if (FAILURE_STATES.has(state)) {
    return DEPLOY_OUTCOME.FAILURE;
  }
  return DEPLOY_OUTCOME.PENDING;
}

// Netlify lists deploys newest first; a page this size covers every deploy a
// single run could have created, previews included.
const DEPLOYS_PAGE_SIZE = 20;
// GitHub's runner clock and Netlify's can disagree by a few seconds, so a
// deploy created slightly "before" the trigger time still counts.
const CLOCK_SKEW_MS = 2 * 60 * 1000;

async function getJson({ path, token, fetchImpl }) {
  const response = await fetchImpl(`${NETLIFY_API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (AUTH_FAILURE_STATUSES.has(response.status)) {
    throw new DeployVerificationError(
      `Netlify API rejected NETLIFY_AUTH_TOKEN (HTTP ${response.status}); check the token is valid and can read this site.`,
    );
  }
  if (response.status === NOT_FOUND_STATUS) {
    throw new DeployVerificationError(
      `Netlify API returned 404 for ${path}; check NETLIFY_SITE_ID names this site.`,
    );
  }
  if (!response.ok) {
    throw new Error(`Netlify API responded with HTTP ${response.status}`);
  }
  return response.json();
}

// The hook started the newest production deploy carrying its trigger title
// that was created after the trigger fired.
export function findTriggeredDeploy(deploys, { title, triggeredAt }) {
  const earliest = Date.parse(triggeredAt) - CLOCK_SKEW_MS;
  return deploys.find(
    (deploy) =>
      deploy.title === title && Date.parse(deploy.created_at) >= earliest,
  );
}

// A build hook answers with an empty body, not a build id, so each poll
// finds the deploy the hook started in the site's production deploys. Until
// Netlify lists it, the deploy is reported as pending.
export async function fetchDeploy({ target, token, fetchImpl = fetch }) {
  const query = `production=true&per_page=${DEPLOYS_PAGE_SIZE}`;
  const deploys = await getJson({
    path: `/sites/${encodeURIComponent(target.siteId)}/deploys?${query}`,
    token,
    fetchImpl,
  });
  const deploy = findTriggeredDeploy(deploys, target);
  return deploy ?? { id: `"${target.title}"`, state: "new" };
}

function describeFailure(deploy) {
  const detail = deploy.error_message ? `: ${deploy.error_message}` : "";
  return `Netlify production deploy ${deploy.id} ended in state "${deploy.state}"${detail}. See ${deploy.admin_url ?? "the Netlify deploys page"}.`;
}

async function pollOnce({ target, token, fetchDeployImpl }) {
  try {
    return { deploy: await fetchDeployImpl({ target, token }) };
  } catch (error) {
    if (error instanceof DeployVerificationError) {
      throw error;
    }
    return { error };
  }
}

// Returns the deploy once it is live, throws when it failed, null while pending.
function settleDeploy(deploy, log) {
  log(`Deploy ${deploy.id}: ${deploy.state}`);
  const outcome = classifyDeployState(deploy.state);
  if (outcome === DEPLOY_OUTCOME.FAILURE) {
    throw new DeployVerificationError(describeFailure(deploy));
  }
  return outcome === DEPLOY_OUTCOME.SUCCESS ? deploy : null;
}

// Transient API errors are retried until the timeout so one blip does not fail a
// healthy deploy; auth and not-found errors are not transient and abort immediately.
// The deadline check runs after a poll, so one last poll always happens at the end.
export async function verifyDeploy({
  target,
  token,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  fetchDeployImpl = fetchDeploy,
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = Date.now,
  log = console.log,
}) {
  const deadline = now() + timeoutMs;
  let lastObservation;
  while (true) {
    const { deploy, error } = await pollOnce({
      target,
      token,
      fetchDeployImpl,
    });
    if (error) {
      log(`Netlify API error (will retry): ${error.message}`);
      lastObservation = error.message;
    } else {
      lastObservation = `state "${deploy.state}"`;
      const settled = settleDeploy(deploy, log);
      if (settled) {
        return settled;
      }
    }
    if (now() >= deadline) {
      break;
    }
    await sleep(intervalMs);
  }
  throw new DeployVerificationError(
    `Timed out after ${Math.round(timeoutMs / 60000)} minutes waiting for the Netlify deploy "${target.title}"; last observed ${lastObservation}.`,
  );
}

const MISSING_CONFIG_HINTS = {
  NETLIFY_AUTH_TOKEN:
    "set the NETLIFY_AUTH_TOKEN repository secret (a Netlify personal access token) so the workflow can confirm the production build succeeded",
  NETLIFY_SITE_ID:
    "set the NETLIFY_SITE_ID repository secret (Site configuration > Site details > Site ID) so the workflow can find the triggered deploy",
  NETLIFY_TRIGGER_TITLE:
    "the trigger step did not output the trigger title it sent to the build hook",
  NETLIFY_TRIGGERED_AT:
    "the trigger step did not output when it called the build hook",
};

export function readConfig(environment = process.env) {
  const missing = Object.keys(MISSING_CONFIG_HINTS).filter(
    (name) => !environment[name],
  );
  if (missing.length > 0) {
    const hints = missing.map(
      (name) => `${name}: ${MISSING_CONFIG_HINTS[name]}`,
    );
    throw new DeployVerificationError(`Missing ${hints.join("; ")}.`);
  }
  return {
    token: environment.NETLIFY_AUTH_TOKEN,
    target: {
      siteId: environment.NETLIFY_SITE_ID,
      title: environment.NETLIFY_TRIGGER_TITLE,
      triggeredAt: environment.NETLIFY_TRIGGERED_AT,
    },
  };
}

export async function main(environment = process.env) {
  const { token, target } = readConfig(environment);
  const deploy = await verifyDeploy({ token, target });
  console.log(`Netlify production deploy ${deploy.id} is live.`);
}

// Same shape as scripts/check-asset-version-bump.mjs: import.meta.url is bound to
// the defining module, so the helper cannot be shared.
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
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`::error::${message}`);
    process.exit(1);
  }
}
