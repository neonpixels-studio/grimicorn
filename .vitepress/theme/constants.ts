// Id shared by the skip-to-content link's target and the <main> landmark it
// jumps to, so the anchor href and the landmark id can never drift apart.
export const MAIN_CONTENT_ID = "main-content";

// The site's only external identity. Linked from the home page, the 404, and
// the JSON-LD sameAs; public/llms.txt is static, so config.test.ts asserts it
// carries the same URL.
export const GITHUB_PROFILE_URL = "https://github.com/grimicorn-agent";
