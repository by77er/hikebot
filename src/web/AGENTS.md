# Working in src/web

The example page is `/trails` in `src/web/pages/trails.tsx`; use your page's
path and file. "Web pages" in `docs/design.md` says how the pages are built
and which headers they carry.

## Add a page

1. Write the page as a component in `src/web/pages/<page>.tsx` that renders
   its content inside `Layout`. Put every value into the markup as a JSX
   expression (`{trail.name}`, `href={url}`), so it is escaped; style it with
   classes from the stylesheet ("Add a static asset"):

   ```tsx
   /** The list of trails at `/trails`. */
   import { Layout } from "../layout";

   export function TrailsPage({ names }: { names: string[] }) {
     return (
       <Layout title="Trails · hikebot">
         <h1>Trails</h1>
         <ul>
           {names.map((name) => (
             <li key={name}>{name}</li>
           ))}
         </ul>
       </Layout>
     );
   }
   ```

2. Register the route on `webRouter` in `src/web/routes.tsx`, answering with
   `htmlResponse`, which sets the content type and the security headers.
   Use `.get` for a page and `.post` for a form's target; a `GET` route also
   answers `HEAD`:

   ```tsx
   import { TrailsPage } from "./pages/trails";

     .get("/trails", () => htmlResponse(<TrailsPage names={["Ridge"]} />))
   ```

   Pass `{ status }` as the second argument for a page answered with
   another status, and `{ headers }` for extra headers such as `Location`.

3. Add it to the screenshots as "Add a page to the screenshots" says.
4. Write its tests as "Test a page" says, then check the whole change:

   ```sh
   npm run typecheck
   npm run lint
   npm test
   ```

## Add a page that needs a signed-in user

"Sign-in and sessions" in `docs/design.md` says what the session holds. The
example is `/trails` again, now for signed-in members only.

1. Take the signed-in user as a prop and pass it to `Layout`, which then
   shows their name and the Sign out button:

   ```tsx
   /** The list of trails at `/trails`, for signed-in members. */
   import { Layout, type LayoutUser } from "../layout";

   export function TrailsPage({
     user,
     names,
   }: {
     user: LayoutUser;
     names: string[];
   }) {
     return (
       <Layout title="Trails · hikebot" user={user}>
         <h1>Trails</h1>
         <ul>
           {names.map((name) => (
             <li key={name}>{name}</li>
           ))}
         </ul>
       </Layout>
     );
   }
   ```

2. In the route, read the clock once with `systemNow()` from
   `src/clock.ts`, start with `requireSession`, which answers someone
   signed out with a redirect to `/login?next=/trails`, and build the
   layout's user with `layoutUser`:

   ```tsx
   import { systemNow } from "../clock";
   import { layoutUser } from "./auth/csrf";
   import { requireSession } from "./auth/session";
   import { TrailsPage } from "./pages/trails";

     .get("/trails", async (request, env) => {
       const now = systemNow();
       const session = await requireSession(request, env, now);
       if (session instanceof Response) return session;
       return htmlResponse(
         <TrailsPage user={await layoutUser(env, session, now)} names={["Ridge"]} />,
       );
     })
   ```

3. For a page of one server, such as `/g/<guild id>`, register a prefix
   (`/g/*`), take the id from the path, and answer with
   `requireGuild(session, guildId)` first, which is the 404 page for a
   server the session does not list. The session's list is only a hint:
   before showing anything of the server, check with the bot's token that
   the user is still a member and has the roles the page needs.
4. Unit test it in `test/web/routes.test.ts`: send a session cookie made
   with `sessionCookie` from `src/web/auth/session.tsx` (with
   `issuedAt: Date.now()`, since the route reads the real clock), and check
   that a request without one gets a `303` to
   `/login?next=%2Ftrails`, as "sends someone signed in to /servers" there
   does.
