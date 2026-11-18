/**
 * The page list in `test/screenshots/pages.json` against the web router: a
 * GET route needs screenshots, or an exclusion that says why it has none,
 * so a new page cannot ship without them.
 */
import { describe, expect, it } from "vitest";
import { webRouter } from "../../src/web/routes";
import list from "../screenshots/pages.json";
import type { PageList } from "../screenshots/pages";

const { pages, excluded }: PageList = list;
const routes = webRouter.paths("GET");

/** Whether `route` answers `path`, as the router matches them. */
function answers(route: string, path: string): boolean {
  const pathname = new URL(path, "https://hikebot.example").pathname;
  return route.endsWith("/*")
    ? pathname.startsWith(route.slice(0, -1))
    : pathname === route;
}

describe("the screenshot page list", () => {
  it("has an entry or an exclusion with a reason for every GET route", () => {
    const missing = routes.filter(
      (route) =>
        !pages.some((page) => answers(route, page.path)) &&
        !excluded.some((entry) => entry.route === route),
    );
    expect(
      missing,
      'add each route to "pages" in test/screenshots/pages.json ("Add a page to the screenshots" in src/web/AGENTS.md), or to "excluded" with the reason it is not a page',
    ).toEqual([]);
  });

  it("gives every exclusion a registered route and a reason", () => {
    for (const entry of excluded) {
      expect(routes, entry.route).toContain(entry.route);
      expect(entry.reason.trim().length, entry.route).toBeGreaterThan(10);
    }
  });

  it("excludes no route it also screenshots", () => {
    for (const entry of excluded) {
      const shot = pages.filter((page) => answers(entry.route, page.path));
      expect(shot, entry.route).toEqual([]);
    }
  });

  it("names each page once, in lower-case words joined by hyphens", () => {
    const names = pages.map((page) => page.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("gives every page a path, a status, a seed and a user", () => {
    for (const page of pages) {
      expect(page.path, page.name).toMatch(/^\//);
      expect(Number.isInteger(page.status), page.name).toBe(true);
      expect(page.seed, page.name).not.toBe("");
      expect(page.user === null || typeof page.user === "string").toBe(true);
    }
  });

  it("expects 404 exactly for the paths no route answers", () => {
    for (const page of pages) {
      const routed = routes.some((route) => answers(route, page.path));
      if (!routed) expect(page.status, page.name).toBe(404);
    }
  });

  it("screenshots the landing page and the not-found page", () => {
    expect(pages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/", status: 200 }),
        expect.objectContaining({ status: 404 }),
      ]),
    );
  });
});
