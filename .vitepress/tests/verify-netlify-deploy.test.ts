import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  DEPLOY_OUTCOME,
  DeployVerificationError,
  classifyDeployState,
  fetchDeploy,
  isMainModule,
  readConfig,
  verifyDeploy,
} from "../../scripts/verify-netlify-deploy.mjs";

const BUILD_ID = "deploy-123";
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
    return { id: BUILD_ID, state: next, error_message: "boom" };
  });
  const sleep = vi.fn(async (milliseconds: number) => {
    clock += milliseconds;
  });
  const run = () =>
    verifyDeploy({
      buildId: BUILD_ID,
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
      buildId: BUILD_ID,
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

describe("fetchDeploy", () => {
  function response(status: number, body: unknown = {}) {
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

  it("follows the build to its deploy using a bearer token", async () => {
    const fetchImpl = respondWith(
      response(200, { deploy_id: "d1" }),
      response(200, { state: "ready" }),
    );
    const deploy = await fetchDeploy({
      buildId: BUILD_ID,
      token: TOKEN,
      fetchImpl,
    });
    expect(deploy).toEqual({ state: "ready" });
    const calls = fetchImpl.mock.calls as unknown as Array<
      [string, { headers: Record<string, string> }]
    >;
    expect(calls[0][0]).toBe(
      `https://api.netlify.com/api/v1/builds/${BUILD_ID}`,
    );
    expect(calls[1][0]).toBe("https://api.netlify.com/api/v1/deploys/d1");
    expect(calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("reports a build error as a failed deploy", async () => {
    const deploy = await fetchDeploy({
      buildId: BUILD_ID,
      token: TOKEN,
      fetchImpl: respondWith(
        response(200, { error: "Build script returned non-zero exit code" }),
      ),
    });
    expect(deploy).toMatchObject({
      state: "error",
      error_message: "Build script returned non-zero exit code",
    });
  });

  it("reports a build with no deploy yet as pending", async () => {
    const deploy = await fetchDeploy({
      buildId: BUILD_ID,
      token: TOKEN,
      fetchImpl: respondWith(response(200, {})),
    });
    expect(classifyDeployState(deploy.state)).toBe(DEPLOY_OUTCOME.PENDING);
  });

  it.each([401, 403, 404])(
    "throws a non-retryable error on HTTP %i",
    async (status) => {
      await expect(
        fetchDeploy({
          buildId: BUILD_ID,
          token: TOKEN,
          fetchImpl: respondWith(response(status)),
        }),
      ).rejects.toBeInstanceOf(DeployVerificationError);
    },
  );

  it("throws a retryable plain error on other failures", async () => {
    const promise = fetchDeploy({
      buildId: BUILD_ID,
      token: TOKEN,
      fetchImpl: respondWith(response(500)),
    });
    await expect(promise).rejects.toThrow(/HTTP 500/);
    await expect(promise).rejects.not.toBeInstanceOf(DeployVerificationError);
  });
});

describe("readConfig", () => {
  it("returns the token and build id", () => {
    expect(
      readConfig({ NETLIFY_AUTH_TOKEN: TOKEN, NETLIFY_BUILD_ID: BUILD_ID }),
    ).toEqual({ token: TOKEN, buildId: BUILD_ID });
  });

  it("fails clearly when the token secret is missing", () => {
    expect(() => readConfig({ NETLIFY_BUILD_ID: BUILD_ID })).toThrow(
      /Missing NETLIFY_AUTH_TOKEN: set the NETLIFY_AUTH_TOKEN repository secret/,
    );
  });

  it("fails clearly when the build id is missing", () => {
    expect(() => readConfig({ NETLIFY_AUTH_TOKEN: TOKEN })).toThrow(
      /Missing NETLIFY_BUILD_ID: the trigger step/,
    );
  });
});

describe("isMainModule", () => {
  it("is false when imported from a test", () => {
    expect(isMainModule("/nonexistent/other.mjs")).toBe(false);
    expect(isMainModule(null as unknown as string)).toBe(false);
  });
});
