import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shallowMount, type VueWrapper } from "@vue/test-utils";
import GrimicornPage from "@components/GrimicornPage.vue";

// Matches any absolute URL (has a scheme, e.g. "https:", "mailto:") or a
// protocol-relative URL ("//host/..."). Matching by scheme presence rather
// than hardcoding http(s) means a mailto:/tel:/ftp: link is correctly
// treated as external instead of silently falling into "internal".
const EXTERNAL_HREF_PATTERN = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

function isExternalHref(href: string) {
  return EXTERNAL_HREF_PATTERN.test(href);
}

const FIXED_TIME = new Date("2026-01-01T00:00:00.000Z");

type GrimicornWrapper = VueWrapper<InstanceType<typeof GrimicornPage>>;

const KONAMI_SEQUENCE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

const RAVE_FILTER = "saturate(1.7) contrast(1.08)";
const RAVE_RAINBOW_DURATION = "1.8s";
const RAVE_GLOW_DURATION = "1s";
const DEFAULT_FILTER = "none";
const DEFAULT_RAINBOW_DURATION = "7s";
const DEFAULT_GLOW_DURATION = "3.5s";
const RAVE_ON_TOAST_MESSAGE = "🦄 RAVE MODE — dark, dead, AND lively";
const RAVE_OFF_TOAST_MESSAGE = "rave mode off — back to merely dark";

function pressKey(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
}

async function pressSequence(wrapper: GrimicornWrapper, keys: string[]) {
  keys.forEach(pressKey);
  await wrapper.vm.$nextTick();
}

function getPageFilter(wrapper: GrimicornWrapper) {
  return wrapper.element.style.filter;
}

function getRainbowDuration(wrapper: GrimicornWrapper) {
  return wrapper.element.style.getPropertyValue("--gx-rainbow-dur");
}

function getGlowDuration(wrapper: GrimicornWrapper) {
  return wrapper.element.style.getPropertyValue("--gx-glow-dur");
}

function findToast(wrapper: GrimicornWrapper) {
  return wrapper
    .findAll(".fixed")
    .find((element) =>
      element.classes().some((className) => className.includes("rounded-full")),
    );
}

// Two `.colorful-btn` toggles now share the page (rave + content pause), so
// each lookup targets its button explicitly rather than relying on document
// order: the rave toggle by its "colorful" label, the pause toggle by its
// distinguishing class. Throwing on a miss (matching findHeadingByText below)
// keeps a broken selector failing loudly at the call site instead of silently
// no-opping through `?.`.
function findRaveButton(wrapper: GrimicornWrapper) {
  const button = wrapper
    .findAll(".colorful-btn")
    .find((candidate) => candidate.text() === "colorful");
  if (!button) {
    throw new Error('No .colorful-btn with text "colorful" was found');
  }
  return button;
}

function findPauseButton(wrapper: GrimicornWrapper) {
  return wrapper.find(".pause-toggle");
}

function getTagline(wrapper: GrimicornWrapper) {
  return wrapper.find(".text-fg-muted span:last-child").text();
}

function getLogCount(wrapper: GrimicornWrapper) {
  return wrapper.findAll(".border-l-2 div").length;
}

const REDUCED_MOTION_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";
const TAGLINE_ROTATION_INTERVAL_MS = 2800;
const LOG_APPEND_INTERVAL_MS = 2000;
const INITIAL_LOG_COUNT = 6;
const MAX_LOG_COUNT = 8;

type ReducedMotionChangeListener = (_event: { matches: boolean }) => void;
type AnimationFrameCallback = (_time: number) => void;

// Drives the component's requestAnimationFrame loop by hand instead of
// relying on vitest's fake-timer rAF shim: this repo's other tests combine
// vi.useFakeTimers() with vi.setSystemTime() across multiple `it` blocks,
// and that combination is known to stop the shimmed rAF from ever firing on
// the second and later tests in a file. Replacing requestAnimationFrame /
// cancelAnimationFrame with a manual queue sidesteps that entirely and lets
// each test step the loop exactly one frame at a time.
function mockAnimationFrame() {
  let nextFrameId = 0;
  const queuedCallbacks = new Map<number, AnimationFrameCallback>();

  const requestAnimationFrameSpy = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback) => {
      nextFrameId += 1;
      queuedCallbacks.set(nextFrameId, callback);
      return nextFrameId;
    });

  const cancelAnimationFrameSpy = vi
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation((frameId) => {
      queuedCallbacks.delete(frameId);
    });

  function runNextFrame() {
    const [frameId] = queuedCallbacks.keys();
    if (frameId === undefined) {
      return;
    }
    const callback = queuedCallbacks.get(frameId);
    queuedCallbacks.delete(frameId);
    callback?.(0);
  }

  return { runNextFrame, requestAnimationFrameSpy, cancelAnimationFrameSpy };
}

// Spies on window.addEventListener/removeEventListener without replacing
// their implementation, so real listener registration (and dispatchMouseMove
// delivery) keeps working while tests assert on it by identity. Asserting
// via observed transforms or the rAF spy alone isn't enough: those signals
// are driven by the rAF loop, not the mousemove listener itself, so a bug
// that wires mousemove up in the wrong place could still leave those
// assertions green.
function mockWindowEventListeners() {
  const addEventListenerSpy = vi.spyOn(window, "addEventListener");
  const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

  function findRegisteredListener(eventName: string) {
    const matchingCall = addEventListenerSpy.mock.calls.find(
      ([registeredEventName]) => registeredEventName === eventName,
    );
    return matchingCall?.[1];
  }

  return {
    findRegisteredListener,
    addEventListenerSpy,
    removeEventListenerSpy,
  };
}

