/**
 * The shell of every page: the document, its head with the stylesheet, a
 * skip link to the main content, and the header, main and footer landmarks.
 * Pages render their content as its children. Given the signed-in user, the
 * header shows their name and a Sign out button.
 */
import type { ComponentChildren } from "preact";
import { CsrfField } from "./auth/csrf";

export const STYLESHEET = "/assets/app.css";
export const PROJECT_URL = "https://github.com/by77er/hikebot";

/** The signed-in user, from `layoutUser` in `src/web/auth/csrf.tsx`. */
export interface LayoutUser {
  name: string;
  /** The CSRF token for the Sign out form. */
  csrf: string;
}

export interface LayoutProps {
  /** The whole `<title>`, such as `Page not found · hikebot`. */
  title: string;
  /** The signed-in user; leave it out on pages anyone may see signed out. */
  user?: LayoutUser;
  children: ComponentChildren;
}

export function Layout({ title, user, children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <link rel="stylesheet" href={STYLESHEET} />
      </head>
      <body>
        <a class="skip-link" href="#main">
          Skip to main content
        </a>
        <header>
          <p>
            <a href="/">hikebot</a>
          </p>
          {user && (
            <form method="post" action="/logout">
              <p>
                Signed in as {user.name}. <CsrfField token={user.csrf} />
                <button type="submit">Sign out</button>
              </p>
            </form>
          )}
        </header>
        <main id="main">{children}</main>
        <footer>
          <p>
            hikebot is open source: <a href={PROJECT_URL}>the project</a>.
          </p>
        </footer>
      </body>
    </html>
  );
}
