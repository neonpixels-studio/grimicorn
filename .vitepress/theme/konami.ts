export const KONAMI_SEQUENCE = [
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

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

export type KonamiKeyEvent = Pick<
  KeyboardEvent,
  "key" | "repeat" | "ctrlKey" | "metaKey" | "altKey"
>;

// Held keys and bare modifier presses are not deliberate input, and
// ctrl/meta/alt chords are browser shortcuts, so none of them may advance or
// reset the sequence.
function isIgnorable(event: KonamiKeyEvent): boolean {
  return (
    event.repeat ||
    MODIFIER_KEYS.has(event.key) ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  );
}

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

// Returns a feed function that reports true on the event that completes the
// sequence.
export function createKonamiMatcher(
  sequence: readonly string[] = KONAMI_SEQUENCE,
) {
  let position = 0;

  return function feed(event: KonamiKeyEvent): boolean {
    if (isIgnorable(event)) {
      return false;
    }
    const key = normalizeKey(event.key);
    if (key !== sequence[position]) {
      position = key === sequence[0] ? 1 : 0;
      return false;
    }
    position++;
    if (position < sequence.length) {
      return false;
    }
    position = 0;
    return true;
  };
}
