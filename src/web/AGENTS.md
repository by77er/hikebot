# Working in src/web

The example page is `/trails` in `src/web/pages/trails.tsx`; use your page's
path and file. "Web pages" in `docs/design.md` says how the pages are built
and which headers they carry.

## Add a page

1. Write the page as a component in `src/web/pages/<page>.tsx` that renders
   its content inside `Layout`. Put every value into the markup as a JSX
   expression (`{trail.name}`, `href={url}`), so it is escaped; build it
   from the design system's layout classes and components, as "Build a
   page from the design system" says:

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

1. Take the signed-in user as a prop and pass it to `Layout` as `user`:

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

3. For a page of one server, under `/g/<guild id>`, follow "Add a page for
   a server" instead.
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

## Add a page for a server

The example is the server's channels at `/g/<guild id>/channels`; use your
page's path and file. "Web pages for a server" in `docs/design.md` says
what the guard answers.

1. Write the page in `src/web/pages/server/<page>.tsx`, taking the user and
   the view, as "Add a page that needs a signed-in user" says. Show only
   what the view holds; if it lacks something, add it as "Add a field to
   the web view" in `src/guild/AGENTS.md` says, never by reading the
   guild object otherwise. Use `view.viewer.isAdmin` for what only an
   admin sees:

   ```tsx
   /** A server's channels at `/g/<guild id>/channels`. */
   import type { WebView } from "../../../guild/web-view";
   import { BackLink } from "../../components/back-link";
   import { Layout, type LayoutUser } from "../../layout";

   export function ChannelsPage({
     user,
     view,
   }: {
     user: LayoutUser;
     view: WebView;
   }) {
     return (
       <Layout title={`Channels · ${view.server.name} · hikebot`} user={user}>
         <div class="stack stack--section">
           <BackLink href={`/g/${view.server.id}`}>
             Back to {view.server.name}
           </BackLink>
           <h1>Channels</h1>
           <p>Votes: {view.settings.voteChannel?.name ?? "not set"}</p>
         </div>
       </Layout>
     );
   }
   ```

2. In `src/web/server-routes.tsx`, write its handler, starting with
   `requireServer`, which signs the user in, turns away a server the
   session does not list, and reads the server with the bot's token,
   answering for a user who is not a member or when Discord cannot be
   asked. Pass the hike log's page and size when the page shows the log:

   ```tsx
   import { ChannelsPage } from "./pages/server/channels";

   async function channelsPage(request: Request, env: Env, guildId: string) {
     const server = await requireServer(request, env, guildId);
     if (server instanceof Response) return server;
     return htmlResponse(
       <ChannelsPage user={server.user} view={server.view} />,
     );
   }
   ```

   For an action (a POST) on the server, follow "Add an action a member
   can take on a server's page", or "Add an admin action to a server's
   page" for one only admins may take.

3. Add one line for it to `SERVER_PAGES` there, the path after
   `/g/<guild id>` as its key:

   ```tsx
     ["/channels", channelsPage],
   ```

4. Test it in `test/web/server-guard.test.tsx` or a test file of its own:
   pass the router a `GUILD_HIKE` binding whose objects answer `webView`
   with a fixed view, as `answeringNamespace` there does, with the view
   from `baseView` in `test/web/pages/server/view.ts`, and check that a
   server the session does not list is the 404 page without reaching the
   binding, as "Check that a route turns a request away before it reaches
   a guild object" says. Run them:

   ```sh
   npx vitest run test/web
   ```

5. Add an end-to-end scenario to `test/e2e/server-page.test.ts`: play the
   state with `RoundPlayer` ("Play a hike round in an end-to-end scenario"
   in `test/AGENTS.md`), add the user to the guild with
   `e2e.discord.addMember`, sign them in with the guild in their list, and
   request the page:

   ```sh
   npx vitest run --project e2e test/e2e/server-page.test.ts
   ```

6. Add it to the screenshots as "Add a page to the screenshots" says, with
   a `server(...)` seed from `test/screenshots/seeds.ts`, whose server is
   `/g/220000000000000101`; add the admin's view too where it differs.

## Add a section to the server's page

The example adds the hike's map to the server's page,
`src/web/pages/server/page.tsx`.

1. Write the section in `src/web/pages/server/<section>.tsx`, with a
   comment at the top saying where on the page it sits and what it shows.
   It takes `{ view }: { view: WebView }`, returns `null` when it has
   nothing to show, and starts with an `h2` (or a component whose heading
   is level 2), so the page's outline holds:

   ```tsx
   /**
    * The server's page, after the planned hike: the planned hike's map
    * picture. Nothing while no hike is planned or it has no picture.
    */
   import type { WebView } from "../../../guild/web-view";

   export function HikeMap({ view }: { view: WebView }) {
     const hike = view.plannedHike;
     if (hike?.mapPictureKey == null) return null;
     return (
       <section class="stack" aria-labelledby="hike-map">
         <h2 id="hike-map">Map</h2>
         <img
           src={`/g/${view.server.id}/map.png`}
           alt={`Map of ${hike.location.label}`}
         />
       </section>
     );
   }
   ```

2. Import it in `src/web/pages/server/page.tsx` and add one line for it
   where it belongs in the page's order:

   ```tsx
           <PlannedHike view={view} />
           <HikeMap view={view} />
           <LogPreview view={view} />
   ```

3. Test it in `test/web/pages/server/<section>.test.tsx`, one test per
   state it shows, from the fixed views in `test/web/pages/server/view.ts`
   (add a builder there for a state it lacks), including text with markup
   in it, which must arrive as text:

   ```tsx
   import { describe, expect, it } from "vitest";
   import { HikeMap } from "../../../../src/web/pages/server/hike-map";
   import { render } from "../../components/render";
   import { baseView, plannedHike } from "./view";

   describe("HikeMap", () => {
     it("shows nothing without a map picture", () => {
       expect(
         render(<HikeMap view={baseView({ plannedHike: plannedHike() })} />),
       ).toBe("");
     });
   });
   ```

