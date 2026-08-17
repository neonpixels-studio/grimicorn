import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

// fonts.css serves each family as a single variable woff2 that spans the weight axis
// (see the header comment there; the theme declares font-weight: 400 700). This suite
// parses each shipped woff2's table directory and fails if the variable-axis table
// (fvar) is missing. An fvar table is what distinguishes a variable font from the
// static, per-weight files a naive refresh would ship — Google's enumerated
// `wght@400;500;700` syntax returns one static file per weight (no fvar), which would
// render 500/700 as synthetic ("faux") bold with no other CI signal. This asserts the
// variation axis is present; it does not decode the axis ranges (that lives inside the
// brotli-compressed table data and is out of scope for this guard).
const FONTS_DIR = resolve(process.cwd(), "public", "fonts");
const WOFF2_EXTENSION = ".woff2";

// woff2 layout (W3C WOFF2 spec §4-5): a fixed 48-byte header precedes the
// uncompressed table directory. numTables is a uint16 at offset 12.
const WOFF2_SIGNATURE = "wOF2";
const WOFF2_HEADER_LENGTH = 48;
const NUM_TABLES_OFFSET = 12;

// Directory-entry flags (spec §5): low 6 bits index the known-tag table below; the
// sentinel value 63 means a 4-byte arbitrary tag follows the flags byte instead.
// The top 2 bits are the transform version.
const TAG_INDEX_MASK = 0x3f;
const ARBITRARY_TAG_INDEX = 0x3f;
const ARBITRARY_TAG_LENGTH = 4;
const TRANSFORM_VERSION_SHIFT = 6;

// Transform rules (spec §5.2): a transformed table appends a second UIntBase128
// (transformLength) that must be skipped to stay aligned while walking the directory.
// The null (untransformed) version is 0 for every table EXCEPT glyf/loca, whose null
// transform is version 3; any other version means a transform is applied. This set is
// exactly the tags whose null transform is version 3 — NOT "tables that can be
// transformed" (hmtx is transformable at version 1 but its null is still version 0).
const NULL_TRANSFORM_V3_TAGS = new Set(["glyf", "loca"]);
const NULL_TRANSFORM_VERSION = 0;
const GLYF_LOCA_TRANSFORMED_VERSION = 0;
const GLYF_LOCA_NULL_TRANSFORM_VERSION = 3;

// The variable-fonts axis table: its presence is what distinguishes a real variable
// font from a static, single-weight file.
const FVAR_TABLE_TAG = "fvar";

// UIntBase128 (spec §4): big-endian, 7 bits per byte, high bit continues; ≤5 bytes.
const UINT_BASE128_MAX_BYTES = 5;
const CONTINUATION_BIT = 0x80;
const SEVEN_BIT_MASK = 0x7f;
const BASE128_SHIFT = 0x80;

// Known-tag table (spec §5, "Known Table Tags"): a directory entry's low-6-bit index
// selects a tag here. Order and trailing spaces are significant.
const KNOWN_WOFF2_TABLE_TAGS = [
  "cmap",
  "head",
  "hhea",
  "hmtx",
  "maxp",
  "name",
  "OS/2",
  "post",
  "cvt ",
  "fpgm",
  "glyf",
  "loca",
  "prep",
  "CFF ",
  "VORG",
  "EBDT",
  "EBLC",
  "gasp",
  "hdmx",
  "kern",
  "LTSH",
  "PCLT",
  "VDMX",
  "vhea",
  "vmtx",
  "BASE",
  "GDEF",
  "GPOS",
  "GSUB",
  "EBSC",
  "JSTF",
  "MATH",
  "CBDT",
  "CBLC",
  "COLR",
  "CPAL",
  "SVG ",
  "sbix",
  "acnt",
  "avar",
  "bdat",
  "bloc",
  "bsln",
  "cvar",
  "fdsc",
  "feat",
  "fmtx",
  "fvar",
  "gvar",
  "hsty",
  "just",
  "lcar",
  "mort",
  "morx",
  "opbd",
  "prop",
  "trak",
  "Zapf",
  "Silf",
  "Glat",
  "Gloc",
  "Feat",
  "Sil ",
];

// Every read past the end of the buffer must fail loud, not silently decode
// `undefined` as a zero byte (which would fabricate phantom "cmap" entries and mask a
// truncated font).
function byteAt(buffer: Buffer, offset: number) {
  if (offset >= buffer.length) {
    throw new Error(
      `woff2 table directory runs past end of file at offset ${offset}`,
    );
  }
  return buffer[offset];
}

