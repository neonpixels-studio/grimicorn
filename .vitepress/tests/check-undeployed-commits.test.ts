import { describe, it, expect, vi } from "vitest";
import {
  LastDeployLookupError,
  decideDeploy,
  fetchLastDeployedSha,
  findLastDeployedSha,
  isMainModule,
  main,
} from "../../scripts/check-undeployed-commits.mjs";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SITE_ID = "site-1";
const TOKEN = "token-abc";
const LIVE_SHA = "aaa111";
const NEW_SHA = "bbb222";

function deploy(
  state: string,
  commitRef: string | null,
  context = "production",
) {
  return { state, commit_ref: commitRef, context };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("findLastDeployedSha", () => {
  it("returns the newest ready production deploy, skipping failures", () => {
    const deploys = [
      deploy("error", "ccc333"),
      deploy("ready", LIVE_SHA),
      deploy("ready", "old000"),
    ];
    expect(findLastDeployedSha(deploys)).toBe(LIVE_SHA);
  });

  it("ignores non-production and commit-less deploys", () => {
    const deploys = [
      deploy("ready", "preview1", "deploy-preview"),
      deploy("ready", null),
    ];
    expect(findLastDeployedSha(deploys)).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(findLastDeployedSha([])).toBeNull();
  });
});

describe("fetchLastDeployedSha", () => {
  it("requests production deploys for the site with the bearer token", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([deploy("ready", LIVE_SHA)]),
    );
    const sha = await fetchLastDeployedSha({
      siteId: SITE_ID,
      token: TOKEN,
      fetchImpl,
    });
    expect(sha).toBe(LIVE_SHA);
    const [url, options] = fetchImpl.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toContain(`/sites/${SITE_ID}/deploys?production=true`);
    expect(options.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("throws a lookup error on auth failure", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 401));
    await expect(
      fetchLastDeployedSha({ siteId: SITE_ID, token: TOKEN, fetchImpl }),
    ).rejects.toThrow(LastDeployLookupError);
  });

  it("throws a lookup error on other HTTP failures", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    await expect(
      fetchLastDeployedSha({ siteId: SITE_ID, token: TOKEN, fetchImpl }),
    ).rejects.toThrow("HTTP 500");
  });
});

describe("decideDeploy", () => {
  const log = vi.fn();
  const decide = (
    fetchImpl: typeof fetch,
    overrides: Record<string, unknown> = {},
  ) =>
    decideDeploy({
      siteId: SITE_ID,
      token: TOKEN,
      currentSha: NEW_SHA,
      fetchImpl,
      log,
      ...overrides,
    });

  it("skips when main is already the live commit", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([deploy("ready", NEW_SHA)]),
    );
    expect(await decide(fetchImpl)).toEqual({ deploy: false });
  });

  it("deploys when main is ahead of the live commit, however old the commit", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([deploy("ready", LIVE_SHA)]),
    );
    expect(await decide(fetchImpl)).toEqual({ deploy: true });
  });

  it("deploys when the most recent deploy failed but main is not live", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([deploy("error", NEW_SHA), deploy("ready", LIVE_SHA)]),
    );
    expect(await decide(fetchImpl)).toEqual({ deploy: true });
  });

  it("deploys when there is no prior successful deploy", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]));
    expect(await decide(fetchImpl)).toEqual({ deploy: true });
  });

  it("deploys when the API errors", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    expect(await decide(fetchImpl)).toEqual({ deploy: true });
  });

  it("deploys when the network call rejects", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    expect(await decide(fetchImpl)).toEqual({ deploy: true });
  });

  it("deploys without calling the API when config is missing", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await decide(fetchImpl, { siteId: undefined })).toEqual({
      deploy: true,
    });
    expect(await decide(fetchImpl, { token: "" })).toEqual({ deploy: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("main", () => {
  it("writes skip=false to GITHUB_OUTPUT when config is missing", async () => {
    const outputPath = join(mkdtempSync(join(tmpdir(), "deploy-")), "output");
    writeFileSync(outputPath, "");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main({ GITHUB_OUTPUT: outputPath, CURRENT_SHA: NEW_SHA });
    logSpy.mockRestore();
    expect(readFileSync(outputPath, "utf8")).toBe("skip=false\n");
  });
});

describe("isMainModule", () => {
  it("is false when imported", () => {
    expect(isMainModule(undefined)).toBe(false);
    expect(isMainModule("/nonexistent/other.mjs")).toBe(false);
  });
});
