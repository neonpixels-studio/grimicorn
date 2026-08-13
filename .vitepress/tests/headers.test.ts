import { describe, it, expect } from "vitest";

import {
  buildContentSecurityPolicy,
  buildHeadersFile,
  collectScriptHashes,
  extractInlineScriptHashes,
  hashInlineScript,
} from "../headers";

// A real VitePress inline bootstrap script; its CSP hash is pinned so a change to
// the hashing (encoding, algorithm, trimming) fails loud rather than shipping a
// policy no browser will honor. Verified against `openssl dgst -sha256 | base64`.
const CHECK_MAC_OS_SCRIPT =
  'document.documentElement.classList.toggle("mac",/Mac|iPhone|iPod|iPad/i.test(navigator.platform));';
const CHECK_MAC_OS_HASH =
  "'sha256-La1r0VSk0Po4KFI0duEKhmPu+u0I416JW3oONqtdf4M='";

const BOOTSTRAP_SCRIPT = "console.log(1)";
const SITE_DATA_SCRIPT = "window.__VP_SITE_DATA__={};";

// Mirrors the shape VitePress renders: an external module script (covered by
// 'self'), a JSON-LD data block (exempt from script-src), and two executable
// inline scripts that need hashes.
const FIXTURE_HTML = `
<script type="module" src="/assets/app.js"></script>
<script type="application/ld+json">{"@type":"WebSite"}</script>
<script id="bootstrap">${BOOTSTRAP_SCRIPT}</script>
<script>${SITE_DATA_SCRIPT}</script>
`;

function parseDirectives(policy: string) {
  const directives = new Map<string, string[]>();
  for (const directive of policy.split(";")) {
    const [name, ...sources] = directive.trim().split(/\s+/);
    if (name) {
      directives.set(name, sources);
    }
  }
  return directives;
}

// Every directive the generated policy is allowed to carry; a new or removed one
// must be reviewed (a widening directive like script-src-elem would otherwise
// slip past the named checks below).
const EXPECTED_DIRECTIVES = [
  "default-src",
  "script-src",
  "style-src",
  "font-src",
  "img-src",
  "connect-src",
  "object-src",
  "base-uri",
  "frame-ancestors",
  "form-action",
];

describe("hashInlineScript", () => {
  it("produces the browser's sha256 CSP source for a script's exact bytes", () => {
    expect(hashInlineScript(CHECK_MAC_OS_SCRIPT)).toBe(CHECK_MAC_OS_HASH);
  });

  it("hashes UTF-8 content so multi-byte characters change the digest", () => {
    expect(hashInlineScript("x—y")).not.toBe(hashInlineScript("x-y"));
  });
});

describe("extractInlineScriptHashes", () => {
  it("hashes only executable inline scripts, skipping src'd and data blocks", () => {
    expect(extractInlineScriptHashes(FIXTURE_HTML)).toEqual([
      hashInlineScript(BOOTSTRAP_SCRIPT),
      hashInlineScript(SITE_DATA_SCRIPT),
    ]);
  });

  it("returns nothing when every script is external or a data block", () => {
    const html = `<script src="/a.js"></script><script type="application/ld+json">{}</script>`;
    expect(extractInlineScriptHashes(html)).toEqual([]);
  });
});

describe("collectScriptHashes", () => {
  it("dedupes shared bootstrap scripts across pages and sorts the result", () => {
    const pageOne = `<script>${BOOTSTRAP_SCRIPT}</script><script>${SITE_DATA_SCRIPT}</script>`;
    const pageTwo = `<script>${BOOTSTRAP_SCRIPT}</script>`;
    const expected = [
      hashInlineScript(BOOTSTRAP_SCRIPT),
      hashInlineScript(SITE_DATA_SCRIPT),
    ].sort();
    expect(collectScriptHashes([pageOne, pageTwo])).toEqual(expected);
  });
});

describe("buildContentSecurityPolicy", () => {
  const hashes = [hashInlineScript(BOOTSTRAP_SCRIPT)];
  const directives = parseDirectives(buildContentSecurityPolicy(hashes));

  it("declares no directives beyond the reviewed set", () => {
    expect([...directives.keys()].sort()).toEqual(
      [...EXPECTED_DIRECTIVES].sort(),
    );
  });

  it("allow-lists the inline scripts by hash and drops 'unsafe-inline'", () => {
    const scriptSrc = directives.get("script-src");
    expect(scriptSrc).toEqual(["'self'", ...hashes]);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("keeps inline style attributes and the Google Fonts origins allowed", () => {
    expect(directives.get("style-src")).toEqual([
      "'self'",
      "'unsafe-inline'",
      "https://fonts.googleapis.com",
    ]);
    expect(directives.get("font-src")).toEqual([
      "'self'",
      "https://fonts.gstatic.com",
    ]);
  });

  it("keeps images and network requests same-origin", () => {
    expect(directives.get("img-src")).toEqual(["'self'", "data:"]);
    expect(directives.get("connect-src")).toEqual(["'self'"]);
    expect(directives.get("default-src")).toEqual(["'self'"]);
  });

  it("locks down framing, plugins, base URI, and form submissions", () => {
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'self'"]);
    expect(directives.get("form-action")).toEqual(["'self'"]);
  });
});

describe("buildHeadersFile", () => {
  it("emits a Netlify global rule with the policy on an indented line", () => {
    const file = buildHeadersFile("default-src 'self'");
    expect(file).toBe("/*\n  Content-Security-Policy: default-src 'self'\n");
  });
});