4. If the order of the sections changed, update the order test in
   `test/web/pages/server/page.test.tsx`, then run the tests:

   ```sh
   npx vitest run test/web/pages/server
   ```

5. Add a screenshot of each state it shows, as "Add a page to the
   screenshots" says, and follow "Review your own UI change as a
   designer".

## Add an admin action to a server's page

The example adds Reopen vote, a control that acts on a poll and asks
first; use your control's kind, round action and words. "Web pages for a
server" in `docs/design.md` says what every admin action checks.

1. Write the round action in `src/features/round-actions.ts` and its
   button on the Discord panel, as "Add a round action" in
   `src/features/AGENTS.md` says, adding the kind to `PanelActionKind` and
   the control to `panelActions` in `src/features/admin-panel.ts` in the
   states where the panel offers it. The view's `admin.actions` then offer
   it too. A control only the web page has goes in `webAdminActions` in
   `src/features/web-admin.ts` instead.
2. In `src/features/web-admin.ts`, add a case to `act` that calls the
   round action with the request's `target` (or `text`, one line per item),
   and, for a control that asks first, give it a `confirm` in
   `webAdminActions` with the panel's question and what it does:

   ```ts
       case "reopen-vote":
         return reopenVote(context, actor, { pollId: target });
   ```

3. In `src/web/admin/routes.tsx`, add one line for its POST to
   `ADMIN_ACTIONS`, through `action`, which answers with `adminAction`
   from `action.tsx`, and, for a control that asks first, one for its
   confirmation page to `ADMIN_PAGES`. For a control that takes input,
   write a form page like `startPage` and pass `adminAction` a `refused`
   hook that shows the form again for the refusals of its input, as
   `startAction` does:

   ```tsx
     ["/admin/reopen-vote", confirmPage("reopen-vote")],
   ```

   ```tsx
     ["/admin/reopen-vote", action("reopen-vote")],
   ```

4. Check the Admin card (`src/web/pages/server/admin-controls.tsx`) in
   each state that offers the control: a control with `confirm` must be a
   link to its confirmation page, a start a link to its form page, any
   other a button that posts. For another kind of page, add its case to
   `pageOf` there.
5. Test it: in `test/features/web-admin.test.ts`, that the view offers it
   in the panel's states and that `runWebAdminAction` runs it as the actor
   and refuses it, with the panel's sentence, once the state changed; in
   `test/web/admin/routes.test.tsx`, that its POST reaches `adminAction`
   with the target and is refused without the token; and in
   `test/e2e/admin-web.test.ts`, the admin doing it from the page with
   `client.submitForm` while members act in Discord:

   ```sh
   npx vitest run test/features/web-admin.test.ts test/web/admin
   npx vitest run --project e2e test/e2e/admin-web.test.ts
   ```

6. Add its confirmation page to the screenshots, and the server's page
   after it with a `submit` entry, as "Add a page to the screenshots"
   says, then follow "Review your own UI change as a designer".

## Put a map on a page

The example puts the planned hike's map on a page of a server; "Map view"
in `docs/design-system.md` says what the component shows, and
"Interactive map" in `docs/design.md` how it is drawn.

1. Get the places from the view: a point (`{ lat, lon }`) and a name for
   each. If the view lacks them, add them as "Add a field to the web view"
   in `src/guild/AGENTS.md` says; the planned hike's pin is `hikePlace.pin`
   and a location option's is its `place`.
2. Render `MapView` from `src/web/components/map-view.tsx`, with no map
   when there is no place. One marker is a pin, centred at zoom 13; give
   several markers `number`s, which the map and its list under it show.
   Pass the stored picture's address as `picture` when there is one, so
   the page shows it without JavaScript; a picture of a server's hike is
   `/g/<guild id>/map.png`, served to members only. Give the place's name
   and coordinates as `caption`:

   ```tsx
   import { coordinates, MapView } from "../../components/map-view";

   const hike = view.plannedHike;
   const pin = view.hikePlace?.pin ?? null;
   if (hike === null || pin === null || hike.mapPictureKey === null) {
     return null;
   }
   const point = { lat: pin.lat, lon: pin.lon };
   return (
     <MapView
       title={`Map of ${hike.location.label}`}
       markers={[{ ...point, label: hike.location.label }]}
       picture={`/g/${view.server.id}/map.png`}
       caption={`${hike.location.label}: ${coordinates(point)}`}
     />
   );
   ```

   The component loads the map's script itself; write no `<script>`, and
   change nothing in the Content-Security-Policy.

3. Test it as "Add a section to the server's page" says: the markers and
   the caption in the markup, and nothing without a place:

   ```sh
   npx vitest run test/web/components/map-view.test.tsx test/web/pages/server
   ```

4. Add the page's screenshots as "Add a page to the screenshots" says,
   with `"map": true` in its entry, so it is taken in the browser with
   WebGL, and a second entry with `"javascript": false` where the page
   shows a picture without JavaScript. Its seed puts the places inside the
   sample map data (`maps/sample/sample.json`): give each location option
   a `point`, and a complete round a `mapPicture`, a PNG such as
   `public/assets/maps/samples/trailhead-z12.png` (drawn at the sample
   point), in `play.seedRound`.
5. Check it draws in a browser, from this site only and without moving
   anything, as `test/e2e/map-browser.test.ts` does for the server's page,
   and run that test:

   ```sh
   npx vitest run --project e2e test/e2e/map-browser.test.ts
   ```

## Update MapLibre GL JS

1. Install the new version, pinned, as "Add a dependency" in the root
   `AGENTS.md` says, then copy its modules and licence over the old ones:

   ```sh
   npx -y npm@12 install -D --save-exact maplibre-gl@<version>
   cp node_modules/maplibre-gl/dist/maplibre-gl.mjs node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs node_modules/maplibre-gl/LICENSE.txt public/assets/maps/maplibre/
   ```

