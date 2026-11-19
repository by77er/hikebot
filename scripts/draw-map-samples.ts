/**
 * `npm run maps:samples`: starts the Worker in local workerd with the sample
 * map archive in its bucket, draws the views in `map-samples.ts` through the
 * `MapPainter` Durable Object and writes them to `docs/maps/samples/`. Then
 * draws the pin on each fill in `PIN_FILLS` with the same drawing code and
 * rasterizer, here in Node, from made-up tiles.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { createTestHarness } from "wrangler";
import { readFontMetrics } from "../src/maps/font-metrics";
import { FAMILY } from "../src/maps/style";
import { buildSvg } from "../src/maps/svg";
import { seedMaps, type MapsBucket } from "../test/e2e/harness/maps";
import { PIN_FILLS, drawSamples, pinScene, type Paint } from "./map-samples";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = fileURLToPath(new URL("../docs/maps/samples/", import.meta.url));
const FONTS = fileURLToPath(new URL("../src/maps/fonts/", import.meta.url));
const WASM = fileURLToPath(
  import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm"),
);

interface PainterEnv {
  MAPS: MapsBucket;
  MAP_PAINTER: {
    idFromName(name: string): unknown;
    get(id: unknown): { picture: Paint };
  };
}

// Drawing needs no secrets; these dummies only satisfy secrets.required.
const secrets = {
  DISCORD_PUBLIC_KEY: "00".repeat(32),
  DISCORD_APPLICATION_ID: "000000000000000000",
  DISCORD_BOT_TOKEN: "unused",
  DISCORD_CLIENT_SECRET: "unused",
  SIGNING_SECRET: "unused-signing-secret-of-at-least-32-chars",
};
const harness = createTestHarness({
  root: ROOT,
  workers: [{ configPath: "wrangler.jsonc", secrets }],
});
try {
  await harness.listen();
  const env = await harness.getWorker<PainterEnv>().getEnv();
  await seedMaps(env.MAPS);
  const painter = env.MAP_PAINTER.get(env.MAP_PAINTER.idFromName("maps"));
  await mkdir(OUT, { recursive: true });
  const failed = await drawSamples(
    (request) => painter.picture(request),
    (file, png) => writeFile(`${OUT}${file}`, png),
    {
      log: (line) => {
        console.log(line);
      },
      error: (line) => {
        console.error(line);
      },
    },
  );
  await drawPins();
  process.exitCode = failed;
} finally {
  await harness.close();
}

/** Draws the pin on each fill in `PIN_FILLS`, as the Worker would. */
async function drawPins(): Promise<void> {
  await initWasm(await readFile(WASM));
  const files = (await readdir(FONTS)).filter((file) => file.endsWith(".ttf"));
  const buffers = await Promise.all(
    files.map(async (file) => new Uint8Array(await readFile(FONTS + file))),
  );
  const regular = new Uint8Array(
    await readFile(`${FONTS}PublicSans-Regular.ttf`),
  );
  const metrics = readFontMetrics(regular);
  for (const fill of PIN_FILLS) {
    const scene = pinScene(fill, { family: FAMILY, metrics: () => metrics });
    const renderer = new Resvg(buildSvg(scene), {
      font: { fontBuffers: buffers, loadSystemFonts: false },
    });
    const image = renderer.render();
    const png = image.asPng();
    image.free();
    renderer.free();
    await writeFile(OUT + fill.file, png);
    console.log(
      `${fill.file}: the pin on ${fill.kind}, ${String(Math.round(png.length / 1024))} KiB`,
    );
  }
}
