import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";

// fonts.css serves each family as a single variable woff2 that spans the weight axis
// (see the header comment there; the theme declares font-weight: 400 700). This suite
// parses each shipped woff2's table directory and fails if the variable-axis table
// (fvar) is missing. An fvar table is what distinguishes a variable font from the
// static, per-weight files a naive refresh would ship — Google's enumerated
// `wght@400;500;700` syntax returns one static file per weight (no fvar), which would
// render 500/700 as synthetic ("faux") bold with no other CI signal.
//
// Presence alone is not enough: a variable font whose wght axis stopped at, say,
// 300–600 would still ship an fvar table yet render 700 as faux bold. So this suite
// also brotli-decompresses the woff2 data block, reads the fvar axis records, and
// asserts the wght axis actually spans the 400–700 range the theme declares.
const FONTS_DIR = resolve(process.cwd(), "public", "fonts");
const FONTS_CSS_PATH = resolve(process.cwd(), ".vitepress/theme/fonts.css");
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
// font from a static, single-weight file, and it holds the axis min/max we assert on.
const FVAR_TABLE_TAG = "fvar";

// woff2 header (spec §4): totalCompressedSize (uint32 at offset 20) is the byte length
// of the single brotli stream that follows the uncompressed table directory.
const TOTAL_COMPRESSED_SIZE_OFFSET = 20;

// flavor (uint32 at offset 4) is the wrapped sfnt version. "ttcf" marks a font
// collection, which interposes a CollectionDirectory before the brotli block — our
// single-font offset math would then point into that directory and hand brotli garbage.
const FLAVOR_OFFSET = 4;
const FLAVOR_LENGTH = 4;
const FONT_COLLECTION_FLAVOR = "ttcf";

// fvar table layout (OpenType fvar): a header, then axisCount VariationAxisRecords.
const FVAR_AXES_ARRAY_OFFSET_FIELD = 4; // uint16: bytes from fvar start to the axis array
const FVAR_AXIS_COUNT_OFFSET = 8; // uint16
const FVAR_AXIS_SIZE_OFFSET = 10; // uint16: byte length of one VariationAxisRecord
const FVAR_HEADER_LENGTH = 16;

// VariationAxisRecord (OpenType fvar): axisTag then three Fixed (16.16) values.
const AXIS_RECORD_LENGTH = 20;
const AXIS_TAG_LENGTH = 4;
const AXIS_MIN_VALUE_OFFSET = 4;
const AXIS_DEFAULT_VALUE_OFFSET = 8;
const AXIS_MAX_VALUE_OFFSET = 12;

// Fixed is a signed 16.16 fixed-point number: divide the raw int32 by 65536.
const FIXED_POINT_DIVISOR = 65536;

// The one axis this suite asserts on, and the range fonts.css declares (font-weight:
// 400 700). "Covers" means the axis min is at or below 400 and its max at or above 700.
const WEIGHT_AXIS_TAG = "wght";
const MIN_DECLARED_WEIGHT = 400;
const MAX_DECLARED_WEIGHT = 700;

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

// A table's byte length inside the decompressed stream is its transformLength when
// transformed (glyf/loca), otherwise its origLength. Returns that size plus the offset
// just past whichever length field(s) this entry carries, to keep the walk aligned.
function readTableSize(
  buffer: Buffer,
  tag: string,
  transformVersion: number,
  offset: number,
) {
  const origLength = readUIntBase128(buffer, offset);
  if (!isTableTransformed(tag, transformVersion)) {
    return { streamSize: origLength.value, nextOffset: origLength.nextOffset };
  }
  const transformLength = readUIntBase128(buffer, origLength.nextOffset);
  return {
    streamSize: transformLength.value,
    nextOffset: transformLength.nextOffset,
  };
}

function readTableDirectoryEntry(buffer: Buffer, offset: number) {
  const flags = byteAt(buffer, offset);
  const tagIndex = flags & TAG_INDEX_MASK;
  const transformVersion = flags >> TRANSFORM_VERSION_SHIFT;
  const { tag, afterTag } = readEntryTag(buffer, tagIndex, offset + 1);
  const { streamSize, nextOffset } = readTableSize(
    buffer,
    tag,
    transformVersion,
    afterTag,
  );
  return { tag, streamSize, nextOffset };
}

