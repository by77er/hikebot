/**
 * The sample map picture at `/maps/sample.png`, as the deploy's smoke check
 * fetches it: a PNG drawn from the map data in the bucket, or a 404 before
 * the map data is built.
 */
import { describe, expect, it } from "vitest";
import { useE2E } from "./harness/worker";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

async function fetchSample(url: URL): Promise<Response> {
  return fetch(new URL("/maps/sample.png", url));
}

describe("with map data", () => {
  const e2e = useE2E();

  it("answers a 1200x800 PNG of the sample point", async () => {
    const response = await fetchSample(e2e.url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const png = new Uint8Array(await response.arrayBuffer());
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    const header = new DataView(png.buffer, png.byteOffset + 16, 8);
    expect([header.getUint32(0), header.getUint32(4)]).toEqual([1200, 800]);
    expect(png.length).toBeGreaterThan(20_000);
    expect(png.length).toBeLessThan(1_000_000);
  });

  it("answers the same picture again from the bucket", async () => {
    const first = new Uint8Array(
      await (await fetchSample(e2e.url)).arrayBuffer(),
    );
    const second = await fetchSample(e2e.url);
    expect(second.status).toBe(200);
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(first);
  });
});

describe("before the map data is built", () => {
  const e2e = useE2E({ maps: false });

  it("answers 404", async () => {
    const response = await fetchSample(e2e.url);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    await response.arrayBuffer();
  });
});