2. Install the matching `@maplibre/maplibre-gl-style-spec`, the version
   `maplibre-gl` depends on, so the style is checked against it:

   ```sh
   npm view maplibre-gl@<version> dependencies --json | grep style-spec
   npx -y npm@12 install -D --save-exact @maplibre/maplibre-gl-style-spec@<that version>
   ```

3. Change the version in "Map view" in `docs/design-system.md` and in
   "Interactive map" in `docs/design.md`, then run the map's tests and take
   the screenshots, as "Take the screenshots" says:

   ```sh
   npx vitest run test/maps test/web/maps.test.ts
   npx vitest run --project e2e test/e2e/map-browser.test.ts
   npm run screenshots
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

   Build the form from the design system's form components, as "Forms" in
   `docs/design-system.md` says: `novalidate` on the form, a form row per
   field (`TextField`, `Textarea`, `Select`, `ChoiceGroup`), then
   `FormActions` with the submit Button and the way back. Give each field
   the value it had, so the page can come back with what was typed:

   ```tsx
   import { Button } from "../components/button";
   import { ErrorSummary } from "../components/error-summary";
   import { FormActions } from "../components/form-actions";
   import { TextField } from "../components/text-field";

   <>
     {errors.name !== undefined && (
       <ErrorSummary
         title="The trail was not added."
         errors={[{ field: "trail-name", message: errors.name }]}
       />
     )}
     <form method="post" action="/trails" novalidate>
       <CsrfField token={csrf} />
       <TextField
         id="trail-name"
         name="name"
         label="Trail name"
         required
         maxLength={80}
         autoComplete="off"
         value={typed.name}
         error={errors.name}
       />
       <FormActions>
         <Button variant="primary">Add trail</Button>
         <Button href="/trails">Back</Button>
       </FormActions>
     </form>
   </>;
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
       // check the name, and the user's rights with the bot's token; if the
       // check fails, answer with the page again, given what was typed and
       // the errors, and a <title> starting with "Error: "; then save it
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

## Add an action a member can take on a server's page

The example lets a member withdraw a location they proposed, with
`POST /g/<guild id>/polls/<poll id>/withdraw`; use your action's name,
path, fields and feature file. "Web pages for a server" in
`docs/design.md` says how an action is checked and answered.

1. Do the action in the feature's own code, in one function that the
   Discord control's handler calls too, so both follow the same rules and
   say the same words. It takes the handler context, the member's user id,
   the poll and what they sent, writes through the store, marks the poll
   message for a refresh ("Refresh a poll message after a change" in
   `src/features/AGENTS.md`), and returns a `MemberOutcome` from
   `src/features/poll-ui.ts`, a refusal carrying the bot's sentence:

   ```ts
   export async function withdrawLocation(
     context: HandlerContext,
     userId: string,
     pollId: number,
     optionId: number,
   ): Promise<MemberOutcome<OptionView>> {
     const store = new PollStore(context.storage);
     try {
       const option = store.withdrawOption(pollId, optionId, userId);
       await scheduleRefresh(context.storage, pollId, store.now());
       return { ok: true, value: option };
     } catch (error) {
       if (!isPollError(error)) throw error;
       return { ok: false, code: error.code, message: withdrawRefusal(error) };
     }
   }
   ```

2. Add the guild object's method for the web in
   `src/guild/web-action.ts`: it starts with `memberNow`, which asks
   Discord whether the user is a member at this moment, and turns the
   outcome into a `WebMemberResult`, with the banner the page shows once:

   ```ts
   export async function webWithdraw(
     context: HandlerContext,
     cache: WebViewCache,
     request: WebWithdrawRequest,
     options: ActionOptions = {},
   ): Promise<WebMemberResult> {
     const member = await memberNow(context, cache, request, options);
     if ("kind" in member) return member;
     const { userId, pollId, optionId } = request;
     const outcome = await withdrawLocation(context, userId, pollId, optionId);
     if (!outcome.ok) return refusal(outcome);
     return {
       kind: "done",
       banner: `Withdrew ${outcome.value.label}.`,
       note: null,
     };
   }
   ```

   Give `GuildHike` (`src/guild/guild-hike.ts`) a one-line RPC method
   that calls it, as `webVote` does, and `src/web/guild.ts` a function
   that calls the method, as `voteInGuild` does.

3. Add the form target to `SERVER_ACTIONS` in
   `src/web/server-routes.tsx`, one line, and its handler: it starts with
   `requireServerAction`, which refuses a request without a session, a
   valid CSRF token or a same-origin request before the guild object is
   reached, reads the fields, calls the guild, and answers with `answer`,
   given what was sent, so a refusal shows the form as it was:

   ```tsx
     [/^\/polls\/(\d{1,15})\/withdraw$/, withdraw],
   ```

   ```tsx
   async function withdraw(
     request: Request,
     env: Env,
     guildId: string,
     pollId: number,
   ) {
     const action = await requireServerAction(request, env, guildId);
     if (action instanceof Response) return action;
     const optionId = Number(action.form.get("option"));
     const result = await withdrawInGuild(env, {
       guildId,
       userId: action.session.userId,
       pollId,
       optionId,
     });
     return answer(request, env, guildId, pollId, action, result, {
       form: "withdraw",
       optionId,
     });
   }
   ```

4. Add the form's name and what it sends to `FormName` and `Refusal` in
   `src/web/pages/server/forms.ts`, with a path function beside
   `votesPath` and a case in `offersForm` saying when the page shows the
   form. Put the form in its section, as "Add a form that changes
   something" step 1 says, with `<CsrfField token={forms.csrf} />`; take
   its refusal with `refusalFor(view, forms, "withdraw")` and show the
   sentence with `BotSentence`, in an `ErrorSummary` above the form and on
   its field, the field keeping what was sent. Whatever the form needs to
   offer comes from the view ("Add a field to the web view" in
   `src/guild/AGENTS.md`).
