// Id shared by the skip-to-content link's target and the <main> landmark it
// jumps to, so the anchor href and the landmark id can never drift apart.
export const MAIN_CONTENT_ID = "main-content";

// The site's only external identity. Linked from the home page, the 404, and
// the JSON-LD sameAs; public/llms.txt is static, so config.test.ts asserts it
// carries the same URL.
export const GITHUB_PROFILE_URL = "https://github.com/grimicorn-agent";

// The open-source orchestrator Grimicorn runs on, linked from the home page's
// "build your own" section and public/llms.txt (config.test.ts asserts the
// latter stays in sync).
export const AGENTS_REPO_URL = "https://github.com/neonpixels-studio/agents";

// The privacy page's route and the frontmatter `layout` value privacy.md sets so
// AppLayout renders PrivacyPage for it. Shared by the footer link, AppLayout, and
// config.ts (which derives the page's canonical URL from the same path).
export const PRIVACY_PAGE_PATH = "/privacy";
export const PRIVACY_LAYOUT = "privacy";
