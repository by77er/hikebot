/**
 * `npm run maps:samples`: starts the Worker in local workerd with the sample
 * map archive in its bucket, draws the views in `map-samples.ts` through the
 * `MapPainter` Durable Object and writes them to `docs/maps/samples/`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";
import { seedMaps, type MapsBucket } from "../test/e2e/harness/maps";
import { drawSamples, type Paint } from "./map-samples";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = fileURLToPath(new URL("../docs/maps/samples/", import.meta.url));

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
  process.exitCode = await drawSamples(
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
} finally {
  await harness.close();
}