5. Test it:
   - the feature function in `test/features/<feature>.test.ts`, and that
     the Discord control still answers as before;
   - the guild's method in `test/guild/web-member-action.test.ts`: done, each
     refusal code with the bot's sentence and nothing stored, and a member
     who left since the page's read refused;
   - the route in `test/web/server-actions.test.tsx`: the fields reach the
     guild object, a done action redirects with the banner, and a request
     without a session, a token, with another user's token or from
     another site is refused before the binding is reached;
   - the form in `test/web/pages/server/<section>.test.tsx`: its markup,
     the accessible name of each field, and one test per refusal code
     with the sentence and the input kept;
   - an end-to-end scenario in `test/e2e/member-web.test.ts` that submits
     the form with `client.submitForm` and waits with `eventually` for the
     poll message in the fake Discord to change.

   ```sh
   npx vitest run test/guild/web-member-action.test.ts test/web/server-actions.test.tsx test/web/pages/server
   npx vitest run --project e2e test/e2e/member-web.test.ts
   ```

6. Add a screenshot of the form, of its refusal and of the banner, as "Add
   a page to the screenshots" says, with `submit` for the last two.

## Add a static asset

1. Put the file under `public/assets/`; it is served at the same path below
   `/assets/`, so `public/assets/trail-map.svg` is `/assets/trail-map.svg`.
   Link it from a page with a path on the Worker's own origin:

   ```tsx
   <img src="/assets/trail-map.svg" alt="Map of the trails" />
   ```

   A file the design system's stylesheet uses goes under
   `public/assets/cairn/` and is referred to by a relative `url()`, so it
   is served under the stylesheet's versioned path. For styles, follow
   "Add a component to the design system" instead of adding a stylesheet.

2. Start the dev server as "Run the bot locally" in the root `AGENTS.md`
   says and request the file in its place in that procedure. It answers
   `200` with the file's type and `Cache-Control: public, max-age=300`, set
   for everything under `/assets/` by `public/_headers`. Under the running
   version's path, which a rendered page links, it answers with
   `Cache-Control: public, max-age=31536000, immutable` (a path naming any
   other version keeps `max-age=300`):

   ```sh
   curl -fsS -D - -o /dev/null http://localhost:8787/assets/trail-map.svg
   V=$(curl -fsS http://localhost:8787/ | grep -o '/assets/v/[^/]*/' | head -1)
   curl -fsS -D - -o /dev/null "http://localhost:8787${V}trail-map.svg"
   ```

3. Add the file's path to the stylesheet test in `test/web/routes.test.ts`
   ("static assets"), or to a test of your own there, and run it:

   ```sh
   npx vitest run test/web/routes.test.ts -t "static assets"
   ```

## Build a page from the design system

1. Read "Method" and "Designing a new page" in `docs/design-system.md`.
   Write the page's question sentence (who is looking, where, and what
   they are trying to find out or do) at the top of the pull request
   description's `## Design review`:

   ```text
   Question: a member who tapped a link to the trails in Discord, on their phone, wants to see every place proposed so far and propose another.
   ```

2. Under it, write the presence table: each element the page needs,
   largest first, and the question it answers that nothing else on the
   page does. Leave out anything without an answer, eyebrows, leads,
   icons and helper text included. The three questions come first (where
   am I, what state is the hike in, what can I do next), and the one
   primary action is a button:

   ```text
   | Element                     | Question it answers                 |
   | --------------------------- | ----------------------------------- |
   | h1 "Trails"                 | Where am I?                         |
   | The list of places          | What has been proposed?             |
   | The banner when it is empty | Has anything been proposed?         |
   | "Propose a location"        | How do I add mine? (primary action) |
   ```

3. Write the page in the order of "Build order" in
   `docs/design-system.md`: the real words and numbers first, then the
   hierarchy with headings and `.stack` spacing only, then the
   components, then colour. Build it from the shell, the layout classes
   and the components, with no styles of its own. `width="overview"` is
   for lists and dashboards; a page that does one job keeps the default
   task width:

   ```tsx
   /** The list of trails at `/trails`. */
   import { Banner } from "../components/banner";
   import { Button } from "../components/button";
   import { Card } from "../components/card";
   import { MapPinIcon } from "../components/icons";
   import { Layout } from "../layout";

   export function TrailsPage({ names }: { names: string[] }) {
     return (
       <Layout title="Trails · hikebot" width="overview">
         <div class="stack stack--section">
           <div class="page-heading">
             <h1>Trails</h1>
           </div>
           {names.length === 0 && (
             <Banner
               tone="info"
               title="Nobody has proposed a location in this server."
             />
           )}
           <ul class="grid list-reset">
             {names.map((name) => (
               <li key={name}>
                 <Card title={name} />
               </li>
             ))}
           </ul>
           <div class="cluster">
             <Button variant="primary" icon={MapPinIcon} href="/trails/new">
               Propose a location
             </Button>
           </div>
         </div>
       </Layout>
     );
   }
   ```

4. If the page needs something no component offers, add a component
   ("Add a component to the design system") rather than page CSS. Only a
   layout used by this page alone goes in `public/assets/cairn/pages/<page>.css`,
   with classes named `.<page>-<thing>`, imported by a line in
   `public/assets/cairn/cairn.css` under the page styles, in alphabetical
   order:

   ```css
   @import url("pages/trails.css") layer(components);
   ```

5. Design every state "States" in `docs/design-system.md` lists, and add
   a screenshot entry with a seed for each data-view state that differs
   ("Add a page to the screenshots"): empty, error, partial and first
   run, and loading for a part that loads after the page, such as the
   map (its no-JavaScript entry shows what stands in for it); and for every control, small links included, rest, hover,
   focus-visible, pressed (with a finger too), disabled, and busy if it
   starts work.
6. Register and test the page as "Add a page" says, then run the design
   system's checks:

   ```sh
   npx vitest run test/web/token-use.test.ts test/web/size-budget.test.ts test/web/routes.test.ts test/web/contrast.test.ts
   ```

7. Follow "Take the screenshots" and "Review your own UI change as a
   designer".

## Add a token

