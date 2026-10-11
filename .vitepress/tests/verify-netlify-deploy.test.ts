import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  DEPLOY_OUTCOME,
  DeployVerificationError,
  classifyDeployState,
  fetchDeploy,
  findTriggeredDeploy,
  isMainModule,
  readConfig,
  verifyDeploy,
} from "../../scripts/verify-netlify-deploy.mjs";

const DEPLOY_ID = "deploy-123";
const SITE_ID = "site-1";
const TITLE = "Manual production deploy";
const TRIGGERED_AT = "2026-10-11T22:26:29Z";
const TARGET = { siteId: SITE_ID, title: TITLE, triggeredAt: TRIGGERED_AT };
const TOKEN = "token-abc";
const TIMEOUT_MS = 60_000;
const INTERVAL_MS = 10_000;

function buildHarness(states: Array<string | Error>) {
  let clock = 0;
  const queue = [...states];
  const fetchDeployImpl = vi.fn(async () => {
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    if (next instanceof Error) {
      throw next;
    }
    return { id: DEPLOY_ID, state: next, error_message: "boom" };
  });
  const sleep = vi.fn(async (milliseconds: number) => {
    clock += milliseconds;
  });
  const run = () =>
    verifyDeploy({
      target: TARGET,
      token: TOKEN,
      timeoutMs: TIMEOUT_MS,
      intervalMs: INTERVAL_MS,
      fetchDeployImpl,
      sleep,
      now: () => clock,
      log: () => {},
    });
  return { run, fetchDeployImpl, sleep };
}

describe("classifyDeployState", () => {
  it.each([
    ["ready", DEPLOY_OUTCOME.SUCCESS],
    ["error", DEPLOY_OUTCOME.FAILURE],
    ["cancelled", DEPLOY_OUTCOME.FAILURE],
    ["canceled", DEPLOY_OUTCOME.FAILURE],
    ["rejected", DEPLOY_OUTCOME.FAILURE],
    ["skipped", DEPLOY_OUTCOME.FAILURE],
    ["new", DEPLOY_OUTCOME.PENDING],
    ["enqueued", DEPLOY_OUTCOME.PENDING],
    ["building", DEPLOY_OUTCOME.PENDING],
    ["processing", DEPLOY_OUTCOME.PENDING],
  ])("%s is %s", (state, outcome) => {
    expect(classifyDeployState(state)).toBe(outcome);
  });
});

