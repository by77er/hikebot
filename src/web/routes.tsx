/**
 * The Worker's web routes: every request except `/interactions` comes here.
 * In production Workers Static Assets answers a request for a file under
 * `public/` before the Worker runs; `/assets/*` here serves the same files
 * when a request does reach the Worker (as in the unit tests), and turns a
 * missing one into the HTML 404 page. `/assets/v/<version>/*` serves the
 * same files cacheable for a year (see `src/web/assets.ts`).
 * `/maps/sample.png` is the map picture of the sample point in
 * `maps/regions.json`, which the deploy's smoke check fetches to prove the
 * map pictures work in production.
 */
import regions from "../../maps/regions.json";
import { systemNow } from "../clock";
import { mapPainter } from "../maps/map-painter";
import { versionedAsset } from "./assets";
import { addSignInRoutes } from "./auth/routes";
import { readSession } from "./auth/session";
import { calendarRoute } from "./calendar";
import { inviteUrl } from "./invite";
import { MethodNotAllowedPage, NotFoundPage } from "./pages/errors";
import { HomePage } from "./pages/home";
import {
  ownPageSection,
  StyleguidePage,
  StyleguideSectionPage,
} from "./pages/styleguide";
import { seeOther } from "./redirect";
import { htmlResponse } from "./response";
import { WebRouter } from "./router";
import { parseTokens } from "./tokens";

export const HEALTH_LINE = "hikebot is running";

const notFound = () => htmlResponse(<NotFoundPage />, { status: 404 });

export const webRouter = new WebRouter({
  notFound,
  methodNotAllowed: () =>
    htmlResponse(<MethodNotAllowedPage />, { status: 405 }),
})
  .get("/", async (request, env) =>
    (await readSession(request, env, systemNow()))
      ? seeOther("/servers")
      : htmlResponse(<HomePage inviteUrl={inviteUrl(env)} />),
  )
  .get("/styleguide", async (request, env) => {
    const tokensCss = await env.ASSETS.fetch(
      new URL("/assets/cairn/tokens.css", request.url),
    );
    const tokens = parseTokens(await tokensCss.text());
    return htmlResponse(<StyleguidePage tokens={tokens} />);
  })
  .get("/styleguide/*", async (request, env) => {
    const url = new URL(request.url);
    const section = ownPageSection(url.pathname.slice("/styleguide/".length));
    if (!section) return notFound();
    const tokensCss = await env.ASSETS.fetch(
      new URL("/assets/cairn/tokens.css", request.url),
    );
    const tokens = parseTokens(await tokensCss.text());
    return htmlResponse(
      <StyleguideSectionPage
        section={section}
        tokens={tokens}
        query={url.searchParams}
      />,
    );
  })
  // The style guide's posting forms, such as the confirmation page's, land
  // here: nothing changes, and the page says the form was posted.
  .post("/styleguide/*", (request) => {
    const id = new URL(request.url).pathname.slice("/styleguide/".length);
    const section = ownPageSection(id);
    if (!section) return notFound();
    return seeOther(`/styleguide/${section.id}?posted=1#${section.id}`);
  })
  .get("/assets/*", async (request, env) => {
    const asset = await env.ASSETS.fetch(request);
    return asset.status === 404 ? notFound() : asset;
  })
  .get("/assets/v/*", async (request, env) => {
    return (await versionedAsset(request, env)) ?? notFound();
  })
  .get("/calendar/*", calendarRoute(notFound))
  .get("/maps/sample.png", async (_request, env) => {
    const { lon, lat } = regions.samplePoint;
    const picture = await mapPainter(env).picture({ lon, lat });
    if (!picture) return notFound();
    return new Response(picture.png, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  })
  .get(
    "/healthz",
    () =>
      new Response(`${HEALTH_LINE}\n`, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }),
  );

addSignInRoutes(webRouter);