function assertWoff2Signature(buffer: Buffer) {
  if (buffer.length < WOFF2_HEADER_LENGTH) {
    throw new Error(
      `woff2 file shorter than its ${WOFF2_HEADER_LENGTH}-byte header`,
    );
  }
  const signature = buffer.toString("latin1", 0, WOFF2_SIGNATURE.length);
  if (signature === WOFF2_SIGNATURE) {
    return;
  }
  throw new Error(
    `expected woff2 signature ${WOFF2_SIGNATURE}, got "${signature}"`,
  );
}

function readUIntBase128(buffer: Buffer, offset: number) {
  // Accumulate with multiplication rather than <<7 so a 5-byte value can't overflow
  // the signed 32-bit range mid-parse.
  let value = 0;
  for (let index = 0; index < UINT_BASE128_MAX_BYTES; index++) {
    const byte = byteAt(buffer, offset + index);
    value = value * BASE128_SHIFT + (byte & SEVEN_BIT_MASK);
    if ((byte & CONTINUATION_BIT) === 0) {
      return { value, nextOffset: offset + index + 1 };
    }
  }
  throw new Error("woff2 UIntBase128 value exceeds 5 bytes");
}

function readEntryTag(buffer: Buffer, tagIndex: number, offset: number) {
  if (tagIndex !== ARBITRARY_TAG_INDEX) {
    return { tag: KNOWN_WOFF2_TABLE_TAGS[tagIndex], afterTag: offset };
  }
  const tagEnd = offset + ARBITRARY_TAG_LENGTH;
  if (tagEnd > buffer.length) {
    throw new Error(
      `woff2 arbitrary tag runs past end of file at offset ${offset}`,
    );
  }
  return { tag: buffer.toString("latin1", offset, tagEnd), afterTag: tagEnd };
}

function isTableTransformed(tag: string, transformVersion: number) {
  if (NULL_TRANSFORM_V3_TAGS.has(tag)) {
    return transformVersion !== GLYF_LOCA_NULL_TRANSFORM_VERSION;
  }
  return transformVersion !== NULL_TRANSFORM_VERSION;
}

function skipTransformLength(
  buffer: Buffer,
  tag: string,
  transformVersion: number,
  offset: number,
) {
  if (!isTableTransformed(tag, transformVersion)) {
    return offset;
  }
  return readUIntBase128(buffer, offset).nextOffset;
}

function readTableDirectoryEntry(buffer: Buffer, offset: number) {
  const flags = byteAt(buffer, offset);
  const tagIndex = flags & TAG_INDEX_MASK;
  const transformVersion = flags >> TRANSFORM_VERSION_SHIFT;
  const { tag, afterTag } = readEntryTag(buffer, tagIndex, offset + 1);
  const afterOrigLength = readUIntBase128(buffer, afterTag).nextOffset;
  const nextOffset = skipTransformLength(
    buffer,
    tag,
    transformVersion,
    afterOrigLength,
  );
  return { tag, nextOffset };
}

function readWoff2TableTags(buffer: Buffer) {
  assertWoff2Signature(buffer);
  const tableCount = buffer.readUInt16BE(NUM_TABLES_OFFSET);
  const tags: string[] = [];
  let offset = WOFF2_HEADER_LENGTH;
  for (let index = 0; index < tableCount; index++) {
    const entry = readTableDirectoryEntry(buffer, offset);
    tags.push(entry.tag);
    offset = entry.nextOffset;
  }
  return tags;
}

function hasVariableFontAxis(buffer: Buffer) {
  return readWoff2TableTags(buffer).includes(FVAR_TABLE_TAG);
}

function shippedWoff2Paths() {
  if (!existsSync(FONTS_DIR)) {
    return [];
  }
  return readdirSync(FONTS_DIR)
    .filter((name) => name.endsWith(WOFF2_EXTENSION))
    .map((name) => resolve(FONTS_DIR, name));
}

// --- Fixtures for the teeth tests ---------------------------------------------
// The parser only reads the header and the uncompressed table directory, so a valid
// fixture needs no font data. The builders below mirror the three entry encodings the
// parser must handle: a known tag, a 4-byte arbitrary tag, and a transformed table
// carrying a transformLength.

function encodeUIntBase128(value: number) {
  const bytes = [value & SEVEN_BIT_MASK];
  let remaining = Math.floor(value / BASE128_SHIFT);
  while (remaining > 0) {
    // Prepend the next more-significant 7 bits with its continuation bit set.
    bytes.unshift((remaining & SEVEN_BIT_MASK) | CONTINUATION_BIT);
    remaining = Math.floor(remaining / BASE128_SHIFT);
  }
  return Buffer.from(bytes);
}

const ZERO_ORIG_LENGTH = 0;