type TableEntry = { tag: string; streamSize: number };

// Walks the uncompressed directory once, returning every entry (tag + its size in the
// decompressed stream) and where the directory ends — i.e. where the brotli block begins.
function readWoff2Directory(buffer: Buffer) {
  assertWoff2Signature(buffer);
  const tableCount = buffer.readUInt16BE(NUM_TABLES_OFFSET);
  const entries: TableEntry[] = [];
  let offset = WOFF2_HEADER_LENGTH;
  for (let index = 0; index < tableCount; index++) {
    const entry = readTableDirectoryEntry(buffer, offset);
    entries.push({ tag: entry.tag, streamSize: entry.streamSize });
    offset = entry.nextOffset;
  }
  return { entries, directoryEndOffset: offset };
}

function readWoff2TableTags(buffer: Buffer) {
  return readWoff2Directory(buffer).entries.map((entry) => entry.tag);
}

function hasVariableFontAxis(buffer: Buffer) {
  return readWoff2TableTags(buffer).includes(FVAR_TABLE_TAG);
}

// The decompressed stream is every table's data concatenated in directory order, so a
// table's offset is the running sum of the sizes of the tables ahead of it.
function locateTableInStream(entries: TableEntry[], tag: string) {
  let offset = 0;
  for (const entry of entries) {
    if (entry.tag === tag) {
      return { offset, length: entry.streamSize };
    }
    offset += entry.streamSize;
  }
  return null;
}

// Rethrows a brotli failure in this file's voice so a corrupt block names the font
// rather than surfacing an opaque zlib code (e.g. ERR_PADDING_1).
function decompressBrotliBlock(compressed: Buffer, directoryEndOffset: number) {
  try {
    return brotliDecompressSync(compressed);
  } catch (error) {
    throw new Error(
      `woff2 compressed block at ${directoryEndOffset} is not valid brotli: ${(error as Error).message}`,
      { cause: error },
    );
  }
}

function assertSingleFontFlavor(buffer: Buffer) {
  const flavor = buffer.toString(
    "latin1",
    FLAVOR_OFFSET,
    FLAVOR_OFFSET + FLAVOR_LENGTH,
  );
  if (flavor !== FONT_COLLECTION_FLAVOR) {
    return;
  }
  throw new Error(
    `woff2 flavor "${FONT_COLLECTION_FLAVOR}" (font collection) is not supported by this parser`,
  );
}

function decompressTableStream(buffer: Buffer, directoryEndOffset: number) {
  assertSingleFontFlavor(buffer);
  const totalCompressedSize = buffer.readUInt32BE(TOTAL_COMPRESSED_SIZE_OFFSET);
  const streamEnd = directoryEndOffset + totalCompressedSize;
  // subarray clamps silently, so a truncated download would reach brotli as a short
  // stream and fail with an opaque zlib error instead of this file's own message.
  if (streamEnd > buffer.length) {
    throw new Error(
      `woff2 compressed block (${totalCompressedSize} bytes at ${directoryEndOffset}) runs past end of file`,
    );
  }
  const compressed = buffer.subarray(directoryEndOffset, streamEnd);
  return decompressBrotliBlock(compressed, directoryEndOffset);
}

function readFixed(buffer: Buffer, offset: number) {
  return buffer.readInt32BE(offset) / FIXED_POINT_DIVISOR;
}

// Rejects an fvar whose record array doesn't fit its buffer, so an upstream
// offset-math desync fails loud here rather than falling through as "no wght axis".
function assertAxisRecordsFit(
  fvar: Buffer,
  axesArrayOffset: number,
  axisCount: number,
  axisSize: number,
) {
  if (axesArrayOffset < FVAR_HEADER_LENGTH) {
    throw new Error(
      `woff2 fvar axesArrayOffset ${axesArrayOffset} overlaps the ${FVAR_HEADER_LENGTH}-byte header`,
    );
  }
  if (axisSize < AXIS_RECORD_LENGTH) {
    throw new Error(
      `woff2 fvar axisSize ${axisSize} is shorter than a ${AXIS_RECORD_LENGTH}-byte VariationAxisRecord`,
    );
  }
  if (axesArrayOffset + axisCount * axisSize > fvar.length) {
    throw new Error(
      `woff2 fvar axis records run past the ${fvar.length}-byte table`,
    );
  }
}

