import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const NETLIFY_CONFIG_PATH = resolve(process.cwd(), "netlify.toml");
const BUILD_COMMAND_PATTERN = /^\s*command\s*=\s*"([^"]*)"/m;
const BUILD_SECTION_PATTERN = /^\[build\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m;
const COMMAND_SEPARATOR = "&&";

// The CI steps (.github/workflows/ci.yml) that must also gate a production deploy,
// in the order they must run: the build is last so nothing ships unless the rest pass.
const REQUIRED_BUILD_STEPS = [
  "npm run lint",
  "npm run typecheck",
  "npm run test:ci",
  "npm run build",
];

function readBuildSteps() {
  const config = readFileSync(NETLIFY_CONFIG_PATH, "utf8");
  const section = config.match(BUILD_SECTION_PATTERN)?.[1];
  const command = section?.match(BUILD_COMMAND_PATTERN)?.[1];
  if (!command) {
    throw new Error("netlify.toml [build] section has no command");
  }
  return command.split(COMMAND_SEPARATOR).map((step) => step.trim());
}

describe("netlify build command", () => {
  it("runs the CI gates, then the build, in order", () => {
    expect(readBuildSteps()).toEqual(REQUIRED_BUILD_STEPS);
  });

  it.each(REQUIRED_BUILD_STEPS)(
    "exposes %s as a runnable npm script",
    (step) => {
      const scriptName = step.replace(/^npm run /, "");
      const packageJson = JSON.parse(
        readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
      );
      expect(packageJson.scripts).toHaveProperty(scriptName);
    },
  );
});
