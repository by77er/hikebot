/**
 * A fake Nominatim geocoder on a local HTTP port. The Worker under test
 * reaches it through NOMINATIM_BASE. It answers `GET /search` the way
 * Nominatim's jsonv2 search does for the places a test adds, records every
 * request with the time it arrived so scenarios can check the bot's pacing,
 * and refuses what Nominatim's documentation does not allow: a malformed
 * search (400) and a request without an identifying User-Agent (403). Tests
 * can make it fail with a status of their choice and hold its answers.
 *
 * Each behaviour cites the sentence of Nominatim's documentation it follows:
 * the Search page (https://nominatim.org/release-docs/latest/api/Search/),
 * the Output page (https://nominatim.org/release-docs/latest/api/Output/)
 * and the OSM Foundation's usage policy
 * (https://operations.osmfoundation.org/policies/nominatim/). A refusal's
 * message names the page that states the rule it broke.
 */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { nextSequence } from "./outbound";

const SEARCH_DOCS = "https://nominatim.org/release-docs/latest/api/Search/";
const USAGE_POLICY = "https://operations.osmfoundation.org/policies/nominatim/";

/**
 * "Data © OpenStreetMap contributors, ODbL 1.0. https://osm.org/copyright"
 * is the `licence` of every result in the examples on the Output page
 * (https://nominatim.org/release-docs/latest/api/Output/).
 */
export const NOMINATIM_LICENCE =
  "Data © OpenStreetMap contributors, ODbL 1.0. https://osm.org/copyright";

/**
 * format: "one of: xml, json, jsonv2, geojson, geocodejson", default jsonv2
 * (https://nominatim.org/release-docs/latest/api/Search/).
 */
const FORMATS = ["xml", "json", "jsonv2", "geojson", "geocodejson"];

/**
 * "Limit the maximum number of returned results. Cannot be more than 40."
 * (https://nominatim.org/release-docs/latest/api/Search/).
 */
export const MAX_LIMIT = 40;

/**
 * User-Agents that HTTP libraries send by default. "Provide a valid HTTP
 * Referer or User-Agent identifying the application (stock User-Agents as
 * set by http libraries will not do)."
 * (https://operations.osmfoundation.org/policies/nominatim/).
 */
const STOCK_USER_AGENTS =
  /^(?:node|undici|python|curl|go-http-client|wget|axios|java|okhttp|libwww-perl|ruby|php)\b/i;

/** A place a test added, as `addPlace` takes it. */
export interface FakePlace {
  lat: number;
  lon: number;
  /** Nominatim's full comma-separated address, place first. */
  displayName: string;
  /** The place's own name; defaults to the first part of `displayName`. */
  name?: string;
}

/** One request the fake received. */
export interface NominatimRequest {
  /** `Date.now()` when the request arrived. */
  at: number;
  /** Its place in the outbound request log (`./outbound.ts`). */
  seq: number;
  method: string;
  /** The path, without the query string. */
  path: string;
  /** The query parameters; a repeated parameter keeps its last value. */
  query: Record<string, string>;
  userAgent: string | undefined;
  status: number;
  /** What the fake answered (parsed JSON). */
  response: unknown;
}

type Waiter = {
  match: (request: NominatimRequest) => boolean;
  resolve: (request: NominatimRequest) => void;
};

interface Reply {
  status: number;
  body: unknown;
  /** A refusal of a request Nominatim would not accept. */
  rejected?: boolean;
}

