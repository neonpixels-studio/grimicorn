export const KONAMI_SEQUENCE: readonly string[] = [
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

const MODIFIER_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "AltGraph",
  "Meta",
  "CapsLock",
]);

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
    typeof event.key !== "string" ||
    MODIFIER_KEYS.has(event.key) ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  );
}

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function matchesSequence(
  keys: readonly string[],
  sequence: readonly string[],
): boolean {
  return (
    keys.length === sequence.length &&
    keys.every((key, index) => key === sequence[index])
  );
}

// Returns a feed function that reports true on the event that completes the
// sequence. Compares a sliding window of recent keys so an overshoot of an
// overlapping prefix (an extra leading ArrowUp) still completes.
export function createKonamiMatcher(
  sequence: readonly string[] = KONAMI_SEQUENCE,
) {
  let recentKeys: string[] = [];

  return function feed(event: KonamiKeyEvent): boolean {
    if (isIgnorable(event)) {
      return false;
    }
    recentKeys = [...recentKeys, normalizeKey(event.key)].slice(
      -sequence.length,
    );
    if (!matchesSequence(recentKeys, sequence)) {
      return false;
    }
    recentKeys = [];
    return true;
  };
}
