import { describe, it, expect, vi, afterEach } from "vitest";
import { reactive } from "vue";
import { shallowMount, mount, enableAutoUnmount } from "@vue/test-utils";

// reactive (not a plain object): AppLayout's client-side not-found-meta
// override watches useData().page, so mutating pageState from an `it` block
// has to go through Vue's reactivity for that watcher to ever re-fire — a
// plain object's mutations are invisible to a computed()/watch() dependency.
// relativePath mirrors real VitePress page data and lets a test change
// identity while isNotFound stays true, the same way a real 404-to-404
// client-side navigation does (see AppLayout.vue's watch source comment).
const initialPageState = vi.hoisted(() => ({
  isNotFound: false,
  relativePath: "",
}));
const pageState = reactive(initialPageState);

vi.mock("vitepress", async () => {
  const { computed } = await import("vue");
  return {
    useData: () => ({
      page: computed(() => ({
        isNotFound: pageState.isNotFound,
        relativePath: pageState.relativePath,
      })),
    }),
  };
});

import AppLayout from "@theme/AppLayout.vue";
import SkipLink from "@components/SkipLink.vue";
import { NOT_FOUND_TITLE, NOT_FOUND_DESCRIPTION } from "../../not-found-meta";

describe("AppLayout", () => {
  // Auto-unmount every mounted wrapper after each case, even when an assertion
  // throws first. Hand-clearing document.body would detach the node but leave the
  // Vue app mounted, so GrimicornPage's onMounted timers/listeners would keep
  // firing into later cases; enableAutoUnmount runs onUnmounted so they stop.
  enableAutoUnmount(afterEach);
  afterEach(() => {
    pageState.isNotFound = false;
    pageState.relativePath = "";
    document.title = "";
    // Belt-and-suspenders even for tests that clean up their own <meta>: if
    // an assertion throws before an inline cleanup runs, a stray tag would
    // otherwise leak into (and be found by) a later test's querySelector.
    document.head
      .querySelectorAll('meta[name="description"]')
      .forEach((element) => element.remove());
  });

  it("renders the homepage for a valid route", () => {
    pageState.isNotFound = false;
    const wrapper = shallowMount(AppLayout);
    expect(wrapper.findComponent({ name: "GrimicornPage" }).exists()).toBe(
      true,
    );
    expect(wrapper.findComponent({ name: "NotFound" }).exists()).toBe(false);
    wrapper.unmount();
  });

  it("renders the 404 view when the page is not found", () => {
    pageState.isNotFound = true;
    const wrapper = shallowMount(AppLayout);
    expect(wrapper.findComponent({ name: "NotFound" }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: "GrimicornPage" }).exists()).toBe(
      false,
    );
    wrapper.unmount();
  });

  it("renders the skip-to-content link on both the homepage and the 404", () => {
    pageState.isNotFound = false;
    const home = shallowMount(AppLayout);
    expect(home.findComponent(SkipLink).exists()).toBe(true);
    home.unmount();

    pageState.isNotFound = true;
    const notFound = shallowMount(AppLayout);
    expect(notFound.findComponent(SkipLink).exists()).toBe(true);
    notFound.unmount();
  });

  it.each([
    ["homepage", false, "GrimicornPage"],
    ["404", true, "NotFound"],
  ])(
    "renders the skip link ahead of the %s content so keyboard focus reaches it first",
    (_label, isNotFound, pageName) => {
      pageState.isNotFound = isNotFound;
      const wrapper = shallowMount(AppLayout);

      // DOCUMENT_POSITION_FOLLOWING means the page (and its nav) comes after the
      // skip link in tab order, which is the whole point of a skip link.
      const relativePosition = wrapper
        .findComponent(SkipLink)
        .element.compareDocumentPosition(
          wrapper.findComponent({ name: pageName }).element,
        );
      expect(relativePosition & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      wrapper.unmount();
    },
  );

  it.each([
    ["homepage", false],
    ["404", true],
  ])(
    "moves focus into the %s main landmark when the skip link is activated",
    async (_label, isNotFound) => {
      pageState.isNotFound = isNotFound;
      const wrapper = mount(AppLayout, { attachTo: document.body });
      await wrapper.vm.$nextTick();

      await wrapper.get(".skip-link").trigger("click");

      expect(document.activeElement).toBe(wrapper.get("main").element);

      wrapper.unmount();
    },
  );

  // VitePress's own client-side head updater unconditionally resets
  // document.title and the description meta tag from its internal
  // notFoundPageData fallback on every hydration and route change (see
  // not-found-meta.ts), which would otherwise silently undo config.ts's
  // build-time title/description the instant JS runs. These cover
  // AppLayout's client-side override that re-applies the owned copy.
  it("overrides document.title with the owned 404 title once mounted as the not-found page", async () => {
    pageState.isNotFound = true;
    const wrapper = mount(AppLayout, { attachTo: document.body });
    await wrapper.vm.$nextTick();

    expect(document.title).toBe(NOT_FOUND_TITLE);

    wrapper.unmount();
  });

  it("leaves document.title untouched when the page is found", async () => {
    document.title = "unchanged-baseline";
    pageState.isNotFound = false;
    const wrapper = mount(AppLayout, { attachTo: document.body });
    await wrapper.vm.$nextTick();

    expect(document.title).toBe("unchanged-baseline");

    wrapper.unmount();
  });

  it("overrides an existing description meta tag's content with the owned 404 description", async () => {
    const descriptionMeta = document.createElement("meta");
    descriptionMeta.setAttribute("name", "description");
    descriptionMeta.setAttribute("content", "Not Found");
    document.head.appendChild(descriptionMeta);

    pageState.isNotFound = true;
    const wrapper = mount(AppLayout, { attachTo: document.body });
    await wrapper.vm.$nextTick();

    expect(descriptionMeta.getAttribute("content")).toBe(NOT_FOUND_DESCRIPTION);

    wrapper.unmount();
  });

  it("reapplies the owned title/description when the page transitions from found to not-found after mount", async () => {
    const descriptionMeta = document.createElement("meta");
    descriptionMeta.setAttribute("name", "description");
    descriptionMeta.setAttribute("content", "A chaotic AI coding sidekick");
    document.head.appendChild(descriptionMeta);

    pageState.isNotFound = false;
    document.title = "Grimicorn – AI Coding Sidekick";
    const wrapper = mount(AppLayout, { attachTo: document.body });
    await wrapper.vm.$nextTick();

    pageState.isNotFound = true;
    await wrapper.vm.$nextTick();

    expect(document.title).toBe(NOT_FOUND_TITLE);
    expect(descriptionMeta.getAttribute("content")).toBe(NOT_FOUND_DESCRIPTION);

    wrapper.unmount();
  });

  it("reapplies the owned title/description across a 404-to-404 client-side navigation", async () => {
    // Regression test: VitePress's router builds a brand-new page-data object
    // on every failed route load, even one 404 to another — isNotFound stays
    // true the whole time. Watching only the isNotFound boolean would miss
    // this (it never changes), so the fix watches the whole page object
    // instead (see AppLayout.vue). relativePath changing while isNotFound
    // stays true is what a real 404-to-404 navigation looks like.
    const descriptionMeta = document.createElement("meta");
    descriptionMeta.setAttribute("name", "description");
    descriptionMeta.setAttribute("content", "Not Found");
    document.head.appendChild(descriptionMeta);

    pageState.isNotFound = true;
    pageState.relativePath = "nope.md";
    const wrapper = mount(AppLayout, { attachTo: document.body });
    await wrapper.vm.$nextTick();
    expect(document.title).toBe(NOT_FOUND_TITLE);

    // Simulate VitePress's own client-side head updater clobbering the title
    // and description back to its generic fallback on the new not-found page
    // load — the failure mode this test guards against.
    document.title = "404 | Grimicorn";
    descriptionMeta.setAttribute("content", "Not Found");

    pageState.relativePath = "also-nope.md";
    await wrapper.vm.$nextTick();

    expect(document.title).toBe(NOT_FOUND_TITLE);
    expect(descriptionMeta.getAttribute("content")).toBe(NOT_FOUND_DESCRIPTION);

    wrapper.unmount();
  });
});