1. Check the token tables in `docs/design-system.md` first: use an
   existing role if one fits. Name a new token after its role, as the
   others are named (`--color-warning` rather than `--color-amber`).
2. Add it to `public/assets/cairn/tokens.css`, in its group in `:root`. A
   colour also gets its dark value in the `prefers-color-scheme: dark`
   block, in the same order:

   ```css
   --color-planned: #2f5d7c;
   ```

3. For a colour, add every pairing it may be drawn in to `PAIRINGS` in
   `src/web/tokens.ts`, with its kind (`text`, `large-text` or
   `non-text`), and add its two lines to the lists at the end of
   `public/assets/cairn/pages/styleguide.css`:

   ```css
   .styleguide-sample[data-bg="color-planned"] {
     background: var(--color-planned);
   }
   .styleguide-sample[data-fg="color-planned"] {
     color: var(--color-planned);
   }
   ```

4. Add a row for it to its table in `docs/design-system.md`, saying its
   value in each scheme, its role and when to use it; a colour's pairings
   go in "Allowed pairings".
5. Run the checks. The contrast test names any pairing below its minimum,
   in either scheme; change the value until it passes:

   ```sh
   npx vitest run test/web/contrast.test.ts test/web/token-use.test.ts test/web/routes.test.ts
   ```

6. Open `/styleguide` on the dev server ("Run the bot locally" in the root
   `AGENTS.md`) and find the token under "Colour" and its pairings under
   "Contrast".

## Add a component to the design system

Give the component four files of its own, one per job, and one line in
each of three lists, in alphabetical order, one item per line, so that
tasks adding different components at the same time edit different lines.
Here the component is `pill`; use your component's name.

1. Write the markup as a typed Preact component in
   `src/web/components/pill.tsx`, with a comment at the top saying what it
   is for and when to use it. Give it the classes `.pill`, `.pill__<part>`
   and `.pill--<variant>`, take states from the platform (`disabled`,
   `aria-current`, `aria-disabled`), and accept `preview?: Preview` (from
   `button.tsx`) as `data-preview` if it is interactive, so the style guide
   can show hover, active and focus:

   ```tsx
   /** Pill: a hike's state in a word, such as "Open" or "Decided". */
   export type PillTone = "open" | "decided" | "cancelled";

   export function Pill({
     tone,
     children,
   }: {
     tone: PillTone;
     children: string;
   }) {
     return <span class={`pill pill--${tone}`}>{children}</span>;
   }
   ```

2. Style it in `public/assets/cairn/components/pill.css`, with a comment at
   the top, using tokens only (`var(--space-2)`, `var(--color-success)`),
   and every state "States" in `docs/design-system.md` lists that it has:
   `:hover` and `[data-preview="hover"]`; `:active`, `[data-pressed]` and
   `[data-preview="active"]` in one rule, so a press shows with a finger
   too; `:disabled` or `[aria-disabled="true"]`; and, if it starts work,
   `[aria-busy="true"]` with the pressed fill. Change state with no
   transition on any colour: a `transition` names only `opacity` or
   `transform`, with a property list. The focus ring comes from the base
   layer. Use
   only pairings listed in "Allowed pairings" of `docs/design-system.md`,
   or add the pairing as "Add a token" says. Then add its import to
   `public/assets/cairn/cairn.css`, in alphabetical order among the
   components:

   ```css
   @import url("components/pill.css") layer(components);
   ```

3. Test its rendered markup and its accessible name in
   `test/web/components/pill.test.tsx`, with `render` and `spokenText`
   from `test/web/components/render.ts`:

   ```tsx
   import { describe, expect, it } from "vitest";
   import { Pill } from "../../../src/web/components/pill";
   import { render, spokenText } from "./render";

   describe("Pill", () => {
     it("says the state in words", async () => {
       const html = render(<Pill tone="decided">Decided</Pill>);
       expect(html).toBe('<span class="pill pill--decided">Decided</span>');
       expect(await spokenText(html)).toBe("Decided");
     });
   });
   ```

4. Show it in every variant and state in
   `src/web/pages/styleguide/pill.tsx`, exporting a `StyleguideSection`
   whose `id` is the component's name; `StateList` from `section.tsx` lays
   out one example per state. Use the bot's words in the examples. Add the
   section to `COMPONENTS` in `src/web/pages/styleguide.tsx`, in
   alphabetical order:

   ```tsx
   import { pillSection } from "./styleguide/pill";

     pillSection,
   ```

5. Add an entry for it to "Components" in `docs/design-system.md`, in
   alphabetical order: its file, what it is for, its variants and states,
   and its accessible name.
6. Run the design system's checks and the component's test:

   ```sh
   npx vitest run test/web
   ```

7. Take the screenshots and review the style guide and every page that
   uses the component, as "Take the screenshots" and "Review your own UI
   change as a designer" say. Chromium repeats the top of a page past
   16,384 pixels, so check that the style guide's phone screenshot is
   shorter than that; this prints its width and height:

   ```sh
   node -e 'const b = require("fs").readFileSync(process.argv[1]); console.log(b.readUInt32BE(16), b.readUInt32BE(20))' docs/screenshots/styleguide--phone--light.png
   ```

   If it is taller, or your section is long (a list of 25 rows), give the
   component a page of its own at `/styleguide/<component>`: add
   `ownPage: true` to its `StyleguideSection`, so the style guide's index
   links to that page and the route `/styleguide/*` shows the section
   there, then add the page to the screenshots as "Add a page to the
   screenshots" says, named `styleguide-<component>`, with
   `"seed": "empty"` and `"user": null`, after the other `styleguide`
   entries in alphabetical order, and take the screenshots again:

   ```sh
   npx vitest run test/web/screenshot-pages.test.ts test/web/routes.test.ts test/web/styleguide-pages.test.ts
   npm run screenshots
   ```

   Point a form on the component's page at the page itself
   (`method="get" action="/styleguide/pill#pill"`) and read what it sent
   from the section's `query` prop; point a form that must post at the
   same path, and show a message when `query` has `posted`. Show the
   states of a component as wide as its column, such as a form control,
   with `ExampleList` from `section.tsx` instead of `StateList`.