describe("verifyDeploy", () => {
  it("resolves once the deploy becomes ready, polling through pending states", async () => {
    const { run, fetchDeployImpl, sleep } = buildHarness([
      "enqueued",
      "building",
      "ready",
    ]);
    await expect(run()).resolves.toMatchObject({ state: "ready" });
    expect(fetchDeployImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(INTERVAL_MS);
  });

  it("fails with the Netlify error message when the build errors", async () => {
    const { run } = buildHarness(["building", "error"]);
    await expect(run()).rejects.toThrow(/state "error": boom/);
  });

  it("fails when the build is cancelled", async () => {
    const { run, fetchDeployImpl } = buildHarness(["cancelled"]);
    await expect(run()).rejects.toThrow(/state "cancelled"/);
    expect(fetchDeployImpl).toHaveBeenCalledTimes(1);
  });

  it("fails after the timeout when the deploy never finishes", async () => {
    const { run, fetchDeployImpl } = buildHarness(["building"]);
    await expect(run()).rejects.toThrow(/Timed out after 1 minutes.*building/);
    expect(fetchDeployImpl).toHaveBeenCalledTimes(TIMEOUT_MS / INTERVAL_MS + 1);
  });

  it("retries transient API errors and still succeeds", async () => {
    const { run } = buildHarness([new Error("HTTP 502"), "ready"]);
    await expect(run()).resolves.toMatchObject({ state: "ready" });
  });

  it("reports the last API error when it only ever sees errors", async () => {
    const { run } = buildHarness([new Error("HTTP 502")]);
    await expect(run()).rejects.toThrow(/Timed out.*HTTP 502/);
  });

  it("aborts immediately on an auth failure", async () => {
    const { run, fetchDeployImpl } = buildHarness([
      new DeployVerificationError("rejected NETLIFY_AUTH_TOKEN"),
    ]);
    await expect(run()).rejects.toThrow(/rejected NETLIFY_AUTH_TOKEN/);
    expect(fetchDeployImpl).toHaveBeenCalledTimes(1);
  });

  it("logs a transient API error before retrying", async () => {
    const { fetchDeployImpl, sleep } = buildHarness([
      new Error("HTTP 502"),
      "ready",
    ]);
    const log = vi.fn();
    await verifyDeploy({
      target: TARGET,
      token: TOKEN,
      timeoutMs: TIMEOUT_MS,
      intervalMs: INTERVAL_MS,
      fetchDeployImpl,
      sleep,
      now: () => 0,
      log,
    });
    expect(log).toHaveBeenCalledWith(
      "Netlify API error (will retry): HTTP 502",
    );
  });

  it("uses a timeout longer than the poll interval by default", () => {
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(DEFAULT_INTERVAL_MS);
  });
});

describe("findTriggeredDeploy", () => {
  function deploy(id: string, title: string, createdAt: string) {
    return { id, title, created_at: createdAt, state: "building" };
  }

  it("picks the newest deploy with the trigger title created after the trigger", () => {
    const deploys = [
      deploy("other", "Bump deps (#257)", "2026-10-11T22:27:00Z"),
      deploy("ours", TITLE, "2026-10-11T22:26:30.330Z"),
      deploy("earlier-manual", TITLE, "2026-10-04T10:00:00Z"),
    ];
    expect(findTriggeredDeploy(deploys, TARGET)?.id).toBe("ours");
  });

  it("tolerates a Netlify clock a little behind the runner's", () => {
    const deploys = [deploy("ours", TITLE, "2026-10-11T22:25:59Z")];
    expect(findTriggeredDeploy(deploys, TARGET)?.id).toBe("ours");
  });

  it("ignores an older deploy with the same title", () => {
    const deploys = [deploy("old", TITLE, "2026-10-11T22:20:00Z")];
    expect(findTriggeredDeploy(deploys, TARGET)).toBeUndefined();
  });
});

describe("fetchDeploy", () => {
  function response(status: number, body: unknown = []) {
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    } as Response;
  }

  function respondWith(...responses: Response[]) {
    const queue = [...responses];
    return vi.fn(async () => queue.shift()!);
  }

  it("lists the site's production deploys with a bearer token and returns the triggered one", async () => {
    const triggered = {
      id: DEPLOY_ID,
      title: TITLE,
      created_at: "2026-10-11T22:26:30.330Z",
      state: "ready",
    };
    const fetchImpl = respondWith(response(200, [triggered]));
    const deploy = await fetchDeploy({
      target: TARGET,
      token: TOKEN,
      fetchImpl,
    });
    expect(deploy).toEqual(triggered);
    const calls = fetchImpl.mock.calls as unknown as Array<
      [string, { headers: Record<string, string> }]
    >;
    expect(calls[0][0]).toBe(
      `https://api.netlify.com/api/v1/sites/${SITE_ID}/deploys?production=true&per_page=20`,
    );
    expect(calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("reports pending while Netlify hasn't listed the deploy yet", async () => {
    const deploy = await fetchDeploy({
      target: TARGET,
      token: TOKEN,
      fetchImpl: respondWith(response(200, [])),
    });
    expect(classifyDeployState(deploy.state)).toBe(DEPLOY_OUTCOME.PENDING);
  });

  it.each([401, 403, 404])(
    "throws a non-retryable error on HTTP %i",
    async (status) => {
      await expect(
        fetchDeploy({
          target: TARGET,
          token: TOKEN,
          fetchImpl: respondWith(response(status)),
        }),
      ).rejects.toBeInstanceOf(DeployVerificationError);
    },
  );

  it("throws a retryable plain error on other failures", async () => {
    const promise = fetchDeploy({
      target: TARGET,
      token: TOKEN,
      fetchImpl: respondWith(response(500)),
    });
    await expect(promise).rejects.toThrow(/HTTP 500/);
    await expect(promise).rejects.not.toBeInstanceOf(DeployVerificationError);
  });
});

describe("readConfig", () => {
  const ENVIRONMENT = {
    NETLIFY_AUTH_TOKEN: TOKEN,
    NETLIFY_SITE_ID: SITE_ID,
    NETLIFY_TRIGGER_TITLE: TITLE,
    NETLIFY_TRIGGERED_AT: TRIGGERED_AT,
  };

  it("returns the token and the deploy to look for", () => {
    expect(readConfig(ENVIRONMENT)).toEqual({ token: TOKEN, target: TARGET });
  });

  it.each([
    ["NETLIFY_AUTH_TOKEN", /set the NETLIFY_AUTH_TOKEN repository secret/],
    ["NETLIFY_SITE_ID", /set the NETLIFY_SITE_ID repository secret/],
    [
      "NETLIFY_TRIGGER_TITLE",
      /the trigger step did not output the trigger title/,
    ],
    ["NETLIFY_TRIGGERED_AT", /the trigger step did not output when/],
  ])("fails clearly when %s is missing", (name, hint) => {
    const environment: Record<string, string> = { ...ENVIRONMENT };
    delete environment[name];
    expect(() => readConfig(environment)).toThrow(
      new RegExp(`Missing ${name}: ${hint.source}`),
    );
  });
});

describe("isMainModule", () => {
  it("is false when imported from a test", () => {
    expect(isMainModule("/nonexistent/other.mjs")).toBe(false);
    expect(isMainModule(null as unknown as string)).toBe(false);
  });
});
