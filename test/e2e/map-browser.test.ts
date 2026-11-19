/**
 * The interactive map in a real browser: headless Chromium with WebGL (the
 * screenshots' browser, `test/screenshots/browser.ts`) opens a server's
 * page with a planned hike and an open location vote on the map, both in
 * the committed sample map data, and checks that the maps draw from this
 * Worker's tiles, that nothing comes from another host or breaks the
 * Content-Security-Policy, that the map takes the picture's place without
 * moving anything, and that it zooms from the keyboard and its buttons.
 */
import type { Browser, Page } from "puppeteer-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchBrowser } from "../screenshots/browser";
import { RoundPlayer } from "./harness/rounds";
import { PageClient } from "./harness/web";
import { useE2E } from "./harness/worker";

const e2e = useE2E();
const VIEWER = "400000000000009101";
const SAMPLE_POINT = { lat: 47.4881, lon: -121.7232 };
const PLACES = [
  { label: "Mount Si", point: { lat: 47.5069, lon: -121.739 } },
  { label: "Little Si", point: { lat: 47.4987, lon: -121.756 } },
  { label: "Lake Serene" },
  { label: "Crater Lake Peak", point: { lat: 47.5184, lon: -121.7294 } },
  { label: "Three Forks Park", point: { lat: 47.521, lon: -121.7749 } },
  { label: "Tanner", point: { lat: 47.461, lon: -121.7378 } },
];

let browser: Browser;
let path: string;
let cookie: string;
let member: PageClient;

beforeAll(async () => {
  const play = new RoundPlayer(e2e);
  const g = play.guild(1, { name: "Ridge Walkers" });
  e2e.discord.addMember(g.guildId, VIEWER);
  await play.setUpPanel(g);
  await play.seedRound(g, {
    status: "complete",
    startedAt: Date.UTC(2030, 5, 2, 18),
    locations: [{ label: "Mount Si", point: SAMPLE_POINT }],
    location: "Mount Si",
    dates: [{ label: "2030-06-15 11:00" }],
    date: "2030-06-15 11:00",
    threadId: "320000000000009101",
    mapPicture: "public/assets/maps/samples/trailhead-z12.png",
  });
  await play.seedRound(g, {
    status: "location_voting",
    startedAt: Date.UTC(2030, 5, 20, 18),
    locations: PLACES,
  });
  e2e.discord.addUser({
    id: VIEWER,
    username: "ana",
    globalName: "Ana",
    guilds: [{ id: g.guildId, name: "Ridge Walkers" }],
  });
  const client = new PageClient(e2e.url);
  expect((await client.signIn({ id: VIEWER })).status).toBe(303);
  cookie = client.cookieHeader();
  member = client;
  path = `/g/${g.guildId}`;
  browser = await launchBrowser({ webgl: true });
}, 120_000);

afterAll(async () => {
  await browser.close();
});

interface Opened {
  page: Page;
  /** Every URL the page requested. */
  requests: string[];
  /** Tiles this Worker answered, as `z/x/y` and status. */
  tiles: { z: number; status: number }[];
}

/**
 * Opens the server's page signed in, at a desktop size, with JavaScript
 * running or, with `script: false`, with every script answered empty, as a
 * browser without JavaScript shows it.
 */
async function open({ script = true } = {}): Promise<Opened> {
  const page = await browser.newPage();
  const requests: string[] = [];
  const tiles: Opened["tiles"] = [];
  await page.setExtraHTTPHeaders({ Cookie: cookie });
  await page.setViewport({ width: 1280, height: 800 });
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    requests.push(request.url());
    if (new URL(request.url()).origin !== e2e.url.origin) {
      // Discord's CDN, for the avatar; the map must load nothing from it.
      void request.abort();
    } else if (!script && request.resourceType() === "script") {
      void request.respond({ contentType: "text/javascript", body: "" });
    } else {
      void request.continue();
    }
  });
  page.on("response", (response) => {
    const tile = /\/tiles\/(\d+)\/\d+\/\d+\.mvt/.exec(response.url());
    if (tile) tiles.push({ z: Number(tile[1]), status: response.status() });
  });
  await page.evaluateOnNewDocument(`(() => {
    window.__violations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__violations.push(event.violatedDirective + " " + event.blockedURI);
    });
    window.__shifts = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__shifts += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
  })()`);
  const response = await page.goto(new URL(path, e2e.url).href, {
    waitUntil: "load",
  });
  expect(response?.status()).toBe(200);
  return { page, requests, tiles };
}

async function settled(page: Page): Promise<void> {
  await page.waitForFunction(
    `[...document.querySelectorAll("figure[data-map]")].every((f) => f.dataset.mapState === "idle")`,
    { timeout: 60_000 },
  );
}

/** The text of every element `selector` picks. */
async function texts(page: Page, selector: string): Promise<string[]> {
  return (await page.evaluate(
    `[...document.querySelectorAll(${JSON.stringify(selector)})].map((e) => e.textContent)`,
  )) as string[];
}

