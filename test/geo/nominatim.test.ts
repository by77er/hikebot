import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOMINATIM_BASE,
  GeocodeError,
  NOMINATIM_USER_AGENT,
  Nominatim,
  nominatim,
  shortPlaceName,
  viewbox,
} from "../../src/geo/nominatim";

const SI = {
  place_id: 1,
  licence:
    "Data © OpenStreetMap contributors, ODbL 1.0. https://osm.org/copyright",
  lat: "47.4875",
  lon: "-121.7234",
  name: "Mount Si",
  display_name: "Mount Si, King County, Washington, United States of America",
};

/** A stub geocoder: answers each request with `answer` and keeps it. */
function stub(answer: (request: Request) => Promise<Response> | Response) {
  const requests: Request[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    return Promise.resolve(answer(request));
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

describe("Nominatim", () => {
  it("builds the jsonv2 search for one result, with an identifying User-Agent", async () => {
    const { fetch, requests } = stub(() => Response.json([SI]));
    const client = new Nominatim({ baseUrl: "https://geo.test/", fetch });
    const place = await client.search("Mount Si & Lake");
    expect(place).toEqual({
      point: { lat: 47.4875, lon: -121.7234 },
      name: "Mount Si, King County, Washington",
    });
    const url = new URL(requests[0]?.url ?? "");
    expect(url.origin + url.pathname).toBe("https://geo.test/search");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "Mount Si & Lake",
      format: "jsonv2",
      limit: "1",
    });
    expect(requests[0]?.headers.get("User-Agent")).toBe(NOMINATIM_USER_AGENT);
    expect(NOMINATIM_USER_AGENT).toMatch(
      /hikebot.*github\.com\/by77er\/hikebot/,
    );
  });

  it("focuses on two degrees around the home point with bounded=0", async () => {
    const { fetch, requests } = stub(() => Response.json([SI]));
    await new Nominatim({ fetch }).search("Mount Si", {
      lat: 47.6,
      lon: -122.3,
    });
    const url = new URL(requests[0]?.url ?? "");
    expect(url.origin).toBe(DEFAULT_NOMINATIM_BASE);
    expect(url.searchParams.get("viewbox")).toBe("-123.3,48.6,-121.3,46.6");
    expect(url.searchParams.get("bounded")).toBe("0");
  });

  it("clamps the box to the globe", () => {
    expect(viewbox({ lat: 89.5, lon: 179.5 })).toBe("178.5,90,180,88.5");
    expect(viewbox({ lat: -89.5, lon: -179.5 })).toBe("-180,-88.5,-178.5,-90");
  });

  it("takes the base address from NOMINATIM_BASE", async () => {
    const { fetch, requests } = stub(() => Response.json([]));
    await nominatim(
      { NOMINATIM_BASE: "http://127.0.0.1:9/" },
      { fetch },
    ).search("x");
    expect(requests[0]?.url).toMatch(/^http:\/\/127\.0\.0\.1:9\/search\?/);
    await nominatim({ NOMINATIM_BASE: "" }, { fetch }).search("x");
    expect(requests[1]?.url).toMatch(
      /^https:\/\/nominatim\.openstreetmap\.org\/search\?/,
    );
  });

  it("returns null for an empty result", async () => {
    const { fetch } = stub(() => Response.json([]));
    expect(await new Nominatim({ fetch }).search("Nowhere")).toBeNull();
  });

  it.each([429, 500, 503])(
    "throws a GeocodeError for HTTP %i",
    async (status) => {
      const { fetch } = stub(() => new Response("busy", { status }));
      const error = await new Nominatim({ fetch })
        .search("Mount Si")
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GeocodeError);
      expect(error).toMatchObject({
        status,
        message: `answered HTTP ${String(status)}`,
      });
    },
  );

  it.each([
    ["not JSON", () => new Response("<html>")],
    ["not a list", () => Response.json({ error: "x" })],
    ["no coordinates", () => Response.json([{ display_name: "X" }])],
    ["coordinates out of range", () => Response.json([{ ...SI, lat: "95" }])],
  ])("throws a GeocodeError for an answer with %s", async (_name, answer) => {
    const { fetch } = stub(answer);
    await expect(new Nominatim({ fetch }).search("x")).rejects.toBeInstanceOf(
      GeocodeError,
    );
  });

  it("gives up when there is no answer within the timeout", async () => {
    // Answers only when the client's own timeout aborts the request.
    const fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason as Error);
        });
      })) as typeof globalThis.fetch;
    const error = await new Nominatim({ fetch, timeoutMs: 20 })
      .search("Mount Si")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GeocodeError);
    expect(error).toMatchObject({
      status: null,
      message: "no answer within 0.02 seconds",
    });
  });

  it("throws a GeocodeError when the geocoder cannot be reached", async () => {
    const fetch = (() =>
      Promise.reject(new TypeError("fetch failed"))) as typeof globalThis.fetch;
    await expect(new Nominatim({ fetch }).search("x")).rejects.toMatchObject({
      status: null,
      message: "could not be reached",
    });
  });

  it("falls back to the query when the result has no name", async () => {
    const { fetch } = stub(() => Response.json([{ lat: "1.5", lon: "2.5" }]));
    expect(await new Nominatim({ fetch }).search("Spot")).toEqual({
      point: { lat: 1.5, lon: 2.5 },
      name: "Spot",
    });
  });
});

describe("shortPlaceName", () => {
  it.each([
    [
      "Mount Si, King County, Washington, United States of America",
      "Mount Si, King County, Washington",
    ],
    ["Mount Si", "Mount Si"],
    [`${"A".repeat(50)}, ${"B".repeat(40)}, C`, "A".repeat(50)],
    [`${"A".repeat(90)}, B`, `${"A".repeat(79)}…`],
    [" , Lake ,, Town ", "Lake, Town"],
  ])("shortens %s", (displayName, name) => {
    expect(shortPlaceName(displayName)).toBe(name);
  });
});