## Add an icon

1. Find the icon on lucide.dev and copy its shapes from the Lucide package
   at the version named at the top of `src/web/components/icons.tsx`
   (here `tent`):

   ```sh
   mkdir -p /tmp/lucide
   npm pack lucide-static@1.75.0 --pack-destination /tmp/lucide
   tar -xzf /tmp/lucide/lucide-static-1.75.0.tgz -C /tmp/lucide
   grep -E "<(path|circle|line|rect|polyline|polygon|ellipse)" /tmp/lucide/package/icons/tent.svg
   ```

2. Add it to `src/web/components/icons.tsx` as a component named after
   it, in alphabetical order, and to `ICONS` at the end of the file in the
   same place:

   ```tsx
   export function TentIcon(props: IconProps) {
     return (
       <Icon {...props}>
         <path d="M3.5 21 14 3" />
         <path d="M20.5 21 10 3" />
         <path d="M15.5 21 12 15l-3.5 6" />
         <path d="M2 21h20" />
       </Icon>
     );
   }
   ```

3. Run the icon tests; every icon in `ICONS` is checked for the shared
   frame:

   ```sh
   npx vitest run test/web/components/icons.test.tsx
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
   `test/screenshots/pages.json` gives, or a file it loads fails. It also
   audits every page, as "Audit the pages" says, and ends with
   `The audit found nothing to fix on <n> page(s) in 7 configurations`:

   ```sh
   npm run screenshots
   pgrep -x workerd || echo "no workerd left"
   ```

   When the audit finds something, the run exits non-zero after writing
   the PNGs and prints the findings page by page, one line each: the
   configuration, the check, a CSS selector that matches only that element
   on the page, its first words, and what was measured:

   ```text
   server-location-vote-located
     390 coarse  target  li.tally-list__item:nth-of-type(2) > div.tally-row.tally-row--votable > p.cluster.cluster--tight.cluster--nowrap.u-small.u-muted > span > a "Map of Mailbox Peak": 28.4 px × 16 px, under 44 × 44 px
   ```

   Fix each one in the page or in Cairn ("Audit the pages" says what each
   check measures), and run the script again. Only when the fix is too
   large for the change at hand, allow the finding: add an entry to
   `"allow"` in `test/screenshots/audit-allow.json` with the page, the
   check and the selector exactly as the report prints them, and a reason
   that says why it stays and what would fix it:

   ```json
   {
     "page": "servers-one",
     "check": "cut",
     "selector": "span.app-header__name",
     "reason": "The header shows at most 128px of the name; the whole name is in the open menu. To fix: let the header show the whole name."
   }
   ```

   An entry covers that element in every configuration. An entry that
   matches no finding fails the run too, listed under `match no finding
any more`: delete it.

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

## Audit the pages

1. Run the audit alone, which writes no PNG. It opens every page of
   `test/screenshots/pages.json` as "Take the screenshots" does, in seven
   configurations: `phone light`, `phone dark`, `desktop light` and
   `desktop dark`, as the screenshots are taken, then `320` (320 CSS px
   wide), `390 coarse` (390 px with a coarse pointer and touch) and
   `desktop 200%` (the 1280 px window at 200% zoom: 640 CSS px at twice
   the scale), and exits non-zero with the findings page by page:

   ```sh
   npm run screenshots:audit
   ```

2. Read each finding by its check:
   - `overflow`: the page scrolls sideways at that width; the selector
     names the first element that sticks out past the window. Make it wrap
     or shrink.
   - `target`: a link, button, form control, summary, `[role=button]` or
     label wrapping a control is under 44 × 44 CSS px, measured at 390 px
     (`phone light`, `phone dark` and `390 coarse`); a checkbox or radio is
     measured with its label. A link inside running text is not a target.
     Give the control `--target-min` (a link standing alone on a small
     line: `.u-target`). Something that must stay small goes inside an
     element with `data-audit-exempt="<why>"`; without a reason it is a
     finding itself.
   - `inline-main-path`: the page's primary action (`.button--primary`, or
     an element marked `data-main-path`) is a link inside a sentence. Make
     it a button standing on its own.
   - `cut`: a word is clipped by a box with `overflow: hidden`, cut with
     `text-overflow: ellipsis`, or lies past the window's edge. Text in a
     box that scrolls sideways on purpose is not cut. Let the text wrap.
   - `small-text`: text is drawn smaller than the smallest `--font-size-*`
     token in `public/assets/cairn/tokens.css`. Use the token.
   - `shift`: the layout moved by a cumulative layout shift of 0.05 or more
     while the page loaded, with no input; the selector names an element
     the largest shift moved. Reserve the space before the content arrives.
   - `overlap`: a word, hit-tested at the centre of the part of it that
     shows, lands on another element: one is drawn over the other, or a
     control's hit area covers another control's words. Give them room.
3. Fix each finding, or allow it as "Take the screenshots" says, and run
   the audit again until it prints
   `The audit found nothing to fix on <n> page(s) in 7 configurations`.
   To check one rule of the audit itself, run its tests, which open a
   fixture page that breaks each check and one that passes it:

   ```sh
   npx vitest run test/screenshots/audit.test.ts
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
   Discord, give `"path": "/auth/callback"` and `"cancel": true`. For a
   page with an interactive map, give `"map": true`; for the page as a
   browser without JavaScript shows it, `"javascript": false`. Add one
   entry per state worth seeing, such as `servers`, `servers-many` and
   `servers-none`. A clock reading the Worker writes into a page (the time
   now somewhere) goes in a `<time data-clock data-zone={zone}>`, which the
   script sets to its frozen clock, since the Worker's clock cannot be
   frozen.

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
   names and dates written years ahead, never from today's date. To sign
   `MEMBER_ID` in with a given server list, call `member` there with the
   servers, which of them the bot is in, and the user's display name and
   avatar. Give an avatar or server icon the hash `picture(n)` for a fixed
   picture, or `MISSING_PICTURE` for one that fails to load, both from
   `test/screenshots/discord-cdn.ts`, which answers for Discord's CDN while
   the screenshots are taken; leave it out for none:

   ```ts
   "member-one-server": (e2e) =>
     member(
       e2e,
       [{ id: guildId(1), name: "Ridge Walkers", icon: picture(2) }],
       () => true,
       { globalName: "Ana Hiker", avatar: MISSING_PICTURE },
     ),
   ```

   For a server's page, use `server(steps, as)` there: it sets up the
   server `/g/220000000000000101` with its panel and signs `MEMBER_ID` in
   as a member, as its owner (`"admin"`) or as a member who has left
   (`"stranger"`). `steps` stores the server's rounds and hikes with
   `play.seedRound` from `test/e2e/harness/rounds.ts`, which writes them
   into the guild's object without posting anything: the script runs
   outside Vitest, where waiting for the bot's posts (`eventually`) cannot
   run. Give each round a fixed `startedAt` and dates written out:

   ```ts
   "server-date-vote": server((play, g) =>
     play.seedRound(g, {
       status: "date_voting",
       startedAt: Date.UTC(2030, 5, 2, 18),
       locations: [{ label: "Snow Lake", voters: [MEMBER_ID] }],
       location: "Snow Lake",
       dates: [{ label: "2030-06-15 11:00", voters: [MEMBER_ID] }],
     }),
   ),
   ```

