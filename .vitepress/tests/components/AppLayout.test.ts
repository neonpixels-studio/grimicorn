import { describe, it, expect, vi, afterEach } from "vitest";
import { shallowMount, mount } from "@vue/test-utils";

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

describe("AppLayout", () => {
  // The `attachTo: document.body` cases below leak their <main> landmark if an
  // assertion throws before unmount(); a stale #main-content would then make the
  // next parametrized case focus the wrong node and fail for an unrelated reason.
  // Reset shared state here so each case starts from a clean body regardless.
  afterEach(() => {
    document.body.innerHTML = "";
    pageState.isNotFound = false;
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
});
