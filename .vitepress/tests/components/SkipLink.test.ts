import { describe, it, expect, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import SkipLink from "@components/SkipLink.vue";
import { MAIN_CONTENT_ID } from "@theme/constants";

// A focusable stand-in for the <main> landmark the real pages render, so the
// handler under test has a target to move focus to. tabindex="-1" mirrors the
// landmark markup — without it focus() is a no-op.
function addMainLandmark() {
  const main = document.createElement("main");
  main.id = MAIN_CONTENT_ID;
  main.tabIndex = -1;
  document.body.appendChild(main);
  return main;
}

describe("SkipLink", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders an anchor targeting the shared main-content id", () => {
    const wrapper = mount(SkipLink);
    const link = wrapper.find("a");

    expect(link.exists()).toBe(true);
    // The href fragment must resolve to the <main> landmark id both pages use;
    // binding both to MAIN_CONTENT_ID is what keeps them from drifting.
    expect(link.attributes("href")).toBe(`#${MAIN_CONTENT_ID}`);
    expect(link.text()).toBe("skip to content");

    wrapper.unmount();
  });

  it("ships visually hidden but keeps the class that reveals it on focus", () => {
    const wrapper = mount(SkipLink);
    // sr-only hides it; skip-link is what .skip-link:focus in style.css keys
    // off to surface it — dropping either breaks the feature, so pin both.
    expect(wrapper.find("a").classes()).toEqual(
      expect.arrayContaining(["skip-link", "sr-only"]),
    );
    wrapper.unmount();
  });

  it("moves focus onto the main landmark when activated", async () => {
    const main = addMainLandmark();
    const wrapper = mount(SkipLink, { attachTo: document.body });

    // VitePress cancels the native fragment navigation, so activation only
    // reaches the landmark if the component moves focus itself.
    await wrapper.get("a").trigger("click");

    expect(document.activeElement).toBe(main);

    wrapper.unmount();
  });

  it("leaves focus where it was when the landmark is absent", async () => {
    const wrapper = mount(SkipLink, { attachTo: document.body });
    const link = wrapper.get("a");
    link.element.focus();

    await link.trigger("click");

    // No landmark to move to, so focus must stay put rather than being lost to
    // <body> — the guard clause's observable contract.
    expect(document.activeElement).toBe(link.element);

    wrapper.unmount();
  });
});