/** Where `selector` is on the page, rounded to whole pixels. */
async function box(page: Page, selector: string): Promise<number[]> {
  return (await page.evaluate(`(() => {
    const { x, y, width, height } = document
      .querySelector(${JSON.stringify(selector)})
      .getBoundingClientRect();
    return [x, y + window.scrollY, width, height].map(Math.round);
  })()`)) as number[];
}

it("draws both maps from this Worker's tiles, loading nothing from another host and breaking no policy", async () => {
  const { page, requests, tiles } = await open();
  await settled(page);

  expect(tiles.length).toBeGreaterThan(0);
  expect(tiles.every(({ status }) => status === 200 || status === 204)).toBe(
    true,
  );
  const elsewhere = requests.filter(
    (url) =>
      new URL(url).origin !== e2e.url.origin &&
      !url.startsWith("data:") &&
      !url.startsWith("https://cdn.discordapp.com/avatars/"),
  );
  expect(elsewhere).toEqual([]);
  expect(requests).toContain(new URL("/maps/style.json", e2e.url).href);
  expect(
    requests.some((url) =>
      url.includes("/maps/maplibre/maplibre-gl-worker.mjs"),
    ),
  ).toBe(true);
  expect(await page.evaluate("window.__violations")).toEqual([]);

  // The planned hike's pin with its name, and five numbered places.
  expect(await texts(page, ".map-view__pin")).toEqual([""]);
  expect(await texts(page, ".maplibregl-popup-content")).toEqual(["Mount Si"]);
  expect(await texts(page, ".map-view__marker")).toEqual([
    "1",
    "2",
    "3",
    "4",
    "5",
  ]);
  expect(await texts(page, ".maplibregl-ctrl-attrib")).toEqual([
    expect.stringContaining("© OpenStreetMap contributors"),
    expect.stringContaining("© OpenStreetMap contributors"),
  ]);
  await page.close();
}, 120_000);

it("takes the picture's place at the same size, moving nothing", async () => {
  const without = await open({ script: false });
  const picture = await box(without.page, ".hike-card .map-view__picture");
  const voteFrame = await box(without.page, "#vote-map + * .map-view__frame");
  const linksBefore = await box(without.page, ".hike-card__links");
  await without.page.close();

  const { page } = await open();
  await settled(page);
  expect(await page.$(".map-view__picture")).toBeNull();
  expect(await box(page, ".hike-card .maplibregl-canvas")).toEqual(picture);
  expect(await box(page, "#vote-map + * .maplibregl-canvas")).toEqual(
    voteFrame,
  );
  expect(await box(page, ".hike-card__links")).toEqual(linksBefore);
  expect(await page.evaluate("window.__shifts")).toBe(0);
  await page.close();
}, 120_000);

it("zooms from the keyboard, with a visible focus, and from its buttons", async () => {
  const { page } = await open();
  await settled(page);
  const hikeMap = ".hike-card figure[data-map]";
  const zoom = async () =>
    Number(
      await page.evaluate(
        `document.querySelector(${JSON.stringify(hikeMap)}).dataset.mapZoom`,
      ),
    );
  const before = await zoom();
  expect(before).toBe(12);

  // Tab to the planned hike's map, as a keyboard user would.
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(`(() => {
      const active = document.activeElement;
      return active.classList.contains("maplibregl-canvas") &&
        document.querySelector(${JSON.stringify(hikeMap)}).contains(active);
    })()`);
    if (focused) break;
  }
  expect(
    await page.evaluate(
      `getComputedStyle(document.activeElement).outlineStyle`,
    ),
  ).toBe("solid");
  await page.keyboard.press("=");
  await expect.poll(zoom, { timeout: 30_000 }).toBe(before + 1);
  await page.keyboard.press("-");
  await expect.poll(zoom, { timeout: 30_000 }).toBe(before);

  await page.click(`${hikeMap} .map-view__button[data-zoom="in"]`);
  await expect.poll(zoom, { timeout: 30_000 }).toBe(before + 1);
  await page.click(`${hikeMap} .map-view__button[data-zoom="out"]`);
  await expect.poll(zoom, { timeout: 30_000 }).toBe(before);
  await page.close();
}, 120_000);

it("serves the stored picture to a member only, and the tiles to anyone", async () => {
  const picture = await member.get(`${path}/map.png`);
  expect(picture.status).toBe(200);
  expect(picture.headers.get("content-type")).toBe("image/png");

  const stranger = new PageClient(e2e.url);
  const signedOut = await stranger.get(`${path}/map.png`);
  expect(signedOut.status).toBe(303);
  expect(signedOut.headers.get("location")).toBe(
    `/login?next=${encodeURIComponent(`${path}/map.png`)}`,
  );

  const style = await stranger.get("/maps/style.json");
  expect(style.status).toBe(200);
  const { sources } = JSON.parse(style.body) as {
    sources: { hikebot: { tiles: string[] } };
  };
  const tile = await stranger.get(
    (sources.hikebot.tiles[0] ?? "")
      .replace("{z}", "12")
      .replace("{x}", "663")
      .replace("{y}", "1432"),
  );
  expect(tile.status).toBe(200);
  expect(tile.headers.get("content-type")).toBe(
    "application/vnd.mapbox-vector-tile",
  );
});
