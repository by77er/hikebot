/**
 * Self-tests of the fake Nominatim geocoder: it answers a jsonv2 search for
 * an added place the way Nominatim does, finds nothing for other queries,
 * fails and holds its answers when told to, refuses the searches and
 * User-Agents Nominatim's documentation does not allow, and records every
 * request. No Worker runs here; the tests call the fake over HTTP.
 */
import { request } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeNominatim, NOMINATIM_LICENCE } from "./harness/fake-nominatim";

const USER_AGENT = "hikebot (+https://github.com/by77er/hikebot)";

let geocoder: FakeNominatim;

beforeAll(async () => {
  geocoder = new FakeNominatim();
  await geocoder.listen();
  geocoder.addPlace("Mount Tam", {
    lat: 37.9235,
    lon: -122.5965,
    displayName: "Mount Tamalpais, Marin County, California, United States",
  });
});

afterEach(() => {
  geocoder.clearFailures();
  expect(geocoder.takeRejections()).toEqual([]);
});

afterAll(async () => {
  await geocoder.close();
});

interface Reply {
  status: number;
  body: unknown;
}

function searchUrl(params: Record<string, string>): string {
  return `${geocoder.base}/search?${new URLSearchParams(params).toString()}`;
}

async function search(
  params: Record<string, string>,
  userAgent: string = USER_AGENT,
): Promise<Reply> {
  const response = await fetch(searchUrl(params), {
    headers: { "User-Agent": userAgent },
  });
  return { status: response.status, body: await response.json() };
}