3. For a page that shows what a form did, such as the server's page after
   an admin's action or a member's saved vote, give the entry `"submit"`:
   the page whose form to submit, the form's `action` and the `fields`
   over its own (a list for a field sent once per value, such as ticked
   boxes). The script submits it once, signed in as `user`, and opens
   `path` with the cookies that leaves. When the form answers with the
   page itself instead of a redirect, such as a refused proposal, the
   shots are of that answer, and `status` is its status. Seeded ids are
   fixed, since each page gets a fresh Worker: the first seeded round's
   location vote is poll `1`, its date vote poll `2`, and the first
   option `"1"`:

   ```json
   "submit": {
     "from": "/g/220000000000000101",
     "action": "/g/220000000000000101/polls/1/votes",
     "fields": { "option": ["1", "3"] }
   }
   ```

4. For the page a form answers with itself, such as a refused form
   (status 400), give the entry `"post"`: the form as a CSS selector and
   the fields to fill in by name (a radio or checkbox by its value). The
   script submits it in the browser after `path` loads and takes the page
   that answers, which must answer with `status`:

   ```json
   "post": {
     "form": "#schedule form",
     "fields": { "cadence.enabled": "on" }
   }
   ```

5. A `GET` route that is not a page (a file, a redirect, a plain-text
   answer) goes under `"excluded"` with its `route` as registered and the
   `reason` it has no screenshot.
6. Run the test that compares the list with the web router's `GET` routes:

   ```sh
   npx vitest run test/web/screenshot-pages.test.ts
   ```

7. Follow "Take the screenshots", then "Review your own UI change as a
   designer".

## Review your own UI change as a designer