// Scans the fvar VariationAxisRecords for wght and returns its Fixed-decoded bounds.
function findWeightAxisBounds(fvar: Buffer) {
  if (fvar.length < FVAR_HEADER_LENGTH) {
    throw new Error(
      `woff2 fvar table is ${fvar.length} bytes, shorter than its ${FVAR_HEADER_LENGTH}-byte header`,
    );
  }
  const axesArrayOffset = fvar.readUInt16BE(FVAR_AXES_ARRAY_OFFSET_FIELD);
  const axisCount = fvar.readUInt16BE(FVAR_AXIS_COUNT_OFFSET);
  const axisSize = fvar.readUInt16BE(FVAR_AXIS_SIZE_OFFSET);
  assertAxisRecordsFit(fvar, axesArrayOffset, axisCount, axisSize);
  for (let index = 0; index < axisCount; index++) {
    const recordOffset = axesArrayOffset + index * axisSize;
    const tag = fvar.toString(
      "latin1",
      recordOffset,
      recordOffset + AXIS_TAG_LENGTH,
    );
    if (tag !== WEIGHT_AXIS_TAG) {
      continue;
    }
    return {
      min: readFixed(fvar, recordOffset + AXIS_MIN_VALUE_OFFSET),
      max: readFixed(fvar, recordOffset + AXIS_MAX_VALUE_OFFSET),
    };
  }
  throw new Error(`woff2 fvar table has no ${WEIGHT_AXIS_TAG} axis`);
}

function readWeightAxisBounds(buffer: Buffer) {
  const { entries, directoryEndOffset } = readWoff2Directory(buffer);
  const fvarLocation = locateTableInStream(entries, FVAR_TABLE_TAG);
  if (!fvarLocation) {
    throw new Error("woff2 has no fvar table to read a weight axis from");
  }
  const stream = decompressTableStream(buffer, directoryEndOffset);
  const fvarEnd = fvarLocation.offset + fvarLocation.length;
  // subarray clamps, so a bad running-offset sum would hand findWeightAxisBounds a
  // short/empty slice that reads as "no wght axis" — blame the parser, not the font.
  if (fvarEnd > stream.length) {
    throw new Error(
      `woff2 fvar table at stream offset ${fvarLocation.offset} runs past the ${stream.length}-byte decompressed stream`,
    );
  }
  const fvar = stream.subarray(fvarLocation.offset, fvarEnd);
  return findWeightAxisBounds(fvar);
}

// The one guard the shipped-font assertion turns on: the axis min reaches down to 400
// and its max up to 700. Shared with the teeth tests so both directions are pinned.
function coversDeclaredWeightRange(bounds: { min: number; max: number }) {
  return bounds.min <= MIN_DECLARED_WEIGHT && bounds.max >= MAX_DECLARED_WEIGHT;
}

function shippedWoff2Paths() {
  if (!existsSync(FONTS_DIR)) {
    return [];
  }
  return readdirSync(FONTS_DIR)
    .filter((name) => name.endsWith(WOFF2_EXTENSION))
    .map((name) => resolve(FONTS_DIR, name));
}

// Shared by both shipped-font suites so a single non-empty guard (below) provably
// covers every it.each over it — a per-describe copy could silently cover nothing.
const SHIPPED_FONT_ROWS = shippedWoff2Paths().map((fontPath) => [
  basename(fontPath),
  fontPath,
]);

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

