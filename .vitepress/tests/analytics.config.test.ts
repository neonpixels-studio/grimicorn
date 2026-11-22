import { afterEach, describe, it, expect, vi } from "vitest";

const DEFINE_KEY = "import.meta.env.VITE_GA_MEASUREMENT_ID";

async function loadDefine(context: string) {
  vi.stubEnv("CONTEXT", context);
  vi.resetModules();
  const { default: config } = await import("../config");
  return config.vite?.define?.[DEFINE_KEY];
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("GA in the VitePress config", () => {
  it("exposes the measurement ID to the client on the production deploy only", async () => {
    expect(await loadDefine("production")).toBe(JSON.stringify("G-0R2LBBYFB7"));
    expect(await loadDefine("deploy-preview")).toBe('""');
    expect(await loadDefine("")).toBe('""');
  });

  it("never puts a GA script or loader in the page head", async () => {
    vi.stubEnv("CONTEXT", "production");
    vi.resetModules();
    const { default: config } = await import("../config");
    const scripts = (config.head ?? []).filter(([tag]) => tag === "script");

    expect(scripts).toEqual([]);
  });
});