/** Lowercase with whitespace collapsed, as `addPlace` matches queries. */
function normalize(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Nominatim's own pages do not state the status or body of an error; the
 * fake answers the JSON shape the public server is reported to send,
 * `{ "error": { "code": <status>, "message": <text> } }`.
 */
function error(status: number, message: string, rejected = false): Reply {
  return { status, body: { error: { code: status, message } }, rejected };
}

function refuse(message: string, docs: string): Reply {
  return error(400, `${message} (${docs})`, true);
}

export class FakeNominatim {
  /**
   * Every request the fake received, in order, with `at` the time it
   * arrived. The usage policy asks for "No heavy uses (an absolute maximum
   * of 1 request per second)."
   * (https://operations.osmfoundation.org/policies/nominatim/); the fake
   * does not refuse faster requests, since several guilds share one fake in
   * a test file, so scenarios check the spacing through `at`.
   */
  readonly requests: NominatimRequest[] = [];

  private readonly places = new Map<
    string,
    FakePlace & { placeId: number; osmId: number }
  >();
  private nextId = 1;
  private failures: { status: number; times: number } | null = null;
  private readonly holds = new Set<Promise<void>>();
  private held = 0;
  private readonly waiters: Waiter[] = [];
  private rejections: NominatimRequest[] = [];
  private server = createServer((req, res) => {
    void this.handle(req, res);
  });
  private origin = "";

  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });
    const { port } = this.server.address() as AddressInfo;
    this.origin = `http://127.0.0.1:${String(port)}`;
  }

  /** The value for NOMINATIM_BASE. */
  get base(): string {
    return this.origin;
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }

  // Configuration.

  /**
   * Makes a search whose `q` is `query` (ignoring case and repeated
   * whitespace) find `place`. Nominatim's `q` is a "Free-form query string
   * to search for." (https://nominatim.org/release-docs/latest/api/Search/);
   * the fake matches the whole string rather than ranking candidates.
   */
  addPlace(query: string, place: FakePlace): void {
    const id = this.nextId++;
    this.places.set(normalize(query), {
      ...place,
      placeId: 100_000 + id,
      osmId: 2_000_000 + id,
    });
  }

  /**
   * Answers the next `times` valid searches with `status`, for example 429,
   * 500 or 503. Nominatim's own pages do not state which statuses its
   * servers answer under load or when they block a client; 429 and 403 are
   * what the public server is reported to send when it blocks a client, and
   * 5xx is what any overloaded or failing server may answer.
   */
  failNext(status: number, times = 1): void {
    this.failures = { status, times };
  }

  /** Answers every valid search with `status` until `clearFailures`. */
  failAlways(status: number): void {
    this.failures = { status, times: Number.POSITIVE_INFINITY };
  }

  clearFailures(): void {
    this.failures = null;
  }

  /**
   * Holds every answer, of requests already waiting and still to come, until
   * the returned function is called; requests are recorded on arrival. Use
   * it for a slow geocoder. Nominatim's own pages do not state how long an
   * answer may take; the fake answers at once unless held.
   */
  hold(): () => void {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.holds.add(held);
    return () => {
      this.holds.delete(held);
      release();
    };
  }

  // Readers.

  /** How many answers `hold` is holding back now. */
  get heldRequests(): number {
    return this.held;
  }

  /**
   * Returns the requests the fake refused (400 for a malformed search, 403
   * for a missing or stock User-Agent) since the last call, and forgets them.
   */
  takeRejections(): NominatimRequest[] {
    const taken = this.rejections;
    this.rejections = [];
    return taken;
  }

  /**
   * Resolves with the first recorded request (already received or still to
   * come) that `match` accepts, any request if `match` is left out. A held
   * request counts once it arrived. Fails after `timeoutMs`.
   */
  nextRequest(
    match: (request: NominatimRequest) => boolean = () => true,
    timeoutMs = 5_000,
  ): Promise<NominatimRequest> {
    const seen = this.requests.find(match);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        match,
        resolve: (request) => {
          clearTimeout(deadline);
          resolve(request);
        },
      };
      const deadline = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(
          new Error(
            `no matching request reached the fake Nominatim within ${String(timeoutMs)} ms; it received: ${this.requests.map((r) => `${r.method} ${r.path} q=${JSON.stringify(r.query.q)} -> ${String(r.status)}`).join(", ") || "nothing"}`,
          ),
        );
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  // HTTP.

  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const at = Date.now();
    // A search has no body; read whatever came so the connection is reusable.
    req.resume();
    await new Promise((resolve) => req.once("end", resolve));
    const url = new URL(req.url ?? "/", this.origin);
    const method = req.method ?? "GET";
    const userAgent = req.headers["user-agent"];
    const reply = this.answer(method, url, userAgent);
    const recorded: NominatimRequest = {
      at,
      seq: nextSequence(),
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      userAgent,
      status: reply.status,
      response: reply.body,
    };
    if (reply.rejected) this.rejections.push(recorded);
    this.requests.push(recorded);
    for (const waiter of [...this.waiters]) {
      if (waiter.match(recorded)) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(recorded);
      }
    }
    if (this.holds.size > 0) {
      this.held += 1;
      while (this.holds.size > 0) await Promise.all([...this.holds]);
      this.held -= 1;
    }
    res.writeHead(reply.status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(reply.body));
  }

  private answer(
    method: string,
    url: URL,
    userAgent: string | undefined,
  ): Reply {
    /**
     * "Provide a valid HTTP Referer or User-Agent identifying the
     * application (stock User-Agents as set by http libraries will not
     * do)." (https://operations.osmfoundation.org/policies/nominatim/).
     * Nominatim's own pages do not state the status of the refusal; the
     * fake answers 403, which the public server is reported to send when
     * it blocks a client.
     */
    if (userAgent === undefined || userAgent.trim() === "") {
      return error(
        403,
        `requests must send a User-Agent identifying the application (${USAGE_POLICY})`,
        true,
      );
    }
    if (STOCK_USER_AGENTS.test(userAgent.trim())) {
      return error(
        403,
        `the stock User-Agent ${JSON.stringify(userAgent)} does not identify the application (${USAGE_POLICY})`,
        true,
      );
    }

    /**
     * The Search page gives the endpoint as
     * "https://nominatim.openstreetmap.org/search?<params>"
     * (https://nominatim.org/release-docs/latest/api/Search/). The fake
     * implements only that endpoint, read with GET; Nominatim's own pages do
     * not state the status for other paths, and the fake refuses them with
     * 400 so a test notices the bot calling something it does not fake.
     */
    if (url.pathname !== "/search" || (method !== "GET" && method !== "HEAD")) {
      return refuse(
        `the fake answers only GET /search, not ${method} ${url.pathname}`,
        SEARCH_DOCS,
      );
    }
    const params = url.searchParams;

    /**
     * q: "Free-form query string to search for."
     * (https://nominatim.org/release-docs/latest/api/Search/). Nominatim's
     * own pages do not state the answer to a search with no query; the
     * fake refuses it with 400.
     */
    const q = params.get("q");
    if (q === null || q.trim() === "") {
      return refuse("q must be a non-empty free-form query", SEARCH_DOCS);
    }

    /**
     * format: "one of: xml, json, jsonv2, geojson, geocodejson", default
     * jsonv2 (https://nominatim.org/release-docs/latest/api/Search/). The fake
     * produces only json and jsonv2 output, and refuses the other formats
     * with 400 so a test notices the bot asking for one it does not fake.
     */
    const format = params.get("format") ?? "jsonv2";
    if (!FORMATS.includes(format)) {
      return refuse(
        `format must be one of: ${FORMATS.join(", ")}; got ${JSON.stringify(format)}`,
        SEARCH_DOCS,
      );
    }
    if (format !== "json" && format !== "jsonv2") {
      return refuse(
        `the fake produces only json and jsonv2 output, not ${format}`,
        SEARCH_DOCS,
      );
    }

    /**
     * limit: "Limit the maximum number of returned results. Cannot be more
     * than 40." (https://nominatim.org/release-docs/latest/api/Search/),
     * default 10. Nominatim's own pages do not state the answer to a limit
     * outside 1..40; the fake refuses it with 400.
     */
    const limit = params.get("limit");
    if (limit !== null) {
      const n = /^\d+$/.test(limit) ? Number(limit) : Number.NaN;
      if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
        return refuse(
          `limit must be an integer from 1 to ${String(MAX_LIMIT)}; got ${JSON.stringify(limit)}`,
          SEARCH_DOCS,
        );
      }
    }

    /**
     * viewbox=<x1>,<y1>,<x2>,<y2>: "Boost parameter which focuses the
     * search on the given area. Any two corner points of the box are
     * accepted as long as they make a proper box. `x` is longitude, `y` is
     * latitude." (https://nominatim.org/release-docs/latest/api/Search/).
     * Nominatim's own pages do not state the answer to a malformed box; the
     * fake refuses it with 400. It does not rank by the box: every added
     * place matches wherever it lies.
     */
    const box = params.get("viewbox");
    if (box !== null) {
      const problem = viewboxProblem(box);
      if (problem) return refuse(problem, SEARCH_DOCS);
    }

    /**
     * bounded=[0|1], default 0: "When set to 1, then it turns the 'viewbox'
     * parameter (see above) into a filter parameter, excluding any results
     * outside the viewbox."
     * (https://nominatim.org/release-docs/latest/api/Search/). Nominatim's
     * own pages do not state the answer to other values; the fake refuses
     * them with 400.
     */
    const bounded = params.get("bounded");
    if (bounded !== null && bounded !== "0" && bounded !== "1") {
      return refuse(
        `bounded must be 0 or 1; got ${JSON.stringify(bounded)}`,
        SEARCH_DOCS,
      );
    }

    /**
     * A failure a test configured with `failNext` or `failAlways`, applied
     * only to searches Nominatim would accept. Nominatim's own pages do not
     * state the statuses its servers answer when overloaded or blocking a
     * client (https://operations.osmfoundation.org/policies/nominatim/ only
     * says "No heavy uses (an absolute maximum of 1 request per second).");
     * the fake answers the status the test chose with a small JSON error.
     */
    if (this.failures) {
      const { status } = this.failures;
      this.failures.times -= 1;
      if (this.failures.times <= 0) this.failures = null;
      return error(
        status,
        `the fake Nominatim was told to fail (${String(status)})`,
      );
    }

    /**
     * "JSON returns an array of places (for search and lookup)"
     * (https://nominatim.org/release-docs/latest/api/Output/). Nominatim's
     * own pages do not state the answer to a search that finds nothing; the
     * fake answers an empty array, which follows from "an array of places".
     */
    const place = this.places.get(normalize(q));
    return { status: 200, body: place ? [result(place, format)] : [] };
  }
}