function knownTableEntry(tag: string) {
  const tagIndex = KNOWN_WOFF2_TABLE_TAGS.indexOf(tag);
  if (tagIndex < 0 || NULL_TRANSFORM_V3_TAGS.has(tag)) {
    throw new Error(
      `fixture tag must be a known tag with a version-0 null transform (not glyf/loca): "${tag}"`,
    );
  }
  // Transform version 0 + known-tag index, then a single-byte origLength of 0.
  return Buffer.from([tagIndex, ZERO_ORIG_LENGTH]);
}

function arbitraryTableEntry(tag: string) {
  const tagBytes = Buffer.from(tag, "latin1");
  if (tagBytes.length !== ARBITRARY_TAG_LENGTH) {
    throw new Error(`arbitrary fixture tag must be 4 bytes: "${tag}"`);
  }
  return Buffer.concat([
    Buffer.from([ARBITRARY_TAG_INDEX]),
    tagBytes,
    Buffer.from([ZERO_ORIG_LENGTH]),
  ]);
}

function entryFlags(tagIndex: number, transformVersion: number) {
  return (transformVersion << TRANSFORM_VERSION_SHIFT) | tagIndex;
}

function transformedGlyfEntry(transformLength: number) {
  const glyfIndex = KNOWN_WOFF2_TABLE_TAGS.indexOf("glyf");
  // Version 0 is glyf's transform → origLength then transformLength follow.
  return Buffer.concat([
    Buffer.from([
      entryFlags(glyfIndex, GLYF_LOCA_TRANSFORMED_VERSION),
      ZERO_ORIG_LENGTH,
    ]),
    encodeUIntBase128(transformLength),
  ]);
}

function nullTransformGlyfEntry() {
  const glyfIndex = KNOWN_WOFF2_TABLE_TAGS.indexOf("glyf");
  // Version 3 is glyf's null transform: origLength only, no transformLength.
  const flags = entryFlags(glyfIndex, GLYF_LOCA_NULL_TRANSFORM_VERSION);
  return Buffer.from([flags, ZERO_ORIG_LENGTH]);
}

const HMTX_TRANSFORM_VERSION = 1;

function transformedHmtxEntry(transformLength: number) {
  const hmtxIndex = KNOWN_WOFF2_TABLE_TAGS.indexOf("hmtx");
  // hmtx's only transform is version 1, which (unlike every other non-glyf/loca
  // table) carries a transformLength that must be skipped.
  return Buffer.concat([
    Buffer.from([
      entryFlags(hmtxIndex, HMTX_TRANSFORM_VERSION),
      ZERO_ORIG_LENGTH,
    ]),
    encodeUIntBase128(transformLength),
  ]);
}

function assembleWoff2(entries: Buffer[]) {
  const header = Buffer.alloc(WOFF2_HEADER_LENGTH);
  header.write(WOFF2_SIGNATURE, 0, "latin1");
  header.writeUInt16BE(entries.length, NUM_TABLES_OFFSET);
  return Buffer.concat([header, ...entries]);
}

function woff2FromKnownTags(tableTags: string[]) {
  return assembleWoff2(tableTags.map(knownTableEntry));
}

describe("shipped woff2 binaries are variable fonts", () => {
  const fontRows = shippedWoff2Paths().map((fontPath) => [
    basename(fontPath),
    fontPath,
  ]);

  it("finds shipped woff2 files to check", () => {
    // A zero-length it.each below would report as passing while covering nothing.
    expect(fontRows.length).toBeGreaterThan(0);
  });

  it.each(fontRows)(
    "%s ships with an fvar (variable axis) table",
    (name, fontPath) => {
      const buffer = readFileSync(fontPath);
      expect(hasVariableFontAxis(buffer), name).toBe(true);
    },
  );
});

