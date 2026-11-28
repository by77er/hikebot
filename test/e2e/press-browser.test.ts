/**
 * Cairn's press and busy states in a real browser ("States" in
 * docs/design-system.md): headless Chromium (the screenshots' browser,
 * `test/screenshots/browser.ts`) opens a server's page with an open
 * location vote, signed in as a member, and checks that a finger on the
 * vote's button shows its pressed fill before it lifts; that from the
 * submit until the next page the button is busy (`aria-busy`, the pressed
 * fill) and a second press sends nothing; that no element eases a colour,
 * with a mouse or a finger; and that with JavaScript off the vote still
 * posts and the page still answers.
 */
import type { Browser, CDPSession, HTTPRequest, Page } from "puppeteer-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchBrowser } from "../screenshots/browser";
import { RoundPlayer } from "./harness/rounds";
import { PageClient } from "./harness/web";
import { useE2E } from "./harness/worker";

const e2e = useE2E();
const VIEWER = "400000000000009201";
const BUTTON = "form.tally-vote button.button--primary";

let browser: Browser;
let path: string;
let cookie: string;

beforeAll(async () => {
  const play = new RoundPlayer(e2e);
  const g = play.guild(1, { name: "Ridge Walkers" });
  e2e.discord.addMember(g.guildId, VIEWER);
  await play.setUpPanel(g);
  await play.seedRound(g, {
    status: "location_voting",
    startedAt: Date.UTC(2030, 5, 20, 18),
    locations: [{ label: "Snow Lake" }, { label: "Mailbox Peak" }],
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
  path = `/g/${g.guildId}`;
  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  await browser.close();
});

interface Opened {
  page: Page;
  /** The vote posts the page sent, in order. */
  posts: HTTPRequest[];
}

/**
 * Opens `at` signed in: at 390px with a finger (`touch`) or 1280px with a
 * mouse, with JavaScript on or off, noting each post it sends.
 */
async function open({
  at = path,
  touch = false,
  javascript = true,
} = {}): Promise<Opened> {
  const page = await browser.newPage();
  await browser.setCookie(
    ...cookie.split("; ").map((pair) => {
      const [name = "", ...value] = pair.split("=");
      return {
        name,
        value: value.join("="),
        domain: e2e.url.hostname,
        path: "/",
        secure: true,
      };
    }),
  );
  await page.setJavaScriptEnabled(javascript);
  await page.setViewport(
    touch
      ? {
          width: 390,
          height: 844,
          deviceScaleFactor: 1,
          hasTouch: true,
          isMobile: true,
        }
      : { width: 1280, height: 800 },
  );
  const posts: HTTPRequest[] = [];
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== e2e.url.origin) {
      void request.abort();
      return;
    }
    if (request.method() === "POST") {
      posts.push(request);
    }
    void request.continue();
  });
  const response = await page.goto(new URL(at, e2e.url).href, {
    waitUntil: "load",
  });
  expect(response?.status()).toBe(200);
  return { page, posts };
}

/** Runs `expression` in the page and returns its value. */
async function run<T>(page: Page, expression: string): Promise<T> {
  return (await page.evaluate(expression)) as T;
}

/** The computed background of `selector`. */
async function background(page: Page, selector: string): Promise<string> {
  return run(
    page,
    `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`,
  );
}

/** What `var(<token>)` computes to as a background on this page. */
async function token(page: Page, name: string): Promise<string> {
  return run(
    page,
    `(() => {
      const probe = document.createElement("div");
      probe.style.background = "var(${name})";
      document.body.append(probe);
      const value = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return value;
    })()`,
  );
}

