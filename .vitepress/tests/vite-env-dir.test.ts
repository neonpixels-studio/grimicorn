import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import config from "../config";

const REPO_ROOT = process.cwd();
// Vite loads .env, .env.local, .env.<mode> and .env.<mode>.local from envDir.
const VITE_ENV_FILE_PATTERN = /^\.env(\.|$)/;

function resolvedEnvDir() {
  const envDir = config.vite?.envDir;
  if (typeof envDir !== "string") {
    throw new Error("config.vite.envDir must be set to a directory path");
  }
  return resolve(REPO_ROOT, envDir);
}

// The repo root holds dotenvx-encrypted .env files. If Vite read them, a build
// without the private key (CI, Deploy Previews) would bake ciphertext into
// import.meta.env.
describe("vite envDir", () => {
  it("points away from the repo root's encrypted .env files", () => {
    expect(resolvedEnvDir()).not.toBe(REPO_ROOT);
  });

  it("points at an existing directory with no .env files for Vite to load", () => {
    const envDir = resolvedEnvDir();
    expect(statSync(envDir).isDirectory()).toBe(true);
    const envFiles = readdirSync(envDir).filter((name) =>
      VITE_ENV_FILE_PATTERN.test(name),
    );
    expect(envFiles).toEqual([]);
  });
});