/** Why `box` is not a viewbox Nominatim accepts, or null if it is one. */
function viewboxProblem(box: string): string | null {
  const parts = box.split(",");
  const numbers = parts.map((p) =>
    /^\s*[-+]?(?:\d+\.?\d*|\.\d+)\s*$/.test(p) ? Number(p) : Number.NaN,
  );
  if (numbers.length !== 4 || numbers.some((n) => !Number.isFinite(n))) {
    return `viewbox must be four numbers <x1>,<y1>,<x2>,<y2>; got ${JSON.stringify(box)}`;
  }
  const [x1, y1, x2, y2] = numbers as [number, number, number, number];
  if ([x1, x2].some((x) => x < -180 || x > 180)) {
    return `viewbox x (longitude) must be within -180..180; got ${JSON.stringify(box)}`;
  }
  if ([y1, y2].some((y) => y < -90 || y > 90)) {
    return `viewbox y (latitude) must be within -90..90; got ${JSON.stringify(box)}`;
  }
  if (x1 === x2 || y1 === y2) {
    return `viewbox corners must make a proper box; got ${JSON.stringify(box)}`;
  }
  return null;
}

/**
 * One search result as Nominatim's JSON output gives it. From the Output
 * page (https://nominatim.org/release-docs/latest/api/Output/): `lat`, `lon`
 * are the "latitude and longitude of the centroid of the object", strings in
 * its example; `display_name` is the "full comma-separated address"; jsonv2
 * is json with `class` renamed to `category` and an added `place_rank`.
 * Nominatim's own pages do not state values for an invented place; the fake
 * makes up ids, a peak's category and type, and a small bounding box.
 */
function result(
  place: FakePlace & { placeId: number; osmId: number },
  format: string,
): Record<string, unknown> {
  const name =
    place.name ?? place.displayName.split(",")[0]?.trim() ?? place.displayName;
  const coordinate = (n: number) => n.toFixed(7);
  const common = {
    place_id: place.placeId,
    licence: NOMINATIM_LICENCE,
    osm_type: "node",
    osm_id: place.osmId,
    lat: coordinate(place.lat),
    lon: coordinate(place.lon),
  };
  const rest = {
    type: "peak",
    importance: 0.5,
    addresstype: "peak",
    name,
    display_name: place.displayName,
    boundingbox: [
      coordinate(place.lat - 0.001),
      coordinate(place.lat + 0.001),
      coordinate(place.lon - 0.001),
      coordinate(place.lon + 0.001),
    ],
  };
  return format === "jsonv2"
    ? { ...common, category: "natural", place_rank: 18, ...rest }
    : { ...common, class: "natural", ...rest };
}
