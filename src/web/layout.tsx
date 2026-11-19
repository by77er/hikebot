/**
 * The shell of every page: the document, its head with the Cairn
 * stylesheet and the preloaded typeface, a skip link to the main content,
 * the app header (brand mark, then room for the server and navigation, and
 * the signed-in user's menu with Sign out), main and footer landmarks.
 * Pages render their content as its children. "Page shell" in
 * docs/design-system.md describes it.
 */
import type { ComponentChildren } from "preact";
import { assetPath, FONT, STYLESHEET } from "./assets";
import { AppHeader, type HeaderUser } from "./components/app-header";

export const PROJECT_URL = "https://github.com/by77er/hikebot";

/** The signed-in user, from `layoutUser` in `src/web/auth/csrf.tsx`. */
export type LayoutUser = HeaderUser;

export interface LayoutProps {
  /** The whole `<title>`, such as `Page not found · hikebot`. */
  title: string;
  /**
   * `task` (the default): one readable column of at most 720px, for a page
   * that does one job. `overview`: up to 1080px, for lists and dashboards.
   */
  width?: "task" | "overview";
  /** The server the page is about, shown in the header after the brand. */
  context?: ComponentChildren;
  /** The header's navigation: a `<ul>` of links, the current one marked. */
  nav?: ComponentChildren;
  /** The signed-in user; leave it out on pages anyone may see signed out. */
  user?: LayoutUser;
  children: ComponentChildren;
}

export function Layout({
  title,
  width = "task",
  context,
  nav,
  user,
  children,
}: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <link
          rel="preload"
          href={assetPath(FONT)}
          as="font"
          type="font/woff2"
          crossorigin="anonymous"
        />
        <link rel="stylesheet" href={assetPath(STYLESHEET)} />
      </head>
      <body class={width === "overview" ? "shell shell--overview" : "shell"}>
        <a class="skip-link" href="#main">
          Skip to main content
        </a>
        <AppHeader context={context} nav={nav} user={user} />
        <main id="main" class="shell__main" tabindex={-1}>
          <div class="shell__inner">{children}</div>
        </main>
        <footer class="shell__footer">
          <div class="shell__inner">
            <p>
              hikebot is open source:&nbsp;<a href={PROJECT_URL}>the project</a>
            </p>
            <p>
              <a href="/styleguide">Style guide</a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