describe("fvar detection has teeth", () => {
  it("detects fvar in a variable-font table directory", () => {
    const variableFont = woff2FromKnownTags(["head", "cmap", "fvar", "name"]);
    expect(hasVariableFontAxis(variableFont)).toBe(true);
  });

  it("rejects a static font whose table directory has no fvar", () => {
    // The exact hazard the assertion guards against: a per-weight static file. With no
    // fvar table the check must fail.
    const staticFont = woff2FromKnownTags(["head", "cmap", "name", "post"]);
    expect(hasVariableFontAxis(staticFont)).toBe(false);
  });

  it("stays aligned past a 4-byte arbitrary tag before fvar", () => {
    // Real variable fonts carry STAT (not a known tag), so the arbitrary-tag branch
    // fires on every shipped file; this pins it against a fixture too.
    const withArbitraryTag = assembleWoff2([
      arbitraryTableEntry("STAT"),
      knownTableEntry("fvar"),
    ]);
    expect(hasVariableFontAxis(withArbitraryTag)).toBe(true);
  });

  it("stays aligned past a transformed table's transformLength before fvar", () => {
    // glyf is transformed in every real font; a wrong transformLength skip would
    // desync the walk and miss (or fabricate) fvar. 300 forces a multi-byte length.
    const withTransformedGlyf = assembleWoff2([
      transformedGlyfEntry(300),
      knownTableEntry("fvar"),
    ]);
    expect(hasVariableFontAxis(withTransformedGlyf)).toBe(true);
  });

  it("reads no transformLength for a null-transformed glyf (version 3)", () => {
    // Version 3 is glyf's null transform: no transformLength. Skipping one here would
    // desync the walk and miss the following fvar.
    const withNullGlyf = assembleWoff2([
      nullTransformGlyfEntry(),
      knownTableEntry("fvar"),
    ]);
    expect(hasVariableFontAxis(withNullGlyf)).toBe(true);
  });

  it("skips a transformed hmtx's transformLength before fvar", () => {
    // hmtx is the one non-glyf/loca table with a transform (version 1); its
    // transformLength must be skipped even though hmtx is not in the transformable set.
    const withTransformedHmtx = assembleWoff2([
      transformedHmtxEntry(300),
      knownTableEntry("fvar"),
    ]);
    expect(hasVariableFontAxis(withTransformedHmtx)).toBe(true);
  });
});

describe("woff2 parsing fails loud on malformed input", () => {
  it("throws rather than decoding phantom tags past a truncated directory", () => {
    // readdirSync will happily hand a half-downloaded font to the parser; an
    // out-of-range read must throw, not silently decode undefined as a zero byte.
    const full = woff2FromKnownTags(["head", "cmap", "fvar"]);
    const truncated = full.subarray(0, WOFF2_HEADER_LENGTH + 3);
    expect(() => hasVariableFontAxis(truncated)).toThrow(
      /runs past end of file/,
    );
  });

  it("throws on a file that is not woff2", () => {
    const notAFont = Buffer.alloc(WOFF2_HEADER_LENGTH);
    notAFont.write("<!DO", 0, "latin1");
    expect(() => hasVariableFontAxis(notAFont)).toThrow(
      /expected woff2 signature/,
    );
  });

  it("throws on a file shorter than the woff2 header", () => {
    const tooShort = Buffer.from(WOFF2_SIGNATURE, "latin1");
    expect(() => hasVariableFontAxis(tooShort)).toThrow(/shorter than/);
  });

  it("throws on a UIntBase128 longer than five bytes", () => {
    // A corrupt origLength with five continuation bits set never terminates.
    const overlongLength = Buffer.concat([
      Buffer.from([KNOWN_WOFF2_TABLE_TAGS.indexOf("head")]),
      Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80]),
    ]);
    const overlong = assembleWoff2([overlongLength]);
    expect(() => hasVariableFontAxis(overlong)).toThrow(/exceeds 5 bytes/);
  });

  it("throws on an arbitrary tag truncated mid-tag", () => {
    // Only bounds check not routed through byteAt: a 0x3f flags byte with fewer than
    // four tag bytes left must fail loud rather than read past the buffer.
    const full = assembleWoff2([arbitraryTableEntry("STAT")]);
    const truncated = full.subarray(0, WOFF2_HEADER_LENGTH + 3);
    expect(() => hasVariableFontAxis(truncated)).toThrow(
      /arbitrary tag runs past end/,
    );
  });
});

// Pins the hand-transcribed known-tag table independently of the directory walk: the
// fixtures round-trip through this array, so only a spec-anchored check catches a
// dropped or reordered entry (which would otherwise surface as a confusing
// "shipped font has no fvar" failure).
describe("woff2 known-tag table matches the spec", () => {
  it("indexes the tags the parser depends on at their spec positions", () => {
    expect(KNOWN_WOFF2_TABLE_TAGS).toHaveLength(ARBITRARY_TAG_INDEX);
    // No duplicates: a duplicate tag would displace a real one and could make a
    // static font's entry decode as fvar (a silent false pass).
    expect(new Set(KNOWN_WOFF2_TABLE_TAGS).size).toBe(ARBITRARY_TAG_INDEX);
    expect(KNOWN_WOFF2_TABLE_TAGS.indexOf(FVAR_TABLE_TAG)).toBe(47);
    expect(KNOWN_WOFF2_TABLE_TAGS.indexOf("glyf")).toBe(10);
    expect(KNOWN_WOFF2_TABLE_TAGS.indexOf("loca")).toBe(11);
    expect(KNOWN_WOFF2_TABLE_TAGS.indexOf("hmtx")).toBe(3);
  });
});
