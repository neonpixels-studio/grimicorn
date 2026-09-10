import { test, expect, type Locator } from "@playwright/test";
import { MAIN_CONTENT_ID } from "../theme/constants";

// One real-browser smoke test for the skip-link reveal/focus behavior
// (SkipLink.vue + the `.skip-link:focus` rule in style.css). The happy-dom unit
// suite (SkipLink.test.ts) can assert the click handler moves focus but, with no
// real stylesheet loaded, can't see whether the link is actually `sr-only`-hidden
// until it receives real keyboard focus.

// Tailwind's sr-only clips the link to a 1x1px box rather than display:none, so
// Playwright's toBeVisible (which only checks for a non-empty box) would report
// it visible even while hidden from sighted users. Asserting the actual box size
// is what proves it starts — and, once focus moves away, ends up — clipped.
const HIDDEN_BOX_SIZE = { width: 1, height: 1 };
const TO_PASS_TIMEOUT_MS = 5_000;

// WebKit on macOS leaves links out of the Tab order by default (Safari exposes
// this as Settings > Advanced > "Press Tab to highlight each item on a webpage").
// Holding Option flips that setting for a single keypress, so Option+Tab reaches
// links while it's at its default, which is what Playwright's macOS WebKit
// always uses. Playwright's Linux WebKit build (what CI runs) Tab-focuses links
// by default, like Chromium and Firefox, so plain Tab is used everywhere else.
function linkTabKeyFor(browserName: string) {
  if (browserName === "webkit" && process.platform === "darwin") {
    return "Alt+Tab";
  }
  return "Tab";
}

// One evaluate() so the box and the outline come from a single snapshot — two
// separate reads (a boundingBox() call plus a getComputedStyle() round trip)
// could straddle a frame and pass on values that never held simultaneously.
// Throws rather than returning nulls/NaN: a missing layout box or a
// non-numeric outline-width are distinct, louder failures than "wrong size".
// Every caller reads this inside expect(...).toPass() (not expect.poll, which
// does not retry a thrown error) so a brief post-navigation layout wobble
// retries instead of flaking.
function readRevealState(locator: Locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const outlineStyle = getComputedStyle(element);
    const outlineWidth = parseFloat(outlineStyle.outlineWidth);
    if (Number.isNaN(outlineWidth)) {
      throw new Error(
        `Unrecognized outline-width: "${outlineStyle.outlineWidth}"`,
      );
    }
    return {
      width: rect.width,
      height: rect.height,
      outlineWidth,
      outlineHasStyle: outlineStyle.outlineStyle !== "none",
    };
  });
}

test("tabbing to the skip link reveals it, activating focuses main content, and it re-hides", async ({
  page,
  browserName,
}) => {
  await page.goto("/");

  const skipLink = page.getByRole("link", { name: "skip to content" });

  await expect(async () => {
    const state = await readRevealState(skipLink);
    expect(state).toEqual(expect.objectContaining(HIDDEN_BOX_SIZE));
  }).toPass({ timeout: TO_PASS_TIMEOUT_MS });

  // The skip link is the first element AppLayout.vue renders (before the nav
  // and page content), so a single Tab (or, on macOS WebKit, Option+Tab — see
  // linkTabKeyFor) from a fresh load lands on it.
  await page.keyboard.press(linkTabKeyFor(browserName));
  await expect(skipLink).toBeFocused();

  // `.skip-link:focus` overrides the `sr-only` clip with a real width/height
  // and a visible outline — this is what a regression to that rule would break.
  await expect(async () => {
    const state = await readRevealState(skipLink);
    expect(state.width).toBeGreaterThan(1);
    expect(state.height).toBeGreaterThan(1);
    expect(state.outlineHasStyle).toBe(true);
    expect(state.outlineWidth).toBeGreaterThan(0);
  }).toPass({ timeout: TO_PASS_TIMEOUT_MS });

  // VitePress's capture-phase anchor handler cancels the native fragment
  // navigation, so only the component's own click handler moves focus.
  // Pressing Enter on a focused link dispatches that same click event in a
  // real browser, exercising the exact activation path a keyboard user takes.
  // (Confirmed by temporarily removing the handler in SkipLink.vue: with it
  // gone, VitePress's interceptor still swallows the click and main content
  // never receives focus, so this assertion does depend on the component.)
  await page.keyboard.press("Enter");

  const mainContent = page.locator(`[id="${MAIN_CONTENT_ID}"]`);
  await expect(mainContent).toBeFocused();

  // Focus has moved off the skip link, so the reveal rule (which only matches
  // :focus) must have released it back to its clipped size — proving the
  // reveal is focus-gated in both directions, not a one-way class that gets
  // stuck on.
  await expect(async () => {
    const state = await readRevealState(skipLink);
    expect(state).toEqual(expect.objectContaining(HIDDEN_BOX_SIZE));
  }).toPass({ timeout: TO_PASS_TIMEOUT_MS });
});