Do this for every change to `src/web/`, `public/` or `docs/screenshots/`,
before marking the pull request ready. The audit must be clean ("Audit the
pages") before the visual review starts.

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

3. Write the question sentence of each page you changed, as "Start from
   the question" in `docs/design-system.md` says, at the top of
   `## Design review`. Judge the page by it: within a few seconds, the
   person in the sentence finds out what they came for, or sees how to do
   it.
4. Apply the presence test to each page on its phone image in the light
   scheme, element by element, from largest to smallest (sections, cards,
   headings, lines of text, icons, rules, gaps): what question does it
   answer for the person in the sentence, is that already answered
   elsewhere on the screen, and what would they lose if it went? Write a
   row of the presence table for each element. An element that answers
   nothing, or answers what another already does, is a **presence**
   finding: remove it. Eyebrows, leads, icons, helper text, rules and
   empty space are elements too.
5. Check the hierarchy in greyscale. Make a greyscale copy of each phone
   image, open it, and write down the first three things the eye reaches,
   in order; they are the page's answers to its question, most important
   first:

   ```sh
   mkdir -p /tmp/grey
   node -e 'require("sharp")(process.argv[1]).greyscale().toFile(process.argv[2]).then(() => console.log("wrote", process.argv[2]))' docs/screenshots/<file> /tmp/grey/<file>
   ```

6. Go through this checklist for each page, as a critical designer who has
   never seen it:
   - **Purpose and hierarchy.** Within a few seconds it is clear what the
     page is, what state the hike is in, and what the visitor can do next.
     There is one primary action, and it looks like one. ("Principles" and
     "Designing a new page" in `docs/design-system.md`.)
   - **Main path.** The thing the question sentence is about is a button
     or a standalone link with a 44px target, not a link inside a
     sentence. ("Layout rules" in `docs/design-system.md`.)
   - **Honest feedback.** A press shows at once with a finger as with a
     mouse, and with no eased colour; a form that posts shows its button
     busy; a forecast or a tally says how old it is, and every heading,
     count, caption and age describes the data on the screen. After an
     action, the page shows what is now true, in place or in a banner
     that says it. ("States", "Motion" and "Forms" in
     `docs/design-system.md`.)
   - **Consistency.** Headings, buttons, forms, spacing, colours and wording
     look and behave like the existing pages and components, built from
     Cairn's tokens and components. ("Tokens", "Components" and "Layout
     rules" in `docs/design-system.md`; compare with `/styleguide`.)
   - **Every state.** Each data view's loading, empty, error, partial and
     first run; each control's rest, hover, focus-visible, pressed,
     disabled and busy, small links included; the page after each action;
     very long text (a 100-character location name) and many items (25
     options) each look right. Add a page entry with a seed for each state
     that differs. ("States" in `docs/design-system.md`.)
   - **Phone layout.** Nothing scrolls sideways at 390px, and every tap
     target is at least 44px high and wide. ("Layout rules" in
     `docs/design-system.md`.)
   - **Accessibility.** Text contrast is at least 4.5:1 (3:1 for large
     text); focus is visible and moves in a sensible order; every control
     has a label; headings go in order without skipping a level; everything
     works from the keyboard alone; nothing is conveyed by colour alone;
     motion stops under `prefers-reduced-motion`. ("Accessibility rules" and
     "Allowed pairings" in `docs/design-system.md`.)
   - **Wording.** Plain words from the reader's side (what happened, then
     what to do), and the same words the bot uses in Discord for the same
     things. Every number has its unit; ages and durations are written
     one way ("14 min ago", "2 h 9 min"); a hike's or a vote's time reads
     as it does in Discord ("Sat, 5 Dec 2026 · 09:00"). ("Content rules"
     in `docs/design-system.md`.)
   - **Numbers.** Counts and forecast columns people compare are in
     tabular figures and right-aligned, with the unit once in the column
     head. ("Layout rules" in `docs/design-system.md`.)
   - **Dark scheme.** Every colour, border, image and focus ring still
     works on the dark background. ("Colour" in `docs/design-system.md`.)
   - **Visual direction.** Hiking-themed through restraint: the blaze only
     as a marker, contour lines only in the header or an empty state, no
     photos, emoji, decorative gradients or shadows outside overlays, and
     none of the marks of generated work: pill badges on everything, cards
     with a coloured edge for decoration, an eyebrow above every heading,
     everything centred. ("Visual direction" and "Nothing that marks
     generated work" in `docs/design-system.md`.)

7. Measure what can be measured rather than judging it from the images.
   Run the contrast and token tests:

   ```sh
   npx vitest run test/web/contrast.test.ts test/web/token-use.test.ts
   ```

   For every other rule in "Measure what can be measured" in
   `docs/design-system.md` (eased colour, the press on touch, busy, links
   on the main path, tabular right-aligned numbers, targets, sideways
   overflow and cut words, layout shift), measure it as that table's
   middle column says, in a browser against the dev server ("Run the bot
   locally" in the root `AGENTS.md`), at 390px with touch emulation and at
   200% zoom. Where the pull request's checks include the automated check
   the table's last column names, read its result instead. Say in the
   review which rules you measured and how.

   A screenshot does not show focus, keyboard order, a press or motion
   either: check those in the browser too. Without a browser, list a
   page's controls in focus order and read their labels from the HTML:

   ```sh
   curl -fsS http://localhost:8787/ | grep -oE '<(a|button|input|select|textarea|label|h[1-6])\b[^>]*>'
   ```

8. Give each finding a severity. Three kinds of finding have a fixed
   severity; write the kind in the finding's line:
   - **blocker**: a visitor cannot do the job, or the page breaks or shuts
     someone out (unreadable text, a control without a label, sideways
     scrolling on a phone, a dead end).
   - **major**: the job is hard, slow or misleading (no clear primary action
     or two of them, contrast below the minimum, a target under 44px, a
     state that looks broken, words that differ from the bot's, a number
     without its unit).
     - **honest feedback**: a press that does not show at once (with a
       finger too), a form that posts without showing it is busy, an
       eased colour, or a heading, count, caption or age that describes
       data not on the screen.
     - **main path in a sentence**: the thing the question sentence is
       about is reached only by a link inside running text.
     - **presence**, misleading: an element that suggests something that
       is not true, such as a status pill on a vote that has closed.
   - **minor**: noticeably off without getting in the way (uneven spacing,
     misalignment, a component that differs from its siblings).
     - **presence**: an element that answers no question for the person
       in the sentence, or one another element already answers.
   - **nit**: taste.
9. Fix every blocker and major in what your change adds or changes, take
   the screenshots again and repeat from step 1. Fix or explain the rest.
   A finding in a component or page your change does not touch, such as
   a shared button that eases its colour, goes in the review marked
   **existing**, with no fix asked of this pull request.
10. Write the findings into the `## Design review` section of the pull
    request description, under the question sentence and the presence
    table, one line each: the severity, the kind where it has one, the
    page, viewport and scheme, what you saw, and what was done about it:

    ```text
    Question: a member who tapped the link in the vote's Discord message, on their phone, wants to see which places are in the location vote and vote for the ones they would go to.

    - **major** (honest feedback) server-location-vote (phone, light): "Save votes" shows no press until the finger lifts, and nothing shows the votes are being sent. Fixed: the button is pressed from the touch and busy until the page answers.
    - **major** (main path in a sentence) server-empty-admin (phone, light): the only way to start the vote is "start one" inside the empty state's sentence. Fixed: "Start location vote" is a button under it.
    - **minor** (presence) server-location-vote (phone, light): the eyebrow "Location vote" above the card heading "Location vote" answers nothing the heading does not. Fixed: the eyebrow is gone.
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

3. Read only the question sentence at the top of the author's
   `## Design review`. If it is missing, or does not name who is looking
   and what they are trying to find out or do, request changes for that
   first: the page cannot be judged without it.
4. Open every before and after image and follow steps 4 to 8 of "Review
   your own UI change as a designer" yourself, before reading the rest of
   the author's `## Design review`: judge each page against its question
   sentence, apply the presence test element by element and write your
   own presence table, check the hierarchy in greyscale, go through the
   checklist, read the measured checks, and give each finding its
   severity and kind (presence, honest feedback, main path in a
   sentence). Be critical: judge the page as a member who has never seen
   it would, independently of the author's notes.
5. Compare your findings and your presence table with the author's.
   Request changes for every blocker or major in what the pull request
   adds or changes that the author missed, or recorded without fixing. A
   finding in a part the pull request does not touch is recorded as
   **existing** and is no reason to request changes:

   ```sh
   gh pr review <n> --request-changes --body-file <file>
   ```

6. In the review, say what you saw in the screenshots, page by page, at
   each viewport and scheme, which measured checks you read and which
   rules you measured by hand. A review of a UI pull request that does
   not say what was seen in the screenshots is not a design review.
