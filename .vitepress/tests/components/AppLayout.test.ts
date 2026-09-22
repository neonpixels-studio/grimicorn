import { describe, it, expect, vi, afterEach } from "vitest";
import { shallowMount, mount, enableAutoUnmount } from "@vue/test-utils";

const pageState = vi.hoisted(() => ({ isNotFound: false }));

vi.mock("vitepress", async () => {
  const { computed } = await import("vue");
  return {
    useData: () => ({
      page: computed(() => ({ isNotFound: pageState.isNotFound })),
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
    document.title = "";
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
    descriptionMeta.remove();
  });
});
