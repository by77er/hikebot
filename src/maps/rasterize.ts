/**
 * Turns an SVG document into PNG bytes with resvg compiled to WebAssembly.
 * The module is imported statically (Workers cannot compile WebAssembly from
 * bytes at run time) and instantiated once per isolate, on first use.
 */
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";

let ready: Promise<void> | undefined;

/** Rasterizes `svg` at its own width and height, with `fonts` for text. */
export async function rasterize(
  svg: string,
  fonts: Uint8Array[],
): Promise<Uint8Array> {
  ready ??= initWasm(resvgWasm);
  await ready;
  const renderer = new Resvg(svg, {
    font: { fontBuffers: fonts, loadSystemFonts: false },
  });
  try {
    const image = renderer.render();
    try {
      return image.asPng();
    } finally {
      image.free();
    }
  } finally {
    renderer.free();
  }
}
