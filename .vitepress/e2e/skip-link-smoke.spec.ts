import { test, expect } from "@playwright/test";

// One real-browser smoke test for the skip-link reveal/focus behavior
// (SkipLink.vue + the `.skip-link:focus` rule in style.css). The happy-dom unit
// suite (SkipLink.test.ts) mounts the component in isolation with no stylesheet,
// so it can assert the click handler moves focus but can't see whether the link
// is actually `sr-only`-hidden until it receives real keyboard focus — that's a
// CSS cascade fact only a real browser layout engine can confirm.

// Mirrors MAIN_CONTENT_ID in .vitepress/theme/constants.ts: the landmark id both
// the skip link's href and the <main> element bind to.
const MAIN_CONTENT_ID = "main-content";

test("tabbing to the skip link reveals it, and activating it focuses main content", async ({
  page,
}) => {
  await page.goto("/");

  const skipLink = page.getByRole("link", { name: "skip to content" });

  // Tailwind's sr-only clips the link to a 1x1px box rather than
  // display:none, so Playwright's toBeVisible (which only checks for a
  // non-empty box) would report it visible even while hidden from sighted
  // users. Asserting the actual box size is what proves it starts clipped.
  const hiddenBox = await skipLink.boundingBox();
  expect(hiddenBox?.width).toBeLessThanOrEqual(1);
  expect(hiddenBox?.height).toBeLessThanOrEqual(1);

  // The skip link is the first element AppLayout.vue renders (before the nav
  // and page content), so a single Tab from a fresh load lands on it.
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();

  // `.skip-link:focus` overrides the `sr-only` clip with a real width/height,
  // so the reveal only shows up as a real, hit-testable box once focus
  // lands — this is the assertion a regression to that rule (or a lost focus
  // outline) would break.
  const revealedBox = await skipLink.boundingBox();
  expect(revealedBox?.width).toBeGreaterThan(1);
  expect(revealedBox?.height).toBeGreaterThan(1);

  // VitePress's capture-phase anchor handler cancels the native fragment
  // navigation, so only the component's own click handler moves focus.
  // Pressing Enter on a focused link dispatches that same click event in a
  // real browser, exercising the exact activation path a keyboard user takes.
  await page.keyboard.press("Enter");

  const mainContent = page.locator(`#${MAIN_CONTENT_ID}`);
  await expect(mainContent).toBeFocused();
});
