/**
 * Advance widths read from a TrueType or OpenType font file, so labels can be
 * measured before the rasterizer draws them. Kerning is left out: it only
 * narrows text, so a measured box always holds the drawn label.
 */

export interface FontMetrics {
  /** The text's width at `size` pixels. */
  width(text: string, size: number): number;
  /** True when the font has a glyph for every character of `text`. */
  covers(text: string): boolean;
  /** Ascender and descender as fractions of the size (descender positive). */
  ascent: number;
  descent: number;
}

export function readFontMetrics(font: Uint8Array): FontMetrics {
  const data = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const tables = new Map<string, number>();
  const count = data.getUint16(4);
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16;
    const tag = String.fromCharCode(
      ...font.subarray(record, record + 4).values(),
    );
    tables.set(tag, data.getUint32(record + 8));
  }
  const table = (tag: string): number => {
    const offset = tables.get(tag);
    if (offset === undefined) throw new Error(`font has no ${tag} table`);
    return offset;
  };
  const unitsPerEm = data.getUint16(table("head") + 18);
  const hhea = table("hhea");
  const ascender = data.getInt16(hhea + 4);
  const descender = data.getInt16(hhea + 6);
  const metricsCount = data.getUint16(hhea + 34);
  const hmtx = table("hmtx");
  const glyphOf = readCmap(data, table("cmap"));
  const advanceOfGlyph = (glyph: number): number =>
    data.getUint16(hmtx + 4 * Math.min(glyph, metricsCount - 1));
  const cache = new Map<number, number>();
  const advance = (codePoint: number): number => {
    let value = cache.get(codePoint);
    if (value === undefined) {
      value = advanceOfGlyph(glyphOf(codePoint));
      cache.set(codePoint, value);
    }
    return value;
  };
  return {
    width(text, size) {
      let units = 0;
      for (const char of text) units += advance(char.codePointAt(0) ?? 0);
      return (units / unitsPerEm) * size;
    },
    covers(text) {
      for (const char of text) {
        if (glyphOf(char.codePointAt(0) ?? 0) === 0) return false;
      }
      return true;
    },
    ascent: ascender / unitsPerEm,
    descent: -descender / unitsPerEm,
  };
}

/** A code point to glyph lookup from the best Unicode `cmap` subtable. */
function readCmap(data: DataView, cmap: number): (codePoint: number) => number {
  const count = data.getUint16(cmap + 2);
  let format4: number | undefined;
  let format12: number | undefined;
  for (let i = 0; i < count; i++) {
    const record = cmap + 4 + i * 8;
    const platform = data.getUint16(record);
    const encoding = data.getUint16(record + 2);
    const subtable = cmap + data.getUint32(record + 4);
    const unicode =
      platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const format = data.getUint16(subtable);
    if (format === 12) format12 ??= subtable;
    if (format === 4) format4 ??= subtable;
  }
  if (format12 !== undefined) {
    const at = format12;
    const groups = data.getUint32(at + 12);
    return (codePoint) => {
      for (let i = 0; i < groups; i++) {
        const group = at + 16 + i * 12;
        const start = data.getUint32(group);
        if (codePoint < start) return 0;
        if (codePoint <= data.getUint32(group + 4)) {
          return data.getUint32(group + 8) + codePoint - start;
        }
      }
      return 0;
    };
  }
  if (format4 !== undefined) {
    const at = format4;
    const segments = data.getUint16(at + 6) / 2;
    const ends = at + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const offsets = deltas + segments * 2;
    return (codePoint) => {
      if (codePoint > 0xffff) return 0;
      for (let i = 0; i < segments; i++) {
        if (codePoint > data.getUint16(ends + i * 2)) continue;
        const start = data.getUint16(starts + i * 2);
        if (codePoint < start) return 0;
        const delta = data.getInt16(deltas + i * 2);
        const rangeOffset = data.getUint16(offsets + i * 2);
        if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
        const glyph = data.getUint16(
          offsets + i * 2 + rangeOffset + (codePoint - start) * 2,
        );
        return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
      }
      return 0;
    };
  }
  throw new Error("font has no Unicode cmap");
}
