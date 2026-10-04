import { describe, it, expect } from "vitest";

import {
  KONAMI_SEQUENCE,
  createKonamiMatcher,
  type KonamiKeyEvent,
} from "../theme/konami";

function press(key: string, overrides: Partial<KonamiKeyEvent> = {}) {
  return {
    key,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...overrides,
  };
}

describe("createKonamiMatcher", () => {
  it("completes on the full sequence and reports true only on the last key", () => {
    const feed = createKonamiMatcher();
    const results = KONAMI_SEQUENCE.map((key) => feed(press(key)));

    expect(results.slice(0, -1).every((result) => !result)).toBe(true);
    expect(results.at(-1)).toBe(true);
  });

  it("matches letters case-insensitively", () => {
    const feed = createKonamiMatcher();
    const results = KONAMI_SEQUENCE.map((key) =>
      feed(press(key.toUpperCase().length === 1 ? key.toUpperCase() : key)),
    );

    expect(results.at(-1)).toBe(true);
  });

  it("resets on a wrong key", () => {
    const feed = createKonamiMatcher();
    feed(press("ArrowUp"));
    feed(press("x"));
    const results = KONAMI_SEQUENCE.slice(1).map((key) => feed(press(key)));

    expect(results.at(-1)).toBe(false);
  });

  it("restarts at position one when the wrong key is the first key", () => {
    const feed = createKonamiMatcher();
    feed(press("ArrowUp"));
    feed(press("ArrowUp"));
    feed(press("ArrowUp"));
    const results = KONAMI_SEQUENCE.slice(1).map((key) => feed(press(key)));

    expect(results.at(-1)).toBe(true);
  });

  it.each(["Shift", "Control", "Alt", "Meta"])(
    "does not reset when %s is pressed mid-sequence",
    (modifier) => {
      const feed = createKonamiMatcher();
      const results = KONAMI_SEQUENCE.map((key, index) => {
        if (index === 4) {
          feed(press(modifier));
        }
        return feed(press(key));
      });

      expect(results.at(-1)).toBe(true);
    },
  );

  it("does not advance on auto-repeat keydown events", () => {
    const feed = createKonamiMatcher();
    feed(press("ArrowUp"));
    feed(press("ArrowUp", { repeat: true }));
    feed(press("ArrowUp", { repeat: true }));
    const results = KONAMI_SEQUENCE.slice(1).map((key) => feed(press(key)));

    expect(results.at(-1)).toBe(true);
  });

  it("does not reset the sequence on a repeat of a non-matching key", () => {
    const feed = createKonamiMatcher();
    feed(press("ArrowUp"));
    feed(press("x", { repeat: true }));
    const results = KONAMI_SEQUENCE.slice(1).map((key) => feed(press(key)));

    expect(results.at(-1)).toBe(true);
  });

  it.each(["ctrlKey", "metaKey", "altKey"] as const)(
    "ignores keys typed while %s is held",
    (modifierFlag) => {
      const feed = createKonamiMatcher();
      feed(press("ArrowUp"));
      feed(press("x", { [modifierFlag]: true }));
      const results = KONAMI_SEQUENCE.slice(1).map((key) => feed(press(key)));

      expect(results.at(-1)).toBe(true);
    },
  );

  it("can complete again after finishing", () => {
    const feed = createKonamiMatcher();
    KONAMI_SEQUENCE.forEach((key) => feed(press(key)));
    const results = KONAMI_SEQUENCE.map((key) => feed(press(key)));

    expect(results.at(-1)).toBe(true);
  });
});
