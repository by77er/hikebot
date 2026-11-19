/**
 * App header: the band at the top of every page. The brand mark links
 * home; after it come the server the page is about (`context`) and the
 * page's navigation (`nav`), which pages of one server add; at the end,
 * for a signed-in user, the user menu: their avatar and name, which open a
 * panel saying who is signed in, with Sign out (a form posting to
 * `/logout` with the CSRF token). The menu is a `<details>` element, so it
 * opens and closes without script; "App header" in docs/design-system.md
 * says why it is a menu rather than an always-visible button.
 */
import type { ComponentChildren } from "preact";
import { CsrfField } from "../auth/csrf";
import { Avatar } from "./avatar";
import { Blaze } from "./blaze";
import { Button, type Preview } from "./button";
import { ChevronDownIcon } from "./icons";

/** The signed-in user, from `layoutUser` in `src/web/auth/csrf.tsx`. */
export interface HeaderUser {
  name: string;
  /** The avatar's address (`userAvatarUrl`), or null without one. */
  avatar: string | null;
  /** The CSRF token for the Sign out form. */
  csrf: string;
}

export interface AppHeaderProps {
  /** The server the page is about, shown after the brand. */
  context?: ComponentChildren;
  /** The page's navigation: a `<ul>` of links, the current one marked. */
  nav?: ComponentChildren;
  /** The signed-in user; leave it out on pages anyone may see signed out. */
  user?: HeaderUser;
  /** Style guide only: shows the user menu open. */
  open?: boolean;
  /** Style guide only: shows a state of the menu's button. */
  preview?: Preview;
}

export function AppHeader({
  context,
  nav,
  user,
  open,
  preview,
}: AppHeaderProps) {
  return (
    <header class="shell__header">
      <div class="shell__inner app-header__inner">
        <a class="shell__brand" href="/">
          <Blaze />
          hikebot
        </a>
        {context !== undefined && <p class="app-header__context">{context}</p>}
        {nav !== undefined && (
          <nav class="shell__nav app-header__nav" aria-label="Main">
            {nav}
          </nav>
        )}
        {user && <UserMenu user={user} open={open} preview={preview} />}
      </div>
    </header>
  );
}

function UserMenu({
  user,
  open,
  preview,
}: {
  user: HeaderUser;
  open?: boolean;
  preview?: Preview;
}) {
  return (
    <details class="app-header__menu" open={open}>
      <summary class="app-header__summary" data-preview={preview}>
        <Avatar name={user.name} src={user.avatar} size="small" />
        <span class="u-visually-hidden">Your account: </span>
        <span class="app-header__name">{user.name}</span>
        <ChevronDownIcon class="app-header__chevron" />
      </summary>
      <div class="app-header__panel">
        <p class="app-header__signed-in">Signed in as {user.name}.</p>
        <form method="post" action="/logout">
          <CsrfField token={user.csrf} />
          <Button variant="quiet" type="submit">
            Sign out
          </Button>
        </form>
      </div>
    </details>
  );
}
