/**
 * A small PNG reader for tests: the size and the RGBA pixels of an 8-bit
 * truecolour-with-alpha, non-interlaced PNG, the kind the rasterizer writes.
 */
export interface DecodedPng {
  width: number;
  height: number;
  /** The colour at a pixel as `#rrggbb` and its alpha 0..255. */
  pixel(x: number, y: number): { rgb: string; alpha: number };
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export async function decodePng(png: Uint8Array): Promise<DecodedPng> {
  if (!SIGNATURE.every((byte, i) => png[i] === byte)) {
    throw new Error("not a PNG");
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  for (let at = 8; at < png.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const [depth, colour, , , interlace] = data.subarray(8);
      if (depth !== 8 || colour !== 6 || interlace !== 0) {
        throw new Error("only 8-bit RGBA non-interlaced PNGs are read");
      }
    }
    if (type === "IDAT") idat.push(data);
    at += 12 + length;
  }
  const inflated = new Uint8Array(
    await new Response(
      new Blob(idat).stream().pipeThrough(new DecompressionStream("deflate")),
    ).arrayBuffer(),
  );
  const stride = width * 4;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)];
    const row = inflated.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? (pixels[y * stride + i - 4] ?? 0) : 0;
      const b = y > 0 ? (pixels[(y - 1) * stride + i] ?? 0) : 0;
      const c = i >= 4 && y > 0 ? (pixels[(y - 1) * stride + i - 4] ?? 0) : 0;
      const raw = row[i] ?? 0;
      let value: number;
      switch (filter) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + a;
          break;
        case 2:
          value = raw + b;
          break;
        case 3:
          value = raw + Math.floor((a + b) / 2);
          break;
        case 4:
          value = raw + paeth(a, b, c);
          break;
        default:
          throw new Error(`unknown PNG filter ${String(filter)}`);
      }
      pixels[y * stride + i] = value & 0xff;
    }
  }
  return {
    width,
    height,
    pixel(x, y) {
      const at = Math.round(y) * stride + Math.round(x) * 4;
      const hex = (i: number) =>
        (pixels[at + i] ?? 0).toString(16).padStart(2, "0");
      return {
        rgb: `#${hex(0)}${hex(1)}${hex(2)}`,
        alpha: pixels[at + 3] ?? 0,
      };
    },
  };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** The largest difference of one channel between two `#rrggbb` colours. */
export function colourDistance(a: string, b: string): number {
  const channels = (hex: string) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [channels(a.toLowerCase()), channels(b.toLowerCase())];
  return Math.max(...x.map((v, i) => Math.abs(v - (y[i] ?? 0))));
}