// A minimal MediaQueryList stand-in so tests can drive
// `prefers-reduced-motion` deterministically: set its initial value, then
// flip it at runtime via setMatches() to simulate the visitor toggling the
// OS setting while the page is open.
function mockPrefersReducedMotion(initialMatches: boolean) {
  const changeListeners = new Set<ReducedMotionChangeListener>();
  const mediaQueryList = {
    matches: initialMatches,
    media: REDUCED_MOTION_MEDIA_QUERY,
    addEventListener: vi.fn(
      (eventName: string, listener: ReducedMotionChangeListener) => {
        if (eventName === "change") {
          changeListeners.add(listener);
        }
      },
    ),
    removeEventListener: vi.fn(
      (eventName: string, listener: ReducedMotionChangeListener) => {
        if (eventName === "change") {
          changeListeners.delete(listener);
        }
      },
    ),
  };

  // Asserts on the query string too, not just a blanket mockReturnValue:
  // otherwise a typo'd or inverted query in the component (e.g.
  // "no-preference" instead of "reduce") would still pass every test here.
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
    expect(query).toBe(REDUCED_MOTION_MEDIA_QUERY);
    return mediaQueryList as unknown as MediaQueryList;
  });

  function setMatches(matches: boolean) {
    mediaQueryList.matches = matches;
    changeListeners.forEach((listener) => listener({ matches }));
  }

  return { mediaQueryList, setMatches };
}

function dispatchMouseMove(clientX: number, clientY: number) {
  window.dispatchEvent(new MouseEvent("mousemove", { clientX, clientY }));
}

function getHeroTransform(wrapper: GrimicornWrapper) {
  return wrapper.get<HTMLImageElement>(
    'img[alt="Grimicorn — skeletal rainbow unicorn"]',
  ).element.style.transform;
}

function getPortraitTransform(wrapper: GrimicornWrapper) {
  return wrapper.get<HTMLImageElement>('img[alt="Grimicorn portrait"]').element
    .style.transform;
}