/** The centre of `selector` in the window, after scrolling it into view. */
async function centre(
  page: Page,
  selector: string,
): Promise<{ x: number; y: number }> {
  return run(
    page,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      element.scrollIntoView({ block: "center" });
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x: x + width / 2, y: y + height / 2 };
    })()`,
  );
}

/** Whether the vote's option `value` is ticked. */
async function ticked(page: Page, value: string): Promise<boolean> {
  return run(
    page,
    `document.querySelector('form.tally-vote input[value="${value}"]').checked`,
  );
}

async function touch(
  session: CDPSession,
  type: "touchStart" | "touchEnd",
  at: { x: number; y: number },
): Promise<void> {
  await session.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: type === "touchEnd" ? [] : [{ x: at.x, y: at.y }],
  });
}

it("shows a finger's press on the vote's button before the finger lifts", async () => {
  const { page } = await open({ touch: true });
  const rest = await background(page, BUTTON);
  const pressed = await token(page, "--color-primary-active");
  expect(rest).toBe(await token(page, "--color-primary"));
  expect(pressed).not.toBe(rest);

  const session = await page.createCDPSession();
  const at = await centre(page, BUTTON);
  await touch(session, "touchStart", at);
  await page.waitForSelector(`${BUTTON}[data-pressed]`);
  expect(await background(page, BUTTON)).toBe(pressed);
  const next = page.waitForNavigation({ waitUntil: "load" });
  await touch(session, "touchEnd", at);
  await next;
  await page.close();
}, 60_000);

it("holds the vote's button busy from the tap until the next page, and sends one vote for two presses", async () => {
  const { page, posts } = await open({ touch: true });
  // Puppeteer cannot read a page whose next page is on its way, so the
  // page records the button as the submit leaves it, presses it again,
  // and keeps both in sessionStorage for the next page to read.
  await run(
    page,
    `addEventListener("submit", (event) => {
      if (sessionStorage.getItem("busy") !== null) {
        sessionStorage.setItem(
          "second",
          JSON.stringify({ ignored: event.defaultPrevented }),
        );
        return;
      }
      // The next task, once this submit's events are done: a press during
      // them would be dropped by the browser itself, proving nothing.
      setTimeout(() => {
        const button = document.querySelector(${JSON.stringify(BUTTON)});
        sessionStorage.setItem(
          "busy",
          JSON.stringify({
            busy: button.getAttribute("aria-busy"),
            pressed: button.hasAttribute("data-pressed"),
            background: getComputedStyle(button).backgroundColor,
          }),
        );
        button.click();
      });
    })`,
  );
  await page.tap('form.tally-vote input[value="1"]');
  const pressed = await token(page, "--color-primary-active");
  const next = page.waitForNavigation({ waitUntil: "load" });
  await page.tap(BUTTON);
  await next;

  const recorded = await run<{ busy: unknown; second: unknown }>(
    page,
    `({
      busy: JSON.parse(sessionStorage.getItem("busy")),
      second: JSON.parse(sessionStorage.getItem("second")),
    })`,
  );
  // The finger had lifted: the fill was the busy state's.
  expect(recorded.busy).toEqual({
    busy: "true",
    pressed: false,
    background: pressed,
  });
  expect(recorded.second).toEqual({ ignored: true });
  expect(posts).toHaveLength(1);
  expect(page.url()).toContain(path);
  expect(await page.$(`${BUTTON}[aria-busy]`)).toBeNull();
  expect(await ticked(page, "1")).toBe(true);
  await page.close();
}, 60_000);

it("shows a mouse's press at once, with no eased colour", async () => {
  const { page } = await open();
  const at = await centre(page, BUTTON);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForSelector(`${BUTTON}[data-pressed]`);
  expect(await background(page, BUTTON)).toBe(
    await token(page, "--color-primary-active"),
  );
  // Leaving the button lets the press go, as :active does.
  await page.mouse.move(at.x, at.y - 120);
  await page.waitForFunction(
    `!document.querySelector(${JSON.stringify(BUTTON)}).hasAttribute("data-pressed")`,
  );
  await page.mouse.up();
  await page.close();
}, 60_000);

it.each([
  { pointer: "a mouse", touch: false },
  { pointer: "a finger", touch: true },
])(
  "eases no colour on the server's page or the style guide with $pointer",
  async ({ touch }) => {
    for (const at of [path, "/styleguide"]) {
      const { page } = await open({ at, touch });
      const eased = await run<string[]>(
        page,
        `(() => {
          const found = [];
          for (const element of document.querySelectorAll("*")) {
            const style = getComputedStyle(element);
            const names = style.transitionProperty.split(",").map((n) => n.trim());
            const durations = style.transitionDuration.split(",").map(parseFloat);
            names.forEach((name, i) => {
              const duration = durations[i % durations.length];
              if (duration > 0 && name !== "opacity" && name !== "transform") {
                found.push(element.tagName.toLowerCase() + "." + element.className + ": " + name);
              }
            });
          }
          return found;
        })()`,
      );
      expect(eased, at).toEqual([]);
      await page.close();
    }
  },
  60_000,
);

it("votes with JavaScript off: no press script runs, and the vote posts and the page answers", async () => {
  const { page, posts } = await open({ javascript: false });
  await page.click('form.tally-vote input[value="2"]');
  const next = page.waitForNavigation({ waitUntil: "load" });
  await page.click(BUTTON);
  await next;
  expect(posts).toHaveLength(1);
  expect(await page.$("[data-pressed], [aria-busy]")).toBeNull();
  expect(page.url()).toContain(path);
  expect(await ticked(page, "2")).toBe(true);
  await page.close();
}, 60_000);
