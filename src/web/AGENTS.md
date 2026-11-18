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

3. Write its tests as "Test a page" says, then check the whole change:

   ```sh
   npm run typecheck
   npm run lint
   npm test
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