function parseTranslateXPixels(transform: string) {
  const match = transform.match(/translate\(([-\d.]+)px/);
  return match ? Number(match[1]) : NaN;
}

// The constant overzoom scale (see HERO_PARALLAX/PORTRAIT_PARALLAX in the
// component) that both images should rest at whenever no cursor-linked
// translate/rotate is being applied — whether that's because reduced motion
// is preferred, or because the pointer sits dead center.
const HERO_REST_TRANSFORM = "scale(1.06)";
const PORTRAIT_REST_TRANSFORM = "scale(1.08)";

// Locates the heading at `tag` whose text includes `text`, throwing (rather
// than returning undefined) if none matches so callers can use the result
// directly and a missing heading fails loudly at the call site.
function findHeadingByText(
  wrapper: GrimicornWrapper,
  tag: string,
  text: string,
) {
  const heading = wrapper
    .findAll(tag)
    .find((candidate) => candidate.text().includes(text));
  if (!heading) {
    throw new Error(`No <${tag}> containing "${text}" was found`);
  }
  return heading;
}

// The accessible name of a heading: the concatenated text of its direct child
// nodes, skipping any element marked aria-hidden (so decorative ornaments like
// "—" or "~ %" are excluded, matching how assistive tech computes the name).
function accessibleName(element: Element) {
  return Array.from(element.childNodes)
    .filter(
      (node) =>
        node.nodeType !== Node.ELEMENT_NODE ||
        (node as Element).getAttribute("aria-hidden") !== "true",
    )
    .map((node) => node.textContent ?? "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

describe("GrimicornPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TIME);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders correctly", async () => {
    const wrapper = shallowMount(GrimicornPage);
    await wrapper.vm.$nextTick();
    expect(wrapper.html()).toMatchSnapshot();
    wrapper.unmount();
  });

  it("shows the first tagline on initial render", async () => {
    const wrapper = shallowMount(GrimicornPage);
    await wrapper.vm.$nextTick();
    const taglineEl = wrapper.find(".text-fg-muted span:last-child");
    expect(taglineEl.exists()).toBe(true);
    expect(taglineEl.text()).toBeTruthy();
    wrapper.unmount();
  });

  it("cycles to a different tagline after 2800ms", async () => {
    const wrapper = shallowMount(GrimicornPage);
    await wrapper.vm.$nextTick();
    const initial = wrapper.find(".text-fg-muted span:last-child").text();

    await vi.advanceTimersByTimeAsync(TAGLINE_ROTATION_INTERVAL_MS);
    await wrapper.vm.$nextTick();

    const updated = wrapper.find(".text-fg-muted span:last-child").text();
    expect(updated).not.toBe(initial);
    wrapper.unmount();
  });

  it("populates the log stream on mount", async () => {
    const wrapper = shallowMount(GrimicornPage);
    await wrapper.vm.$nextTick();
    const entries = wrapper.findAll(".border-l-2 div");
    expect(entries.length).toBe(INITIAL_LOG_COUNT);
    wrapper.unmount();
  });

  it("appends a log entry after 2000ms", async () => {
    const wrapper = shallowMount(GrimicornPage);
    await wrapper.vm.$nextTick();
    const countBefore = wrapper.findAll(".border-l-2 div").length;

    await vi.advanceTimersByTimeAsync(LOG_APPEND_INTERVAL_MS);
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll(".border-l-2 div").length).toBe(countBefore + 1);
    wrapper.unmount();
  });

  it("toast is hidden on initial render", async () => {
    const wrapper = shallowMount(GrimicornPage);
    await wrapper.vm.$nextTick();
    const toast = wrapper
      .findAll(".fixed")
      .find((el) => el.classes().some((c) => c.includes("rounded-full")));
    expect(toast?.classes()).toContain("opacity-0");
    wrapper.unmount();
  });

  it("opens every external link rendered in this template safely in a new tab", async () => {
    const wrapper = shallowMount(GrimicornPage);
    await wrapper.vm.$nextTick();
    const allLinks = wrapper.findAll("a[href]");
    const externalLinks = allLinks.filter((link) =>
      isExternalHref(link.attributes("href") ?? ""),
    );
    const internalLinks = allLinks.filter(
      (link) => !isExternalHref(link.attributes("href") ?? ""),
    );
    // Pinned to the two known github links (hero CTA + sidebar link) so
    // deleting one silently drops out of coverage instead of still passing.
    expect(externalLinks).toHaveLength(2);
    expect(internalLinks.length).toBeGreaterThan(0);
    externalLinks.forEach((externalLink) => {
      expect(externalLink.attributes("target")).toBe("_blank");
      const relTokens = (externalLink.attributes("rel") ?? "").split(/\s+/);
      expect(relTokens).toContain("noopener");
      expect(relTokens).toContain("noreferrer");
    });
    internalLinks.forEach((internalLink) => {
      expect(internalLink.attributes("target")).toBeUndefined();
    });
    wrapper.unmount();
  });

  it("toggles rave mode and applies its CSS-variable and toast side effects when the full Konami sequence is entered", async () => {
    const wrapper = shallowMount(GrimicornPage);
    await wrapper.vm.$nextTick();

    await pressSequence(wrapper, KONAMI_SEQUENCE);

    expect(getPageFilter(wrapper)).toBe(RAVE_FILTER);
    expect(getRainbowDuration(wrapper)).toBe(RAVE_RAINBOW_DURATION);
    expect(getGlowDuration(wrapper)).toBe(RAVE_GLOW_DURATION);

    const toast = findToast(wrapper);
    expect(toast?.classes()).toContain("opacity-100");
    expect(toast?.text()).toBe(RAVE_ON_TOAST_MESSAGE);
    expect(findRaveButton(wrapper).attributes("aria-pressed")).toBe("true");

    wrapper.unmount();
  });

  it("completes the sequence when the b/a keys arrive uppercase", async () => {
    const wrapper = shallowMount(GrimicornPage);
    await wrapper.vm.$nextTick();

    const uppercaseTail = [...KONAMI_SEQUENCE.slice(0, -2), "B", "A"];
    await pressSequence(wrapper, uppercaseTail);

    expect(getPageFilter(wrapper)).toBe(RAVE_FILTER);

    wrapper.unmount();
  });

  it("does not toggle rave mode on a partial Konami sequence", async () => {
    const wrapper = shallowMount(GrimicornPage);
    await wrapper.vm.$nextTick();

    await pressSequence(wrapper, KONAMI_SEQUENCE.slice(0, -1));

    expect(getPageFilter(wrapper)).toBe(DEFAULT_FILTER);
    expect(findToast(wrapper)?.classes()).toContain("opacity-0");

    wrapper.unmount();
  });

  it("does not toggle rave mode when the sequence contains a wrong key", async () => {
    const wrapper = shallowMount(GrimicornPage);
    await wrapper.vm.$nextTick();

    const wrongSequence = [...KONAMI_SEQUENCE.slice(0, -1), "z"];
    await pressSequence(wrapper, wrongSequence);

    expect(getPageFilter(wrapper)).toBe(DEFAULT_FILTER);
    expect(findToast(wrapper)?.classes()).toContain("opacity-0");

    wrapper.unmount();
  });

  it("resets the match position on a wrong key, requiring the full sequence again", async () => {
    const wrapper = shallowMount(GrimicornPage);
    await wrapper.vm.$nextTick();

    await pressSequence(wrapper, [...KONAMI_SEQUENCE.slice(0, 4), "x"]);
    expect(getPageFilter(wrapper)).toBe(DEFAULT_FILTER);

    await pressSequence(wrapper, KONAMI_SEQUENCE.slice(4));
    expect(getPageFilter(wrapper)).toBe(DEFAULT_FILTER);

    await pressSequence(wrapper, KONAMI_SEQUENCE);
    expect(getPageFilter(wrapper)).toBe(RAVE_FILTER);

    wrapper.unmount();
  });

  it("restarts the match at position 1 when the wrong key matches the sequence's first key", async () => {
    const wrapper = shallowMount(GrimicornPage);
    await wrapper.vm.$nextTick();

    // "ArrowUp", "ArrowUp", "ArrowUp" — the third press is wrong (position 2
    // expects "ArrowDown"), but since it equals KONAMI_SEQUENCE[0] the match
    // position should restart at 1, not 0.
    await pressSequence(wrapper, ["ArrowUp", "ArrowUp", "ArrowUp"]);
    expect(getPageFilter(wrapper)).toBe(DEFAULT_FILTER);

    await pressSequence(wrapper, KONAMI_SEQUENCE.slice(1));
    expect(getPageFilter(wrapper)).toBe(RAVE_FILTER);

    wrapper.unmount();
  });

  it("toggleRave applies rave CSS variables and toast, and reverts them on a second toggle", async () => {
    const wrapper = shallowMount(GrimicornPage);
    await wrapper.vm.$nextTick();

    const colorfulButton = findRaveButton(wrapper);
    expect(colorfulButton.exists()).toBe(true);

    await colorfulButton.trigger("click");

    expect(getPageFilter(wrapper)).toBe(RAVE_FILTER);
    expect(getRainbowDuration(wrapper)).toBe(RAVE_RAINBOW_DURATION);
    expect(getGlowDuration(wrapper)).toBe(RAVE_GLOW_DURATION);
    expect(findToast(wrapper)?.text()).toBe(RAVE_ON_TOAST_MESSAGE);

    await colorfulButton.trigger("click");

    expect(getPageFilter(wrapper)).toBe(DEFAULT_FILTER);
    expect(getRainbowDuration(wrapper)).toBe(DEFAULT_RAINBOW_DURATION);
    expect(getGlowDuration(wrapper)).toBe(DEFAULT_GLOW_DURATION);
    expect(findToast(wrapper)?.text()).toBe(RAVE_OFF_TOAST_MESSAGE);

    wrapper.unmount();
  });

  it("exposes aria-pressed on the colorful button reflecting rave mode state", async () => {
    const wrapper = shallowMount(GrimicornPage);
    await wrapper.vm.$nextTick();

    const colorfulButton = findRaveButton(wrapper);
    expect(colorfulButton.attributes("aria-pressed")).toBe("false");

    await colorfulButton.trigger("click");
    expect(colorfulButton.attributes("aria-pressed")).toBe("true");

    await colorfulButton.trigger("click");
    expect(colorfulButton.attributes("aria-pressed")).toBe("false");

    wrapper.unmount();
  });

  describe("semantic heading structure", () => {
    // The section label / wordmark text that must be exposed as a real heading
    // at the given level, so a regression back to a styled <div> fails here.
    const SECTION_HEADINGS = [
      { tag: "h2", text: "what it's doing right now" },
      { tag: "h3", text: "grimicorn links --all" },
    ];

    it("exposes exactly one h1 carrying the whole wordmark as a single readable name", async () => {
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      const level1Headings = wrapper.findAll("h1");
      expect(level1Headings).toHaveLength(1);

      // Both wordmark lines live as distinct spans inside the single h1 (not
      // split across separate heading levels).
      const wordmarkLines = level1Headings[0]
        .findAll("span")
        .map((line) => line.text());
      expect(wordmarkLines).toEqual(["GRIMICORN", "AGENT"]);

      // A real separator keeps the two lines from reading as one run-together
      // token for find-in-page, copy, and assistive tech.
      expect(level1Headings[0].text().replace(/\s+/g, " ")).toBe(
        "GRIMICORN AGENT",
      );

      wrapper.unmount();
    });

    it.each(SECTION_HEADINGS)(
      "renders the $text label as a semantic $tag, not a styled div",
      async ({ tag, text }) => {
        const wrapper = shallowMount(GrimicornPage);
        await wrapper.vm.$nextTick();

        expect(() => findHeadingByText(wrapper, tag, text)).not.toThrow();

        wrapper.unmount();
      },
    );

    it.each(SECTION_HEADINGS)(
      'marks the decorative prefix aria-hidden so only "$text" forms the $tag accessible name',
      async ({ tag, text }) => {
        const wrapper = shallowMount(GrimicornPage);
        await wrapper.vm.$nextTick();

        const heading = findHeadingByText(wrapper, tag, text);
        // The ornament (e.g. "—", "~ %") must exist and be hidden — dropping
        // aria-hidden would fold it into the announced heading name.
        expect(heading.findAll('[aria-hidden="true"]').length).toBeGreaterThan(
          0,
        );
        expect(accessibleName(heading.element)).toBe(text);

        wrapper.unmount();
      },
    );

    it("emits headings in document order starting at h1 with no skipped levels", async () => {
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      // shallowMount only renders this component's own markup, so this covers
      // the headings owned by GrimicornPage — enough, since none are delegated
      // to child components.
      const headingLevels = wrapper
        .findAll("h1, h2, h3, h4, h5, h6")
        .map((heading) => Number(heading.element.tagName[1]));

      // Guard against a vacuous pass: the h1 plus every labelled section
      // heading must actually be present before the ordering walk runs.
      expect(headingLevels.length).toBeGreaterThanOrEqual(
        SECTION_HEADINGS.length + 1,
      );
      expect(headingLevels[0]).toBe(1);
      headingLevels.slice(1).forEach((level, previousIndex) => {
        expect(level).toBeLessThanOrEqual(headingLevels[previousIndex] + 1);
      });

      wrapper.unmount();
    });
  });

  describe("in-page navigation targets", () => {
    // Every in-page fragment the page advertises; each must resolve to a
    // top-level <section>. The named set (rather than a bare length check) is
    // the "pin, don't count" convention this file uses elsewhere, and the
    // obvious place to add "links" back if that panel is ever promoted to a
    // real section.
    const ADVERTISED_FRAGMENT_TARGETS = ["about", "status"];

    // Pulls the fragment id out of an in-page anchor href ("/#status" or
    // "#status" -> "status"), returning null for anything that isn't a
    // same-page fragment: external URLs (matched only if they start with the
    // in-page prefixes, so "https://…#readme" is excluded) and a bare "#" with
    // no id. Deliberately not reused from isExternalHref: the prefix allowlist
    // must also exclude cross-page hrefs like "/about#status", which a scheme
    // check would wrongly admit as same-page.
    function fragmentId(href: string) {
      if (!href.startsWith("#") && !href.startsWith("/#")) {
        return null;
      }
      const id = href.slice(href.indexOf("#") + 1);
      return id.length > 0 ? id : null;
    }

    it("points every in-page nav anchor at a real top-level <section> peer", async () => {
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      const fragmentIds = wrapper
        .findAll("a[href]")
        .map((link) => fragmentId(link.attributes("href") ?? ""))
        .filter((id): id is string => id !== null);

      // Pin the exact set of advertised in-page targets (deduped — the hero
      // CTA repeats "#status"), matching this file's "pin, don't count"
      // convention so dropping #about, or re-adding #links, fails here instead
      // of silently changing coverage.
      const advertisedTargets = [...new Set(fragmentIds)].sort();
      expect(advertisedTargets).toEqual(ADVERTISED_FRAGMENT_TARGETS);

      // The reconciliation invariant: each advertised fragment must resolve to
      // a <section> carrying that id AND sitting at the top level (no ancestor
      // <section>) — a genuine peer, not an h3 panel wrapped in a nested
      // <section id="links"> inside section#status. Matching by id attribute
      // (rather than a `section#${id}` selector) keeps ids that are legal HTML
      // but illegal CSS from throwing.
      const sections = wrapper.findAll("section[id]");
      advertisedTargets.forEach((id) => {
        const target = sections.find(
          (section) => section.attributes("id") === id,
        );
        expect(
          target,
          `no <section id="${id}"> for nav anchor #${id}`,
        ).toBeDefined();
        const ancestorSection =
          target?.element.parentElement?.closest("section") ?? null;
        expect(
          ancestorSection,
          `<section id="${id}"> for nav anchor #${id} is nested inside another <section>`,
        ).toBeNull();
      });

      wrapper.unmount();
    });
  });

  describe("cursor-linked parallax and prefers-reduced-motion", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("applies a cursor-linked transform to the hero and portrait images when reduced motion is not preferred", async () => {
      mockPrefersReducedMotion(false);
      const { runNextFrame } = mockAnimationFrame();
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      dispatchMouseMove(900, 700);
      runNextFrame();

      expect(parseTranslateXPixels(getHeroTransform(wrapper))).toBeGreaterThan(
        0,
      );
      expect(
        parseTranslateXPixels(getPortraitTransform(wrapper)),
      ).toBeGreaterThan(0);

      wrapper.unmount();
    });

    it("never starts the requestAnimationFrame loop or listens for mousemove when reduced motion is preferred at mount, and rests at the constant overzoom scale", async () => {
      mockPrefersReducedMotion(true);
      const { requestAnimationFrameSpy } = mockAnimationFrame();
      const { findRegisteredListener } = mockWindowEventListeners();
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      expect(requestAnimationFrameSpy).not.toHaveBeenCalled();
      expect(findRegisteredListener("mousemove")).toBeUndefined();

      // Reduced motion at mount must land on the same rest pose as a
      // runtime stop, not on no transform at all — otherwise a visitor who
      // already prefers reduced motion (the common case) sees a different,
      // un-cropped image size than one who toggles it on mid-session.
      expect(getHeroTransform(wrapper)).toBe(HERO_REST_TRANSFORM);
      expect(getPortraitTransform(wrapper)).toBe(PORTRAIT_REST_TRANSFORM);

      wrapper.unmount();
    });

    it("stops the loop and clears any applied transform when the preference switches to reduced motion at runtime", async () => {
      const { setMatches } = mockPrefersReducedMotion(false);
      const {
        runNextFrame,
        requestAnimationFrameSpy,
        cancelAnimationFrameSpy,
      } = mockAnimationFrame();
      const { findRegisteredListener, removeEventListenerSpy } =
        mockWindowEventListeners();
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      const registeredMouseMoveListener = findRegisteredListener("mousemove");
      expect(registeredMouseMoveListener).toBeDefined();

      dispatchMouseMove(900, 700);
      runNextFrame();
      expect(parseTranslateXPixels(getHeroTransform(wrapper))).toBeGreaterThan(
        0,
      );

      setMatches(true);
      await wrapper.vm.$nextTick();

      expect(cancelAnimationFrameSpy).toHaveBeenCalled();
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "mousemove",
        registeredMouseMoveListener,
      );
      // Stopping lands on the constant overzoom rest pose, not on no
      // transform at all, so the image doesn't visibly change size the
      // instant reduced motion is turned on.
      expect(getHeroTransform(wrapper)).toBe(HERO_REST_TRANSFORM);
      expect(getPortraitTransform(wrapper)).toBe(PORTRAIT_REST_TRANSFORM);

      // Confirms cancelAnimationFrame actually cancelled the frame that was
      // pending, not a stale/wrong id: if it hadn't, the queued tick()
      // callback would still be sitting in the queue, re-schedule itself,
      // and clobber the rest pose the instant it's run.
      const framesRequestedAfterStop =
        requestAnimationFrameSpy.mock.calls.length;
      runNextFrame();
      expect(requestAnimationFrameSpy.mock.calls.length).toBe(
        framesRequestedAfterStop,
      );
      expect(getHeroTransform(wrapper)).toBe(HERO_REST_TRANSFORM);

      wrapper.unmount();
    });

    it("resets the eased cursor offset on stop, so resuming eases in from rest instead of snapping back to the pre-stop position", async () => {
      const { setMatches } = mockPrefersReducedMotion(false);
      const { runNextFrame } = mockAnimationFrame();
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      // Move to a far corner and let several frames build up real eased
      // momentum, so there is something to (incorrectly) snap back to.
      dispatchMouseMove(1024, 768);
      for (let frame = 0; frame < 20; frame += 1) {
        runNextFrame();
      }
      expect(parseTranslateXPixels(getHeroTransform(wrapper))).toBeGreaterThan(
        1,
      );

      setMatches(true);
      await wrapper.vm.$nextTick();
      expect(getHeroTransform(wrapper)).toBe(HERO_REST_TRANSFORM);

      setMatches(false);
      await wrapper.vm.$nextTick();
      runNextFrame();

      // If the eased offset weren't reset alongside the transform, this
      // first frame after resuming would immediately reproduce the pre-stop
      // offset in one jump instead of easing in from zero.
      expect(getHeroTransform(wrapper)).toBe(
        "translate(0.00px,0.00px) rotate(0.00deg) scale(1.06)",
      );

      wrapper.unmount();
    });

    it("resumes the parallax loop when the preference switches away from reduced motion at runtime", async () => {
      const { setMatches } = mockPrefersReducedMotion(true);
      const { runNextFrame } = mockAnimationFrame();
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      setMatches(false);
      await wrapper.vm.$nextTick();

      dispatchMouseMove(900, 700);
      runNextFrame();

      expect(parseTranslateXPixels(getHeroTransform(wrapper))).toBeGreaterThan(
        0,
      );
      expect(
        parseTranslateXPixels(getPortraitTransform(wrapper)),
      ).toBeGreaterThan(0);

      wrapper.unmount();
    });

    it("never stacks a duplicate mousemove listener when a redundant change event fires while already running", async () => {
      const { setMatches } = mockPrefersReducedMotion(true);
      mockAnimationFrame();
      const { addEventListenerSpy } = mockWindowEventListeners();
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      setMatches(false);
      await wrapper.vm.$nextTick();
      // Fires "not reduced" again without an intervening "reduced" event —
      // this is the only case where startParallax()'s
      // `if (parallaxActive) return;` guard is the sole thing preventing a
      // second listener (and a second concurrent rAF loop) from stacking up.
      setMatches(false);
      await wrapper.vm.$nextTick();

      const mouseMoveRegistrationsWhileRunning =
        addEventListenerSpy.mock.calls.filter(
          ([eventName]) => eventName === "mousemove",
        );
      expect(mouseMoveRegistrationsWhileRunning).toHaveLength(1);

      // The content timers share the same re-entrancy guard: the redundant
      // "not reduced" event must not overwrite tagTimer/logTimer with a second
      // pair whose ids stopContentTimers() could never clear. rAF is spied out
      // here, so exactly the two intervals (tagline + log) should be pending.
      expect(vi.getTimerCount()).toBe(2);

      // A genuine stop/resume cycle after that should still add exactly one
      // more registration, confirming the guard isn't just permanently
      // latched shut.
      setMatches(true);
      await wrapper.vm.$nextTick();
      setMatches(false);
      await wrapper.vm.$nextTick();

      const mouseMoveRegistrationsAfterCycle =
        addEventListenerSpy.mock.calls.filter(
          ([eventName]) => eventName === "mousemove",
        );
      expect(mouseMoveRegistrationsAfterCycle).toHaveLength(2);

      wrapper.unmount();
    });

    it("clears the tagline and log timers on unmount so they cannot keep mutating after teardown", async () => {
      mockPrefersReducedMotion(false);
      mockAnimationFrame();
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      // rAF is spied out, so the only pending fake timers are the two intervals.
      expect(vi.getTimerCount()).toBe(2);

      wrapper.unmount();

      expect(vi.getTimerCount()).toBe(0);
    });

    it("removes the exact prefers-reduced-motion change listener that was registered, on unmount", async () => {
      const { mediaQueryList } = mockPrefersReducedMotion(false);
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      const [, registeredListener] =
        mediaQueryList.addEventListener.mock.calls[0];

      wrapper.unmount();

      // Asserting identity (not expect.any(Function)) catches a common leak
      // pattern: registering an inline wrapper closure and removing a
      // different function reference, which would otherwise pass this check
      // while still leaking the original listener.
      expect(mediaQueryList.removeEventListener).toHaveBeenCalledWith(
        "change",
        registeredListener,
      );
    });

    it("removes the mousemove listener and stops scheduling frames on unmount", async () => {
      mockPrefersReducedMotion(false);
      const {
        runNextFrame,
        requestAnimationFrameSpy,
        cancelAnimationFrameSpy,
      } = mockAnimationFrame();
      const { findRegisteredListener, removeEventListenerSpy } =
        mockWindowEventListeners();
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      const registeredMouseMoveListener = findRegisteredListener("mousemove");
      expect(registeredMouseMoveListener).toBeDefined();

      const framesRequestedBeforeUnmount =
        requestAnimationFrameSpy.mock.calls.length;

      wrapper.unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "mousemove",
        registeredMouseMoveListener,
      );
      expect(cancelAnimationFrameSpy).toHaveBeenCalled();

      // The loop calls requestAnimationFrame again from inside its own
      // callback, so cancelling the pending frame is the only thing that
      // stops it: running whatever frame was still queued at unmount must
      // not re-schedule another one.
      runNextFrame();
      expect(requestAnimationFrameSpy.mock.calls.length).toBe(
        framesRequestedBeforeUnmount,
      );
    });

    it("mounts without throwing and does not start the parallax loop when window.matchMedia is unavailable", async () => {
      const originalMatchMedia = window.matchMedia;
      Reflect.deleteProperty(window, "matchMedia");
      const { requestAnimationFrameSpy } = mockAnimationFrame();
      const { findRegisteredListener } = mockWindowEventListeners();

      try {
        let wrapper: GrimicornWrapper | undefined;
        expect(() => {
          wrapper = shallowMount(GrimicornPage);
        }).not.toThrow();
        await wrapper?.vm.$nextTick();

        expect(requestAnimationFrameSpy).not.toHaveBeenCalled();
        expect(findRegisteredListener("mousemove")).toBeUndefined();

        // Same rest pose as every other "no cursor-linked motion" path, so
        // an environment without matchMedia doesn't render a permanently
        // different image crop than every other visitor. wrapper is always
        // defined here: shallowMount() throwing would have already failed
        // the expect(...).not.toThrow() assertion above.
        expect(getHeroTransform(wrapper as GrimicornWrapper)).toBe(
          HERO_REST_TRANSFORM,
        );
        expect(getPortraitTransform(wrapper as GrimicornWrapper)).toBe(
          PORTRAIT_REST_TRANSFORM,
        );

        // Content timers fail closed on this path too: with the preference
        // unknowable, the tagline and log stream stay frozen on their static
        // seed rather than auto-mutating without a way to know it's safe.
        const definedWrapper = wrapper as GrimicornWrapper;
        const taglineAtMount = definedWrapper
          .find(".text-fg-muted span:last-child")
          .text();
        await vi.advanceTimersByTimeAsync(
          TAGLINE_ROTATION_INTERVAL_MS * 2 + LOG_APPEND_INTERVAL_MS * 2,
        );
        await definedWrapper.vm.$nextTick();
        expect(
          definedWrapper.find(".text-fg-muted span:last-child").text(),
        ).toBe(taglineAtMount);
        expect(definedWrapper.findAll(".border-l-2 div").length).toBe(
          INITIAL_LOG_COUNT,
        );

        wrapper?.unmount();
      } finally {
        window.matchMedia = originalMatchMedia;
      }
    });

    it("resumes the tagline rotation and log stream when the preference switches away from reduced motion at runtime", async () => {
      const { setMatches } = mockPrefersReducedMotion(true);
      mockAnimationFrame();
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      // Frozen while reduced motion is on.
      const frozenTagline = wrapper
        .find(".text-fg-muted span:last-child")
        .text();
      const frozenLogCount = wrapper.findAll(".border-l-2 div").length;
      await vi.advanceTimersByTimeAsync(
        TAGLINE_ROTATION_INTERVAL_MS + LOG_APPEND_INTERVAL_MS,
      );
      await wrapper.vm.$nextTick();
      expect(wrapper.find(".text-fg-muted span:last-child").text()).toBe(
        frozenTagline,
      );
      expect(wrapper.findAll(".border-l-2 div").length).toBe(frozenLogCount);

      setMatches(false);
      await wrapper.vm.$nextTick();

      // Append enough to push the stream past its cap, so this also exercises
      // the .slice(-MAX_LOG_COUNT) trim rather than just "grew by some amount".
      await vi.advanceTimersByTimeAsync(
        TAGLINE_ROTATION_INTERVAL_MS + LOG_APPEND_INTERVAL_MS * 5,
      );
      await wrapper.vm.$nextTick();

      expect(wrapper.find(".text-fg-muted span:last-child").text()).not.toBe(
        frozenTagline,
      );
      // 6 seeded + 5 appended, trimmed back to the cap. MAX_LOG_COUNT (8) >
      // INITIAL_LOG_COUNT (6), so this still fails if the stream never resumed.
      expect(MAX_LOG_COUNT).toBeGreaterThan(frozenLogCount);
      expect(wrapper.findAll(".border-l-2 div").length).toBe(MAX_LOG_COUNT);

      wrapper.unmount();
    });

    it("holds the first tagline and never auto-advances it when reduced motion is preferred at mount", async () => {
      mockPrefersReducedMotion(true);
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      const initialTagline = wrapper
        .find(".text-fg-muted span:last-child")
        .text();
      expect(initialTagline).toBeTruthy();

      // Advance well past several rotation intervals: an unguarded timer would
      // have swapped the tagline multiple times by now.
      await vi.advanceTimersByTimeAsync(TAGLINE_ROTATION_INTERVAL_MS * 3);
      await wrapper.vm.$nextTick();

      expect(wrapper.find(".text-fg-muted span:last-child").text()).toBe(
        initialTagline,
      );

      wrapper.unmount();
    });

    it("shows the static initial log entries but never appends to the stream when reduced motion is preferred at mount", async () => {
      mockPrefersReducedMotion(true);
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      // The static seed still renders — reduced motion suppresses the mutation,
      // not the content itself.
      expect(wrapper.findAll(".border-l-2 div").length).toBe(INITIAL_LOG_COUNT);

      await vi.advanceTimersByTimeAsync(LOG_APPEND_INTERVAL_MS * 3);
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll(".border-l-2 div").length).toBe(INITIAL_LOG_COUNT);

      wrapper.unmount();
    });

    it("freezes the tagline and log stream where they are when the preference switches to reduced motion at runtime", async () => {
      const { setMatches } = mockPrefersReducedMotion(false);
      mockAnimationFrame();
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      // While motion is allowed the content advances as normal. One rotation
      // interval both swaps the tagline once and appends one log line (6 → 7),
      // deliberately stopping below MAX_LOG_COUNT so a later append would be
      // observable as growth rather than silently trimmed at the cap — that
      // keeps the frozen-log assertion below from passing vacuously.
      const taglineBeforeStop = wrapper
        .find(".text-fg-muted span:last-child")
        .text();
      await vi.advanceTimersByTimeAsync(TAGLINE_ROTATION_INTERVAL_MS);
      await wrapper.vm.$nextTick();
      expect(wrapper.find(".text-fg-muted span:last-child").text()).not.toBe(
        taglineBeforeStop,
      );

      setMatches(true);
      await wrapper.vm.$nextTick();

      const taglineAtStop = wrapper
        .find(".text-fg-muted span:last-child")
        .text();
      const logCountAtStop = wrapper.findAll(".border-l-2 div").length;
      expect(logCountAtStop).toBeLessThan(MAX_LOG_COUNT);

      await vi.advanceTimersByTimeAsync(
        TAGLINE_ROTATION_INTERVAL_MS * 3 + LOG_APPEND_INTERVAL_MS * 3,
      );
      await wrapper.vm.$nextTick();

      expect(wrapper.find(".text-fg-muted span:last-child").text()).toBe(
        taglineAtStop,
      );
      expect(wrapper.findAll(".border-l-2 div").length).toBe(logCountAtStop);

      wrapper.unmount();
    });
  });

  describe("visitor-facing pause control (WCAG 2.2.2)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("renders a pause toggle whose aria-pressed reflects the paused state", async () => {
      mockPrefersReducedMotion(false);
      mockAnimationFrame();
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      const pauseButton = findPauseButton(wrapper);
      expect(pauseButton.exists()).toBe(true);
      // A stable label carries the affordance; aria-pressed alone carries the
      // on/off state (mirroring the rave toggle), so the two never contradict.
      expect(pauseButton.text()).toBe("pause live updates");
      expect(pauseButton.attributes("aria-pressed")).toBe("false");

      await pauseButton.trigger("click");
      expect(pauseButton.attributes("aria-pressed")).toBe("true");
      expect(pauseButton.text()).toBe("pause live updates");

      await pauseButton.trigger("click");
      expect(pauseButton.attributes("aria-pressed")).toBe("false");

      wrapper.unmount();
    });

    it("freezes the tagline rotation and log stream when paused via the control", async () => {
      mockPrefersReducedMotion(false);
      mockAnimationFrame();
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      // Advance one interval below the cap first so a later append would show
      // as growth, not be silently trimmed — keeps the frozen assertion honest.
      await vi.advanceTimersByTimeAsync(LOG_APPEND_INTERVAL_MS);
      await wrapper.vm.$nextTick();

      await findPauseButton(wrapper).trigger("click");

      const taglineAtPause = getTagline(wrapper);
      // Pinned to the exact expected count (6 seeded + 1 appended), not a
      // range: a bare `< MAX_LOG_COUNT` would be satisfied by a 0 from a
      // selector that stopped matching, letting the freeze assertion below pass
      // vacuously against a component rendering no log at all.
      const logCountAtPause = getLogCount(wrapper);
      expect(logCountAtPause).toBe(INITIAL_LOG_COUNT + 1);

      await vi.advanceTimersByTimeAsync(
        TAGLINE_ROTATION_INTERVAL_MS * 3 + LOG_APPEND_INTERVAL_MS * 3,
      );
      await wrapper.vm.$nextTick();

      expect(getTagline(wrapper)).toBe(taglineAtPause);
      expect(getLogCount(wrapper)).toBe(logCountAtPause);

      wrapper.unmount();
    });

    it("resumes the tagline rotation and log stream when unpaused via the control", async () => {
      mockPrefersReducedMotion(false);
      mockAnimationFrame();
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      const pauseButton = findPauseButton(wrapper);
      await pauseButton.trigger("click");

      const taglineWhilePaused = getTagline(wrapper);
      await vi.advanceTimersByTimeAsync(
        TAGLINE_ROTATION_INTERVAL_MS + LOG_APPEND_INTERVAL_MS,
      );
      await wrapper.vm.$nextTick();
      expect(getTagline(wrapper)).toBe(taglineWhilePaused);

      await pauseButton.trigger("click");
      await vi.advanceTimersByTimeAsync(
        TAGLINE_ROTATION_INTERVAL_MS + LOG_APPEND_INTERVAL_MS * 5,
      );
      await wrapper.vm.$nextTick();

      expect(getTagline(wrapper)).not.toBe(taglineWhilePaused);
      expect(getLogCount(wrapper)).toBe(MAX_LOG_COUNT);

      wrapper.unmount();
    });

    it("does not render the pause control while the OS prefers reduced motion, since nothing is moving to pause", async () => {
      mockPrefersReducedMotion(true);
      mockAnimationFrame();
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      // WCAG 2.2.2 needs a pause mechanism only for content that actually
      // auto-updates; reduced motion already froze it, so the control is absent
      // rather than advertising a paused state that doesn't correspond to
      // anything on the page.
      expect(findPauseButton(wrapper).exists()).toBe(false);

      wrapper.unmount();
    });

    it("appears when the OS reduced-motion preference switches off, and hides again when it switches back on", async () => {
      const { setMatches } = mockPrefersReducedMotion(true);
      mockAnimationFrame();
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      expect(findPauseButton(wrapper).exists()).toBe(false);

      setMatches(false);
      await wrapper.vm.$nextTick();
      expect(findPauseButton(wrapper).exists()).toBe(true);

      setMatches(true);
      await wrapper.vm.$nextTick();
      expect(findPauseButton(wrapper).exists()).toBe(false);

      wrapper.unmount();
    });

    it("hides the now-inert control on the next toggle if the preference drifted to reduced motion without a change event", async () => {
      const { mediaQueryList } = mockPrefersReducedMotion(false);
      mockAnimationFrame();
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      expect(findPauseButton(wrapper).exists()).toBe(true);

      // The OS flips to reduced motion but the change listener never fires
      // (e.g. addEventListener failed to attach, which onMounted anticipates).
      // Without a shared reconcile step the control would be stranded — visible
      // over a stream it can no longer move.
      mediaQueryList.matches = true;

      await findPauseButton(wrapper).trigger("click");
      await wrapper.vm.$nextTick();

      // The toggle re-reads the live preference through the same reconcile path
      // the listener uses, so the control self-corrects and hides.
      expect(findPauseButton(wrapper).exists()).toBe(false);

      wrapper.unmount();
    });

    it("does not render the pause control, nor start the stream, when window.matchMedia is unavailable", async () => {
      const originalMatchMedia = window.matchMedia;
      Reflect.deleteProperty(window, "matchMedia");
      mockAnimationFrame();

      try {
        const wrapper = shallowMount(GrimicornPage);
        await wrapper.vm.$nextTick();

        // The preference is unknowable, so the component fails closed: no
        // moving content, therefore no pause control to (mis)report state.
        expect(findPauseButton(wrapper).exists()).toBe(false);

        const frozenTagline = getTagline(wrapper);
        const frozenLogCount = getLogCount(wrapper);
        // Pinned to the seeded count so a selector miss (which would return 0)
        // can't make the freeze assertion pass against an empty log.
        expect(frozenLogCount).toBe(INITIAL_LOG_COUNT);
        await vi.advanceTimersByTimeAsync(
          TAGLINE_ROTATION_INTERVAL_MS * 2 + LOG_APPEND_INTERVAL_MS * 2,
        );
        await wrapper.vm.$nextTick();

        expect(getTagline(wrapper)).toBe(frozenTagline);
        expect(getLogCount(wrapper)).toBe(frozenLogCount);

        wrapper.unmount();
      } finally {
        window.matchMedia = originalMatchMedia;
      }
    });

    it("keeps a visitor's pause when the OS reduced-motion preference flips off", async () => {
      const { setMatches } = mockPrefersReducedMotion(false);
      mockAnimationFrame();
      const wrapper = shallowMount(GrimicornPage);
      await wrapper.vm.$nextTick();

      await findPauseButton(wrapper).trigger("click");
      const taglineAtPause = getTagline(wrapper);
      const logCountAtPause = getLogCount(wrapper);
      expect(logCountAtPause).toBe(INITIAL_LOG_COUNT);

      // A reduced-motion change event that resolves to "not reduced" must not
      // resurrect the stream the visitor explicitly paused.
      setMatches(true);
      await wrapper.vm.$nextTick();
      setMatches(false);
      await wrapper.vm.$nextTick();

      await vi.advanceTimersByTimeAsync(
        TAGLINE_ROTATION_INTERVAL_MS * 2 + LOG_APPEND_INTERVAL_MS * 2,
      );
      await wrapper.vm.$nextTick();

      expect(getTagline(wrapper)).toBe(taglineAtPause);
      expect(getLogCount(wrapper)).toBe(logCountAtPause);

      wrapper.unmount();
    });
  });
});