function knownTableEntryWithLength(tag: string, origLength: number) {
  const tagIndex = KNOWN_WOFF2_TABLE_TAGS.indexOf(tag);
  if (tagIndex < 0 || NULL_TRANSFORM_V3_TAGS.has(tag)) {
    throw new Error(
      `fixture tag must be a known tag with a version-0 null transform (not glyf/loca): "${tag}"`,
    );
  }
  // Transform version 0 + known-tag index, then the UIntBase128 origLength.
  return Buffer.concat([
    Buffer.from([tagIndex]),
    encodeUIntBase128(origLength),
  ]);
}

function knownTableEntry(tag: string) {
  return knownTableEntryWithLength(tag, ZERO_ORIG_LENGTH);
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

function transformedHmtxEntryWithLengths(
  origLength: number,
  transformLength: number,
) {
  const hmtxIndex = KNOWN_WOFF2_TABLE_TAGS.indexOf("hmtx");
  // hmtx's only transform is version 1, which (unlike every other non-glyf/loca
  // table) carries a transformLength; its size in the decompressed stream is that
  // transformLength, NOT origLength.
  return Buffer.concat([
    Buffer.from([entryFlags(hmtxIndex, HMTX_TRANSFORM_VERSION)]),
    encodeUIntBase128(origLength),
    encodeUIntBase128(transformLength),
  ]);
}

function transformedHmtxEntry(transformLength: number) {
  return transformedHmtxEntryWithLengths(ZERO_ORIG_LENGTH, transformLength);
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

// --- Fixtures for the axis-decoding tests -------------------------------------
// Decoding the wght bounds reads the real table data, so these builders assemble a
// woff2 whose brotli block decompresses to a hand-built fvar table (optionally behind
// a preceding table, to exercise the running-offset math).

type AxisSpec = { tag: string; min: number; default: number; max: number };

function encodeFixed(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(Math.round(value * FIXED_POINT_DIVISOR));
  return buffer;
}

function buildAxisRecord(axis: AxisSpec) {
  const record = Buffer.alloc(AXIS_RECORD_LENGTH);
  record.write(axis.tag, 0, "latin1");
  encodeFixed(axis.min).copy(record, AXIS_MIN_VALUE_OFFSET);
  encodeFixed(axis.default).copy(record, AXIS_DEFAULT_VALUE_OFFSET);
  encodeFixed(axis.max).copy(record, AXIS_MAX_VALUE_OFFSET);
  // flags + axisNameID (the last 4 bytes) stay zero; the parser reads neither.
  return record;
}

const FVAR_MAJOR_VERSION = 1;

// Overrides let a fixture declare a malformed header (an axesArrayOffset that overlaps
// the header, or an axisSize below one record) to exercise the validator's guards.
type FvarHeaderOverrides = { axesArrayOffset?: number; axisSize?: number };

function buildFvarTable(axes: AxisSpec[], overrides: FvarHeaderOverrides = {}) {
  const header = Buffer.alloc(FVAR_HEADER_LENGTH);
  header.writeUInt16BE(FVAR_MAJOR_VERSION, 0);
  header.writeUInt16BE(
    overrides.axesArrayOffset ?? FVAR_HEADER_LENGTH,
    FVAR_AXES_ARRAY_OFFSET_FIELD,
  );
  header.writeUInt16BE(axes.length, FVAR_AXIS_COUNT_OFFSET);
  header.writeUInt16BE(
    overrides.axisSize ?? AXIS_RECORD_LENGTH,
    FVAR_AXIS_SIZE_OFFSET,
  );
  // instanceCount + instanceSize stay zero; the parser reads neither.
  return Buffer.concat([header, ...axes.map(buildAxisRecord)]);
}

// Assembles a woff2 with a real (brotli-compressed) data block from pre-built directory
// entries paired with their stream data — the low-level form that lets a test pair a
// transformed entry (whose stream size is its transformLength) with shorter data.
function woff2FromDirectoryEntries(parts: { entry: Buffer; data: Buffer }[]) {
  const stream = Buffer.concat(parts.map((part) => part.data));
  const compressed = brotliCompressSync(stream);
  const header = Buffer.alloc(WOFF2_HEADER_LENGTH);
  header.write(WOFF2_SIGNATURE, 0, "latin1");
  header.writeUInt16BE(parts.length, NUM_TABLES_OFFSET);
  header.writeUInt32BE(compressed.length, TOTAL_COMPRESSED_SIZE_OFFSET);
  return Buffer.concat([
    header,
    ...parts.map((part) => part.entry),
    compressed,
  ]);
}

// Each table's origLength in the directory matches its data length, so the parser's
// offset math resolves fvar from untransformed tables alone.
function woff2WithTableData(tables: { tag: string; data: Buffer }[]) {
  return woff2FromDirectoryEntries(
    tables.map((table) => ({
      entry: knownTableEntryWithLength(table.tag, table.data.length),
      data: table.data,
    })),
  );
}

function woff2WithAxes(axes: AxisSpec[]) {
  return woff2WithTableData([
    { tag: FVAR_TABLE_TAG, data: buildFvarTable(axes) },
  ]);
}

// A wght axis that covers 400-700 with room to spare, and one that stops short of 700.
const COVERING_WEIGHT_AXIS: AxisSpec = {
  tag: WEIGHT_AXIS_TAG,
  min: 300,
  default: 400,
  max: 700,
};
const NARROW_WEIGHT_AXIS: AxisSpec = {
  tag: WEIGHT_AXIS_TAG,
  min: 500,
  default: 500,
  max: 600,
};
// Each fails exactly one half of the coverage check, pinning both halves of the
// predicate independently: this one reaches 700 but its floor sits above 400 …
const HIGH_FLOOR_WEIGHT_AXIS: AxisSpec = {
  tag: WEIGHT_AXIS_TAG,
  min: 500,
  default: 500,
  max: 800,
};
// … and this one starts at 400 but its ceiling stops below 700.
const LOW_CEILING_WEIGHT_AXIS: AxisSpec = {
  tag: WEIGHT_AXIS_TAG,
  min: 300,
  default: 400,
  max: 600,
};
const WIDTH_AXIS: AxisSpec = { tag: "wdth", min: 75, default: 100, max: 125 };

describe("shipped woff2 binaries are variable fonts", () => {
  it("finds shipped woff2 files to check", () => {
    // A zero-length it.each in either shipped-font suite would report as passing while
    // covering nothing; this guard fails first and covers both.
    expect(SHIPPED_FONT_ROWS.length).toBeGreaterThan(0);
  });

  it.each(SHIPPED_FONT_ROWS)(
    "%s ships with an fvar (variable axis) table",
    (name, fontPath) => {
      const buffer = readFileSync(fontPath);
      expect(hasVariableFontAxis(buffer), name).toBe(true);
    },
  );
});

describe("shipped woff2 fonts span the declared weight axis", () => {
  it("fonts.css still declares the weight range this suite asserts", () => {
    // MIN/MAX_DECLARED_WEIGHT restate fonts.css's `font-weight: 400 700`; pin them to
    // it so widening the CSS without widening this guard can't pass silently.
    const css = readFileSync(FONTS_CSS_PATH, "utf8");
    expect(css).toContain(
      `font-weight: ${MIN_DECLARED_WEIGHT} ${MAX_DECLARED_WEIGHT}`,
    );
  });

  it.each(SHIPPED_FONT_ROWS)(
    "%s wght axis covers the declared 400-700 range",
    (name, fontPath) => {
      const bounds = readWeightAxisBounds(readFileSync(fontPath));
      expect(
        coversDeclaredWeightRange(bounds),
        `${name} wght ${bounds.min}-${bounds.max}`,
      ).toBe(true);
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

describe("wght axis decoding has teeth", () => {
  it("reads the wght min and max from the brotli-compressed fvar table", () => {
    const font = woff2WithAxes([COVERING_WEIGHT_AXIS]);
    const bounds = readWeightAxisBounds(font);
    expect(bounds.min).toBe(COVERING_WEIGHT_AXIS.min);
    expect(bounds.max).toBe(COVERING_WEIGHT_AXIS.max);
  });

  it("accepts a wght axis that spans the declared range", () => {
    // Pins the "true" direction of the very predicate the shipped-font assertion runs.
    const bounds = readWeightAxisBounds(woff2WithAxes([COVERING_WEIGHT_AXIS]));
    expect(coversDeclaredWeightRange(bounds)).toBe(true);
  });

  it("reports a wght axis that stops short of 700 as not covering the range", () => {
    // The exact regression the shipped-font assertion guards against: a variable font
    // that still ships an fvar but whose wght axis can't reach the declared 700, so
    // bold renders faux. It must fail the same predicate the shipped fonts pass.
    const bounds = readWeightAxisBounds(woff2WithAxes([NARROW_WEIGHT_AXIS]));
    expect(bounds.min).toBe(NARROW_WEIGHT_AXIS.min);
    expect(bounds.max).toBe(NARROW_WEIGHT_AXIS.max);
    expect(coversDeclaredWeightRange(bounds)).toBe(false);
  });

  it("rejects an axis that reaches 700 but whose floor sits above 400", () => {
    // Pins the min half of the predicate: dropping the `min` check would pass this.
    const bounds = readWeightAxisBounds(
      woff2WithAxes([HIGH_FLOOR_WEIGHT_AXIS]),
    );
    expect(coversDeclaredWeightRange(bounds)).toBe(false);
  });

  it("rejects an axis that starts at 400 but whose ceiling stops below 700", () => {
    // Pins the max half of the predicate: dropping the `max` check would pass this.
    const bounds = readWeightAxisBounds(
      woff2WithAxes([LOW_CEILING_WEIGHT_AXIS]),
    );
    expect(coversDeclaredWeightRange(bounds)).toBe(false);
  });

  it("locates fvar after a preceding table in the decompressed stream", () => {
    // fvar sits at a non-zero stream offset here; a wrong running-offset sum would
    // read the wrong bytes and misreport the bounds.
    const precedingTableData = Buffer.alloc(64, 0xab);
    const font = woff2WithTableData([
      { tag: "head", data: precedingTableData },
      { tag: FVAR_TABLE_TAG, data: buildFvarTable([COVERING_WEIGHT_AXIS]) },
    ]);
    const bounds = readWeightAxisBounds(font);
    expect(bounds.min).toBe(COVERING_WEIGHT_AXIS.min);
    expect(bounds.max).toBe(COVERING_WEIGHT_AXIS.max);
  });

  it("finds the wght axis among multiple variation axes", () => {
    // A leading non-wght axis forces the record scan to skip past axisSize bytes; a
    // wrong stride would read the width axis's bounds instead.
    const bounds = readWeightAxisBounds(
      woff2WithAxes([WIDTH_AXIS, COVERING_WEIGHT_AXIS]),
    );
    expect(bounds.min).toBe(COVERING_WEIGHT_AXIS.min);
    expect(bounds.max).toBe(COVERING_WEIGHT_AXIS.max);
  });

  it("uses a transformed table's transformLength, not origLength, for the fvar offset", () => {
    // A transformed table occupies transformLength bytes in the decompressed stream,
    // not its (larger) origLength. Its origLength is deliberately huge here: if the
    // offset math used origLength, fvar would resolve far past the stream and throw.
    const HMTX_STREAM_LENGTH = 64;
    const HMTX_ORIG_LENGTH = 9999;
    const fvarData = buildFvarTable([COVERING_WEIGHT_AXIS]);
    const font = woff2FromDirectoryEntries([
      {
        entry: transformedHmtxEntryWithLengths(
          HMTX_ORIG_LENGTH,
          HMTX_STREAM_LENGTH,
        ),
        data: Buffer.alloc(HMTX_STREAM_LENGTH, 0xab),
      },
      {
        entry: knownTableEntryWithLength(FVAR_TABLE_TAG, fvarData.length),
        data: fvarData,
      },
    ]);
    const bounds = readWeightAxisBounds(font);
    expect(bounds.min).toBe(COVERING_WEIGHT_AXIS.min);
    expect(bounds.max).toBe(COVERING_WEIGHT_AXIS.max);
  });

  it("throws when the fvar table declares no wght axis", () => {
    expect(() => readWeightAxisBounds(woff2WithAxes([WIDTH_AXIS]))).toThrow(
      /no wght axis/,
    );
  });

  it("throws when the font has no fvar table to read", () => {
    const font = woff2WithTableData([{ tag: "head", data: Buffer.alloc(4) }]);
    expect(() => readWeightAxisBounds(font)).toThrow(/no fvar table/);
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

  it("throws on a compressed block truncated past the directory", () => {
    // A half-downloaded font must fail with our own message, not an opaque zlib error
    // when brotli is handed a short stream.
    const full = woff2WithAxes([COVERING_WEIGHT_AXIS]);
    const truncated = full.subarray(0, full.length - 1);
    expect(() => readWeightAxisBounds(truncated)).toThrow(
      /compressed block .* runs past end of file/,
    );
  });

  it("throws when the fvar axis records run past the table", () => {
    // A desynced slice (e.g. a wrong offset) hands findWeightAxisBounds a too-short
    // fvar; that must fail loud, not fall through as a bogus "no wght axis".
    const fvar = buildFvarTable([COVERING_WEIGHT_AXIS]);
    const shortFvar = fvar.subarray(0, FVAR_HEADER_LENGTH + 1);
    const font = woff2WithTableData([{ tag: FVAR_TABLE_TAG, data: shortFvar }]);
    expect(() => readWeightAxisBounds(font)).toThrow(/records run past/);
  });

  it("throws on an fvar table shorter than its header", () => {
    // Below the 16-byte header, reading axisCount/axisSize would RangeError inside
    // Node; guard first so the failure names the table, not a raw buffer overrun.
    const font = woff2WithTableData([
      { tag: FVAR_TABLE_TAG, data: Buffer.alloc(4) },
    ]);
    expect(() => readWeightAxisBounds(font)).toThrow(
      /shorter than its .* header/,
    );
  });

  it("throws when a declared table length runs past the decompressed stream", () => {
    // origLength in the directory exceeds the actual data, so fvar's computed slice
    // overshoots the stream; that must fail loud, not clamp to a short slice.
    const fvarData = buildFvarTable([COVERING_WEIGHT_AXIS]);
    const font = woff2FromDirectoryEntries([
      {
        entry: knownTableEntryWithLength(FVAR_TABLE_TAG, fvarData.length + 64),
        data: fvarData,
      },
    ]);
    expect(() => readWeightAxisBounds(font)).toThrow(
      /runs past the .* decompressed stream/,
    );
  });

  it("throws when fvar axesArrayOffset overlaps the header", () => {
    const font = woff2WithTableData([
      {
        tag: FVAR_TABLE_TAG,
        data: buildFvarTable([COVERING_WEIGHT_AXIS], { axesArrayOffset: 8 }),
      },
    ]);
    expect(() => readWeightAxisBounds(font)).toThrow(/overlaps the .* header/);
  });

  it("throws when fvar axisSize is shorter than a VariationAxisRecord", () => {
    const font = woff2WithTableData([
      {
        tag: FVAR_TABLE_TAG,
        data: buildFvarTable([COVERING_WEIGHT_AXIS], { axisSize: 12 }),
      },
    ]);
    expect(() => readWeightAxisBounds(font)).toThrow(
      /shorter than a .* VariationAxisRecord/,
    );
  });

  it("throws a named error when the brotli block is corrupt", () => {
    // Flip the final byte so the block is complete-length but not valid brotli; the
    // failure must name the font, not surface a raw zlib code.
    const font = Buffer.from(woff2WithAxes([COVERING_WEIGHT_AXIS]));
    font[font.length - 1] ^= 0xff;
    expect(() => readWeightAxisBounds(font)).toThrow(/not valid brotli/);
  });

  it("rejects a font-collection (ttcf) flavor rather than misparsing it", () => {
    // A collection interposes a CollectionDirectory before the brotli block; without
    // the flavor guard the offset math would hand brotli garbage.
    const font = Buffer.from(woff2WithAxes([COVERING_WEIGHT_AXIS]));
    font.write(FONT_COLLECTION_FLAVOR, FLAVOR_OFFSET, "latin1");
    expect(() => readWeightAxisBounds(font)).toThrow(
      /is not supported by this parser/,
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
