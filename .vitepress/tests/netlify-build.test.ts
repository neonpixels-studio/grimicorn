import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const NETLIFY_CONFIG_PATH = resolve(process.cwd(), "netlify.toml");
const PACKAGE_JSON_PATH = resolve(process.cwd(), "package.json");

// Accepts TOML basic ("...") and literal ('...') strings.
const BUILD_COMMAND_PATTERN = /^\s*command\s*=\s*(["'])(.*?)\1\s*$/m;
const BUILD_SECTION_HEADER = "[build]";
const PRODUCTION_SECTION_HEADER = "[context.production]";
const COMMAND_SEPARATOR = "&&";
const NPM_RUN_PREFIX = /^npm run /;

const BUILD_STEP = "npm run build";
// Production swaps only the final step, to decrypt .env.production via dotenvx.
const PRODUCTION_BUILD_STEP = "npm run build:production";

function sectionPattern(header: string) {
  const escapedHeader = header.replace(/[.[\]]/g, "\\$&");
  return new RegExp(
    `^${escapedHeader}\\s*$([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`,
    "m",
  );
}

function readSectionSteps(header: string) {
  const config = readFileSync(NETLIFY_CONFIG_PATH, "utf8");
  const section = config.match(sectionPattern(header))?.[1];
  const command = section?.match(BUILD_COMMAND_PATTERN)?.[2];
  if (!command) {
    throw new Error(
      `netlify.toml ${header} command is missing or not a simple quoted string`,
    );
  }
  return command.split(COMMAND_SEPARATOR).map((step) => step.trim());
}

function readBuildSteps() {
  return readSectionSteps(BUILD_SECTION_HEADER);
}

function readProductionSteps() {
  return readSectionSteps(PRODUCTION_SECTION_HEADER);
}

function readPackageScripts() {
  return JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")).scripts;
}

describe("netlify build command", () => {
  it("runs only the build for previews and branch deploys", () => {
    expect(readBuildSteps()).toEqual([BUILD_STEP]);
  });

  it("runs only the production build in production", () => {
    expect(readProductionSteps()).toEqual([PRODUCTION_BUILD_STEP]);
  });

  it("decrypts .env.production strictly in the production build script", () => {
    const script = readPackageScripts()["build:production"];
    expect(script).toContain("dotenvx run --strict");
    expect(script).toContain(".env.production");
  });

  it("only runs steps that are defined npm scripts", () => {
    const scripts = readPackageScripts();
    for (const step of [...readBuildSteps(), ...readProductionSteps()]) {
      expect(step).toMatch(NPM_RUN_PREFIX);
      expect(scripts).toHaveProperty([step.replace(NPM_RUN_PREFIX, "")]);
    }
  });
});
