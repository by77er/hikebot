/**
 * The page list in `pages.json`: every page `npm run screenshots` takes,
 * with the seeded state and signed-in user it needs, and the GET routes that
 * are not pages, each with the reason. The coverage test in
 * `test/web/screenshot-pages.test.ts` checks it against the web router.
 */
export interface ScreenshotPage {
  /** Lower-case words joined by single hyphens; names the PNG files. */
  name: string;
  /** The path the browser opens, such as `/` or `/no-such-page`. */
  path: string;
  /** The HTTP status the page must answer with. */
  status: number;
  /** A key of `SEEDS` in `seeds.ts`: the data the Worker holds first. */
  seed: string;
  /**
   * The id of the Discord user, added by the seed with `discord.addUser`,
   * who signs in before the page is opened, or null for a signed-out
   * visitor.
   */
  user: string | null;
  /**
   * With a `user`: press Cancel on Discord's authorize page while signing
   * in, and take the page the Worker's callback answers. `path` is then
   * `/auth/callback`, and the query is the one Discord sends back.
   */
  cancel?: boolean;
  /**
   * With a `user`: once, before the page's screenshots, open `from` and
   * submit its form that posts to `action`, with `fields` over the form's
   * own, as the browser would; the page is then opened with the cookies
   * that leaves, such as the notice of an admin's action.
   */
  submit?: { from: string; action: string; fields?: Record<string, string> };
  /**
   * `false` opens the page with JavaScript off, as a browser without it
   * shows the page. Defaults to on.
   */
  javascript?: boolean;
  /**
   * The page draws an interactive map: it is taken in a browser with WebGL
   * (`launchBrowser` in `browser.ts`). A map on a page without it fails.
   */
  map?: boolean;
}

export interface ExcludedRoute {
  route: string;
  reason: string;
}

export interface PageList {
  pages: ScreenshotPage[];
  excluded: ExcludedRoute[];
}

export const VIEWPORTS = {
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, isMobile: false, hasTouch: false },
} as const;

export const SCHEMES = ["light", "dark"] as const;

export type ViewportName = keyof typeof VIEWPORTS;
export type Scheme = (typeof SCHEMES)[number];

/** `<page>--<viewport>--<scheme>.png`, as in `docs/screenshots/`. */
export function screenshotFile(
  page: string,
  viewport: ViewportName,
  scheme: Scheme,
): string {
  return `${page}--${viewport}--${scheme}.png`;
}

/** Every file the page list produces, sorted. */
export function screenshotFiles(list: PageList): string[] {
  return list.pages
    .flatMap((page) =>
      (Object.keys(VIEWPORTS) as ViewportName[]).flatMap((viewport) =>
        SCHEMES.map((scheme) => screenshotFile(page.name, viewport, scheme)),
      ),
    )
    .sort();
}
