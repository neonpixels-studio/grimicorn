import { test, expect, type Locator } from "@playwright/test";
import { MAIN_CONTENT_ID } from "../theme/constants";

// One real-browser smoke test for the skip-link reveal/focus behavior
// (SkipLink.vue + the `.skip-link:focus` rule in style.css). The happy-dom unit
// suite (SkipLink.test.ts) mounts the component in isolation with no stylesheet,
// so it can assert the click handler moves focus but can't see whether the link
// is actually `sr-only`-hidden until it receives real keyboard focus — that's a
// CSS cascade fact only a real browser layout engine can confirm.

// Tailwind's sr-only clips the link to a 1x1px box rather than display:none, so
// Playwright's toBeVisible (which only checks for a non-empty box) would report
// it visible even while hidden from sighted users. Asserting the actual box size
// is what proves it starts — and, once focus moves away, ends up — clipped.
const HIDDEN_BOX_SIZE = { width: 1, height: 1 };

// Reads the link's rendered box size, wrapped in expect.poll by every caller so a
// brief post-navigation layout wobble retries instead of flaking. Throws rather
// than returning a nullable box: an element with no layout box at all is a
// distinct, louder failure than "wrong size" and shouldn't be silently coerced
// into a passing or confusingly-worded numeric assertion.
async function readBoxSize(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Expected the skip link to have a layout box");
  }
  return { width: box.width, height: box.height };
}

function readOutlineWidth(locator: Locator) {
  return locator.evaluate((element) =>
    parseFloat(getComputedStyle(element).outlineWidth),
  );
}

test("tabbing to the skip link reveals it, activating focuses main content, and it re-hides", async ({
  page,
}) => {
  await page.goto("/");

  const skipLink = page.getByRole("link", { name: "skip to content" });

  await expect.poll(() => readBoxSize(skipLink)).toMatchObject(HIDDEN_BOX_SIZE);

  // The skip link is the first element AppLayout.vue renders (before the nav
  // and page content), so a single Tab from a fresh load lands on it.
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();

  // `.skip-link:focus` overrides the `sr-only` clip with a real width/height
  // and a visible outline, so the reveal only shows up as a real, hit-testable
  // box with a focus ring once focus lands — this is what a regression to
  // that rule would break.
  await expect
    .poll(async () => (await readBoxSize(skipLink)).width)
    .toBeGreaterThan(1);
  await expect
    .poll(async () => (await readBoxSize(skipLink)).height)
    .toBeGreaterThan(1);
  await expect.poll(() => readOutlineWidth(skipLink)).toBeGreaterThan(0);

  // VitePress's capture-phase anchor handler cancels the native fragment
  // navigation, so only the component's own click handler moves focus.
  // Pressing Enter on a focused link dispatches that same click event in a
  // real browser, exercising the exact activation path a keyboard user takes.
  await page.keyboard.press("Enter");

  // Verified by temporarily gutting SkipLink.vue's click handler: VitePress's
  // capture-phase link interceptor prevents the native fragment navigation
  // unconditionally (it does not fall back to focusing the target itself), so
  // this assertion already fails if the component's own focus() call is
  // removed — it isn't satisfiable by native browser behavior alone.
  const mainContent = page.locator(`#${MAIN_CONTENT_ID}`);
  await expect(mainContent).toBeFocused();

  // Focus has moved off the skip link onto the main landmark, so the reveal
  // rule (which only matches :focus) must have released it back to its
  // clipped size — proving the reveal is focus-gated in both directions, not
  // a one-way class that gets stuck on.
  await expect.poll(() => readBoxSize(skipLink)).toMatchObject(HIDDEN_BOX_SIZE);
});
