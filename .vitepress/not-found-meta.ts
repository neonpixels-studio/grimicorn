// Shared by config.ts (build-time title/description hooks, see
// transformHead/transformHtml) and AppLayout.vue (client-side override on
// hydration and navigation). VitePress's client-side head updater
// (useUpdateHead) unconditionally resets document.title and the description
// meta tag from its own internal notFoundPageData fallback ("404 | <site>" /
// "Not Found") on every hydration and client-side route change — including
// onto and off of the 404 — the instant JS runs, which would otherwise
// silently undo the build-time fix. Keeping one copy of these constants
// means the build-time and client-side overrides can't drift apart.
export const NOT_FOUND_PAGE_ID = "404.md";
export const NOT_FOUND_TITLE = "404 – Page Not Found | Grimicorn";
export const NOT_FOUND_DESCRIPTION =
  "This page doesn't exist — a gremlin broke it, renamed it, or it was never here. Head back to the Grimicorn homepage.";