/** A search sent without any User-Agent header, which fetch always adds. */
function searchWithoutUserAgent(
  params: Record<string, string>,
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(searchUrl(params), (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

const valid = { q: "Mount Tam", format: "jsonv2", limit: "1" };

describe("search", () => {
  it("answers a known place with one jsonv2 result", async () => {
    const reply = await search({
      q: "  mount   TAM ",
      format: "jsonv2",
      limit: "1",
      viewbox: "-123.5,38.9,-121.5,36.9",
      bounded: "0",
    });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual([
      {
        place_id: expect.any(Number) as number,
        licence: NOMINATIM_LICENCE,
        osm_type: "node",
        osm_id: expect.any(Number) as number,
        lat: "37.9235000",
        lon: "-122.5965000",
        category: "natural",
        type: "peak",
        place_rank: 18,
        importance: 0.5,
        addresstype: "peak",
        name: "Mount Tamalpais",
        display_name:
          "Mount Tamalpais, Marin County, California, United States",
        boundingbox: [
          "37.9225000",
          "37.9245000",
          "-122.5975000",
          "-122.5955000",
        ],
      },
    ]);
  });

  it("answers an empty array for an unknown place", async () => {
    const reply = await search({ ...valid, q: "Nowhere Ridge" });
    expect(reply).toEqual({ status: 200, body: [] });
  });

  it("records each request with its query, user agent and status", async () => {
    const before = Date.now();
    await search({ ...valid, q: "Recorded Peak" }, "hikebot-test/1.0");
    const recorded = await geocoder.nextRequest(
      (r) => r.query.q === "Recorded Peak",
    );
    expect(recorded).toMatchObject({
      method: "GET",
      path: "/search",
      query: { q: "Recorded Peak", format: "jsonv2", limit: "1" },
      userAgent: "hikebot-test/1.0",
      status: 200,
      response: [],
    });
    expect(recorded.at).toBeGreaterThanOrEqual(before);
    expect(recorded.at).toBeLessThanOrEqual(Date.now());
    expect(geocoder.requests).toContain(recorded);
  });

  it("resolves nextRequest for a request still to come", async () => {
    const next = geocoder.nextRequest((r) => r.query.q === "Later Peak");
    await search({ ...valid, q: "Later Peak" });
    await expect(next).resolves.toMatchObject({ status: 200 });
  });
});

describe("failures", () => {
  it("answers 503 once after failNext, then works", async () => {
    geocoder.failNext(503);
    const failed = await search(valid);
    expect(failed.status).toBe(503);
    expect(failed.body).toMatchObject({ error: { code: 503 } });
    const next = await search(valid);
    expect(next.status).toBe(200);
    expect(next.body).toHaveLength(1);
  });

  it("answers the status the given number of times", async () => {
    geocoder.failNext(429, 2);
    expect((await search(valid)).status).toBe(429);
    expect((await search(valid)).status).toBe(429);
    expect((await search(valid)).status).toBe(200);
  });

  it("answers the status until clearFailures after failAlways", async () => {
    geocoder.failAlways(500);
    expect((await search(valid)).status).toBe(500);
    expect((await search(valid)).status).toBe(500);
    geocoder.clearFailures();
    expect((await search(valid)).status).toBe(200);
  });
});

describe("hold", () => {
  it("holds answers until released", async () => {
    const release = geocoder.hold();
    const settled = Symbol("settled");
    const pending = Symbol("pending");
    const answer = search({ ...valid, q: "Held Peak" }).then(() => settled);
    await geocoder.nextRequest((r) => r.query.q === "Held Peak");
    expect(geocoder.heldRequests).toBe(1);
    expect(await Promise.race([answer, Promise.resolve(pending)])).toBe(
      pending,
    );
    release();
    expect(await answer).toBe(settled);
    expect(geocoder.heldRequests).toBe(0);
  });
});

describe("refusals", () => {
  const cases: [string, Record<string, string>, RegExp][] = [
    ["a missing q", { format: "jsonv2", limit: "1" }, /\bq\b/],
    ["an empty q", { ...valid, q: "  " }, /\bq\b/],
    ["an unknown format", { ...valid, format: "yaml" }, /format/],
    ["limit 41", { ...valid, limit: "41" }, /limit/],
    ["limit 0", { ...valid, limit: "0" }, /limit/],
    ["a limit that is not an integer", { ...valid, limit: "1.5" }, /limit/],
    ["a viewbox of three numbers", { ...valid, viewbox: "1,2,3" }, /viewbox/],
    ["a viewbox with text", { ...valid, viewbox: "a,2,3,4" }, /viewbox/],
    [
      "a viewbox longitude past 180",
      { ...valid, viewbox: "179,10,181,11" },
      /longitude/,
    ],
    [
      "a viewbox latitude past 90",
      { ...valid, viewbox: "10,89,11,91" },
      /latitude/,
    ],
    ["a flat viewbox", { ...valid, viewbox: "10,20,10,21" }, /proper box/],
    ["bounded=2", { ...valid, bounded: "2" }, /bounded/],
  ];

  it.each(cases)("refuses %s with 400", async (_, params, message) => {
    const reply = await search(params);
    expect(reply.status).toBe(400);
    expect(reply.body).toMatchObject({
      error: { code: 400, message: expect.stringMatching(message) as string },
    });
    const refused = geocoder.takeRejections();
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ status: 400, query: params });
  });

  it("refuses a path other than /search with 400", async () => {
    const response = await fetch(`${geocoder.base}/reverse?lat=1&lon=2`, {
      headers: { "User-Agent": USER_AGENT },
    });
    expect(response.status).toBe(400);
    await response.body?.cancel();
    const refused = geocoder.takeRejections();
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ path: "/reverse", status: 400 });
  });

  it("refuses a search without a User-Agent with 403", async () => {
    const reply = await searchWithoutUserAgent(valid);
    expect(reply.status).toBe(403);
    expect(reply.body).toMatchObject({ error: { code: 403 } });
    const refused = geocoder.takeRejections();
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ userAgent: undefined, status: 403 });
  });

  it.each([
    "node",
    "undici",
    "python-requests/2.31",
    "curl/8.5.0",
    "Go-http-client/1.1",
  ])("refuses the stock User-Agent %s with 403", async (agent) => {
    const reply = await search(valid, agent);
    expect(reply.status).toBe(403);
    const refused = geocoder.takeRejections();
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ userAgent: agent, status: 403 });
  });

  it("does not count a configured failure as a refusal", async () => {
    geocoder.failNext(403);
    expect((await search(valid)).status).toBe(403);
    expect(geocoder.takeRejections()).toEqual([]);
  });

  it("refuses a malformed search even while told to fail", async () => {
    geocoder.failNext(503);
    expect((await search({ ...valid, limit: "41" })).status).toBe(400);
    expect(geocoder.takeRejections()).toHaveLength(1);
    expect((await search(valid)).status).toBe(503);
  });
});