5. Add an end-to-end scenario: add a Discord user to the fake and sign in
   with the page client, as `test/e2e/sign-in.test.ts` does ("Sign in in an
   end-to-end scenario" in `test/AGENTS.md`):

   ```ts
   e2e.discord.addUser({
     id: "400000000000000901",
     username: "ana",
     guilds: [],
   });
   const client = new PageClient(e2e.url);
   await client.signIn({ id: "400000000000000901" });
   const page = await client.get("/trails");
   expect(page.body).toContain("Signed in as ana.");
   ```

6. Run the tests:

   ```sh
   npx vitest run test/web
   npx vitest run --project e2e test/e2e/sign-in.test.ts
   ```

## Add a form that changes something

The example adds a trail from a form on `/trails`; "Sign-in and sessions"
in `docs/design.md` says which POSTs are refused.

1. In the route that renders the form, make a token with
   `csrfToken(env, session, now)` and pass it to the page; put
   `<CsrfField token={csrf} />` inside the `<form method="post">`:

   ```tsx
   import { CsrfField } from "../auth/csrf";

   <form method="post" action="/trails">
     <CsrfField token={csrf} />
     <label for="trail-name">Trail name</label>
     <input id="trail-name" name="name" required />
     <button type="submit">Add trail</button>
   </form>;
   ```

2. Register the target with `.post`. Read the session (a POST cannot be
   sent back after sign-in, so refuse instead of redirecting), check the
   POST, then do the work and redirect with `303` so a reload does not
   post again:

   ```tsx
   import { checkPost, forbidden } from "./auth/csrf";
   import { readSession } from "./auth/session";
   import { seeOther } from "./redirect";

     .post("/trails", async (request, env) => {
       const now = systemNow();
       const session = await readSession(request, env, now);
       if (!session) return forbidden();
       const form = await checkPost(request, env, session, now);
       if (form instanceof Response) return form;
       const name = form.get("name");
       // check the name, and the user's rights with the bot's token, then save it
       return seeOther("/trails");
     })
   ```

3. Unit test the route: a POST with the page's token and
   `Origin: https://hikebot.example` succeeds; without the token, with
   another user's token, or with `Origin: https://evil.example` it gets
   `403`, as `test/web/auth/routes.test.ts` does for `/logout`.
4. In the end-to-end scenario, submit the form the way a browser does, and
   check a forged one is refused:

   ```ts
   const page = await client.get("/trails");
   const added = await client.submitForm(page, "/trails", { name: "Lake" });
   expect(added.status).toBe(303);
   const forged = await client.request("/trails", {
     form: { name: "Lake" },
     headers: {
       Origin: "https://evil.example",
       "Sec-Fetch-Site": "cross-site",
     },
   });
   expect(forged.status).toBe(403);
   ```

5. Run the tests:

   ```sh
   npx vitest run test/web
   npx vitest run --project e2e test/e2e/sign-in.test.ts
   ```

## Add a static asset

1. Put the file under `public/assets/`; it is served at the same path below
   `/assets/`, so `public/assets/trail-map.svg` is `/assets/trail-map.svg`.
   Link it from a page with a path on the Worker's own origin:

   ```tsx
   <img src="/assets/trail-map.svg" alt="Map of the trails" />
   ```

2. For a stylesheet, add a `<link rel="stylesheet">` next to the one in
   `src/web/layout.tsx`, or add your rules to `public/assets/app.css`.
3. Start the dev server as "Run the bot locally" in the root `AGENTS.md`
   says and request the file in its place in that procedure. It answers
   `200` with the file's type and `Cache-Control: public, max-age=300`, set
   for everything under `/assets/` by `public/_headers`:

   ```sh
   curl -fsS -D - -o /dev/null http://localhost:8787/assets/app.css
   ```

4. Add the file's path to the stylesheet test in `test/web/routes.test.ts`
   ("static assets"), or to a test of your own there, and run it:

   ```sh
   npx vitest run test/web/routes.test.ts -t "static assets"
   ```

## Test a page

1. Unit test the page through the router in `test/web/routes.test.ts`, with
   `outline` from `test/web/helpers.ts`, which reads the HTML with
   `HTMLRewriter`, and `pageHeaders`, which reads the security headers:

   ```ts
   describe("GET /trails", () => {
     it("lists the trails in the page shell", async () => {
       const response = await get("/trails");
       expect(response.status).toBe(200);
       expect(pageHeaders(response)).toEqual(EXPECTED_PAGE_HEADERS);
       const page = await outline(await response.text());
       expect(page).toMatchObject({ title: "Trails · hikebot", scripts: 0 });
       expect(page.text).toContain("Ridge");
     });
   });
   ```

2. When the page shows text that comes from a member or from Discord, add a
   test that passes `<script>alert(1)</script>` in as that text and checks
   that `outline(html).scripts` is `0`, as "escapes text passed into the
   title and the body" in `test/web/response.test.tsx` does. A test that
   renders JSX goes in a `.test.tsx` file.
3. Run the unit tests:

   ```sh
   npx vitest run test/web
   ```

4. Add an end-to-end scenario to `test/e2e/web.test.ts`, or a new
   `test/e2e/<page>.test.ts` that starts the Worker with `useE2E()`.
   Request the page with a `PageClient` from `test/e2e/harness/web.ts`; it
   returns `status`, `headers` and `body`, does not follow redirects (read
   `location` instead) and keeps the cookies the Worker sets in `cookies`.
   Use one client per member, so each has its own cookies:

   ```ts
   import { expect, it } from "vitest";
   import { PageClient } from "./harness/web";
   import { useE2E } from "./harness/worker";

   const e2e = useE2E();

   it("lists the trails", async () => {
     const page = await new PageClient(e2e.url).get("/trails");
     expect(page.status).toBe(200);
     expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
     expect(page.body).toContain("Ridge");
   });
   ```

   Post a form with `client.request("/trails", { form: { name: "Lake" } })`.

5. Run the scenarios and check that no `workerd` process is left:

   ```sh
   npx vitest run --project e2e test/e2e/web.test.ts
   pgrep -x workerd || echo "no workerd left"
   ```

## Check that a route turns a request away before it reaches a guild object

1. In the route's unit test, pass the router an `env` whose `GUILD_HIKE`
   records every call, as `spyNamespace` in `test/web/calendar.test.ts`
   does:

   ```ts
   const idFromName = vi.fn();
   const get = vi.fn();
   const bindings = {
     ...env,
     GUILD_HIKE: { idFromName, get, idFromString: get },
   } as unknown as Env;
   const response = await webRouter.handle(
     new Request("https://hikebot.example/calendar/1/x.ics"),
     bindings,
     createExecutionContext(),
   );
   expect(response.status).toBe(404);
   expect(idFromName).not.toHaveBeenCalled();
   expect(get).not.toHaveBeenCalled();
   ```

2. Run it:

   ```sh
   npx vitest run test/web/calendar.test.ts
   ```

## Take the screenshots

1. Run the script. It prints `wrote docs/screenshots/<file>` for each file,
   and exits non-zero naming the page, viewport and scheme when a page
   answers with another status than its entry in
   `test/screenshots/pages.json` gives, or a file it loads fails:

   ```sh
   npm run screenshots
   pgrep -x workerd || echo "no workerd left"
   ```

2. If Chromium does not start (for example
   `libnspr4.so: cannot open shared object file`), delete what the
   `@sparticuz/chromium` package unpacked and run it again:

   ```sh
   rm -rf "${TMPDIR:-/tmp}/hikebot-chromium"
   npm run screenshots
   ```

3. Check that the files are what the script makes, as CI does on every pull
   request. A second run on the same commit changes no byte, so it prints
   `docs/screenshots/ matches what is committed.` once they are committed:

   ```sh
   git add docs/screenshots
   git commit -m "<what changed on the pages>"
   npm run screenshots:check
   ```

4. If the CI step "Check the screenshots are current" fails while your
   check passes, compare the SHA-256 of each PNG that the step printed in
   its log with yours. The PNGs CI made are kept as the run's artifact
   `screenshots-<head sha>`, on the run's page on GitHub:

   ```sh
   gh run view <run-id> --log | grep -E '[0-9a-f]{64}  docs/screenshots/'
   sha256sum docs/screenshots/*.png
   ```

## Add a page to the screenshots

1. Add an entry for the page to `"pages"` in `test/screenshots/pages.json`:
   its `name` (lower-case words joined by hyphens; it names the PNG files),
   the `path` to open, the `status` it must answer with, the `seed` that
   sets up the data it shows, and the `user` signed in: `null` for a
   signed-out visitor, or the id of the Discord user the seed adds with
   `e2e.discord.addUser` (such as `MEMBER_ID` in
   `test/screenshots/seeds.ts`), whom the script signs in through the fake
   Discord API first. For the page a member sees after pressing Cancel at
   Discord, give `"path": "/auth/callback"` and `"cancel": true`. Add one
   entry per state worth seeing, such as `servers`, `servers-many` and
   `servers-none`.

   ```json
   {
     "name": "trails",
     "path": "/trails",
     "status": 200,
     "seed": "empty",
     "user": null
   }
   ```

2. If the page needs data, add a seed to `SEEDS` in
   `test/screenshots/seeds.ts`. A seed gets the running Worker and fake
   Discord API and sets the state up as members would, as "Play a hike
   round in an end-to-end scenario" in `test/AGENTS.md` says, with fixed
   names and dates written years ahead, never from today's date.
3. A `GET` route that is not a page (a file, a redirect, a plain-text
   answer) goes under `"excluded"` with its `route` as registered and the
   `reason` it has no screenshot.
4. Run the test that compares the list with the web router's `GET` routes:

   ```sh
   npx vitest run test/web/screenshot-pages.test.ts
   ```

5. Follow "Take the screenshots", then "Review your own UI change as a
   designer".

## Review your own UI change as a designer

Do this for every change to `src/web/`, `public/` or `docs/screenshots/`,
before marking the pull request ready.

1. Follow "Take the screenshots", then list the screenshots your change
   adds, changes or removes:

   ```sh
   git fetch origin main
   git diff --stat origin/main... -- docs/screenshots
   ```

2. Open every PNG of each page you changed, at both viewports and in both
   schemes, and the same file from `main` next to it. Judge from the
   images, not from the code: open the files in an image viewer (an agent
   reads them with its file-reading tool, which shows images):

   ```sh
   mkdir -p /tmp/before
   git show origin/main:docs/screenshots/<file> > /tmp/before/<file>
   ```

   For a page that is new, `git show` answers that the path is not in
   `origin/main`: there is no before image.

3. Go through this checklist for each page, as a critical designer who has
   never seen it:
   - **Purpose and hierarchy.** Within a few seconds it is clear what the
     page is, what state the hike is in, and what the visitor can do next.
     There is one primary action, and it looks like one.
   - **Consistency.** Headings, buttons, forms, spacing, colours and wording
     look and behave like the existing pages and components.
   - **Every state.** Empty, error, success and disabled states, very long
     text (a 100-character location name) and many items (25 options) each
     look right. Add a page entry with a seed for each state that differs.
   - **Phone layout.** Nothing scrolls sideways at 390px, and every tap
     target is at least 44px high and wide.
   - **Accessibility.** Text contrast is at least 4.5:1 (3:1 for large
     text); focus is visible and moves in a sensible order; every control
     has a label; headings go in order without skipping a level; everything
     works from the keyboard alone; nothing is conveyed by colour alone;
     motion stops under `prefers-reduced-motion`.
   - **Wording.** Plain words, and the same words the bot uses in Discord
     for the same things.
   - **Dark scheme.** Every colour, border, image and focus ring still
     works on the dark background.

   A screenshot does not show focus, keyboard order or motion: check those
   in a browser against the dev server ("Run the bot locally" in the root
   `AGENTS.md`). Without a browser, list a page's controls in focus order
   and read their labels from the HTML:

   ```sh
   curl -fsS http://localhost:8787/ | grep -oE '<(a|button|input|select|textarea|label|h[1-6])\b[^>]*>'
   ```

4. Give each finding a severity:
   - **blocker**: a visitor cannot do the job, or the page breaks or shuts
     someone out (unreadable text, a control without a label, sideways
     scrolling on a phone, a dead end).
   - **major**: the job is hard, slow or misleading (no clear primary action
     or two of them, contrast below the minimum, a target under 44px, a
     state that looks broken, words that differ from the bot's).
   - **minor**: noticeably off without getting in the way (uneven spacing,
     misalignment, a component that differs from its siblings).
   - **nit**: taste.
5. Fix every blocker and major, take the screenshots again and repeat from
   step 1. Fix or explain the rest.
6. Write the findings into the `## Design review` section of the pull
   request description, one line each: the severity, the page, viewport and
   scheme, what you saw, and what was done about it:

   ```text
   - **major** home (phone, dark): the link colour is hard to tell from the text. Fixed: links are underlined.
   - **nit** not-found (desktop, light): the page is short and leaves the screen empty below. Left: an error page stays short.
   ```

   When you find nothing, say what you checked, page by page.

## Describe a UI change in the pull request

Do this for every pull request that changes `src/web/`, `public/` or
`docs/screenshots/`.

1. After your last push, print the screenshot table. It lists each PNG that
   differs between the merge base with `main` and your pushed head commit,
   with the image before and after, or `No visual change.`:

   ```sh
   git push
   git fetch origin main
   npm run screenshots:table
   ```

2. Write the description with a `## Design review` section, from "Review
   your own UI change as a designer", and the table as the `## Screenshots`
   section, then set it as step 3 of "Get a pull request checked" in the
   root `AGENTS.md` says.
3. Check the description as CI will, from the pull request as GitHub has
   it:

   ```sh
   gh api repos/by77er/hikebot/pulls/<n> --jq '{pull_request: .}' > /tmp/pr-event.json
   GITHUB_EVENT_PATH=/tmp/pr-event.json npm run description:check
   ```

   It prints `the description has what it needs`, or what is missing.

4. Every push changes the head commit, so run step 1 again after each push
   and replace the section. The check reads the description as it was when
   its run started: after editing the description of a ready pull request,
   start a new run with `gh pr ready <n> --undo` and `gh pr ready <n>`.

## Review a pull request that changes the web UI

As the reviewer of a pull request that changes `src/web/`, `public/` or
`docs/screenshots/`:

1. Check out the pull request and check that its screenshots are what the
   script makes; it prints `docs/screenshots/ matches what is committed.`:

   ```sh
   gh pr checkout <n>
   npm run screenshots:check
   ```

2. Check that the `## Screenshots` section lists every changed PNG, and
   that each image in it is the committed file: download each before and
   after image from its URL and compare it with the file at the merge base
   and at the head:

   ```sh
   git fetch origin main
   git diff --name-only origin/main... -- docs/screenshots
   mkdir -p /tmp/review/before /tmp/review/after
   curl -fsSL -o /tmp/review/after/<file> <after url>
   cmp /tmp/review/after/<file> docs/screenshots/<file>
   curl -fsSL -o /tmp/review/before/<file> <before url>
   git show "$(git merge-base origin/main HEAD)":docs/screenshots/<file> | cmp - /tmp/review/before/<file>
   ```

3. Open every before and after image and go through the checklist in
   "Review your own UI change as a designer" yourself, before reading the
   author's `## Design review`. Be critical: judge the page as a member
   who has never seen it would, independently of the author's notes.
4. Compare your findings with the author's. Request changes for every
   blocker or major the author missed, or recorded without fixing:

   ```sh
   gh pr review <n> --request-changes --body-file <file>
   ```

5. In the review, say what you saw in the screenshots, page by page, at
   each viewport and scheme. A review of a UI pull request that does not
   say what was seen in the screenshots is not a design review.
